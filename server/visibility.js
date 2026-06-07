// server/visibility.js — unified fog-of-war for enemy asset broadcast

const { isCellInTacticalPing } = require('./probes/tactical');

const FLEET_VISION_RADIUS = 2;
const DRONE_VISION_RADIUS = 1;

function manhattan(x1, y1, x2, y2) {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

function hasFriendlyAssetOnCell(game, viewingTeam, x, y) {
  for (const m of game.deployedMiners || []) {
    if (m.teamName === viewingTeam && m.x === x && m.y === y) return true;
  }
  for (const f of game.factories || []) {
    if (f.teamName === viewingTeam && f.x === x && f.y === y) return true;
  }
  for (const fl of game.deployedFleets || []) {
    if (fl.teamName === viewingTeam && fl.x === x && fl.y === y) return true;
  }
  for (const w of game.deployedDroneWings || []) {
    if (w.teamName === viewingTeam && w.x === x && w.y === y) return true;
  }
  return false;
}

function manhattanToNearestFriendlyFleet(game, viewingTeam, x, y) {
  let best = Infinity;
  for (const fl of game.deployedFleets || []) {
    if (fl.teamName !== viewingTeam) continue;
    best = Math.min(best, manhattan(x, y, fl.x, fl.y));
  }
  return best;
}

function manhattanToNearestFriendlyDrone(game, viewingTeam, x, y) {
  let best = Infinity;
  for (const w of game.deployedDroneWings || []) {
    if (w.teamName !== viewingTeam) continue;
    best = Math.min(best, manhattan(x, y, w.x, w.y));
  }
  return best;
}

function isEnemyAssetVisibleToTeam(game, viewingTeam, assetTeam, x, y) {
  if (!viewingTeam) return true;
  if (assetTeam === viewingTeam) return true;

  if (isCellInTacticalPing(game, viewingTeam, x, y)) return true;
  if (hasFriendlyAssetOnCell(game, viewingTeam, x, y)) return true;
  if (manhattanToNearestFriendlyFleet(game, viewingTeam, x, y) <= FLEET_VISION_RADIUS) return true;
  if (manhattanToNearestFriendlyDrone(game, viewingTeam, x, y) <= DRONE_VISION_RADIUS) return true;

  return false;
}

function filterVisibleMiners(game, viewingTeam) {
  return (game.deployedMiners || []).filter(m =>
    isEnemyAssetVisibleToTeam(game, viewingTeam, m.teamName, m.x, m.y)
  );
}

function filterVisibleFactories(game, viewingTeam) {
  return (game.factories || []).filter(f =>
    isEnemyAssetVisibleToTeam(game, viewingTeam, f.teamName, f.x, f.y)
  );
}

function filterVisibleDeployedFleets(game, viewingTeam) {
  return (game.deployedFleets || []).filter(f =>
    isEnemyAssetVisibleToTeam(game, viewingTeam, f.teamName, f.x, f.y)
  );
}

function filterVisibleDeployedProbes(game, viewingTeam) {
  return (game.deployedProbes || []).filter(p =>
    isEnemyAssetVisibleToTeam(game, viewingTeam, p.teamName, p.x, p.y)
  );
}

function filterVisibleDroneWings(game, viewingTeam) {
  return (game.deployedDroneWings || []).filter(w =>
    isEnemyAssetVisibleToTeam(game, viewingTeam, w.teamName, w.x, w.y)
  );
}

const MOON_ANOMALY_TYPES = new Set([
  'large_moon', 'small_moon', 'major_moon', 'normal_moon'
]);

function isMoonAnomalyType(type) {
  return MOON_ANOMALY_TYPES.has(type);
}

/** Team-shared probe/miner intel: which static anomalies this team may see on the map. */
function isAnomalyVisibleToTeam(game, teamName, anom) {
  if (!anom) return false;
  if (!teamName) return true;
  if (isMoonAnomalyType(anom.type)) return true;

  if (anom.discoveredBy?.[teamName]) return true;

  const team = game.getTeamByName?.(teamName);
  if (anom.id && team?.probeIntel?.[anom.id]) return true;

  for (const m of game.deployedMiners || []) {
    if (m.teamName === teamName && (m.state === 'mining' || m.state === 'setting_up') &&
        m.x === anom.x && m.y === anom.y) {
      return true;
    }
  }

  return false;
}

function filterAnomaliesForTeam(game, teamName) {
  const all = game.map?.anomalies || [];
  if (!teamName) return all;
  return all.filter(a => isAnomalyVisibleToTeam(game, teamName, a));
}

function getRevealedAnomalyIdsForTeam(game, teamName) {
  if (!teamName || !game.map?.anomalies) return [];
  const team = game.getTeamByName?.(teamName);
  const ids = new Set();
  for (const a of game.map.anomalies) {
    if (!a.id) continue;
    if (a.discoveredBy?.[teamName] || team?.probeIntel?.[a.id]) {
      ids.add(a.id);
    }
  }
  return [...ids];
}

function buildMapPayloadForTeam(game, teamName) {
  if (!game.map) return null;
  return {
    gasGiant: game.map.gasGiant,
    anomalies: filterAnomaliesForTeam(game, teamName)
  };
}

/** Legacy helper — cells where own assets grant exact-cell awareness */
function getVisionCells(game, teamName) {
  const cells = new Set();
  const size = game.mapSize || 13;

  const addCell = (x, y) => {
    if (x >= 0 && x < size && y >= 0 && y < size) cells.add(`${x},${y}`);
  };

  const markRadius = (cx, cy, radius) => {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.abs(dx) + Math.abs(dy) <= radius) addCell(cx + dx, cy + dy);
      }
    }
  };

  for (const f of game.deployedFleets || []) {
    if (f.teamName === teamName) markRadius(f.x, f.y, FLEET_VISION_RADIUS);
  }
  for (const m of game.deployedMiners || []) {
    if (m.teamName === teamName) addCell(m.x, m.y);
  }
  for (const fac of game.factories || []) {
    if (fac.teamName === teamName) addCell(fac.x, fac.y);
  }
  for (const f of game.deployedFleets || []) {
    if (f.teamName === teamName) addCell(f.x, f.y);
  }
  for (const w of game.deployedDroneWings || []) {
    if (w.teamName === teamName) markRadius(w.x, w.y, DRONE_VISION_RADIUS);
  }

  return cells;
}

module.exports = {
  FLEET_VISION_RADIUS,
  DRONE_VISION_RADIUS,
  isMoonAnomalyType,
  isAnomalyVisibleToTeam,
  filterAnomaliesForTeam,
  getRevealedAnomalyIdsForTeam,
  buildMapPayloadForTeam,
  isEnemyAssetVisibleToTeam,
  filterVisibleMiners,
  filterVisibleFactories,
  filterVisibleDeployedFleets,
  filterVisibleDeployedProbes,
  filterVisibleDroneWings,
  getVisionCells
};