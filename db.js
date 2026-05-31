const Database = require('better-sqlite3');
const path = require('path');

let db = null;

function initDb() {
  const dbPath = path.join(__dirname, 'starpoint.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL'); // better performance + crash safety
  db.pragma('foreign_keys = ON');  // Required for ON DELETE CASCADE to actually work on child tables

  // Schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      code TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'waiting', -- waiting | running | saved | ended
      winner TEXT,
      map_size INTEGER DEFAULT 13,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      last_saved INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_code TEXT NOT NULL,
      name TEXT NOT NULL,
      titanium INTEGER NOT NULL DEFAULT 100,
      miners INTEGER NOT NULL DEFAULT 0,
      fighters INTEGER NOT NULL DEFAULT 0,
      canons INTEGER NOT NULL DEFAULT 0,
      factory_hp INTEGER NOT NULL DEFAULT 100,
      build_queues_json TEXT,  -- one build queue per operational factory
      FOREIGN KEY(game_code) REFERENCES games(code) ON DELETE CASCADE,
      UNIQUE(game_code, name)
    );

    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_code TEXT NOT NULL,
      team_name TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL, -- 'war' | 'negotiator' | 'builder'
      joined_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY(game_code) REFERENCES games(code) ON DELETE CASCADE,
      UNIQUE(game_code, team_name, name)
    );

    CREATE TABLE IF NOT EXISTS fleets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_code TEXT NOT NULL,
      from_team TEXT NOT NULL,
      to_team TEXT NOT NULL,
      fighters INTEGER NOT NULL,
      arrival_time INTEGER NOT NULL,
      FOREIGN KEY(game_code) REFERENCES games(code) ON DELETE CASCADE
    );

    -- Map persistence tables (new for saved games feature)
    CREATE TABLE IF NOT EXISTS game_maps (
      game_code TEXT PRIMARY KEY,
      gas_giant_x INTEGER NOT NULL,
      gas_giant_y INTEGER NOT NULL,
      moons TEXT NOT NULL, -- JSON array of {x,y} (legacy; no longer populated — moons now live in anomalies as large_moon/small_moon)
      FOREIGN KEY(game_code) REFERENCES games(code) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS team_starts (
      game_code TEXT NOT NULL,
      team_name TEXT NOT NULL,
      start_x INTEGER NOT NULL,
      start_y INTEGER NOT NULL,
      FOREIGN KEY(game_code) REFERENCES games(code) ON DELETE CASCADE,
      PRIMARY KEY (game_code, team_name)
    );

    CREATE INDEX IF NOT EXISTS idx_teams_game ON teams(game_code);
    CREATE INDEX IF NOT EXISTS idx_players_game ON players(game_code);
    CREATE INDEX IF NOT EXISTS idx_fleets_game ON fleets(game_code);
    CREATE INDEX IF NOT EXISTS idx_team_starts_game ON team_starts(game_code);
  `);

  // Safe upgrade: add map_size column if missing (for existing databases)
  try {
    db.exec(`ALTER TABLE games ADD COLUMN map_size INTEGER DEFAULT 13`);
  } catch (e) {}

  // Safe upgrades for the new 6-resource system (add columns if they don't exist)
  const upgrades = [
    `ALTER TABLE teams ADD COLUMN resources_json TEXT`,
    `ALTER TABLE teams ADD COLUMN frigates INTEGER DEFAULT 0`,
    `ALTER TABLE teams ADD COLUMN destroyers INTEGER DEFAULT 0`,
    `ALTER TABLE teams ADD COLUMN buildings_json TEXT`,
    `ALTER TABLE fleets ADD COLUMN frigates INTEGER DEFAULT 0`,
    // MINING Phase 6: persistence for available_miners, probes, and deployed miners JSON per team
    `ALTER TABLE teams ADD COLUMN available_miners INTEGER DEFAULT 0`,
    `ALTER TABLE teams ADD COLUMN probes INTEGER DEFAULT 0`,
    `ALTER TABLE teams ADD COLUMN deployed_miners_json TEXT`,
    // Factory multi-queue system (one build queue per operational factory)
    `ALTER TABLE teams ADD COLUMN build_queues_json TEXT`,
    // MINING: anomalies (with discovery) JSON on map table
    `ALTER TABLE game_maps ADD COLUMN anomalies TEXT`
  ];
  for (const sql of upgrades) {
    try { db.exec(sql); } catch (e) {}
  }

  console.log('[DB] Initialized starpoint.db (6-resource schema ready)');
  return db;
}

function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

// === GAME OPERATIONS ===

function saveGame(code, status, winner = null) {
  const stmt = getDb().prepare(`
    INSERT INTO games (code, status, winner, last_saved)
    VALUES (?, ?, ?, strftime('%s','now'))
    ON CONFLICT(code) DO UPDATE SET
      status = excluded.status,
      winner = excluded.winner,
      last_saved = excluded.last_saved
  `);
  stmt.run(code, status, winner);
}

function loadAllGames() {
  const games = getDb().prepare('SELECT * FROM games').all();
  const result = [];

  for (const g of games) {
    const teams = getDb().prepare('SELECT * FROM teams WHERE game_code = ?').all(g.code);
    const players = getDb().prepare('SELECT * FROM players WHERE game_code = ?').all(g.code);
    const fleets = getDb().prepare('SELECT * FROM fleets WHERE game_code = ?').all(g.code);

    // Load map data if present
    const mapRow = getDb().prepare('SELECT * FROM game_maps WHERE game_code = ?').get(g.code);
    let mapData = null;
    if (mapRow) {
      mapData = {
        gasGiant: { x: mapRow.gas_giant_x, y: mapRow.gas_giant_y },
        moons: JSON.parse(mapRow.moons || '[]'),
        // MINING Phase 6
        anomalies: mapRow.anomalies ? JSON.parse(mapRow.anomalies) : []
      };
    }

    const startsRows = getDb().prepare('SELECT * FROM team_starts WHERE game_code = ?').all(g.code);
    const starts = {};
    for (const s of startsRows) {
      starts[s.team_name] = { x: s.start_x, y: s.start_y };
    }

    result.push({
      code: g.code,
      status: g.status,
      winner: g.winner,
      mapSize: g.map_size || 13,
      teams: teams.map(t => ({
        name: t.name,
        resources: t.resources_json ? JSON.parse(t.resources_json) : null,
        frigates: t.frigates ?? 0,
        destroyers: t.destroyers ?? 0,
        buildings: t.buildings_json ? JSON.parse(t.buildings_json) : null,
        factoryHP: t.factory_hp,
        // MINING Phase 6
        availableMiners: t.available_miners ?? 0,
        probes: t.probes ?? 0,
        deployedMiners: t.deployed_miners_json ? JSON.parse(t.deployed_miners_json) : null
      })),
      players: players.map(p => ({
        name: p.name,
        teamName: p.team_name,
        role: p.role
      })),
      fleets: fleets.map(f => ({
        from: f.from_team,
        to: f.to_team,
        frigates: f.frigates ?? f.fighters ?? 0,
        fighters: f.fighters, // legacy
        arrivalTime: f.arrival_time
      })),
      mapData,
      teamStarts: starts
    });
  }
  return result;
}

function deleteGame(code) {
  const stmt = getDb().prepare('DELETE FROM games WHERE code = ?');
  stmt.run(code);
}

// === TEAM OPERATIONS ===

function upsertTeam(gameCode, teamName, initialData = {}) {
  const stmt = getDb().prepare(`
    INSERT INTO teams (
      game_code, name,
      resources_json, frigates, destroyers, buildings_json,
      factory_hp, available_miners, probes, deployed_miners_json,
      build_queues_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(game_code, name) DO UPDATE SET
      resources_json = excluded.resources_json,
      frigates = excluded.frigates,
      destroyers = excluded.destroyers,
      buildings_json = excluded.buildings_json,
      factory_hp = excluded.factory_hp,
      available_miners = excluded.available_miners,
      probes = excluded.probes,
      deployed_miners_json = excluded.deployed_miners_json,
      build_queues_json = excluded.build_queues_json
  `);

  stmt.run(
    gameCode,
    teamName,
    initialData.resources ? JSON.stringify(initialData.resources) : null,
    initialData.frigates ?? 0,
    initialData.destroyers ?? 0,
    initialData.buildings ? JSON.stringify(initialData.buildings) : null,
    initialData.factoryHP ?? 100,
    initialData.availableMiners ?? 0,
    initialData.probes ?? 0,
    initialData.deployedMiners ? JSON.stringify(initialData.deployedMiners) : null,
    initialData.buildQueues ? JSON.stringify(initialData.buildQueues) : null
  );
}

function updateTeamResources(gameCode, teamName, updates) {
  const fields = [];
  const values = [];
  for (const [k, v] of Object.entries(updates)) {
    const col = k === 'factoryHP' ? 'factory_hp' : k;
    fields.push(`${col} = ?`);
    values.push(v);
  }
  if (fields.length === 0) return;

  const sql = `UPDATE teams SET ${fields.join(', ')} WHERE game_code = ? AND name = ?`;
  getDb().prepare(sql).run(...values, gameCode, teamName);
}

function getTeamsForGame(gameCode) {
  return getDb().prepare('SELECT * FROM teams WHERE game_code = ? ORDER BY name').all(gameCode);
}

// === PLAYER / ROLE OPERATIONS ===

function addOrUpdatePlayer(gameCode, teamName, playerName, role) {
  const stmt = getDb().prepare(`
    INSERT INTO players (game_code, team_name, name, role)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(game_code, team_name, name) DO UPDATE SET role = excluded.role
  `);
  stmt.run(gameCode, teamName, playerName, role);
}

function getPlayersForGame(gameCode) {
  return getDb().prepare('SELECT * FROM players WHERE game_code = ?').all(gameCode);
}

function getPlayerRole(gameCode, teamName, playerName) {
  const row = getDb().prepare(
    'SELECT role FROM players WHERE game_code = ? AND team_name = ? AND name = ?'
  ).get(gameCode, teamName, playerName);
  return row ? row.role : null;
}

// === FLEET OPERATIONS ===

function addFleet(gameCode, fromTeam, toTeam, fighters, arrivalTime) {
  getDb().prepare(`
    INSERT INTO fleets (game_code, from_team, to_team, fighters, arrival_time)
    VALUES (?, ?, ?, ?, ?)
  `).run(gameCode, fromTeam, toTeam, fighters, arrivalTime);
}

function removeFleetsByArrival(gameCode, arrivalTimeThreshold) {
  getDb().prepare(
    'DELETE FROM fleets WHERE game_code = ? AND arrival_time <= ?'
  ).run(gameCode, arrivalTimeThreshold);
}

function getFleetsForGame(gameCode) {
  return getDb().prepare('SELECT * FROM fleets WHERE game_code = ?').all(gameCode);
}

function clearFleetsForGame(gameCode) {
  getDb().prepare('DELETE FROM fleets WHERE game_code = ?').run(gameCode);
}

// === MAP PERSISTENCE (for saved games feature) ===

function saveGameMap(gameCode, mapSize, gasGiant, moons, anomalies = []) {
  getDb().prepare(`
    INSERT INTO game_maps (game_code, gas_giant_x, gas_giant_y, moons, anomalies)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(game_code) DO UPDATE SET
      gas_giant_x = excluded.gas_giant_x,
      gas_giant_y = excluded.gas_giant_y,
      moons = excluded.moons,
      anomalies = excluded.anomalies
  `).run(gameCode, gasGiant.x, gasGiant.y, JSON.stringify(moons || []), JSON.stringify(anomalies || []));

  // Also update map_size on the games table
  getDb().prepare(`UPDATE games SET map_size = ? WHERE code = ?`).run(mapSize, gameCode);
}

function saveTeamStarts(gameCode, starts) {
  const stmt = getDb().prepare(`
    INSERT INTO team_starts (game_code, team_name, start_x, start_y)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(game_code, team_name) DO UPDATE SET
      start_x = excluded.start_x,
      start_y = excluded.start_y
  `);

  for (const [teamName, pos] of Object.entries(starts || {})) {
    stmt.run(gameCode, teamName, pos.x, pos.y);
  }
}

function getGameMapData(gameCode) {
  const row = getDb().prepare('SELECT * FROM game_maps WHERE game_code = ?').get(gameCode);
  if (!row) return null;

  return {
    gasGiant: { x: row.gas_giant_x, y: row.gas_giant_y },
    moons: JSON.parse(row.moons || '[]'),
    anomalies: row.anomalies ? JSON.parse(row.anomalies) : []
  };
}

function getTeamStarts(gameCode) {
  const rows = getDb().prepare('SELECT * FROM team_starts WHERE game_code = ?').all(gameCode);
  const starts = {};
  for (const r of rows) {
    starts[r.team_name] = { x: r.start_x, y: r.start_y };
  }
  return starts;
}

function updateGameStatusAndMapSize(code, status, mapSize = null) {
  if (mapSize) {
    getDb().prepare(`UPDATE games SET status = ?, map_size = ?, last_saved = strftime('%s','now') WHERE code = ?`)
      .run(status, mapSize, code);
  } else {
    getDb().prepare(`UPDATE games SET status = ?, last_saved = strftime('%s','now') WHERE code = ?`)
      .run(status, code);
  }
}

module.exports = {
  initDb,
  getDb,
  saveGame,
  loadAllGames,
  deleteGame,
  upsertTeam,
  updateTeamResources,
  getTeamsForGame,
  addOrUpdatePlayer,
  getPlayersForGame,
  getPlayerRole,
  addFleet,
  removeFleetsByArrival,
  getFleetsForGame,
  clearFleetsForGame,
  // Map persistence
  saveGameMap,
  saveTeamStarts,
  getGameMapData,
  getTeamStarts,
  updateGameStatusAndMapSize
};
