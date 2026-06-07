// server/probes/movement.js — travel toward target, avoid gas giant

const { PROBE_MOVE_TICKS } = require('./constants');

function stepProbeTowardTarget(probe, game) {
  const size = game.mapSize || 13;
  const gas = game.map?.gasGiant;
  const gasX = gas?.x ?? Math.floor(size / 2);
  const gasY = gas?.y ?? Math.floor(size / 2);

  const tx = probe.targetX;
  const ty = probe.targetY;

  if (probe.x === tx && probe.y === ty) {
    return { arrived: true, nx: probe.x, ny: probe.y };
  }

  let nx = probe.x;
  let ny = probe.y;
  const dx = tx - probe.x;
  const dy = ty - probe.y;

  if (Math.abs(dx) > Math.abs(dy)) {
    nx = probe.x + Math.sign(dx);
  } else if (dy !== 0) {
    ny = probe.y + Math.sign(dy);
  }

  if (nx === gasX && ny === gasY) {
    if (probe.x !== gasX) nx = probe.x;
    else ny = probe.y + (Math.random() > 0.5 ? 1 : -1);
  }

  nx = Math.max(0, Math.min(size - 1, nx));
  ny = Math.max(0, Math.min(size - 1, ny));
  probe.x = nx;
  probe.y = ny;

  return { arrived: false, nx, ny };
}

function shouldMoveProbeThisTick(tickCounter) {
  return (tickCounter % PROBE_MOVE_TICKS) === 0;
}

module.exports = {
  stepProbeTowardTarget,
  shouldMoveProbeThisTick,
  PROBE_MOVE_TICKS
};