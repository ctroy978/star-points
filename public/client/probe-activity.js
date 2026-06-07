// public/client/probe-activity.js — shared team probe stock + active probe status for all roles

function formatProbeCell(x, y) {
  if (x == null || y == null) return '?';
  return String.fromCharCode(65 + x) + (y + 1);
}

function renderTeamProbeActivity(state, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;

  const myTeam = state?.myTeam;
  const teams = state?.teams || [];
  const myTeamData = myTeam ? teams.find(t => t.name === myTeam) : null;
  const stock = myTeamData?.probes ?? 0;
  const activity = state?.teamProbeActivity || [];

  let html = `<div style="font-size:10px; color:#88aa99; margin-bottom:4px;">`;
  html += `Team probes in stock: <strong style="color:#66ccff;">${stock}</strong>`;
  html += `</div>`;

  if (activity.length === 0) {
    html += `<div style="font-size:9px; color:#335544;">No probes in flight.</div>`;
  } else {
    html += `<div style="font-size:9px; color:#558866; margin-bottom:2px;">Active probes:</div>`;
    activity.forEach(a => {
      const modeLabel = a.mode === 'tactical' ? 'Tactical ping' : 'Survey scan';
      const cell = formatProbeCell(a.x, a.y);
      const dest = (a.state === 'moving') ? ` → ${formatProbeCell(a.targetX, a.targetY)}` : '';
      let phase = 'moving';
      if (a.state === 'scanning') phase = `scanning (${a.remainingSec ?? '?'}s)`;
      else if (a.state === 'pinging') phase = `pinging (${a.remainingSec ?? '?'}s)`;
      html += `<div style="font-size:9px; margin:2px 0; padding:2px 4px; background:#001a11; border-left:2px solid #336655;">`;
      html += `<strong>${a.launchedByRoleLabel || a.launchedByRole}</strong> — ${modeLabel} at ${cell}${dest}`;
      html += `<br><span style="color:#669988;">${phase}</span>`;
      html += `</div>`;
    });
  }

  el.innerHTML = html;
}

function renderAllTeamProbeActivity(state) {
  renderTeamProbeActivity(state, 'team-probe-activity-war');
  renderTeamProbeActivity(state, 'team-probe-activity-builder');
  renderTeamProbeActivity(state, 'team-probe-activity-negotiator');
}

window.renderAllTeamProbeActivity = renderAllTeamProbeActivity;