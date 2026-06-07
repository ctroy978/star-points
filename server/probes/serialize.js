// server/probes/serialize.js — client payloads for probes

const { ROLE_LABELS } = require('./constants');

function serializeProbeForClient(probe, tickCounter) {
  const roleLabel = ROLE_LABELS[probe.launchedByRole] || probe.launchedByRole || 'Unknown';
  let scanRemaining = null;
  let pingRemaining = null;

  if (probe.state === 'scanning' && probe.scanCompleteTick != null) {
    scanRemaining = Math.max(0, probe.scanCompleteTick - tickCounter);
  }
  if (probe.state === 'pinging' && probe.pingEndTick != null) {
    pingRemaining = Math.max(0, probe.pingEndTick - tickCounter);
  }

  return {
    id: probe.id,
    teamName: probe.teamName,
    x: probe.x,
    y: probe.y,
    targetX: probe.targetX,
    targetY: probe.targetY,
    state: probe.state,
    mode: probe.mode,
    launchedByRole: probe.launchedByRole,
    launchedByRoleLabel: roleLabel,
    scanRemaining,
    pingRemaining
  };
}

function buildTeamProbeActivity(game, teamName) {
  if (!teamName || !game.deployedProbes) return [];

  return game.deployedProbes
    .filter(p => p.teamName === teamName)
    .map(p => {
      const serialized = serializeProbeForClient(p, game.tickCounter);
      return {
        probeId: p.id,
        launchedByRole: p.launchedByRole,
        launchedByRoleLabel: serialized.launchedByRoleLabel,
        mode: p.mode,
        state: p.state,
        x: p.x,
        y: p.y,
        targetX: p.targetX,
        targetY: p.targetY,
        remainingSec: serialized.pingRemaining ?? serialized.scanRemaining
      };
    });
}

module.exports = {
  serializeProbeForClient,
  buildTeamProbeActivity
};