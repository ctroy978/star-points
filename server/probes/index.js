// server/probes/index.js — probe orchestration

const {
  SURVEY_SCAN_TICKS,
  TACTICAL_PING_DURATION_TICKS,
  ROLE_LABELS
} = require('./constants');
const { stepProbeTowardTarget, shouldMoveProbeThisTick } = require('./movement');
const { performSurveyScan } = require('./survey');
const { revealAnomalyForTeam } = require('./intel');
const { launchProbe } = require('./launch');
const {
  serializeProbeForClient,
  buildTeamProbeActivity
} = require('./serialize');

function processProbeMovement(game) {
  if (!game.deployedProbes?.length || !game.map?.gasGiant) return;

  const toKeep = [];

  for (const probe of game.deployedProbes) {
    if (probe.state === 'scanning') {
      if (game.tickCounter < probe.scanCompleteTick) {
        toKeep.push(probe);
        continue;
      }
      performSurveyScan(game, probe);
      continue;
    }

    if (probe.state === 'pinging') {
      if (game.tickCounter < probe.pingEndTick) {
        toKeep.push(probe);
        continue;
      }
      const roleLabel = ROLE_LABELS[probe.launchedByRole] || 'War Commander';
      game.addEvent(`[${probe.teamName}] ${roleLabel} tactical probe at (${probe.x},${probe.y}) ended`);
      continue;
    }

    if (probe.state !== 'moving') {
      toKeep.push(probe);
      continue;
    }

    if (!shouldMoveProbeThisTick(game.tickCounter)) {
      toKeep.push(probe);
      continue;
    }

    const { arrived } = stepProbeTowardTarget(probe, game);

    if (arrived) {
      const roleLabel = ROLE_LABELS[probe.launchedByRole] || probe.launchedByRole;
      if (probe.mode === 'survey') {
        probe.state = 'scanning';
        probe.scanCompleteTick = game.tickCounter + SURVEY_SCAN_TICKS;
        game.addEvent(
          `[${probe.teamName}] ${roleLabel} survey probe at (${probe.x},${probe.y}) — scanning resources (${SURVEY_SCAN_TICKS}s)...`
        );
      } else if (probe.mode === 'tactical') {
        probe.state = 'pinging';
        probe.pingEndTick = game.tickCounter + TACTICAL_PING_DURATION_TICKS;
        game.addEvent(
          `[${probe.teamName}] ${roleLabel} tactical probe active at (${probe.x},${probe.y}) — pinging ${TACTICAL_PING_DURATION_TICKS}s (enemy ships in zone visible)`
        );
      }
      toKeep.push(probe);
      continue;
    }

    toKeep.push(probe);
  }

  game.deployedProbes = toKeep;
}

module.exports = {
  processProbeMovement,
  launchProbe,
  revealAnomalyForTeam,
  serializeProbeForClient,
  buildTeamProbeActivity,
  PROBE_MOVE_TICKS: require('./constants').PROBE_MOVE_TICKS,
  SURVEY_SCAN_TICKS: require('./constants').SURVEY_SCAN_TICKS,
  TACTICAL_PING_DURATION_TICKS: require('./constants').TACTICAL_PING_DURATION_TICKS
};