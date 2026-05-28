const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const db = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }   // classroom LAN, no security needed
});

const PORT = process.env.PORT || 3000;

// ============ DB INIT (persistence for classroom restarts) ============
db.initDb();

// Load any previously saved games from disk so state survives between class periods
const savedGames = db.loadAllGames();
console.log(`[DB] Loaded ${savedGames.length} saved game(s) from disk`);

// ============ GAME CONSTANTS (easy to tweak for class) ============
const MAX_TEAMS = 4;
const TEAM_SIZE = 3;                    // exactly 3 roles per team
const ROLE_ORDER = ['war', 'negotiator', 'builder'];
const ROLE_LABELS = {
  war: 'War Commander',
  negotiator: 'Negotiator',
  builder: 'Builder'
};

const START_TITANIUM = 120;
const START_FACTORY_HP = 100;

const MINER_COST = 30;
const MINER_TIME = 45;      // seconds - produces passive income
const FIGHTER_COST = 20;
const FIGHTER_TIME = 30;
const CANON_COST = 10;
const CANON_TIME = 60;

const BASE_PASSIVE = 5;
const MINER_PASSIVE = 3;    // +3 Ti per miner every cycle
const PASSIVE_INTERVAL_TICKS = 15;   // every 15 seconds

const TRAVEL_TIME = 8;               // seconds for fleets
const FIGHTER_DAMAGE = 7;            // per survivor to factory
const MAX_QUEUE = 4;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars

// ============ IN-MEMORY STATE ============
const games = new Map(); // code -> Game

// Helper: socketId -> { game, teamName, playerName, role }
const socketToPlayer = new Map();

function generateCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

// Team data structure (shared resources + 3 role players)
class Team {
  constructor(name) {
    this.name = name;
    this.titanium = START_TITANIUM;
    this.miners = 0;
    this.fighters = 0;
    this.canons = 0;
    this.factoryHP = START_FACTORY_HP;
    this.players = new Map(); // playerName -> { name, role, socketId }
    this.buildQueue = [];
    this.currentBuild = null; // { type, remaining }
  }

  getRolePlayer(role) {
    for (const p of this.players.values()) {
      if (p.role === role) return p;
    }
    return null;
  }

  isFull() {
    return this.players.size >= TEAM_SIZE;
  }
}

class Game {
  constructor(code, hostSocketId) {
    this.code = code;
    this.hostSocketId = hostSocketId;
    this.status = 'waiting';           // waiting | running | ended
    this.teams = new Map();            // teamName -> Team
    this.fleets = [];                  // in-transit
    this.eventLog = [];
    this.tickCounter = 0;
    this.lastIncomeTick = 0;
    this.winner = null;

    // Map system (new for ui-map branch)
    this.mapSize = 13;                 // 13, 15, or 17
    this.map = null;                   // { gasGiant, moons: [], starts: {teamName: {x,y}} }
  }

  // Create a new team or return existing
  getOrCreateTeam(teamName) {
    if (!this.teams.has(teamName)) {
      const team = new Team(teamName);
      this.teams.set(teamName, team);
      return team;
    }
    return this.teams.get(teamName);
  }

  // Add player to a team and assign next available role
  addPlayerToTeam(teamName, playerName, socketId) {
    const team = this.getOrCreateTeam(teamName);

    // Rejoin: same player name on same team keeps their role
    if (team.players.has(playerName)) {
      const p = team.players.get(playerName);
      p.socketId = socketId;
      socketToPlayer.set(socketId, { game: this, teamName, playerName, role: p.role });
      return { team, player: p, isNew: false };
    }

    if (team.isFull()) {
      throw new Error(`Team "${teamName}" is full (3 players)`);
    }
    if (this.teams.size > MAX_TEAMS && !this.teams.has(teamName)) {
      throw new Error('Maximum number of teams reached');
    }

    // Assign next role in order
    const usedRoles = new Set(Array.from(team.players.values()).map(p => p.role));
    let assignedRole = null;
    for (const r of ROLE_ORDER) {
      if (!usedRoles.has(r)) {
        assignedRole = r;
        break;
      }
    }
    if (!assignedRole) assignedRole = 'war'; // fallback (shouldn't happen)

    const player = { name: playerName, role: assignedRole, socketId };
    team.players.set(playerName, player);
    socketToPlayer.set(socketId, { game: this, teamName, playerName, role: assignedRole });

    return { team, player, isNew: true, assignedRole };
  }

  getPlayerBySocket(socketId) {
    return socketToPlayer.get(socketId) || null;
  }

  isHost(socketId) {
    return this.hostSocketId === socketId;
  }

  addEvent(text) {
    this.eventLog.push(text);
    if (this.eventLog.length > 20) this.eventLog.shift();
  }

  getTeamByName(name) {
    return this.teams.get(name) || null;
  }

  getAliveTeams() {
    return Array.from(this.teams.values()).filter(t => t.factoryHP > 0);
  }
}

// ============ PERSISTENCE HELPERS ============

function persistGameState(game) {
  try {
    db.saveGame(game.code, game.status, game.winner);

    for (const team of game.teams.values()) {
      db.upsertTeam(game.code, team.name, {
        titanium: team.titanium,
        miners: team.miners,
        fighters: team.fighters,
        canons: team.canons,
        factoryHP: team.factoryHP
      });

      for (const p of team.players.values()) {
        db.addOrUpdatePlayer(game.code, team.name, p.name, p.role);
      }
    }

    // Replace fleets for this game (simple approach)
    db.clearFleetsForGame(game.code);
    for (const f of game.fleets) {
      db.addFleet(game.code, f.from, f.to, f.fighters, f.arrivalTime);
    }

    // === NEW: Persist map data if it exists ===
    if (game.map && game.map.gasGiant) {
      db.saveGameMap(game.code, game.mapSize, game.map.gasGiant, game.map.moons || []);
      if (game.map.starts) {
        db.saveTeamStarts(game.code, game.map.starts);
      }
    }

    // Also ensure map_size is set even if no full map yet
    if (game.mapSize) {
      db.updateGameStatusAndMapSize(game.code, game.status, game.mapSize);
    }
  } catch (e) {
    console.error('[DB] Persist error:', e.message);
  }
}

function hydrateSavedGame(saved) {
  const game = new Game(saved.code, null); // hostSocketId will be set on first reconnect
  game.status = saved.status;
  game.winner = saved.winner || null;
  game.mapSize = saved.mapSize || 13;

  // Rebuild teams
  for (const t of saved.teams) {
    const team = new Team(t.name);
    team.titanium = t.titanium;
    team.miners = t.miners;
    team.fighters = t.fighters;
    team.canons = t.canons;
    team.factoryHP = t.factoryHP;
    game.teams.set(t.name, team);
  }

  // Rebuild player role assignments (no sockets yet)
  for (const p of saved.players) {
    const team = game.teams.get(p.teamName);
    if (team) {
      team.players.set(p.name, {
        name: p.name,
        role: p.role,
        socketId: null
      });
    }
  }

  // Rebuild fleets
  game.fleets = saved.fleets.map(f => ({
    id: Date.now() + Math.random(),
    from: f.from,
    to: f.to,
    fighters: f.fighters,
    arrivalTime: f.arrivalTime
  }));

  // === NEW: Restore persisted map data if available ===
  if (saved.mapData && saved.mapData.gasGiant) {
    game.map = {
      gasGiant: saved.mapData.gasGiant,
      moons: saved.mapData.moons || [],
      starts: saved.teamStarts || {}
    };
    console.log(`[DB] Restored full map data for ${saved.code}`);
  } else if (game.status === 'running' || game.status === 'saved') {
    // Fallback: regenerate if we have no map data but game was active/saved
    generateMapForGame(game);
  }

  return game;
}

// Hydrate any games that were saved from previous runs
// We now restore 'waiting', 'running', and 'saved' games (but not 'ended')
for (const saved of savedGames) {
  if (saved.status !== 'ended') {
    const game = hydrateSavedGame(saved);
    games.set(saved.code, game);
    console.log(`[DB] Restored game ${saved.code} (status: ${saved.status}) with ${game.teams.size} team(s)`);
  }
}

// ============ GAME LOOP (runs every second) ============
setInterval(() => {
  for (const game of games.values()) {
    if (game.status !== 'running') continue;

    game.tickCounter++;

    processBuilds(game);
    processFleets(game);

    // Passive mining (now benefits from miners)
    if ((game.tickCounter - game.lastIncomeTick) >= PASSIVE_INTERVAL_TICKS) {
      givePassiveIncome(game);
      game.lastIncomeTick = game.tickCounter;
    }

    checkWinCondition(game);

    // Broadcast + persist
    broadcastState(game);
    persistGameState(game);
  }
}, 1000);

// Broadcast full state to all players + the host (pure host has no role)
function broadcastState(game) {
  // Build sanitized teams list (what everyone sees)
  const teams = [];
  for (const t of game.teams.values()) {
    const members = Array.from(t.players.values()).map(p => ({
      name: p.name,
      role: p.role,
      label: ROLE_LABELS[p.role]
    }));

    teams.push({
      name: t.name,
      titanium: t.titanium,
      miners: t.miners,
      fighters: t.fighters,
      canons: t.canons,
      factoryHP: t.factoryHP,
      factoryPercent: Math.round((t.factoryHP / START_FACTORY_HP) * 100),
      members,
      incomePerCycle: BASE_PASSIVE + (t.miners * MINER_PASSIVE)
    });
  }

  // Fleets with ETAs
  const fleets = game.fleets.map(f => ({
    from: f.from,
    to: f.to,
    fighters: f.fighters,
    eta: Math.max(1, Math.ceil((f.arrivalTime - Date.now()) / 1000))
  }));

  // Build status per team
  const builds = {};
  for (const [name, team] of game.teams) {
    builds[name] = {
      queue: [...team.buildQueue],
      current: team.currentBuild
    };
  }

  const basePayload = {
    code: game.code,
    status: game.status,
    teams,
    fleets,
    builds,
    eventLog: [...game.eventLog],
    winner: game.winner,
    // Map data (new)
    mapSize: game.mapSize,
    map: game.map ? {
      gasGiant: game.map.gasGiant,
      moons: game.map.moons || []
      // starts are sent privately below
    } : null
  };

  // Send to regular players (they have role + team)
  for (const [socketId, info] of socketToPlayer) {
    if (info.game.code !== game.code) continue;

    const payload = {
      ...basePayload,
      myTeam: info.teamName,
      myRole: info.role,
      myRoleLabel: ROLE_LABELS[info.role],
      isHost: game.hostSocketId === socketId
    };

    // Give this player their private starting location only
    if (game.map && game.map.starts && info.teamName) {
      payload.myStart = game.map.starts[info.teamName] || null;
    }

    io.to(socketId).emit('gameUpdate', payload);
  }

  // Explicitly send to the pure host (if they are not also in socketToPlayer)
  if (game.hostSocketId && !socketToPlayer.has(game.hostSocketId)) {
    const hostPayload = {
      ...basePayload,
      myTeam: null,
      myRole: null,
      myRoleLabel: null,
      isHost: true,
      myStart: null
    };
    io.to(game.hostSocketId).emit('gameUpdate', hostPayload);
  }
}

function processBuilds(game) {
  for (const team of game.teams.values()) {
    if (team.factoryHP <= 0) continue;

    let current = team.currentBuild;

    if (!current && team.buildQueue.length > 0) {
      const nextType = team.buildQueue.shift();
      let time;
      if (nextType === 'miner') time = MINER_TIME;
      else if (nextType === 'fighter') time = FIGHTER_TIME;
      else time = CANON_TIME;

      current = { type: nextType, remaining: time };
      team.currentBuild = current;
      game.addEvent(`[${team.name}] Builder started ${nextType.toUpperCase()}`);
    }

    if (current) {
      current.remaining--;
      if (current.remaining <= 0) {
        // Complete build
        if (current.type === 'miner') team.miners++;
        else if (current.type === 'fighter') team.fighters++;
        else team.canons++;

        game.addEvent(`[${team.name}] completed 1 ${current.type.toUpperCase()}`);
        team.currentBuild = null;
      }
    }
  }
}

function processFleets(game) {
  const now = Date.now();
  const stillInFlight = [];

  for (const fleet of game.fleets) {
    if (fleet.arrivalTime <= now) {
      resolveCombat(game, fleet);
    } else {
      stillInFlight.push(fleet);
    }
  }
  game.fleets = stillInFlight;
}

function resolveCombat(game, fleet) {
  const attackerTeam = game.getTeamByName(fleet.from);
  const defenderTeam = game.getTeamByName(fleet.to);

  const originalCount = fleet.fighters;

  if (!defenderTeam || defenderTeam.factoryHP <= 0) {
    if (attackerTeam && attackerTeam.factoryHP > 0) {
      attackerTeam.fighters += originalCount;
    }
    game.addEvent(`Fleet from ${fleet.from} returned safely (${fleet.to} already destroyed)`);
    return;
  }

  const canons = defenderTeam.canons || 0;
  const killed = Math.min(originalCount, canons);
  const survivors = originalCount - killed;
  const damage = survivors * FIGHTER_DAMAGE;

  defenderTeam.factoryHP = Math.max(0, defenderTeam.factoryHP - damage);

  let msg = `${fleet.from} attacked ${fleet.to} with ${originalCount} FTR. `;
  if (killed > 0) msg += `${killed} shot down. `;
  if (survivors > 0) {
    msg += `${survivors} hit for ${damage} damage`;
    if (attackerTeam && attackerTeam.factoryHP > 0) {
      attackerTeam.fighters += survivors;
      msg += ` — ${survivors} returned.`;
    } else {
      msg += ` (attacker eliminated, survivors lost).`;
    }
  } else {
    msg += `All destroyed, no damage.`;
  }
  game.addEvent(msg);

  // Killing blow bonus
  if (defenderTeam.factoryHP <= 0 && attackerTeam && attackerTeam.factoryHP > 0) {
    attackerTeam.titanium += 25;
    game.addEvent(`${fleet.from} DESTROYED ${fleet.to}'s factory! (+25 Ti bonus)`);
  }
}

function givePassiveIncome(game) {
  for (const team of game.teams.values()) {
    if (team.factoryHP > 0) {
      const income = BASE_PASSIVE + (team.miners * MINER_PASSIVE);
      team.titanium += income;
    }
  }
  game.addEvent(`Mining cycle complete — all teams received passive income`);
}

function checkWinCondition(game) {
  const alive = game.getAliveTeams();

  if (alive.length <= 1 && game.status === 'running') {
    game.status = 'ended';
    if (alive.length === 1) {
      game.winner = alive[0].name;
      game.addEvent(`GAME OVER — ${game.winner} WINS!`);
    } else {
      game.addEvent(`GAME OVER — all teams eliminated.`);
    }
    persistGameState(game);
  }
}

// === MAP GENERATION (ui-map branch) ===
function generateMapForGame(game) {
  const size = game.mapSize;
  const center = Math.floor(size / 2);

  const gasGiant = { x: center, y: center };

  // Simple moon count scaling
  const moonCount = size === 13 ? 5 : size === 15 ? 7 : 10;

  const moons = [];
  // Place moons in a rough ring, avoiding center and edges too much
  const ringDistance = Math.floor(size * 0.28);
  for (let i = 0; i < moonCount; i++) {
    const angle = (i / moonCount) * Math.PI * 2;
    let mx = Math.round(center + Math.cos(angle) * ringDistance);
    let my = Math.round(center + Math.sin(angle) * ringDistance * 0.85);

    // Clamp + jitter to avoid overlap with center
    mx = Math.max(2, Math.min(size - 3, mx + (i % 3 - 1)));
    my = Math.max(2, Math.min(size - 3, my + (Math.floor(i / 2) % 3 - 1)));

    moons.push({ x: mx, y: my });
  }

  // Assign one starting location per team, well spaced and away from center
  const starts = {};
  const teamNames = Array.from(game.teams.keys());
  const margin = Math.floor(size * 0.22);

  teamNames.forEach((teamName, index) => {
    // Spread starts in corners/edges
    const positions = [
      { x: margin, y: margin },
      { x: size - 1 - margin, y: margin },
      { x: margin, y: size - 1 - margin },
      { x: size - 1 - margin, y: size - 1 - margin },
      { x: margin, y: Math.floor(size / 2) },
      { x: size - 1 - margin, y: Math.floor(size / 2) },
    ];

    let pos = positions[index % positions.length];

    // Small offset per team to avoid exact overlap
    pos = {
      x: Math.max(1, Math.min(size - 2, pos.x + (index % 3) - 1)),
      y: Math.max(1, Math.min(size - 2, pos.y + Math.floor(index / 3) - 1))
    };

    // Ensure not on gas giant
    if (pos.x === center && pos.y === center) {
      pos.x = Math.max(1, pos.x - 2);
    }

    starts[teamName] = pos;
  });

  game.map = {
    gasGiant,
    moons,
    starts   // teamName -> {x, y}
  };

  console.log(`[MAP] Generated ${size}x${size} map for game ${game.code} with ${moons.length} moons`);
}

// ============ SOCKET HANDLERS (Team + Role based) ============
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Host (teacher) creates a new game session — host does NOT join any team
  socket.on('createGame', ({ hostName }, cb) => {
    let code;
    do { code = generateCode(); } while (games.has(code));

    const game = new Game(code, socket.id);
    game.hostName = (hostName || '').trim().slice(0, 20) || 'Teacher';

    games.set(code, game);
    socket.join(code);

    game.addEvent(`Host created session (${game.hostName})`);
    persistGameState(game);

    console.log(`Game created: ${code} by host (${game.hostName})`);
    cb({ ok: true, code, isHost: true, hostName: game.hostName });
  });

  // Teacher reclaims host status on refresh (using the code)
  socket.on('reclaimAsHost', ({ code }, cb) => {
    const game = games.get(code);
    if (!game) return cb({ ok: false, error: 'Invalid code' });
    if (game.status === 'ended') return cb({ ok: false, error: 'Game already ended' });
    // 'saved' games are allowed to be reclaimed/joined (treated like waiting)

    // Rebind as host
    game.hostSocketId = socket.id;
    socket.join(code);

    console.log(`Host reclaimed session ${code}`);
    cb({ ok: true, code, isHost: true, hostName: game.hostName || 'Teacher' });

    // Send current state to the reconnected host
    broadcastState(game);
  });

  // Player joins an existing game + team (role auto-assigned)
  socket.on('joinGame', ({ code, teamName, playerName }, cb) => {
    const game = games.get(code);
    if (!game) return cb({ ok: false, error: 'Invalid code' });
    if (game.status === 'ended') return cb({ ok: false, error: 'Game already ended' });
    // 'saved' games are allowed to be reclaimed/joined (treated like waiting)

    const tName = (teamName || '').trim().slice(0, 16);
    const pName = (playerName || '').trim().slice(0, 14);

    if (!tName || !pName) return cb({ ok: false, error: 'Team name and player name required' });

    try {
      const result = game.addPlayerToTeam(tName, pName, socket.id);
      socket.join(code);

      const roleLabel = ROLE_LABELS[result.player.role];
      if (result.isNew) {
        game.addEvent(`[${tName}] ${pName} joined as ${roleLabel}`);
      } else {
        game.addEvent(`[${tName}] ${pName} reconnected as ${roleLabel}`);
      }

      persistGameState(game);
      broadcastState(game);

      cb({
        ok: true,
        code,
        teamName: tName,
        playerName: pName,
        role: result.player.role,
        roleLabel,
        isHost: game.isHost(socket.id)
      });
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  socket.on('startGame', (payload, cb) => {
    // Support both pure host and (legacy) player who happens to be host
    let game = null;
    const info = socketToPlayer.get(socket.id);
    if (info) {
      game = info.game;
    } else {
      // Check if this socket is the registered host
      for (const g of games.values()) {
        if (g.hostSocketId === socket.id) {
          game = g;
          break;
        }
      }
    }
    if (!game) return cb?.({ ok: false, error: 'Not in a game' });
    if (!game.isHost(socket.id)) return cb?.({ ok: false, error: 'Only host can start' });

    const completeTeams = Array.from(game.teams.values()).filter(t => t.players.size === TEAM_SIZE);
    if (completeTeams.length < 2) {
      return cb?.({ ok: false, error: 'Need at least 2 full teams (3 players each)' });
    }

    // Capture map size from host (default 13 if not provided)
    if (payload && payload.mapSize) {
      const size = parseInt(payload.mapSize);
      if ([13, 15, 17].includes(size)) {
        game.mapSize = size;
      }
    }

    // Generate map (gas giant, moons, team starting positions)
    generateMapForGame(game);

    game.status = 'running';
    game.addEvent('GAME STARTED — Coordinate with your team! Builder produces, Negotiator trades, War Commander attacks.');
    persistGameState(game);
    broadcastState(game);
    cb?.({ ok: true });
  });

  // Builder-only action
  socket.on('queueBuild', ({ type }, cb) => {
    const info = socketToPlayer.get(socket.id);
    if (!info || info.role !== 'builder') return cb?.({ ok: false, error: 'Only the Builder can queue production' });

    const game = info.game;
    if (game.status !== 'running') return cb?.({ ok: false });

    const team = game.getTeamByName(info.teamName);
    if (!team || team.factoryHP <= 0) return cb?.({ ok: false });

    const cost = (type === 'miner') ? MINER_COST : (type === 'fighter') ? FIGHTER_COST : CANON_COST;
    if (team.titanium < cost) return cb?.({ ok: false, error: 'Not enough titanium' });
    if (team.buildQueue.length >= MAX_QUEUE) return cb?.({ ok: false, error: 'Queue full (max 4)' });

    team.titanium -= cost;
    team.buildQueue.push(type);

    game.addEvent(`[${info.teamName}] Builder queued 1 ${type.toUpperCase()}`);
    persistGameState(game);
    broadcastState(game);
    cb?.({ ok: true });
  });

  // War Commander-only action
  socket.on('launchAttack', ({ targetTeam, numFighters }, cb) => {
    const info = socketToPlayer.get(socket.id);
    if (!info || info.role !== 'war') return cb?.({ ok: false, error: 'Only the War Commander can launch attacks' });

    const game = info.game;
    if (game.status !== 'running') return cb?.({ ok: false });

    const attacker = game.getTeamByName(info.teamName);
    const defender = game.getTeamByName(targetTeam);

    if (!attacker || !defender) return cb?.({ ok: false });
    if (info.teamName === targetTeam) return cb?.({ ok: false });
    if (attacker.factoryHP <= 0 || defender.factoryHP <= 0) return cb?.({ ok: false });
    if (numFighters < 1 || numFighters > attacker.fighters) return cb?.({ ok: false });

    attacker.fighters -= numFighters;

    const arrivalTime = Date.now() + (TRAVEL_TIME * 1000);
    game.fleets.push({
      id: Date.now() + Math.random(),
      from: info.teamName,
      to: targetTeam,
      fighters: numFighters,
      arrivalTime
    });

    game.addEvent(`[${info.teamName}] War Commander launched ${numFighters} FTR at ${targetTeam} (ETA ${TRAVEL_TIME}s)`);
    persistGameState(game);
    broadcastState(game);
    cb?.({ ok: true });
  });

  // Negotiator-only action
  socket.on('transferTi', ({ targetTeam, amount }, cb) => {
    const info = socketToPlayer.get(socket.id);
    if (!info || info.role !== 'negotiator') return cb?.({ ok: false, error: 'Only the Negotiator can transfer titanium' });

    const game = info.game;
    if (game.status !== 'running') return cb?.({ ok: false });

    const sender = game.getTeamByName(info.teamName);
    const receiver = game.getTeamByName(targetTeam);

    if (!sender || !receiver || info.teamName === targetTeam) return cb?.({ ok: false });
    if (sender.factoryHP <= 0 || receiver.factoryHP <= 0) return cb?.({ ok: false });
    if (![10, 25, 50].includes(amount)) return cb?.({ ok: false });
    if (sender.titanium < amount) return cb?.({ ok: false });

    sender.titanium -= amount;
    receiver.titanium += amount;

    game.addEvent(`[${info.teamName}] Negotiator transferred ${amount} Ti to ${targetTeam}`);
    persistGameState(game);
    broadcastState(game);
    cb?.({ ok: true });
  });

  socket.on('endGame', (cb) => {
    // Support both pure host and (legacy) player who happens to be host
    let game = null;
    const info = socketToPlayer.get(socket.id);
    if (info) {
      game = info.game;
    } else {
      for (const g of games.values()) {
        if (g.hostSocketId === socket.id) {
          game = g;
          break;
        }
      }
    }
    if (!game) return cb?.({ ok: false, error: 'Not in a game' });
    if (!game.isHost(socket.id)) return cb?.({ ok: false, error: 'Only host can end the game' });

    game.status = 'ended';
    game.addEvent('Game ended cleanly by host');
    persistGameState(game);
    broadcastState(game);
    cb?.({ ok: true });
  });

  // New: Teacher can save a game for later without fully ending it
  socket.on('saveGame', (cb) => {
    let game = null;
    const info = socketToPlayer.get(socket.id);
    if (info) {
      game = info.game;
    } else {
      for (const g of games.values()) {
        if (g.hostSocketId === socket.id) {
          game = g;
          break;
        }
      }
    }
    if (!game) return cb?.({ ok: false, error: 'Not in a game' });
    if (!game.isHost(socket.id)) return cb?.({ ok: false, error: 'Only host can save the game' });

    const previousStatus = game.status;
    game.status = 'saved';
    game.addEvent('Game saved by host for later use');
    persistGameState(game);

    // Remove from active memory? No — keep it so the host can continue working with it if desired.
    // But mark clearly as saved.

    broadcastState(game);
    cb?.({ ok: true, status: 'saved' });
  });

  // New: List all savable games for the teacher (on /host page)
  socket.on('listSavedGames', (cb) => {
    const allGames = db.loadAllGames();
    const savable = allGames
      .filter(g => g.status !== 'ended')
      .map(g => ({
        code: g.code,
        status: g.status,
        mapSize: g.mapSize,
        teamCount: g.teams ? g.teams.length : 0,
        playerCount: g.players ? g.players.length : 0,
        lastSaved: g.last_saved || null
      }));

    cb?.({ ok: true, games: savable });
  });

  // New: Load a previously saved game into active memory
  socket.on('loadSavedGame', ({ code }, cb) => {
    if (!games.has(code)) {
      // Try to load it fresh from DB
      const allSaved = db.loadAllGames();
      const found = allSaved.find(g => g.code === code && g.status !== 'ended');
      if (!found) {
        return cb?.({ ok: false, error: 'Saved game not found or already ended' });
      }

      const hydrated = hydrateSavedGame(found);
      games.set(code, hydrated);
      console.log(`[DB] Loaded saved game ${code} on demand`);
    }

    const game = games.get(code);
    if (!game) return cb?.({ ok: false, error: 'Failed to load game' });

    // Rebind the requesting socket as host
    game.hostSocketId = socket.id;
    socket.join(code);

    // If it was 'saved', move it back to 'waiting' so it can be rejoined/started
    if (game.status === 'saved') {
      game.status = 'waiting';
      game.addEvent('Saved game loaded by host');
      persistGameState(game);
    }

    broadcastState(game);
    cb?.({ ok: true, code, status: game.status });
  });

  socket.on('disconnect', () => {
    // Keep role + team assignment so they can rejoin with same name + team + code
    console.log('Client disconnected:', socket.id);
  });
});

// ============ STATIC FILES + SERVER START ============
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Teacher-only interface (students should use the main URL, not this one)
app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Helper: get all usable local IPv4 addresses (for printing real IPs to the teacher)
function getLocalIPv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({ address: iface.address, interface: name });
      }
    }
  }
  return addresses;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║           STAR POINT — TEAMS + ROLES EDITION       ║');
  console.log('║     3 players per team: War / Negotiator / Builder ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Server running on port ${PORT}`);
  console.log(`  Teacher (host) page:  http://localhost:${PORT}/host`);
  console.log(`  Student page:         http://localhost:${PORT}/`);
  console.log('');
  console.log('  === STUDENT CONNECTION ADDRESSES ===');

  const addrs = getLocalIPv4Addresses();
  if (addrs.length > 0) {
    addrs.forEach(({ address, interface: iface }) => {
      console.log(`    Student URL:  http://${address}:${PORT}/`);
      console.log(`    Teacher URL:  http://${address}:${PORT}/host     (interface: ${iface})`);
    });
  } else {
    console.log(`    (No non-loopback IPv4 found — check your network)`);
  }

  console.log('');
  console.log('  IMPORTANT:');
  console.log('  - Give students only the main URL (without /host)');
  console.log('  - The /host page is for the teacher only');
  console.log('  - All computers must be on the SAME WiFi/LAN');
  console.log('  - Temporarily allow port 3000 in your firewall if needed');
  console.log('    (Linux example: sudo ufw allow 3000)');
  console.log('');
});