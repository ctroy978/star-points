// public/client/mining-rates.js
// Client mirror of server mining yield distribution (for UI display after probe discovery)

window.RESOURCE_ORDER = [
  'Fused Xenon',
  'Helium-3 Lattice',
  'Quantite',
  'Plasma-Bound Carbon',
  'Antimatter Catalyst',
  'Neurocryst'
];

window.MINING_YIELD_BASE = {
  large_moon: 6,
  small_moon: 3,
  major_moon: 5,
  normal_moon: 3,
  gas_cloud: 2,
  asteroid_cluster: 1
};

window.STACKING_MULTIPLIERS = [1.0, 0.75, 0.55];

window.RESOURCE_SHORT = {
  'Fused Xenon': 'FX',
  'Helium-3 Lattice': 'He3',
  'Quantite': 'Quant',
  'Plasma-Bound Carbon': 'PBC',
  'Antimatter Catalyst': 'AC',
  'Neurocryst': 'Neuro'
};

window.ANOMALY_LABELS = {
  large_moon: 'Large Moon',
  small_moon: 'Small Moon',
  major_moon: 'Major Moon',
  normal_moon: 'Moon',
  gas_cloud: 'Gas Cloud',
  asteroid_cluster: 'Asteroid Cluster'
};

window.ANOMALY_TERRAIN_PRIORITY = {
  large_moon: 100,
  major_moon: 90,
  small_moon: 80,
  normal_moon: 70,
  gas_cloud: 40,
  asteroid_cluster: 10
};

window.isMoonAnomalyType = function(type) {
  return type === 'large_moon' || type === 'small_moon' ||
    type === 'major_moon' || type === 'normal_moon';
};

/** When multiple anomalies share a cell (e.g. orbiting moon over static asteroid), pick display/mining terrain. */
window.getPrimaryAnomalyAt = function(anomalies, x, y) {
  const atCell = (anomalies || []).filter(a => a.x === x && a.y === y);
  if (atCell.length === 0) return null;
  if (atCell.length === 1) return atCell[0];
  const pri = window.ANOMALY_TERRAIN_PRIORITY;
  let best = atCell[0];
  let bestScore = pri[best.type] || 0;
  for (let i = 1; i < atCell.length; i++) {
    const score = pri[atCell[i].type] || 0;
    if (score > bestScore) {
      best = atCell[i];
      bestScore = score;
    }
  }
  return best;
};

/** True when this team has probed or surveyed the site and unlocked resource intel. */
window.isAnomalyDiscoveredByTeam = function(anomaly, teamName, stateOrRevealedIds) {
  if (!anomaly || !teamName) return false;
  const db = anomaly.discoveredBy || {};
  if (db[teamName]) return true;
  const revealed = Array.isArray(stateOrRevealedIds)
    ? stateOrRevealedIds
    : (stateOrRevealedIds?.revealedAnomalyIds || []);
  return !!(anomaly.id && revealed.includes(anomaly.id));
};

/** Whether this anomaly should appear on the map for the viewing player (team-shared intel). */
window.isAnomalyVisibleForTeam = function(anomaly, state) {
  if (!anomaly) return false;
  if (window.isMoonAnomalyType(anomaly.type)) return true;

  const team = state?.myTeam;
  if (!team) return true;

  if (window.isAnomalyDiscoveredByTeam(anomaly, team)) return true;

  const revealed = state.revealedAnomalyIds || [];
  if (anomaly.id && revealed.includes(anomaly.id)) return true;

  const miners = state.deployedMiners || [];
  for (const m of miners) {
    if (m.teamName === team && (m.state === 'mining' || m.state === 'setting_up') &&
        m.x === anomaly.x && m.y === anomaly.y) {
      return true;
    }
  }

  return false;
};

window.getVisibleAnomaliesForTeam = function(state) {
  const raw = state?.map?.anomalies || [];
  return raw.filter(a => window.isAnomalyVisibleForTeam(a, state));
};

/** Mirror server addMiningYieldToTeam distribution for a single rig payout. */
window.computeMiningRates = function(anomalyType, totalMiningRigsAtSite = 1) {
  const base = window.MINING_YIELD_BASE[anomalyType] || 1;
  const stackIdx = Math.min(
    window.STACKING_MULTIPLIERS.length - 1,
    Math.max(0, totalMiningRigsAtSite - 1)
  );
  const amount = Math.floor(base * window.STACKING_MULTIPLIERS[stackIdx]);
  if (amount <= 0) return {};

  let primaryIdxs = [0, 1];
  if (anomalyType === 'small_moon' || anomalyType === 'normal_moon') primaryIdxs = [1, 2];
  else if (anomalyType === 'gas_cloud') primaryIdxs = [2, 3];
  else if (anomalyType === 'asteroid_cluster') primaryIdxs = [4, 5];

  const primaryShare = Math.floor(amount * 0.7 / 2);
  const secondaryShare = Math.floor(amount * 0.3 / 4);
  const rates = {};

  for (let i = 0; i < 6; i++) {
    let add = secondaryShare;
    if (primaryIdxs.includes(i)) add += primaryShare;
    if (add > 0) rates[window.RESOURCE_ORDER[i]] = add;
  }
  return rates;
};

window.formatResourceRates = function(rates) {
  return Object.entries(rates)
    .filter(([, amt]) => amt > 0)
    .map(([name, amt]) => `+${amt} ${window.RESOURCE_SHORT[name] || name}`)
    .join(', ');
};

window.ANOMALY_RESOURCE_BIAS = {
  large_moon: 'FX, He3',
  small_moon: 'He3, Quant',
  major_moon: 'FX, He3',
  normal_moon: 'He3, Quant',
  gas_cloud: 'Quant, PBC (trace)',
  asteroid_cluster: 'AC, Neuro (trace)'
};

window.formatMiningRatesForAnomaly = function(anomaly, rigsAtSite = 1) {
  if (!anomaly) return 'no yield';
  const rates = window.computeMiningRates(anomaly.type, rigsAtSite);
  const formatted = window.formatResourceRates(rates);
  if (formatted) return formatted;

  const base = window.MINING_YIELD_BASE[anomaly.type] || 0;
  const bias = window.ANOMALY_RESOURCE_BIAS[anomaly.type];
  if (base > 0 && bias) return `~${bias}`;
  return 'no yield';
};

window.countActiveMinersAtSite = function(miners, x, y, teamName) {
  return (miners || []).filter(m =>
    m.teamName === teamName && m.state === 'mining' && m.x === x && m.y === y
  ).length;
};

/** Resolve this player's team starting cell (server myStart or home factory fallback). */
window.resolveMyStart = function(state) {
  if (!state) return null;
  if (state.myStart && state.myStart.x != null && state.myStart.y != null) {
    return { x: Number(state.myStart.x), y: Number(state.myStart.y) };
  }
  if (state.myTeam && Array.isArray(state.factories)) {
    const home = state.factories.find(f => f.teamName === state.myTeam && f.isHome);
    if (home) return { x: Number(home.x), y: Number(home.y) };
  }
  return null;
};