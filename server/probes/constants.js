// server/probes/constants.js

const PROBE_MOVE_TICKS = 8;
const SURVEY_SCAN_TICKS = 30;
const SURVEY_SCAN_RADIUS = 2;
const TACTICAL_PING_RADIUS = 1;
const TACTICAL_PING_DURATION_TICKS = 45;
const MAX_DEPLOYED_PROBES_PER_TEAM = 2;

const ROLE_LABELS = {
  war: 'War Commander',
  negotiator: 'Negotiator',
  builder: 'Builder'
};

function modeForRole(role) {
  if (role === 'war') return 'tactical';
  if (role === 'builder') return 'survey';
  return null;
}

module.exports = {
  PROBE_MOVE_TICKS,
  SURVEY_SCAN_TICKS,
  SURVEY_SCAN_RADIUS,
  TACTICAL_PING_RADIUS,
  TACTICAL_PING_DURATION_TICKS,
  MAX_DEPLOYED_PROBES_PER_TEAM,
  ROLE_LABELS,
  modeForRole
};