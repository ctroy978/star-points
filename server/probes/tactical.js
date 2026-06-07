// server/probes/tactical.js — War tactical ping zones

const { TACTICAL_PING_RADIUS } = require('./constants');
const { cellsInManhattanRadius } = require('./survey');

function getActiveTacticalPingCells(game, teamName) {
  const cells = new Set();
  if (!teamName || !game.deployedProbes) return cells;

  const size = game.mapSize || 13;
  for (const probe of game.deployedProbes) {
    if (probe.teamName !== teamName) continue;
    if (probe.mode !== 'tactical' || probe.state !== 'pinging') continue;
    for (const c of cellsInManhattanRadius(probe.x, probe.y, TACTICAL_PING_RADIUS, size)) {
      cells.add(`${c.x},${c.y}`);
    }
  }
  return cells;
}

function isCellInTacticalPing(game, teamName, x, y) {
  return getActiveTacticalPingCells(game, teamName).has(`${x},${y}`);
}

module.exports = {
  getActiveTacticalPingCells,
  isCellInTacticalPing
};