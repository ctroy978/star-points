// server/probes/intel.js — anomaly discovery for survey probes and miner survey

function revealAnomalyForTeam(game, teamName, anom) {
  if (!game || !teamName || !anom) return false;
  if (!anom.discoveredBy) anom.discoveredBy = {};
  if (anom.discoveredBy[teamName]) return false;

  anom.discoveredBy[teamName] = true;
  const team = game.getTeamByName(teamName);
  if (team) {
    if (!team.probeIntel) team.probeIntel = {};
    if (anom.id) team.probeIntel[anom.id] = true;
  }
  return true;
}

module.exports = {
  revealAnomalyForTeam
};