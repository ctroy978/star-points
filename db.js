const Database = require('better-sqlite3');
const path = require('path');

let db = null;

function initDb() {
  const dbPath = path.join(__dirname, 'starpoint.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL'); // better performance + crash safety

  // Schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      code TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'waiting', -- waiting | running | ended
      winner TEXT,
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

    CREATE INDEX IF NOT EXISTS idx_teams_game ON teams(game_code);
    CREATE INDEX IF NOT EXISTS idx_players_game ON players(game_code);
    CREATE INDEX IF NOT EXISTS idx_fleets_game ON fleets(game_code);
  `);

  console.log('[DB] Initialized starpoint.db');
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

    result.push({
      code: g.code,
      status: g.status,
      winner: g.winner,
      teams: teams.map(t => ({
        name: t.name,
        titanium: t.titanium,
        miners: t.miners,
        fighters: t.fighters,
        canons: t.canons,
        factoryHP: t.factory_hp
      })),
      players: players.map(p => ({
        name: p.name,
        teamName: p.team_name,
        role: p.role
      })),
      fleets: fleets.map(f => ({
        from: f.from_team,
        to: f.to_team,
        fighters: f.fighters,
        arrivalTime: f.arrival_time
      }))
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
    INSERT INTO teams (game_code, name, titanium, miners, fighters, canons, factory_hp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(game_code, name) DO UPDATE SET
      titanium = excluded.titanium,
      miners = excluded.miners,
      fighters = excluded.fighters,
      canons = excluded.canons,
      factory_hp = excluded.factory_hp
  `);
  stmt.run(
    gameCode,
    teamName,
    initialData.titanium ?? 100,
    initialData.miners ?? 0,
    initialData.fighters ?? 0,
    initialData.canons ?? 0,
    initialData.factoryHP ?? 100
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
  clearFleetsForGame
};
