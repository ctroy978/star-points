// server/probes/survey.js — Builder survey: large-area resource/terrain intel

const { SURVEY_SCAN_RADIUS } = require('./constants');
const { revealAnomalyForTeam } = require('./intel');

function cellsInManhattanRadius(cx, cy, radius, size) {
  const cells = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      if (Math.abs(dx) + Math.abs(dy) > radius) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (x >= 0 && x < size && y >= 0 && y < size) cells.push({ x, y });
    }
  }
  return cells;
}

function performSurveyScan(game, probe) {
  const size = game.mapSize || 13;
  const tx = probe.x;
  const ty = probe.y;
  const snapshotCells = cellsInManhattanRadius(tx, ty, SURVEY_SCAN_RADIUS, size);

  let revealed = 0;
  for (const cell of snapshotCells) {
    for (const anom of game.map.anomalies || []) {
      if (anom.x === cell.x && anom.y === cell.y) {
        if (revealAnomalyForTeam(game, probe.teamName, anom)) revealed++;
      }
    }
  }

  const msg = revealed > 0
    ? `[${probe.teamName}] Survey complete at (${tx},${ty}) — ${revealed} site(s) revealed (resource intel, team only)`
    : `[${probe.teamName}] Survey complete at (${tx},${ty}) — nothing new in scan area`;
  game.addEvent(msg);
}

module.exports = {
  cellsInManhattanRadius,
  performSurveyScan
};