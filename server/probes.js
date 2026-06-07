// server/probes.js
// Extracted mobile probe system logic.

// ~1 cell every 8 seconds (game ticks once per second)
const PROBE_MOVE_TICKS = 8;
// Dwell at destination while scanning before intel is returned
const PROBE_SCAN_TICKS = 30;
const PROBE_SNAPSHOT_SIZE = 5;

function performProbeSnapshot(game, probe) {
  const size = game.mapSize || 13;
  const tx = probe.x;
  const ty = probe.y;

  const snapshotCells = [
    { x: tx, y: ty },
    { x: tx, y: ty - 1 },
    { x: tx, y: ty + 1 },
    { x: tx - 1, y: ty },
    { x: tx + 1, y: ty }
  ].filter(c => c.x >= 0 && c.x < size && c.y >= 0 && c.y < size);

  const team = game.getTeamByName(probe.teamName);
  if (team && !team.probeIntel) team.probeIntel = {};

  let revealed = 0;
  for (const cell of snapshotCells) {
    for (const anom of game.map.anomalies) {
      if (anom.x === cell.x && anom.y === cell.y) {
        if (!anom.discoveredBy) anom.discoveredBy = {};
        if (!anom.discoveredBy[probe.teamName]) {
          anom.discoveredBy[probe.teamName] = true;
          if (team && anom.id) team.probeIntel[anom.id] = true;
          revealed++;
        }
      }
    }
  }

  const msg = revealed > 0
    ? `[${probe.teamName}] Probe scan complete at (${tx},${ty}) — revealed ${revealed} site(s) + mineable resources (team intel only)`
    : `[${probe.teamName}] Probe scan complete at (${tx},${ty}) — nothing new in scan area`;
  game.addEvent(msg);
}

/**
 * Mobile reconnaissance probes: travel to target, scan the area, reveal intel, then disappear.
 */
function processProbeMovement(game) {
  if (!game.deployedProbes || game.deployedProbes.length === 0) return;
  if (!game.map || !game.map.anomalies || !game.map.gasGiant) return;

  const size = game.mapSize || 13;
  const gasX = game.map.gasGiant.x;
  const gasY = game.map.gasGiant.y;

  const toKeep = [];

  for (const probe of game.deployedProbes) {
    // Scanning phase — dwell at destination before returning intel
    if (probe.state === 'scanning') {
      if (game.tickCounter < probe.scanCompleteTick) {
        toKeep.push(probe);
        continue;
      }
      performProbeSnapshot(game, probe);
      continue;
    }

    if (probe.state !== 'moving') {
      toKeep.push(probe);
      continue;
    }

    const shouldMove = (game.tickCounter % PROBE_MOVE_TICKS) === 0;
    if (!shouldMove) {
      toKeep.push(probe);
      continue;
    }

    const tx = probe.targetX;
    const ty = probe.targetY;

    if (probe.x === tx && probe.y === ty) {
      probe.state = 'scanning';
      probe.scanCompleteTick = game.tickCounter + PROBE_SCAN_TICKS;
      game.addEvent(`[${probe.teamName}] Probe arrived at (${tx},${ty}) — scanning area (${PROBE_SCAN_TICKS}s)...`);
      toKeep.push(probe);
      continue;
    }

    // Move one step toward target
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
      if (probe.x !== gasX) nx = probe.x;
      else ny = probe.y + (Math.random() > 0.5 ? 1 : -1);
    }

    nx = Math.max(0, Math.min(size - 1, nx));
    ny = Math.max(0, Math.min(size - 1, ny));

    probe.x = nx;
    probe.y = ny;

    toKeep.push(probe);
  }

  game.deployedProbes = toKeep;
}

module.exports = {
  processProbeMovement,
  PROBE_MOVE_TICKS,
  PROBE_SCAN_TICKS,
  PROBE_SNAPSHOT_SIZE
};