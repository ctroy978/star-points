const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const fs = require('fs');
const db = require('./db');
const production = require('./server/production');
const probes = require('./server/probes');
const factories = require('./server/factories');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }   // classroom LAN, no security needed
});

const PORT = process.env.PORT || 3000;

// Debug logging setup - per game code, replaced on new game start
const LOGS_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

function initGameDebugLog(game, code) {
  game.debugLogPath = path.join(LOGS_DIR, `game_${code}.log`);
  const header = `=== Game ${code} started at ${new Date().toISOString()} ===\n`;
  fs.writeFileSync(game.debugLogPath, header);  // truncate / replace
}

function debugLog(game, message) {
  if (!game || !game.debugLogPath) return;
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(game.debugLogPath, line);
  } catch (err) {
    console.error('[DEBUG LOG ERROR]', err.message);
  }
}

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

const START_FACTORY_HP = 100;

// === CORE 6-RESOURCE SYSTEM (exact per fixed prompt) ===
// Materials in this exact order for all costs and arrays:
const RESOURCE_ORDER = [
  'Fused Xenon',
  'Helium-3 Lattice',
  'Quantite',
  'Plasma-Bound Carbon',
  'Antimatter Catalyst',
  'Neurocryst'
];

// Build costs (Frigate and Destroyer) using exact order above.
// Frigate: 4,2,0,3,0,0
// Destroyer: 5,3,0,4,2,0
const BUILD_COSTS = {
  frigate:   [4, 2, 0, 3, 0, 0],
  destroyer: [5, 3, 0, 4, 2, 0],
  // MINING: Miner cost per spec (6/4/2/5/0/1) — Phase 0
  miner:     [6, 4, 2, 5, 0, 1],
  // MINING: Probe for discovery (cheap) — Phase 4
  probe:     [1, 1, 1, 0, 0, 1],
  // NEW: Factory kit — extremely expensive and slow to build (then slow to deploy/setup)
  factory:   [22, 16, 10, 14, 8, 6],
  // NEW: Admiral (produced via Military Academy at home base)
  admiral:   [10, 7, 5, 6, 4, 3],
  // NEW: Capitol Ship (command center for fleet formation, no combat role)
  capitol:   [35, 24, 15, 20, 12, 9]
};

const BUILD_TIMES = {
  frigate: 38,
  destroyer: 42,
  // MINING: Miner build time (Phase 0)
  miner: 55,
  // MINING: Probe build time (Phase 4)
  probe: 18,
  // NEW: Factory kit build time (deploy + 3min setup is the bigger time sink)
  factory: 180,
  // NEW: Admiral production time (via home Military Academy)
  admiral: 75,
  // NEW: Capitol Ship build time (major project)
  capitol: 240
};

// MINING: Core tuning constants (exposed for easy balancing, per plan)
const MINER_SPEED_TICKS = 10;          // 1 grid step every 10 ticks (~10s)
const MINER_SETUP_TIME_MS = 60000;     // 60s setup after arrival before mining starts
const MINING_INTERVAL_MS = 60000;      // Yield payout every 60s
const MAX_MINERS_PER_SITE = 3;
const STACKING_MULTIPLIERS = [1.0, 0.75, 0.55]; // index 0=1rig, 1=2rigs, 2=3rigs (diminishing returns)
const PROBE_COST = [1, 1, 1, 0, 0, 1]; // cheap discovery unit
const PROBE_TIME = 18;
const PROBE_RADIUS = 2;                // legacy instant radius (being replaced)
const PROBE_MOVE_TICKS = 8;            // ~1 cell every 8s (see server/probes.js)
const PROBE_SCAN_TICKS = 30;           // dwell at destination before intel returns
const PROBE_SNAPSHOT_SIZE = 5;         // max cells in a snapshot (center + 4 directions = plus shape)

// FACTORIES: slow but achievable deployment + setup
// Goal: second factory should feel like a meaningful investment that players can realistically benefit from in a ~40 min game.
const FACTORY_DEPLOY_SPEED_TICKS = 8;    // noticeably faster than before (was 15), but still deliberate
const FACTORY_SETUP_TIME_MS = 180000;    // 3 minutes setup once arrived at moon (chosen over 2 min for weight)
const MAX_FACTORIES_PER_MOON = 1;        // hard rule: only one factory per moon

// Yield base (per rig per cycle, before stacking; integers for simplicity)
const YIELD_BASE = {
  // Current moon types (large = high yield, small = lower yield + different bias)
  large_moon: 6,
  small_moon: 3,
  // Legacy keys for restored saved games during transition
  major_moon: 5,
  normal_moon: 3,
  gas_cloud: 2,        // medium
  asteroid_cluster: 1  // rare (plan ~0.6, floored to 1 for playability)
};

const MAX_QUEUE = 4;

// Typical base ranges (midpoint used for base before variance + bias)
// Increased to give teams enough starting resources to build several things early
// (multiple miners + probes) before mining income really ramps up.
const RESOURCE_BASE_RANGES = {
  'Fused Xenon':         { min: 25, max: 35 },
  'Helium-3 Lattice':    { min: 18, max: 26 },
  'Quantite':            { min: 10, max: 16 },
  'Plasma-Bound Carbon': { min: 8,  max: 14 },
  'Antimatter Catalyst': { min: 4,  max: 8  },
  'Neurocryst':          { min: 2,  max: 5  }
};

// Legacy combat constants kept minimal (war scope reduced for this pass)
const TRAVEL_TIME = 8;               // seconds for fleets
const FRIGATE_DAMAGE = 7;            // per survivor (no more Defense Canon interception)

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

// Generate starting 6-resource profile for one team.
// Implements the exact rules from the fixed prompt:
// - Base from given typical ranges
// - ±15-25% variance per material
// - One specialization bias per team (+30-40% on one random material)
// - Different profiles across teams to force trading
function generateStartingResources(teamIndex, totalTeams) {
  const resources = {};

  // Base = midpoint of the given typical range for 4-8 teams
  const base = {};
  for (const mat of RESOURCE_ORDER) {
    const r = RESOURCE_BASE_RANGES[mat];
    base[mat] = Math.round((r.min + r.max) / 2);
  }

  // Slight global scarcity scaling with more teams (encourages trading)
  const scarcityFactor = Math.max(0.75, 1 - (totalTeams - 2) * 0.06);

  // Choose this team's specialization (different preference per team when possible)
  const specIndex = teamIndex % RESOURCE_ORDER.length;
  const specializedMat = RESOURCE_ORDER[specIndex];

  for (const mat of RESOURCE_ORDER) {
    let val = base[mat] * scarcityFactor;

    // ±15-25% random variance
    const variance = 0.15 + Math.random() * 0.10; // 15% to 25%
    const sign = Math.random() < 0.5 ? -1 : 1;
    val = val * (1 + sign * variance);

    // Apply specialization bias (30-40% higher) to one material for this team
    if (mat === specializedMat) {
      const bias = 0.30 + Math.random() * 0.10; // 30-40%
      val = val * (1 + bias);
    }

    // Final integer, never negative
    resources[mat] = Math.max(0, Math.round(val));
  }

  // Strong guarantee for early game bootstrapping.
  // Every team gets enough to build several miners + probes + start on infrastructure
  // even before synthesis and mining kick in.
  const MINER_COST = [6, 4, 2, 5, 0, 1];
  const BOOTSTRAP_MULTIPLIER = 4;   // for 4 miners worth of base

  for (let i = 0; i < RESOURCE_ORDER.length; i++) {
    const mat = RESOURCE_ORDER[i];
    const needed = MINER_COST[i] * BOOTSTRAP_MULTIPLIER;
    if ((resources[mat] || 0) < needed) {
      resources[mat] = needed;
    }
  }

  // Extra buffer specifically for expensive early infrastructure (Factory kits etc.)
  const INFRA_BUFFER = [8, 5, 3, 5, 2, 2];
  for (let i = 0; i < RESOURCE_ORDER.length; i++) {
    const mat = RESOURCE_ORDER[i];
    resources[mat] = (resources[mat] || 0) + INFRA_BUFFER[i];
  }

  return resources;
}

// Team data structure — 6-resource economy + starting infrastructure
// (old Titanium / miners / canons / fighters completely removed)
class Team {
  constructor(name, teamIndex = 0, totalTeams = 2) {
    this.name = name;

    // Exactly 6 resources in RESOURCE_ORDER
    this.resources = generateStartingResources(teamIndex, totalTeams);

    // New military units only (Frigate + Destroyer). Defense Canon fully removed.
    this.frigates = 0;
    this.destroyers = 0;

    // Starting infrastructure (per prompt)
    this.buildings = { factory: 1, militaryAcademy: 1 };

    this.factoryHP = START_FACTORY_HP;

    this.players = new Map(); // playerName -> { name, role, socketId }

    // Production system now tied to factories.
    // Each operational factory gives the team one independent build queue.
    // Starting home factory = 1 queue. Extra deployed factories = additional queues.
    this.buildQueues = []; // [{ factoryId, queue: string[], current: {type, remaining} | null }]

    // Starter kit per playtest feedback:
    // - Builder starts with 1 mining rig ready to deploy immediately
    // - War Commander starts with 1 probe ready to deploy immediately
    this.availableMiners = 1;
    this.probes = 1;

    // NEW infrastructure units
    this.availableFactories = 0;  // factory kits ready to deploy to moons (1 per moon max)
    this.availableAdmirals = 0;   // produced at home Military Academy
    this.capitolShips = 0;        // command vessels for fleet formation

    // Probe intel keyed by anomaly id (mirrors anomaly.discoveredBy for this team)
    this.probeIntel = {};
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

  // Return resources as array in fixed RESOURCE_ORDER (useful for UI + deduction)
  getResourcesArray() {
    return RESOURCE_ORDER.map(mat => this.resources[mat] || 0);
  }

  // Check if team can afford a cost array (same length/order as RESOURCE_ORDER)
  canAfford(costArray) {
    const current = this.getResourcesArray();
    for (let i = 0; i < costArray.length; i++) {
      if (current[i] < costArray[i]) return false;
    }
    return true;
  }

  // Deduct a cost array when production starts
  deduct(costArray) {
    for (let i = 0; i < RESOURCE_ORDER.length; i++) {
      const mat = RESOURCE_ORDER[i];
      this.resources[mat] = Math.max(0, (this.resources[mat] || 0) - (costArray[i] || 0));
    }
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
    this.winner = null;

    // MINING: deployed miner rigs on the map (Phase 1+). Separate from abstract fleets.
    this.deployedMiners = [];

    // PROBES: short-lived mobile reconnaissance units (new functional system)
    // They move quickly to a target, take a small snapshot, then disappear.
    this.deployedProbes = [];

    // FACTORIES: spatial buildings. 1 per moon max + starting home base factory.
    this.factories = [];

    // Map system (new for ui-map branch)
    this.mapSize = 13;                 // 13, 15, or 17
    this.map = null;                   // { gasGiant, moons: [], starts: {teamName: {x,y}}, anomalies: [...] later }
  }

  // Create a new team or return existing.
  // New teams get varied starting resources using the bias + variance rules.
  getOrCreateTeam(teamName) {
    if (!this.teams.has(teamName)) {
      const teamIndex = this.teams.size;                    // 0-based for this new team
      const totalTeams = Math.max(2, this.teams.size + 1);  // reasonable estimate for scarcity
      const team = new Team(teamName, teamIndex, totalTeams);
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
    if (this.eventLog.length > 35) this.eventLog.shift(); // more room for detailed mining / build / combat logs
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
      // MINING: filter this team's miners for per-team JSON persistence (Phase 6)
      const teamMiners = (game.deployedMiners || []).filter(m => m.teamName === team.name);
      db.upsertTeam(game.code, team.name, {
        resources: team.resources,
        frigates: team.frigates,
        destroyers: team.destroyers,
        buildings: team.buildings,
        factoryHP: team.factoryHP,
        // MINING: persist availableMiners + probes (Phase 0/6)
        availableMiners: team.availableMiners || 0,
        probes: team.probes || 0,
        availableFactories: team.availableFactories || 0,
        deployedMiners: teamMiners,
        buildQueues: team.buildQueues || []
      });

      for (const p of team.players.values()) {
        db.addOrUpdatePlayer(game.code, team.name, p.name, p.role);
      }
    }

    // Replace fleets for this game (simple approach)
    db.clearFleetsForGame(game.code);
    for (const f of game.fleets) {
      db.addFleet(game.code, f.from, f.to, f.frigates ?? f.fighters ?? 0, f.arrivalTime);
    }

    // === NEW: Persist map data if it exists ===
    if (game.map && game.map.gasGiant) {
      // MINING: include anomalies (with discoveredBy) for persistence Phase 6
      db.saveGameMap(game.code, game.mapSize, game.map.gasGiant, [], game.map.anomalies || []);
      if (game.map.starts) {
        db.saveTeamStarts(game.code, game.map.starts);
      }
    }

    // Also ensure map_size is set even if no full map yet
    if (game.mapSize) {
      db.updateGameStatusAndMapSize(game.code, game.status, game.mapSize);
    }

    if (game.factories && game.factories.length > 0) {
      db.saveGameFactories(game.code, game.factories);
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

  // Rebuild teams with new 6-resource model (graceful for any old saved data)
  for (const t of saved.teams) {
    const teamIndex = game.teams.size;
    const totalTeams = Math.max(2, game.teams.size + 1);
    const team = new Team(t.name, teamIndex, totalTeams);

    if (t.resources && typeof t.resources === 'object') {
      team.resources = { ...t.resources };
    }
    team.frigates = t.frigates ?? t.fighters ?? 0;
    team.destroyers = t.destroyers ?? 0;
    team.buildings = t.buildings || { factory: 1, militaryAcademy: 1 };
    team.factoryHP = t.factoryHP ?? START_FACTORY_HP;
    // MINING: hydrate availableMiners (defaults 0 for old saves) — Phase 0/6
    team.availableMiners = (t.availableMiners != null) ? t.availableMiners : 0;
    team.probes = (t.probes != null) ? t.probes : 0;
    team.availableFactories = (t.availableFactories != null) ? t.availableFactories : 0;
    team.availableAdmirals = (t.availableAdmirals != null) ? t.availableAdmirals : 0;
    team.capitolShips = (t.capitolShips != null) ? t.capitolShips : 0;

    // Migrate old single-queue saves to the new multi-factory queue system
    if (Array.isArray(t.buildQueues) && t.buildQueues.length > 0) {
      team.buildQueues = t.buildQueues;
    } else if (t.buildQueue && t.buildQueue.length > 0) {
      // Legacy single queue → put it in the first (home) queue
      team.buildQueues = [{
        factoryId: 'home',
        queue: [...t.buildQueue],
        current: t.currentBuild || null
      }];
    } else {
      team.buildQueues = [{
        factoryId: 'home',
        queue: [],
        current: t.currentBuild || null
      }];
    }

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

  // Rebuild fleets (support legacy key during transition)
  game.fleets = saved.fleets.map(f => ({
    id: Date.now() + Math.random(),
    from: f.from,
    to: f.to,
    frigates: f.frigates ?? f.fighters ?? 0,
    arrivalTime: f.arrivalTime
  }));

  // MINING Phase 6: rebuild deployedMiners from per-team JSON in saved data
  game.deployedMiners = [];
  for (const t of saved.teams || []) {
    if (t.deployedMiners && Array.isArray(t.deployedMiners)) {
      for (const dm of t.deployedMiners) {
        // Re-attach minimal required fields, reset transient timers if old
        game.deployedMiners.push({
          id: dm.id || ('miner-' + Math.random().toString(36).slice(2)),
          teamName: t.name,
          x: dm.x || 0,
          y: dm.y || 0,
          state: dm.state || 'moving',
          targetX: dm.targetX,
          targetY: dm.targetY,
          setupCompleteTime: null, // reset timer on load for safety
          miningSite: dm.miningSite || null
        });
      }
    }
  }

  // === NEW: Restore persisted map data if available ===
  if (saved.mapData && saved.mapData.gasGiant) {
    game.map = {
      gasGiant: saved.mapData.gasGiant,
      starts: saved.teamStarts || {},
      // Legacy moons array is no longer used (all moons are now in anomalies as large_moon/small_moon)
      anomalies: saved.mapData.anomalies || []
    };
    // Rebuild per-team probe intel index from persisted anomaly discovery flags
    for (const team of game.teams.values()) {
      team.probeIntel = team.probeIntel || {};
      for (const a of game.map.anomalies) {
        if (a.discoveredBy?.[team.name] && a.id) team.probeIntel[a.id] = true;
      }
    }
    console.log(`[DB] Restored full map data for ${saved.code}`);
  } else if (game.status === 'running' || game.status === 'saved') {
    // Fallback: regenerate if we have no map data but game was active/saved
    generateMapForGame(game);
  }

  if (saved.factories && Array.isArray(saved.factories) && saved.factories.length > 0) {
    game.factories = saved.factories.map(f => ({
      ...f,
      setupCompleteTime: f.state === 'setting_up' ? (Date.now() + factories.FACTORY_SETUP_TIME_MS) : null
    }));
    console.log(`[DB] Restored ${game.factories.length} factory record(s) for ${saved.code}`);
  }

  // Ensure home factories exist for restored games (the spatial factory system)
  if (!game.factories || game.factories.length === 0) {
    const starts = game.map && game.map.starts ? game.map.starts : {};
    game.factories = [];
    for (const [teamName, pos] of Object.entries(starts)) {
      const homeFactoryId = 'factory-home-' + teamName + '-' + Date.now();
      game.factories.push({
        id: homeFactoryId,
        teamName,
        x: pos.x,
        y: pos.y,
        state: 'operational',
        isHome: true,
        setupCompleteTime: null
      });
    }
    if (game.factories.length > 0) {
      console.log(`[DB] Initialized home factories for restored game ${saved.code}`);
    }
  }

  // Backfill map.starts from home factories if team_starts were missing from older saves
  if (game.map) {
    if (!game.map.starts) game.map.starts = {};
    for (const f of game.factories || []) {
      if (f.isHome && f.teamName && !game.map.starts[f.teamName]) {
        game.map.starts[f.teamName] = { x: f.x, y: f.y };
      }
    }
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

    production.processBuilds(game);
    processFleets(game);

    // Moon orbits (slow movement)
    processMoonOrbits(game);

    // MINING: process miner movement + setup timers + mining yields (Phase 1/2/3)
    processMinerMovement(game);
    processMinerSetup(game);
    processMinerMining(game);

    // Forward factory kits: travel to moons, setup, then join build queue pool
    factories.processFactoryMovement(game, debugLog);
    factories.processFactorySetup(game, debugLog);

    // PROBES: fast-moving short-lived reconnaissance units
    probes.processProbeMovement(game);

    // FACTORIES: slow mineral synthesis (baseline permanent resource flow)
    production.processFactorySynthesis(game);

    // Passive mining removed in this pass (new 6-resource economy + future mechanics)
    checkWinCondition(game);

    // Broadcast + persist
    broadcastState(game);
    persistGameState(game);
  }
}, 1000);

/** Resolve a team's starting cell from map data or home factory fallback. */
function getTeamStart(game, teamName) {
  if (!teamName) return null;
  const fromMap = game.map?.starts?.[teamName];
  if (fromMap && fromMap.x != null && fromMap.y != null) {
    return { x: fromMap.x, y: fromMap.y };
  }
  const home = (game.factories || []).find(f => f.teamName === teamName && f.isHome);
  if (home) return { x: home.x, y: home.y };
  return null;
}

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
      resources: { ...t.resources },           // full 6-resource object
      resourcesArray: t.getResourcesArray(),   // ordered array for easy UI
      frigates: t.frigates,
      destroyers: t.destroyers,
      buildings: { ...t.buildings },
      factoryHP: t.factoryHP,
      factoryPercent: Math.round((t.factoryHP / START_FACTORY_HP) * 100),
      members,
      // MINING: broadcast availableMiners count (for Builder UI) — Phase 0
      availableMiners: t.availableMiners || 0,
      probes: t.probes || 0,
      // NEW infrastructure
      availableFactories: t.availableFactories || 0,
      availableAdmirals: t.availableAdmirals || 0,
      capitolShips: t.capitolShips || 0,
      // NEW: Multiple build queues (one per operational factory)
      buildQueues: (t.buildQueues || []).map(q => ({
        factoryId: q.factoryId,
        queue: [...(q.queue || [])],
        current: q.current ? { ...q.current } : null
      }))
    });
  }

  // Fleets with ETAs (frigates only in this pass)
  const fleets = game.fleets.map(f => ({
    from: f.from,
    to: f.to,
    frigates: f.frigates ?? f.fighters ?? 0,
    eta: Math.max(1, Math.ceil((f.arrivalTime - Date.now()) / 1000))
  }));

  // Build status per team — now multiple queues (one per operational factory)
  const builds = {};
  for (const [name, team] of game.teams) {
    builds[name] = {
      // Legacy single-queue fields kept temporarily for old client code
      queue: team.buildQueues.length > 0 ? [...team.buildQueues[0].queue] : [],
      current: team.buildQueues.length > 0 ? (team.buildQueues[0].current || null) : null,
      // NEW: Full multi-factory queue data (preferred by new Builder UI)
      queues: team.buildQueues.map(q => ({
        factoryId: q.factoryId,
        queue: [...q.queue],
        current: q.current ? { ...q.current } : null
      }))
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
    // MINING: deployedMiners broadcast (Phase 1) — client filters for own team mostly
    deployedMiners: game.deployedMiners ? game.deployedMiners.map(m => {
      const payload = {
        id: m.id,
        teamName: m.teamName,
        x: m.x,
        y: m.y,
        state: m.state,
        targetX: m.targetX,
        targetY: m.targetY,
        targetObject: m.targetObject || null
      };
      if (m.state === 'setting_up' && m.setupCompleteTime) {
        payload.setupRemaining = Math.max(0, Math.ceil((m.setupCompleteTime - Date.now()) / 1000));
      }
      return payload;
    }) : [],

    // PROBES: short-lived mobile reconnaissance units (visible primarily to owning team)
    deployedProbes: game.deployedProbes ? game.deployedProbes.map(p => ({
      id: p.id,
      teamName: p.teamName,
      x: p.x,
      y: p.y,
      targetX: p.targetX,
      targetY: p.targetY,
      state: p.state,
      scanRemaining: p.state === 'scanning' && p.scanCompleteTick
        ? Math.max(0, p.scanCompleteTick - game.tickCounter)
        : null
    })) : [],

    // FACTORIES: spatial (home base + deployed to moons, 1 per moon max)
    // Ensure home factories are always present in state sent to clients
    factories: (game.factories && game.factories.length > 0) ? game.factories.map(f =>
      factories.serializeFactoryForClient(f, game)
    ) : (game.map && game.map.starts ? Object.entries(game.map.starts).map(([teamName, pos]) => ({
      id: 'factory-home-' + teamName,
      teamName,
      x: pos.x,
      y: pos.y,
      state: 'operational',
      isHome: true
    })) : []),
    // Map data (new)
    mapSize: game.mapSize,
    map: game.map ? {
      gasGiant: game.map.gasGiant,
      // moons: legacy array removed — all moons live in anomalies (large_moon / small_moon)
      anomalies: game.map.anomalies || []
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
    payload.myStart = getTeamStart(game, info.teamName);

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

// Delegated to production.js
function processBuilds(game) {
  production.processBuilds(game);
}

// Old processBuilds body removed - see server/production.js
function _old_processBuilds_removed(game) {
  for (const team of game.teams.values()) {
    if (team.factoryHP <= 0) continue;

    // NEW: Support multiple parallel build queues, one per operational factory.
    // The number of queues should match the number of operational factories for the team.
    // Each queue runs independently.
    const operationalFactories = (game.factories || []).filter(f =>
      f.teamName === team.name && f.state === 'operational'
    );

    // Ensure we have the correct number of queue slots (one per operational factory)
    while (team.buildQueues.length < operationalFactories.length) {
      const factory = operationalFactories[team.buildQueues.length];
      team.buildQueues.push({
        factoryId: factory ? factory.id : 'home',
        queue: [],
        current: null
      });
    }

    // Trim excess queues if factories were lost (rare)
    if (team.buildQueues.length > operationalFactories.length) {
      team.buildQueues.length = operationalFactories.length;
    }

    // Process every active queue in parallel
    for (let i = 0; i < team.buildQueues.length; i++) {
      const q = team.buildQueues[i];
      let current = q.current;

      if (!current && q.queue.length > 0) {
        const nextType = q.queue.shift();
        const time = BUILD_TIMES[nextType] || 30;

        current = { type: nextType, remaining: time };
        q.current = current;

        const factoryLabel = operationalFactories[i]?.isHome ? 'Home Base' : 'Forward Factory';
        game.addEvent(`[${team.name}] Builder started ${nextType.toUpperCase()} at ${factoryLabel}`);
      }

      if (current) {
        current.remaining--;
        if (current.remaining <= 0) {
          // Complete build — add the unit
          if (current.type === 'frigate') team.frigates++;
          else if (current.type === 'destroyer') team.destroyers++;
          else if (current.type === 'miner') team.availableMiners = (team.availableMiners || 0) + 1;
          else if (current.type === 'probe') team.probes = (team.probes || 0) + 1;
          else if (current.type === 'factory') team.availableFactories = (team.availableFactories || 0) + 1;
          else if (current.type === 'admiral') team.availableAdmirals = (team.availableAdmirals || 0) + 1;
          else if (current.type === 'capitol') team.capitolShips = (team.capitolShips || 0) + 1;

          const factoryLabel = operationalFactories[i]?.isHome ? 'Home Base' : 'Forward Factory';
          game.addEvent(`[${team.name}] completed 1 ${current.type.toUpperCase()} at ${factoryLabel}`);
          q.current = null;
        }
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

  const originalCount = fleet.frigates ?? fleet.fighters ?? 0;

  if (!defenderTeam || defenderTeam.factoryHP <= 0) {
    if (attackerTeam && attackerTeam.factoryHP > 0) {
      attackerTeam.frigates += originalCount;
    }
    game.addEvent(`Fleet from ${fleet.from} returned safely (${fleet.to} already destroyed)`);
    return;
  }

  // Defense Canon fully removed per prompt — no interception in this pass
  const survivors = originalCount;
  const damage = survivors * FRIGATE_DAMAGE;

  defenderTeam.factoryHP = Math.max(0, defenderTeam.factoryHP - damage);

  let msg = `${fleet.from} attacked ${fleet.to} with ${originalCount} FTR. `;
  if (survivors > 0) {
    msg += `${survivors} hit for ${damage} damage`;
    if (attackerTeam && attackerTeam.factoryHP > 0) {
      attackerTeam.frigates += survivors;
      msg += ` — ${survivors} returned.`;
    } else {
      msg += ` (attacker eliminated, survivors lost).`;
    }
  } else {
    msg += `All destroyed, no damage.`;
  }
  game.addEvent(msg);
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

// MINING: Process miner grid movement (Phase 1).
// Greedy Manhattan with improved gas giant avoidance + patience reroute timer.
//
// NOTE ON FUTURE UNIFICATION (see ARCHITECTURE.md):
// This logic is currently miner-specific. When fleets or probes become
// first-class grid-moving entities, we should evaluate extracting common
// movement concerns (position/target tracking, basic avoidance, stuck detection)
// into a shared module. Do not over-abstract until we have a second real consumer.
function processMinerMovement(game) {
  if (!game.map || !game.deployedMiners || game.deployedMiners.length === 0) return;

  const size = game.mapSize || 13;
  const gasX = game.map.gasGiant ? game.map.gasGiant.x : Math.floor(size/2);
  const gasY = game.map.gasGiant ? game.map.gasGiant.y : Math.floor(size/2);

  const now = Date.now();
  const toKeep = [];

  for (const miner of game.deployedMiners) {
    if (miner.state === 'mining') {
      toKeep.push(miner);
      continue;
    }

    // Only step on speed interval
    const shouldStep = (game.tickCounter % MINER_SPEED_TICKS) === 0;
    if (!shouldStep) {
      toKeep.push(miner);
      continue;
    }

    // Resolve current target position if this is an object-targeted move (e.g. moving moon)
    let tx = miner.targetX != null ? miner.targetX : miner.x;
    let ty = miner.targetY != null ? miner.targetY : miner.y;

    if (miner.targetObject) {
      const targetAnom = (game.map.anomalies || []).find(a => a.name === miner.targetObject || a.id === miner.targetObject);
      if (targetAnom) {
        tx = targetAnom.x;
        ty = targetAnom.y;
      }
    }

    if (miner.x === tx && miner.y === ty) {
      // Arrived at (current) target coords
      const targetAnom = miner.targetObject ? (game.map.anomalies || []).find(a => a.name === miner.targetObject || a.id === miner.targetObject) : null;

      if (targetAnom && miner.x === targetAnom.x && miner.y === targetAnom.y) {
        // Object is here - normal arrival
        if (miner.state === 'moving') {
          miner.state = 'setting_up';
          miner.setupCompleteTime = now + MINER_SETUP_TIME_MS;
          game.addEvent(`[${miner.teamName}] Miner arrived at ${miner.targetObject || `(${tx},${ty})`} — setting up (60s)`);
          debugLog(game, `MINER ARRIVED AT OBJECT: id=${miner.id} team=${miner.teamName} object=${miner.targetObject} pos=(${miner.x},${miner.y})`);
        }
      } else if (miner.targetObject) {
        // Expected object not at this cell. Per user rule: only correct if expected cell empty (it is).
        // Search nearby on this "arrival" logic. If not found, self-destruct on next check.
        const nearby = (game.map.anomalies || []).filter(a => 
          a.name === miner.targetObject || a.id === miner.targetObject
        ).filter(a => Math.abs(a.x - miner.x) <= 2 && Math.abs(a.y - miner.y) <= 2); // small search radius

        if (nearby.length > 0) {
          // Found nearby - update target and continue (will move next steps)
          const found = nearby[0];
          miner.targetX = found.x;
          miner.targetY = found.y;
          debugLog(game, `MINER CORRECTION: id=${miner.id} found ${miner.targetObject} nearby at (${found.x},${found.y})`);
          game.addEvent(`[${miner.teamName}] Miner adjusted course to ${miner.targetObject} (nearby)`);
        } else {
          // Not found even nearby - failure per rule. Self-destruct miner (remove it).
          debugLog(game, `MINER LOST TARGET: id=${miner.id} team=${miner.teamName} could not find ${miner.targetObject} - self-destructing`);
          game.addEvent(`[${miner.teamName}] Mining rig lost contact with ${miner.targetObject} and was lost.`);
          // do not push to toKeep -> it is removed
          continue;
        }
      } else {
        // Normal static target arrival
        if (miner.state === 'moving') {
          miner.state = 'setting_up';
          miner.setupCompleteTime = now + MINER_SETUP_TIME_MS;
          game.addEvent(`[${miner.teamName}] Miner arrived at (${tx},${ty}) — setting up (60s)`);
        }
      }

      toKeep.push(miner);
      continue;
    }

    const oldX = miner.x;
    const oldY = miner.y;
    const oldDist = Math.abs(tx - oldX) + Math.abs(ty - oldY);

    // Compute simple step toward target (Manhattan greedy)
    const dx = tx - miner.x;
    const dy = ty - miner.y;

    let stepX = 0;
    let stepY = 0;
    if (Math.abs(dx) >= Math.abs(dy)) {
      stepX = Math.sign(dx);
    } else {
      stepY = Math.sign(dy);
    }

    let nx = miner.x + stepX;
    let ny = miner.y + stepY;

    // If preferred step hits gas giant, try the other axis (slide-around)
    if (nx === gasX && ny === gasY) {
      nx = miner.x;
      ny = miner.y;
      if (stepX !== 0) {
        stepY = Math.sign(dy);
        nx = miner.x;
        ny = miner.y + stepY;
      } else {
        stepX = Math.sign(dx);
        nx = miner.x + stepX;
        ny = miner.y;
      }
    }

    // Final safety
    if (nx === gasX && ny === gasY) {
      nx = miner.x;
      ny = miner.y;
    }

    // Clamp bounds
    nx = Math.max(0, Math.min(size - 1, nx));
    ny = Math.max(0, Math.min(size - 1, ny));

    miner.x = nx;
    miner.y = ny;

    // === Patience / Stuck detection + Reroute ===
    const newDist = Math.abs(tx - nx) + Math.abs(ty - ny);
    const movedCloser = newDist < oldDist;

    if (!movedCloser) {
      miner.stuckCounter = (miner.stuckCounter || 0) + 1;
    } else {
      miner.stuckCounter = 0;
    }

    // Reroute if stuck for too long (patience timer)
    if ((miner.stuckCounter || 0) > 5) {   // ~5 blocked steps = significant time stuck
      // Pick a simple perpendicular detour target
      const detourX = miner.x + (Math.random() > 0.5 ? 3 : -3);
      const detourY = miner.y + (Math.random() > 0.5 ? 3 : -3);

      miner.tempTargetX = Math.max(1, Math.min(size - 2, detourX));
      miner.tempTargetY = Math.max(1, Math.min(size - 2, detourY));

      debugLog(game, `MINER REROUTE (patience): id=${miner.id} team=${miner.teamName} stuck=${miner.stuckCounter} at=(${miner.x},${miner.y}) originalTarget=(${tx},${ty}) newTempTarget=(${miner.tempTargetX},${miner.tempTargetY})`);
      game.addEvent(`[${miner.teamName}] Miner rerouting due to being stuck near obstacle`);

      miner.stuckCounter = 0;
      // Temporarily use the detour for the next few steps
      // (we'll clear it once closer to original target in future ticks)
    }

    // If we have a temp target and we're now reasonably closer to original, clear it
    if (miner.tempTargetX != null && newDist < oldDist + 2) {
      miner.tempTargetX = null;
      miner.tempTargetY = null;
    }

    // Use temp target for this step's calculation if present (for next iteration)
    // (simple: we already moved; the tempTarget will influence future steps via the main target logic if we want,
    //  but for v1 we just log and let natural movement continue)

    toKeep.push(miner);

    debugLog(game, `MINER STEP: id=${miner.id} team=${miner.teamName} from=(${oldX},${oldY}) to=(${nx},${ny}) target=(${tx},${ty}) dist=${newDist} stuck=${miner.stuckCounter || 0} state=${miner.state}`);
  }

  game.deployedMiners = toKeep;
}

// === Moon Orbit Simulation (new for moon motion) ===
// Moons move very slowly in approximate circular orbits around gas giant.
// Each has its own speed/interval for variety.
function processMoonOrbits(game) {
  if (!game.map || !game.map.anomalies || !game.map.gasGiant) return;

  const gas = game.map.gasGiant;
  const now = Date.now();
  const size = game.mapSize || 13;

  game.map.anomalies.forEach((a) => {
    if (!a.orbitRadius || !a.moveIntervalTicks) return; // only moons have this

    const interval = a.moveIntervalTicks || 600; // default ~10 min
    const lastMove = a.lastMoveTime || 0;

    if (now - lastMove < interval * 1000) return; // not time to move yet

    // Update phase
    const angleStep = (2 * Math.PI) / 12; // ~30 degrees per move, enough for ~1 cell
    a.phase = (a.phase || 0) + (angleStep * (a.orbitDirection || 1));

    // Calculate new position
    const newX = Math.round(gas.x + a.orbitRadius * Math.cos(a.phase));
    const newY = Math.round(gas.y + a.orbitRadius * Math.sin(a.phase));

    // Clamp and avoid gas giant
    let finalX = Math.max(1, Math.min(size - 2, newX));
    let finalY = Math.max(1, Math.min(size - 2, newY));

    if (finalX === gas.x && finalY === gas.y) {
      // nudge away
      finalX = gas.x + (Math.random() > 0.5 ? 1 : -1);
    }

    a.x = finalX;
    a.y = finalY;
    a.lastMoveTime = now;

    debugLog(game, `MOON MOVE: ${a.name} (${a.type}) to (${a.x},${a.y}) phase=${a.phase.toFixed(2)}`);
  });
}

// MINING: Handle setup timers (Phase 3). Transition setting_up -> mining after 60s, with event.
function processMinerSetup(game) {
  if (!game.deployedMiners || game.deployedMiners.length === 0) return;
  const now = Date.now();
  for (const miner of game.deployedMiners) {
    if (miner.state === 'setting_up' && miner.setupCompleteTime && now >= miner.setupCompleteTime) {
      miner.state = 'mining';
      miner.miningSite = { x: miner.x, y: miner.y, type: null };
      const siteKey = `(${miner.x},${miner.y})`;
      game.addEvent(`[${miner.teamName}] Miner setup complete at ${siteKey} — now producing resources`);
      debugLog(game, `MINER MINING: team=${miner.teamName} id=${miner.id} at=(${miner.x},${miner.y})`);
      // Clear timer
      miner.setupCompleteTime = null;
    }
  }
}

// MINING: Periodic yield processing (Phase 2). Called every tick but only acts on interval using Date or tick.
// For v1: any non-moving miner on an anomaly cell contributes using stacking based on TOTAL rigs at that cell.
function processMinerMining(game) {
  if (!game.map || !game.map.anomalies || !game.deployedMiners || game.deployedMiners.length === 0) return;

  const now = Date.now();
  // Only payout on mining interval (use a simple lastMiningTime or tick based)
  // Use tickCounter % (MINING_INTERVAL_MS / 1000) but since 1s ticks, every 60 ticks
  const MINING_TICKS = Math.floor(MINING_INTERVAL_MS / 1000);
  if (MINING_TICKS < 1 || (game.tickCounter % MINING_TICKS) !== 0) return;

  const size = game.mapSize || 13;
  const anomalyMap = new Map(); // "x,y" -> {x,y,type}
  for (const a of game.map.anomalies) {
    anomalyMap.set(`${a.x},${a.y}`, a);
  }

  // Group only fully 'mining' state rigs by cell (Phase 3: setup does not yield yet)
  const cellRigs = {}; // key -> { total: num, byTeam: {team: count} }
  for (const m of game.deployedMiners) {
    if (m.state !== 'mining') continue; // ONLY active mining rigs contribute
    const key = `${m.x},${m.y}`;
    if (!anomalyMap.has(key)) continue; // no yield off anomaly

    if (!cellRigs[key]) cellRigs[key] = { total: 0, byTeam: {} };
    cellRigs[key].total++;
    const tname = m.teamName;
    cellRigs[key].byTeam[tname] = (cellRigs[key].byTeam[tname] || 0) + 1;
  }

  // For each occupied mining site, compute and award
  for (const [key, data] of Object.entries(cellRigs)) {
    const totalRigs = data.total;
    if (totalRigs < 1) continue;
    const [cx, cy] = key.split(',').map(Number);
    const anomaly = anomalyMap.get(key);
    const base = YIELD_BASE[anomaly.type] || 1;
    const stackIdx = Math.min(STACKING_MULTIPLIERS.length - 1, Math.max(0, totalRigs - 1));
    const mult = STACKING_MULTIPLIERS[stackIdx];

    // Award per team
    for (const [tname, teamRigs] of Object.entries(data.byTeam)) {
      const team = game.getTeamByName(tname);
      if (!team || team.factoryHP <= 0) continue;

      // Each of team's rigs gets base * mult (floored)
      const perRig = Math.floor(base * mult);
      const teamYield = perRig * teamRigs;

      if (teamYield > 0) {
        const siteKey = `${cx},${cy}`;
        addMiningYieldToTeam(game, team, anomaly.type, teamYield, siteKey);
      }
    }
  }
}

// === PROBE RECONNAISSANCE (new functional system) ===
// Fast-moving, short-lived units. They travel quickly, snapshot a small area (max 5 cells),
// reveal anomalies for their team, then disappear.
function processProbeMovement(game) {
  if (!game.deployedProbes || game.deployedProbes.length === 0) return;
  if (!game.map || !game.map.anomalies || !game.map.gasGiant) return;

  const size = game.mapSize || 13;
  const gasX = game.map.gasGiant.x;
  const gasY = game.map.gasGiant.y;

  const toKeep = [];

  for (const probe of game.deployedProbes) {
    if (probe.state !== 'moving') {
      toKeep.push(probe);
      continue;
    }

    // Fast movement — probes update position on most ticks
    const shouldMove = (game.tickCounter % PROBE_MOVE_TICKS) === 0;
    if (!shouldMove) {
      toKeep.push(probe);
      continue;
    }

    const tx = probe.targetX;
    const ty = probe.targetY;

    // Arrived at destination?
    if (probe.x === tx && probe.y === ty) {
      // Perform small snapshot (plus shape = center + 4 directions = 5 cells max)
      const snapshotCells = [
        { x: tx, y: ty },
        { x: tx, y: ty - 1 },
        { x: tx, y: ty + 1 },
        { x: tx - 1, y: ty },
        { x: tx + 1, y: ty }
      ].filter(c => c.x >= 0 && c.x < size && c.y >= 0 && c.y < size);

      let revealed = 0;
      for (const cell of snapshotCells) {
        for (const anom of game.map.anomalies) {
          if (anom.x === cell.x && anom.y === cell.y) {
            if (!anom.discoveredBy) anom.discoveredBy = {};
            if (!anom.discoveredBy[probe.teamName]) {
              anom.discoveredBy[probe.teamName] = true;
              revealed++;
            }
          }
        }
      }

      const msg = revealed > 0
        ? `[${probe.teamName}] Probe completed snapshot near (${tx},${ty}) — revealed ${revealed} anomaly(ies)`
        : `[${probe.teamName}] Probe completed snapshot near (${tx},${ty}) — nothing new`;
      game.addEvent(msg);
      debugLog(game, `PROBE SNAPSHOT: team=${probe.teamName} at=(${tx},${ty}) revealed=${revealed}`);

      // Probe disappears after snapshot
      continue;
    }

    // Move one step toward target (simple greedy, avoid gas giant)
    let nx = probe.x;
    let ny = probe.y;

    const dx = tx - probe.x;
    const dy = ty - probe.y;

    if (Math.abs(dx) > Math.abs(dy)) {
      nx = probe.x + Math.sign(dx);
    } else if (dy !== 0) {
      ny = probe.y + Math.sign(dy);
    }

    // Avoid gas giant
    if (nx === gasX && ny === gasY) {
      // Nudge sideways
      if (probe.x !== gasX) nx = probe.x;
      else ny = probe.y + (Math.random() > 0.5 ? 1 : -1);
    }

    // Clamp
    nx = Math.max(0, Math.min(size - 1, nx));
    ny = Math.max(0, Math.min(size - 1, ny));

    probe.x = nx;
    probe.y = ny;

    toKeep.push(probe);
  }

  game.deployedProbes = toKeep;
}

// processFactorySynthesis is fully in server/production.js
// (called via production.processFactorySynthesis(game) in the main loop)

// MINING helper: add yield resources to team (tunable distribution) + detailed event log
function addMiningYieldToTeam(game, team, anomalyType, amount, siteKey = '') {
  if (!team || amount <= 0) return;
  const order = RESOURCE_ORDER;
  let idxs = [0,1]; // default (large_moon and legacy major_moon)
  if (anomalyType === 'small_moon' || anomalyType === 'normal_moon') {
    idxs = [1, 2]; // small moons bias toward second + third resource for variety
  } else if (anomalyType === 'gas_cloud') {
    idxs = [2,3];
  } else if (anomalyType === 'asteroid_cluster') {
    idxs = [4,5];
  }

  const primaryShare = Math.floor(amount * 0.7 / 2);
  const secondaryShare = Math.floor(amount * 0.3 / 4);

  const gains = [];
  for (let i = 0; i < 6; i++) {
    let add = secondaryShare;
    if (idxs.includes(i)) add += primaryShare;
    if (add > 0) {
      const mat = order[i];
      team.resources[mat] = (team.resources[mat] || 0) + add;
      // Full names (no acronyms in resource UI / event log)
      const full = order[i];
      gains.push(`+${add} ${full}`);
    }
  }

  if (game && gains.length > 0) {
    const site = siteKey ? ` at ${siteKey}` : '';
    const typeLabel = anomalyType === 'major_moon' ? 'Moon' : (anomalyType === 'gas_cloud' ? 'Gas Cloud' : 'Asteroid');
    game.addEvent(`[${team.name}] Mining${site} (${typeLabel}) → ${gains.join(' ')}`);
    debugLog(game, `YIELD: team=${team.name} site=${siteKey || 'unknown'} type=${anomalyType} gains=${gains.join(' ')}`);
  }
}

// MINING: deployMiner handler logic extracted for socket (Phase 1)
function createDeployedMiner(game, teamName, targetX, targetY, targetObject = null) {
  const team = game.getTeamByName(teamName);
  if (!team || team.availableMiners < 1) return { ok: false, error: 'No available miners' };
  if (!game.map || !game.map.starts) return { ok: false, error: 'Map not ready' };

  const start = game.map.starts[teamName] || { x: 1, y: 1 };
  const size = game.mapSize || 13;

  // Clamp target
  const tx = Math.max(0, Math.min(size-1, Math.floor(targetX)));
  const ty = Math.max(0, Math.min(size-1, Math.floor(targetY)));

  // Prevent targeting the gas giant itself
  const gas = game.map && game.map.gasGiant;
  if (gas && tx === gas.x && ty === gas.y) {
    return { ok: false, error: 'Cannot deploy to the gas giant' };
  }

  // MINING: Enforce max 3 rigs per site (Phase 2). Count current pos + targeted to prevent over-deploy.
  const rigsAtSite = game.deployedMiners.filter(m =>
    (m.x === tx && m.y === ty) || (m.targetX === tx && m.targetY === ty)
  ).length;
  if (rigsAtSite >= MAX_MINERS_PER_SITE) {
    return { ok: false, error: `Site at (${tx},${ty}) is at max capacity (${MAX_MINERS_PER_SITE} rigs)` };
  }

  // Consume one
  team.availableMiners--;

  const miner = {
    id: 'miner-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    teamName,
    x: start.x,
    y: start.y,
    state: 'moving',
    targetX: tx,
    targetY: ty,
    targetObject: targetObject || null, // name/id of the anomaly/moon if object-targeted
    setupCompleteTime: null,
    miningSite: null
  };

  game.deployedMiners.push(miner);
  game.addEvent(`[${teamName}] Builder deployed 1 MINER toward (${tx},${ty})`);
  debugLog(game, `DEPLOY MINER: team=${teamName} from=(${start.x},${start.y}) target=(${tx},${ty}) remainingAvailable=${team.availableMiners}`);
  return { ok: true, miner };
}

// === MAP GENERATION (ui-map branch) ===
function generateMapForGame(game) {
  const size = game.mapSize;
  const center = Math.floor(size / 2);

  const gasGiant = { x: center, y: center };

  // Moon count scaling for large + small moons (replaces legacy static moons)
  const baseMoonCount = size === 13 ? 6 : size === 15 ? 8 : 11;
  const largeMoonCount = Math.max(3, Math.min(7, Math.floor(baseMoonCount * 0.55)));
  const smallMoonCount = Math.max(2, baseMoonCount - largeMoonCount);

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
    starts,   // teamName -> {x, y}
    // Moons and other sites are now fully in anomalies (large_moon / small_moon + gas_cloud + asteroid_cluster)
    anomalies: []
  };

  // Initialize starting home base factories (1 per team, at their starting position)
  game.factories = [];
  for (const [teamName, pos] of Object.entries(starts)) {
    const homeFactoryId = 'factory-home-' + teamName + '-' + Date.now();
    game.factories.push({
      id: homeFactoryId,
      teamName,
      x: pos.x,
      y: pos.y,
      state: 'operational',
      isHome: true,
      setupCompleteTime: null
    });

    // Give the team one initial build queue tied to their home factory
    const team = game.teams.get(teamName);
    if (team) {
      team.buildQueues = [{
        factoryId: homeFactoryId,
        queue: [],
        current: null
      }];
    }
  }

  // MINING: Generate anomalies. large_moon + small_moon are the functioning orbiting moons.
  // gas_cloud + asteroid_cluster are static/hidden. Use seeded rand for reproducibility.

  const seedBase = (game.code || 'SEED').split('').reduce((a,c)=>a + c.charCodeAt(0), size);
  function seededRand(i) { return ((seedBase * 9301 + i * 49297) % 233280) / 233280; }

  const anomalies = [];
  const occupied = new Set();
  function isOccupied(x,y) {
    const k = `${x},${y}`;
    if (occupied.has(k)) return true;
    if (x === center && y === center) return true; // gas giant
    // avoid starts
    for (const s of Object.values(starts)) if (s.x === x && s.y === y) return true;
    return false;
  }
  function placeAnomaly(type, count, jitter=2) {
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < 200) {
      attempts++;
      const idx = placed + attempts * 7;
      const r = seededRand(idx);
      // Bias placement away from center for variety
      let ax = Math.floor(r * (size - 4)) + 2;
      let ay = Math.floor(seededRand(idx+11) * (size - 4)) + 2;
      if (Math.abs(ax - center) < 2 && Math.abs(ay - center) < 2) continue;
      if (isOccupied(ax, ay)) { ax = (ax + 1) % (size-1); ay = (ay + 3) % (size-1); if (isOccupied(ax,ay)) continue; }
      anomalies.push({ x: ax, y: ay, type });
      occupied.add(`${ax},${ay}`);
      placed++;
    }
  }

  // === New: Named objects with movement for moons ===
  // Generate short names: Prefix + - + 3-4 alphanum (e.g. M-A3K, G-7P2)
  function generateShortName(prefix, seedIdx) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // avoid confusing chars
    let name = prefix + '-';
    for (let i = 0; i < 3; i++) {
      name += chars[Math.floor(seededRand(seedIdx + i) * chars.length)];
    }
    return name;
  }

  // Large moons (visible, slower orbits, higher yield)
  placeAnomaly('large_moon', largeMoonCount);

  // Small moons (faster orbits on average, lower yield, different resource bias)
  placeAnomaly('small_moon', smallMoonCount);

  // Gas clouds (medium, hidden) - spread more evenly
  const gasCount = size === 13 ? 5 : size === 15 ? 6 : 8;
  placeAnomaly('gas_cloud', gasCount);

  // Asteroid clusters (rare, hidden)
  const astCount = size === 13 ? 3 : size === 15 ? 4 : 5;
  placeAnomaly('asteroid_cluster', astCount);

  // Assign names and orbit data to moons (large + small)
  const moonTypes = ['large_moon', 'small_moon'];
  anomalies.forEach((a, idx) => {
    if (moonTypes.includes(a.type)) {
      const prefix = a.type === 'large_moon' ? 'L' : 'S';
      a.id = generateShortName(prefix, 100 + idx);
      a.name = a.id;
      // Orbit params: large moons slightly slower / more stable
      a.orbitRadius = 3 + Math.floor(seededRand(200 + idx) * 4); // 3-6
      a.baseIntervalMin = a.type === 'large_moon'
        ? (8 + seededRand(300 + idx) * 4)
        : (4 + seededRand(400 + idx) * 3);
      a.moveIntervalTicks = Math.floor(a.baseIntervalMin * 60); // approx ticks (1s ticks)
      a.phase = seededRand(500 + idx) * Math.PI * 2;
      a.orbitDirection = 1; // counter-clockwise
    } else {
      // Static objects get names too for unified targeting
      const prefix = a.type === 'gas_cloud' ? 'G' : 'A';
      a.id = generateShortName(prefix, 600 + idx);
      a.name = a.id;
    }
  });

  game.map.anomalies = anomalies;
  console.log(`[MAP] Generated ${size}x${size} map for ${game.code} with ${anomalies.length} anomalies (large_moon + small_moon + gas + asteroid)`);
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

    initGameDebugLog(game, code);
    debugLog(game, `Game created by host: ${game.hostName}`);

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
    debugLog(game, `GAME STARTED - ${game.teams.size} teams`);

    // Log starting profiles so everyone immediately sees the asymmetric starts (drives trading)
    // Use full names in the event log (resource UI rule: no acronyms here)
    for (const t of game.teams.values()) {
      const arr = t.getResourcesArray();
      const fullNames = ['Fused Xenon', 'Helium-3 Lattice', 'Quantite', 'Plasma-Bound Carbon', 'Antimatter Catalyst', 'Neurocryst'];
      const display = arr.map((v, i) => `${fullNames[i]}:${v}`).join(' ');
      game.addEvent(`[${t.name}] starts with ${display}`);
    }

    game.addEvent('GAME STARTED — Each team has different starting resources (specialization bias hidden). Builder: you have enough to start building multiple miners immediately.');

    // Give an immediate synthesis "head start" so Builders have resources to build several things right away
    // (home factory baseline for 3 minutes of synthesis)
    for (const t of game.teams.values()) {
      if (t.factoryHP > 0) {
        const synth = production.FACTORY_SYNTHESIS_PER_FACTORY || {};
        const homeFactories = 1; // at least the starting one
        for (const [res, perMin] of Object.entries(synth)) {
          const boost = Math.round(perMin * homeFactories * 3); // 3 minutes worth
          if (boost > 0) {
            t.resources[res] = (t.resources[res] || 0) + boost;
          }
        }
      }
    }

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

    // Allow new infrastructure types (factory, admiral, capitol)
    if (type !== 'frigate' && type !== 'destroyer' && type !== 'miner' && type !== 'probe' &&
        type !== 'factory' && type !== 'admiral' && type !== 'capitol') {
      return cb?.({ ok: false, error: 'Invalid production type' });
    }

    const cost = BUILD_COSTS[type];
    if (!team.canAfford(cost)) {
      return cb?.({ ok: false, error: 'Not enough resources' });
    }

    const targetQueue = factories.findShortestBuildQueue(team, game);

    if (!targetQueue) {
      return cb?.({ ok: false, error: 'All factory queues are full (max 4 per factory)' });
    }

    // Deduct the exact multi-resource cost when production starts
    team.deduct(cost);
    targetQueue.queue.push(type);

    const factoryLabel = factories.factoryLabelForQueue(game, info.teamName, targetQueue.factoryId);
    game.addEvent(`[${info.teamName}] Builder queued 1 ${type.toUpperCase()} at ${factoryLabel}`);

    persistGameState(game);
    broadcastState(game);
    cb?.({ ok: true });
  });

  // Builder can cancel items still sitting in a production queue (not the one currently building)
  socket.on('cancelQueuedBuild', ({ queueIndex, position }, cb) => {
    const info = socketToPlayer.get(socket.id);
    if (!info || info.role !== 'builder') return cb?.({ ok: false, error: 'Only the Builder can manage the production queue' });

    const game = info.game;
    if (game.status !== 'running') return cb?.({ ok: false });

    const team = game.getTeamByName(info.teamName);
    if (!team) return cb?.({ ok: false, error: 'Team not found' });

    const q = team.buildQueues && team.buildQueues[queueIndex];
    if (!q || !Array.isArray(q.queue)) {
      return cb?.({ ok: false, error: 'Invalid queue' });
    }

    if (position < 0 || position >= q.queue.length) {
      return cb?.({ ok: false, error: 'Invalid position in queue' });
    }

    const removedType = q.queue.splice(position, 1)[0];

    // Note: We do NOT refund resources. The cost was paid when queued.
    game.addEvent(`[${info.teamName}] Builder canceled queued ${removedType.toUpperCase()}`);
    debugLog(game, `CANCEL BUILD: team=${info.teamName} queue=${queueIndex} pos=${position} type=${removedType}`);

    persistGameState(game);
    broadcastState(game);
    cb?.({ ok: true });
  });

  // MINING: Builder deploys an available miner to a map target (Phase 1)
  // For v1: Builder can deploy and (later) give move orders. War will also see miners.
  socket.on('deployMiner', ({ targetX, targetY, targetObject }, cb) => {
    const info = socketToPlayer.get(socket.id);
    if (!info || info.role !== 'builder') return cb?.({ ok: false, error: 'Only the Builder can deploy miners' });

    const game = info.game;
    if (game.status !== 'running') return cb?.({ ok: false });

    const res = createDeployedMiner(game, info.teamName, targetX, targetY, targetObject);
    if (!res.ok) return cb?.(res);

    persistGameState(game);
    broadcastState(game);
    cb?.({ ok: true });
  });

  // MINING: Move/redirect an existing deployed miner (Phase 1, callable by Builder or War for v1)
  socket.on('moveMiner', ({ minerId, targetX, targetY, targetObject }, cb) => {
    const info = socketToPlayer.get(socket.id);
    if (!info || (info.role !== 'builder' && info.role !== 'war')) {
      return cb?.({ ok: false, error: 'Builder or War Commander can command miners' });
    }

    const game = info.game;
    if (game.status !== 'running') return cb?.({ ok: false });

    const miner = game.deployedMiners.find(m => m.id === minerId && m.teamName === info.teamName);
    if (!miner) return cb?.({ ok: false, error: 'Miner not found or not yours' });

    // Hard rule: Once a miner has arrived and started setting up or mining, it is locked to that site.
    if (miner.state === 'setting_up' || miner.state === 'mining') {
      return cb?.({ ok: false, error: 'This miner has already been deployed and is locked to its current mining site.' });
    }

    const size = game.mapSize || 13;
    const tx = Math.max(0, Math.min(size-1, Math.floor(targetX)));
    const ty = Math.max(0, Math.min(size-1, Math.floor(targetY)));

    // Prevent moving to the gas giant
    const gas = game.map && game.map.gasGiant;
    if (gas && tx === gas.x && ty === gas.y) {
      return cb?.({ ok: false, error: 'Cannot move miner to the gas giant' });
    }

    miner.targetX = tx;
    miner.targetY = ty;
    if (targetObject) miner.targetObject = targetObject;

    game.addEvent(`[${info.teamName}] Miner re-tasked to (${miner.targetX},${miner.targetY})`);
    debugLog(game, `MOVE MINER: team=${info.teamName} id=${minerId} newTarget=(${tx},${ty}) targetObject=${targetObject || 'none'}`);
    persistGameState(game);
    broadcastState(game);
    cb?.({ ok: true });
  });

  socket.on('deployFactory', ({ targetX, targetY, targetObject }, cb) => {
    const info = socketToPlayer.get(socket.id);
    if (!info || info.role !== 'builder') return cb?.({ ok: false, error: 'Only the Builder can deploy factories' });

    const game = info.game;
    if (game.status !== 'running') return cb?.({ ok: false });

    const res = factories.createDeployedFactory(game, info.teamName, targetX, targetY, targetObject);
    if (!res.ok) return cb?.(res);

    persistGameState(game);
    broadcastState(game);
    cb?.({ ok: true });
  });

  socket.on('moveFactory', ({ factoryId, targetX, targetY, targetObject }, cb) => {
    const info = socketToPlayer.get(socket.id);
    if (!info || info.role !== 'builder') {
      return cb?.({ ok: false, error: 'Only the Builder can redirect factory kits' });
    }

    const game = info.game;
    if (game.status !== 'running') return cb?.({ ok: false });

    const res = factories.moveFactory(game, info.teamName, factoryId, targetX, targetY, targetObject);
    if (!res.ok) return cb?.(res);

    persistGameState(game);
    broadcastState(game);
    cb?.({ ok: true });
  });

  // Launch probe — War Commander deploys a short-lived fast-moving reconnaissance unit.
  // The probe travels quickly to the chosen location, takes a small snapshot (≤5 cells),
  // reveals anomalies for the team, and then disappears.
  socket.on('launchProbe', ({ x, y }, cb) => {
    const info = socketToPlayer.get(socket.id);
    if (!info || info.role !== 'war') return cb?.({ ok: false, error: 'Only the War Commander can launch probes' });

    const game = info.game;
    if (game.status !== 'running') return cb?.({ ok: false });

    const team = game.getTeamByName(info.teamName);
    if (!team || (team.probes || 0) < 1) return cb?.({ ok: false, error: 'No probes available (build more)' });

    if (!game.map || !game.map.starts || !game.map.anomalies) return cb?.({ ok: false, error: 'No map' });

    // Consume one ready probe
    team.probes--;

    const start = game.map.starts[info.teamName] || { x: 1, y: 1 };
    const tx = Math.max(0, Math.min((game.mapSize || 13) - 1, Math.floor(x)));
    const ty = Math.max(0, Math.min((game.mapSize || 13) - 1, Math.floor(y)));

    // Create a mobile probe entity (quick travel, small snapshot on arrival)
    const probe = {
      id: 'probe-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      teamName: info.teamName,
      x: start.x,
      y: start.y,
      targetX: tx,
      targetY: ty,
      state: 'moving',
      launchTime: Date.now()
    };

    game.deployedProbes.push(probe);

    game.addEvent(`[${info.teamName}] Probe launched toward (${tx},${ty}) — en route (scan begins on arrival)`);
    debugLog(game, `PROBE LAUNCH: team=${info.teamName} from=(${start.x},${start.y}) target=(${tx},${ty})`);

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
    if (numFighters < 1 || numFighters > attacker.frigates) return cb?.({ ok: false });

    attacker.frigates -= numFighters;

    const arrivalTime = Date.now() + (TRAVEL_TIME * 1000);
    game.fleets.push({
      id: Date.now() + Math.random(),
      from: info.teamName,
      to: targetTeam,
      frigates: numFighters,
      arrivalTime
    });

    game.addEvent(`[${info.teamName}] War Commander launched ${numFighters} FTR at ${targetTeam} (ETA ${TRAVEL_TIME}s)`);
    persistGameState(game);
    broadcastState(game);
    cb?.({ ok: true });
  });

  // Negotiator-only action — disabled in this resource-system pass (trading not implemented)
  socket.on('transferTi', ({ targetTeam, amount }, cb) => {
    return cb?.({ ok: false, error: 'Trading not available in this build (resource foundation pass)' });
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
      initGameDebugLog(hydrated, code);
      debugLog(hydrated, `Saved game loaded from DB`);
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

  // Teacher can permanently delete a saved / previous game (clean removal from DB + memory)
  socket.on('deleteSavedGame', ({ code }, cb) => {
    if (!code) return cb?.({ ok: false, error: 'No code provided' });

    // Remove from active memory if it was loaded
    if (games.has(code)) {
      games.delete(code);
    }

    try {
      db.deleteGame(code);
      console.log(`[DB] Deleted game ${code} (teacher action)`);
      cb?.({ ok: true });
    } catch (e) {
      console.error(`[DB] Failed to delete game ${code}:`, e.message);
      cb?.({ ok: false, error: 'Database error while deleting' });
    }
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