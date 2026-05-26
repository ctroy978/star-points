const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }   // classroom LAN, no security needed
});

const PORT = process.env.PORT || 3000;

// ============ GAME CONSTANTS (easy to tweak for class) ============
const MAX_PLAYERS = 4;
const START_TITANIUM = 100;
const START_FACTORY_HP = 100;

const FIGHTER_COST = 20;
const FIGHTER_TIME = 30;   // seconds
const CANON_COST = 10;
const CANON_TIME = 60;

const PASSIVE_INCOME = 4;
const PASSIVE_INTERVAL_TICKS = 15;   // every 15 seconds

const TRAVEL_TIME = 8;               // seconds for fleets
const FIGHTER_DAMAGE = 7;            // per survivor to factory
const MAX_QUEUE = 4;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no confusing chars

// ============ IN-MEMORY STATE ============
const games = new Map(); // code -> Game

function generateCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

class Game {
  constructor(code, hostSocketId) {
    this.code = code;
    this.hostSocketId = hostSocketId;
    this.status = 'waiting';           // waiting | running | ended
    this.players = new Map();          // name -> Player
    this.buildQueues = new Map();      // name -> string[]
    this.currentBuilds = new Map();    // name -> {type, remaining}
    this.fleets = [];                  // in-transit
    this.eventLog = [];
    this.tickCounter = 0;
    this.lastIncomeTick = 0;
    this.winner = null;
  }

  addPlayer(name, socketId) {
    if (this.players.has(name)) {
      // Rejoin existing player (same name)
      const p = this.players.get(name);
      p.socketId = socketId;
      return p;
    }
    if (this.players.size >= MAX_PLAYERS) {
      throw new Error('Game is full');
    }
    const player = {
      name,
      titanium: START_TITANIUM,
      fighters: 0,
      canons: 0,
      factoryHP: START_FACTORY_HP,
      socketId
    };
    this.players.set(name, player);
    this.buildQueues.set(name, []);
    this.currentBuilds.set(name, null);
    return player;
  }

  getPlayerBySocket(socketId) {
    for (const p of this.players.values()) {
      if (p.socketId === socketId) return p;
    }
    return null;
  }

  isHost(socketId) {
    return this.hostSocketId === socketId;
  }

  addEvent(text) {
    this.eventLog.push(text);
    if (this.eventLog.length > 18) this.eventLog.shift();
  }
}

// ============ GAME LOOP (runs every second) ============
setInterval(() => {
  for (const game of games.values()) {
    if (game.status !== 'running') continue;

    game.tickCounter++;

    processBuilds(game);
    processFleets(game);

    // Passive mining
    if ((game.tickCounter - game.lastIncomeTick) >= PASSIVE_INTERVAL_TICKS) {
      givePassiveIncome(game);
      game.lastIncomeTick = game.tickCounter;
    }

    checkWinCondition(game);

    // Broadcast fresh state to everyone in the room
    broadcastState(game);
  }
}, 1000);

function processBuilds(game) {
  for (const [name, player] of game.players) {
    let current = game.currentBuilds.get(name);

    if (!current && game.buildQueues.get(name).length > 0) {
      // Start next item
      const nextType = game.buildQueues.get(name).shift();
      const time = (nextType === 'fighter') ? FIGHTER_TIME : CANON_TIME;
      current = { type: nextType, remaining: time };
      game.currentBuilds.set(name, current);
      game.addEvent(`${name} started building ${nextType.toUpperCase()}`);
    }

    if (current) {
      current.remaining--;
      if (current.remaining <= 0) {
        // Complete
        if (current.type === 'fighter') player.fighters++;
        else player.canons++;

        game.addEvent(`${name} completed 1 ${current.type.toUpperCase()}`);
        game.currentBuilds.set(name, null);
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
  const attacker = game.players.get(fleet.from);
  const defender = game.players.get(fleet.to);

  const originalCount = fleet.fighters;

  if (!defender || defender.factoryHP <= 0) {
    // Target already destroyed — the whole fleet returns home safely
    if (attacker && attacker.factoryHP > 0) {
      attacker.fighters += originalCount;
    }
    game.addEvent(`Fleet from ${fleet.from} returned safely (${fleet.to} already destroyed)`);
    return;
  }

  const canons = defender.canons || 0;
  const killed = Math.min(originalCount, canons);
  const survivors = originalCount - killed;
  const damage = survivors * FIGHTER_DAMAGE;

  defender.factoryHP = Math.max(0, defender.factoryHP - damage);

  let msg = `${fleet.from} attacked ${fleet.to} with ${originalCount} FTR. `;
  if (killed > 0) {
    msg += `${killed} shot down. `;
  }
  if (survivors > 0) {
    msg += `${survivors} hit for ${damage} damage`;
    // Survivors fly home and can be used again
    if (attacker && attacker.factoryHP > 0) {
      attacker.fighters += survivors;
      msg += ` — ${survivors} returned.`;
    } else {
      msg += ` (attacker eliminated, survivors lost).`;
    }
  } else {
    msg += `All destroyed, no damage.`;
  }

  game.addEvent(msg);

  // Killing blow bonus (only if attacker is still alive)
  if (defender.factoryHP <= 0 && attacker && attacker.factoryHP > 0) {
    attacker.titanium += 20;
    game.addEvent(`${fleet.from} DESTROYED ${fleet.to}'s factory! (+20 Ti bonus)`);
  }
}

function givePassiveIncome(game) {
  for (const player of game.players.values()) {
    if (player.factoryHP > 0) {
      player.titanium += PASSIVE_INCOME;
    }
  }
  game.addEvent(`Mining cycle complete — everyone +${PASSIVE_INCOME} Ti`);
}

function checkWinCondition(game) {
  const alive = [];
  for (const p of game.players.values()) {
    if (p.factoryHP > 0) alive.push(p.name);
  }

  if (alive.length <= 1 && game.status === 'running') {
    game.status = 'ended';
    if (alive.length === 1) {
      game.winner = alive[0];
      game.addEvent(`GAME OVER — ${game.winner} WINS!`);
    } else {
      game.addEvent(`GAME OVER — all factories destroyed.`);
    }
  }
}

function broadcastState(game) {
  const players = [];
  for (const p of game.players.values()) {
    players.push({
      name: p.name,
      titanium: p.titanium,
      fighters: p.fighters,
      canons: p.canons,
      factoryHP: p.factoryHP,
      factoryPercent: Math.round((p.factoryHP / START_FACTORY_HP) * 100)
    });
  }

  // Sanitized fleets (no secret info)
  const fleets = game.fleets.map(f => ({
    from: f.from,
    to: f.to,
    fighters: f.fighters,
    eta: Math.max(1, Math.ceil((f.arrivalTime - Date.now()) / 1000))
  }));

  // Build status per player
  const builds = {};
  for (const [name, q] of game.buildQueues) {
    builds[name] = {
      queue: [...q],
      current: game.currentBuilds.get(name)
    };
  }

  const payload = {
    code: game.code,
    status: game.status,
    isHost: false, // filled per socket below
    players,
    fleets,
    builds,
    eventLog: [...game.eventLog],
    winner: game.winner
  };

  // Send to each player with correct isHost flag
  for (const [name, player] of game.players) {
    if (player.socketId) {
      const personal = { ...payload, isHost: game.hostSocketId === player.socketId };
      io.to(player.socketId).emit('gameUpdate', personal);
    }
  }
}

// ============ SOCKET HANDLERS ============
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('createGame', (data, cb) => {
    let code;
    do { code = generateCode(); } while (games.has(code));

    const game = new Game(code, socket.id);
    games.set(code, game);

    // Auto-join the creator as the first player (fixes "not in game" on start)
    const rawName = (data && data.playerName) ? data.playerName : '';
    const name = rawName.trim().slice(0, 14) || 'Teacher';
    try {
      game.addPlayer(name, socket.id);
      socket.join(code);
      game.addEvent(`${name} (host) joined the system`);
    } catch (e) {
      // Should never happen on fresh game
    }

    console.log(`Game created: ${code} by ${socket.id} (host: ${name})`);

    cb({ ok: true, code, playerName: name, isHost: true });
  });

  socket.on('joinGame', ({ code, playerName }, cb) => {
    const game = games.get(code);
    if (!game) return cb({ ok: false, error: 'Invalid code' });
    if (game.status === 'ended') return cb({ ok: false, error: 'Game already ended' });

    const name = playerName.trim().slice(0, 14);
    if (!name) return cb({ ok: false, error: 'Name required' });

    try {
      const player = game.addPlayer(name, socket.id);
      socket.join(code);

      game.addEvent(`${name} joined the system`);

      cb({ ok: true, code, playerName: name, isHost: game.isHost(socket.id) });

      // Tell everyone
      broadcastState(game);
    } catch (e) {
      cb({ ok: false, error: e.message });
    }
  });

  socket.on('startGame', (cb) => {
    const game = findGameBySocket(socket.id);
    if (!game) return cb?.({ ok: false, error: 'Not in a game' });
    if (!game.isHost(socket.id)) return cb?.({ ok: false, error: 'Only host can start' });
    if (game.players.size < 2) return cb?.({ ok: false, error: 'Need at least 2 players' });

    game.status = 'running';
    game.addEvent('GAME STARTED — Build fleets and survive!');
    broadcastState(game);
    cb?.({ ok: true });
  });

  socket.on('queueBuild', ({ type }, cb) => {
    const game = findGameBySocket(socket.id);
    if (!game || game.status !== 'running') return cb?.({ ok: false });

    const player = game.getPlayerBySocket(socket.id);
    if (!player || player.factoryHP <= 0) return cb?.({ ok: false });

    const cost = (type === 'fighter') ? FIGHTER_COST : CANON_COST;
    if (player.titanium < cost) {
      return cb?.({ ok: false, error: 'Not enough titanium' });
    }

    const queue = game.buildQueues.get(player.name);
    if (queue.length >= MAX_QUEUE) {
      return cb?.({ ok: false, error: 'Queue full' });
    }

    player.titanium -= cost;
    queue.push(type);

    game.addEvent(`${player.name} queued 1 ${type.toUpperCase()}`);
    broadcastState(game);
    cb?.({ ok: true });
  });

  socket.on('launchAttack', ({ targetName, numFighters }, cb) => {
    const game = findGameBySocket(socket.id);
    if (!game || game.status !== 'running') return cb?.({ ok: false });

    const attacker = game.getPlayerBySocket(socket.id);
    const defender = game.players.get(targetName);

    if (!attacker || !defender) return cb?.({ ok: false });
    if (attacker.name === targetName) return cb?.({ ok: false });
    if (attacker.factoryHP <= 0 || defender.factoryHP <= 0) return cb?.({ ok: false });
    if (numFighters < 1 || numFighters > attacker.fighters) return cb?.({ ok: false });

    // Commit the ships
    attacker.fighters -= numFighters;

    const arrivalTime = Date.now() + (TRAVEL_TIME * 1000);
    game.fleets.push({
      id: Date.now() + Math.random(),
      from: attacker.name,
      to: targetName,
      fighters: numFighters,
      arrivalTime
    });

    game.addEvent(`${attacker.name} launched ${numFighters} FTR at ${targetName} (ETA ${TRAVEL_TIME}s)`);
    broadcastState(game);
    cb?.({ ok: true });
  });

  socket.on('transferTi', ({ targetName, amount }, cb) => {
    const game = findGameBySocket(socket.id);
    if (!game || game.status !== 'running') return cb?.({ ok: false });

    const sender = game.getPlayerBySocket(socket.id);
    const receiver = game.players.get(targetName);

    if (!sender || !receiver || sender.name === targetName) return cb?.({ ok: false });
    if (sender.factoryHP <= 0 || receiver.factoryHP <= 0) return cb?.({ ok: false });
    if (amount !== 10 && amount !== 25 && amount !== 50) return cb?.({ ok: false });
    if (sender.titanium < amount) return cb?.({ ok: false });

    sender.titanium -= amount;
    receiver.titanium += amount;

    game.addEvent(`${sender.name} transferred ${amount} Ti to ${receiver.name}`);
    broadcastState(game);
    cb?.({ ok: true });
  });

  socket.on('endGame', (cb) => {
    const game = findGameBySocket(socket.id);
    if (!game || !game.isHost(socket.id)) return cb?.({ ok: false });

    game.status = 'ended';
    game.addEvent('Game ended by host');
    broadcastState(game);
    cb?.({ ok: true });
  });

  socket.on('disconnect', () => {
    // We keep the player in the game (Chromebook sleep, tab close, etc.)
    // They can rejoin with same name + code
    console.log('Client disconnected:', socket.id);
  });
});

function findGameBySocket(socketId) {
  for (const game of games.values()) {
    for (const p of game.players.values()) {
      if (p.socketId === socketId) return game;
    }
  }
  return null;
}

// ============ STATIC FILES + SERVER START ============
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
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
  console.log('║           STARFIGHT — CLASSROOM EDITION            ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Server running on port ${PORT}`);
  console.log(`  Teacher browser:      http://localhost:${PORT}`);
  console.log('');
  console.log('  === STUDENT CONNECTION ADDRESSES ===');

  const addrs = getLocalIPv4Addresses();
  if (addrs.length > 0) {
    addrs.forEach(({ address, interface: iface }) => {
      console.log(`    http://${address}:${PORT}     (interface: ${iface})`);
    });
  } else {
    console.log(`    (No non-loopback IPv4 found — check your network)`);
  }

  console.log('');
  console.log('  IMPORTANT FOR REMOTE PLAYERS:');
  console.log('  - All computers must be on the SAME WiFi/LAN');
  console.log('  - If students cannot reach it, try a different listed address');
  console.log('  - Temporarily allow port 3000 in your firewall if needed');
  console.log('    (Linux example: sudo ufw allow 3000)');
  console.log('');
});