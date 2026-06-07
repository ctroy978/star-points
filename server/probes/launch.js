// server/probes/launch.js — create and launch probes from shared team stock

const {
  MAX_DEPLOYED_PROBES_PER_TEAM,
  ROLE_LABELS,
  modeForRole
} = require('./constants');

function countDeployedProbesForTeam(game, teamName) {
  return (game.deployedProbes || []).filter(p => p.teamName === teamName).length;
}

function launchProbe(game, teamName, role, x, y) {
  const mode = modeForRole(role);
  if (!mode) {
    return { ok: false, error: 'Your role cannot launch probes yet' };
  }

  const team = game.getTeamByName(teamName);
  if (!team) return { ok: false, error: 'Team not found' };
  if ((team.probes || 0) < 1) {
    return { ok: false, error: 'No probes available — Builder can queue more' };
  }
  if (!game.map?.starts || !game.map?.anomalies) {
    return { ok: false, error: 'No map' };
  }
  if (countDeployedProbesForTeam(game, teamName) >= MAX_DEPLOYED_PROBES_PER_TEAM) {
    return { ok: false, error: `Max ${MAX_DEPLOYED_PROBES_PER_TEAM} probes deployed at once` };
  }

  const size = game.mapSize || 13;
  const tx = Math.max(0, Math.min(size - 1, Math.floor(x)));
  const ty = Math.max(0, Math.min(size - 1, Math.floor(y)));
  const start = game.map.starts[teamName] || { x: 1, y: 1 };
  const roleLabel = ROLE_LABELS[role] || role;

  team.probes--;

  const probe = {
    id: 'probe-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
    teamName,
    launchedByRole: role,
    mode,
    x: start.x,
    y: start.y,
    targetX: tx,
    targetY: ty,
    state: 'moving',
    launchTime: Date.now()
  };

  if (!game.deployedProbes) game.deployedProbes = [];
  game.deployedProbes.push(probe);

  const modeVerb = mode === 'tactical' ? 'tactical probe' : 'survey probe';
  game.addEvent(`[${teamName}] ${roleLabel} launched ${modeVerb} toward (${tx},${ty})`);

  return { ok: true, probe, roleLabel, tx, ty, start };
}

module.exports = {
  launchProbe,
  countDeployedProbesForTeam
};