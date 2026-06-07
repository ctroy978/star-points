// public/client/builder-status.js
// Compact infrastructure status for Builder: deployed mining rigs + factory production/synthesis
// Mining rate helpers live in public/client/mining-rates.js

function cellLabel(col, row) {
  return String.fromCharCode(65 + col) + (row + 1);
}

function getAnomalyAt(state, x, y) {
  const anomalies = state.map?.anomalies || [];
  if (typeof window.getPrimaryAnomalyAt === 'function') {
    return window.getPrimaryAnomalyAt(anomalies, x, y);
  }
  return anomalies.find(a => a.x === x && a.y === y) || null;
}

/** Resolve site for a rig — follow orbiting moons via targetObject, not stale grid coords. */
function resolveAnomalyForMiner(state, miner) {
  const anomalies = state.map?.anomalies || [];
  if (miner.targetObject) {
    const byRef = anomalies.find(a => a.id === miner.targetObject || a.name === miner.targetObject);
    if (byRef) return byRef;
  }
  if (miner.miningSite?.objectId) {
    const bySite = anomalies.find(a =>
      a.id === miner.miningSite.objectId || a.name === miner.miningSite.objectId
    );
    if (bySite) return bySite;
  }
  const x = miner.state === 'moving' ? (miner.targetX ?? miner.x) : miner.x;
  const y = miner.state === 'moving' ? (miner.targetY ?? miner.y) : miner.y;
  return getAnomalyAt(state, x, y);
}

function formatAnomalyTarget(anomaly) {
  if (!anomaly) return 'unknown site';
  const label = (window.ANOMALY_LABELS || {})[anomaly.type] || anomaly.type;
  const name = anomaly.name ? ` "${anomaly.name}"` : '';
  return label + name;
}

function formatSynthPerFactory() {
  return window.formatResourceRates(window.CLIENT_FACTORY_SYNTHESIS || {});
}

function miningSiteTitle(anomaly, cell) {
  if (anomaly) return `${formatAnomalyTarget(anomaly)} · ${cell}`;
  return cell;
}

function resolveMineLine(anomaly, teamName, rigsAtSite, noAnomLabel = 'off anomaly', state = null) {
  if (!anomaly) return `${noAnomLabel} (no yield)`;
  if (typeof window.isAnomalyDiscoveredByTeam === 'function' &&
      !window.isAnomalyDiscoveredByTeam(anomaly, teamName, state)) {
    return 'unknown — probe or deploy miner to reveal';
  }
  return window.formatMiningRatesForAnomaly(anomaly, rigsAtSite);
}

function factoryLocationLabel(factory) {
  if (factory.isHome) return 'Home Base';
  if (factory.moonName) return factory.moonName;
  return `Cell ${cellLabel(factory.x, factory.y)}`;
}

function findQueueIndexForFactory(queues, factory, fallbackIndex) {
  if (!queues || queues.length === 0) return fallbackIndex;
  let idx = queues.findIndex(q => q.factoryId === factory.id);
  if (idx >= 0) return idx;
  if (factory.isHome) {
    idx = queues.findIndex(q => q.factoryId === 'home');
    if (idx >= 0) return idx;
  }
  return fallbackIndex < queues.length ? fallbackIndex : 0;
}

function findQueueForFactory(queues, factory, index) {
  const queueIndex = findQueueIndexForFactory(queues, factory, index);
  return queues?.[queueIndex] || null;
}

function renderMiningSection(state, myTeamName) {
  const miners = (state.deployedMiners || []).filter(m => m.teamName === myTeamName);
  const active = miners.filter(m => m.state === 'mining').length;
  const settingUp = miners.filter(m => m.state === 'setting_up').length;
  const moving = miners.filter(m => m.state === 'moving').length;

  let html = `<div style="margin-bottom:6px;">`;
  html += `<div class="stat-row" style="font-size:11px; margin-bottom:3px;">`;
  html += `<span><strong style="color:#66ffaa;">⛏ MINING RIGS</strong></span>`;
  html += `<span style="font-size:10px; color:#006633;">${active} active · ${miners.length} deployed</span>`;
  html += `</div>`;

  if (miners.length === 0) {
    html += `<div style="color:#006633; font-size:10px; padding:2px 0;">No rigs deployed — use AVAILABLE MINERS below + map.</div>`;
    html += `</div>`;
    return html;
  }

  html += `<div style="border-left:2px solid #004422; padding-left:6px;">`;

  const sorted = [...miners].sort((a, b) => {
    const order = { mining: 0, setting_up: 1, moving: 2 };
    return (order[a.state] ?? 3) - (order[b.state] ?? 3);
  });

  for (const m of sorted) {
    let siteX, siteY, siteCell, anom, statusLine, mineLine;

    if (m.state === 'mining') {
      anom = resolveAnomalyForMiner(state, m);
      siteX = anom ? anom.x : m.x;
      siteY = anom ? anom.y : m.y;
      siteCell = cellLabel(siteX, siteY);
      const rigsHere = window.countActiveMinersAtSite(miners, siteX, siteY, myTeamName);
      mineLine = resolveMineLine(anom, myTeamName, rigsHere || 1, 'off anomaly', state);
      statusLine = `<span style="color:#66ffaa;">▶ mining</span>`;
    } else if (m.state === 'setting_up') {
      anom = resolveAnomalyForMiner(state, m);
      siteX = anom ? anom.x : m.x;
      siteY = anom ? anom.y : m.y;
      siteCell = cellLabel(siteX, siteY);
      const rigsHere = window.countActiveMinersAtSite(miners, siteX, siteY, myTeamName) + 1;
      mineLine = resolveMineLine(anom, myTeamName, rigsHere, 'off anomaly', state);
      const eta = m.setupRemaining != null ? `${m.setupRemaining}s` : '…';
      statusLine = `<span style="color:#ffcc66;">▶ setting up (${eta})</span>`;
    } else {
      siteX = m.targetX != null ? m.targetX : m.x;
      siteY = m.targetY != null ? m.targetY : m.y;
      siteCell = cellLabel(siteX, siteY);
      anom = getAnomalyAt(state, siteX, siteY);
      const rigsHere = window.countActiveMinersAtSite(miners, siteX, siteY, myTeamName) + 1;
      mineLine = resolveMineLine(anom, myTeamName, rigsHere, 'unknown site', state);
      statusLine = `<span style="color:#88ccff;">▶ en route to ${siteCell}</span>`;
    }

    const title = miningSiteTitle(anom, siteCell);

    html += `<div style="margin:3px 0 4px; font-size:10px;">`;
    html += `<strong style="color:#88ddaa;">${title}</strong>`;
    html += `<div style="color:#005533; font-size:9px; margin:1px 0 2px 0;">Mine/min: ${mineLine}</div>`;
    html += `<div>${statusLine}</div>`;
    html += `</div>`;
  }

  html += `</div></div>`;
  return html;
}

function renderFactorySection(state, myTeamName, myTeamData) {
  const allFactories = (state.factories || []).filter(f => f.teamName === myTeamName);
  const factories = allFactories.filter(f => f.state === 'operational');
  const enRoute = allFactories.filter(f => !f.isHome && f.state === 'moving').length;
  const settingUp = allFactories.filter(f => !f.isHome && f.state === 'setting_up').length;
  const factoryCount = factories.length || 1;
  const kits = myTeamData.availableFactories || 0;
  const myBuild = state.builds?.[myTeamName];
  const queues = myBuild?.queues || [];
  const synthLine = formatSynthPerFactory();

  let html = `<div>`;
  html += `<div class="stat-row" style="font-size:11px; margin-bottom:3px;">`;
  html += `<span><strong style="color:#66ccff;">🏭 FACTORIES</strong></span>`;
  let statusBits = `${factoryCount} operational`;
  if (enRoute > 0) statusBits += ` · ${enRoute} en route`;
  if (settingUp > 0) statusBits += ` · ${settingUp} setting up`;
  if (kits > 0) statusBits += ` · ${kits} kit${kits > 1 ? 's' : ''} ready`;
  html += `<span style="font-size:10px; color:#006633;">${statusBits}</span>`;
  html += `</div>`;

  html += `<div style="border-left:2px solid #003344; padding-left:6px;">`;

  const inProgress = allFactories.filter(f => !f.isHome && f.state !== 'operational');
  const factoryList = factories.length > 0 ? factories : [{ id: 'home', isHome: true, x: 0, y: 0, state: 'operational' }];

  inProgress.forEach((factory) => {
    const dest = factory.moonName || cellLabel(factory.targetX ?? factory.x, factory.targetY ?? factory.y);
    let statusLine = `<span style="color:#88ccff;">▶ en route to ${dest}</span>`;
    if (factory.state === 'setting_up') {
      const eta = factory.setupRemaining != null ? `${factory.setupRemaining}s` : '…';
      statusLine = `<span style="color:#ffcc66;">▶ setting up at ${dest} (${eta})</span>`;
    }
    html += `<div style="margin:3px 0 4px; font-size:10px;">`;
    html += `<strong style="color:#88bbdd;">Factory kit</strong>`;
    html += `<div>${statusLine}</div>`;
    html += `</div>`;
  });

  factoryList.forEach((factory, idx) => {
    const loc = factoryLocationLabel(factory);
    const queueIndex = findQueueIndexForFactory(queues, factory, idx);
    const q = queues[queueIndex] || null;

    html += `<div style="margin:3px 0 4px; font-size:10px;">`;
    html += `<strong style="color:#aaddff;">${loc}</strong>`;
    html += `<div style="color:#005533; font-size:9px; margin:1px 0 2px 0;">Synth/min: ${synthLine}</div>`;

    if (q && q.current) {
      html += `<div style="color:#ffcc88;">▶ ${q.current.type.toUpperCase()} — ${q.current.remaining}s</div>`;
    } else {
      html += `<div style="color:#006633;">▶ idle</div>`;
    }

    if (q && q.queue && q.queue.length > 0) {
      html += `<div style="color:#006633; font-size:9px;">Queued: `;
      q.queue.forEach((itemType, pos) => {
        html += `${itemType.toUpperCase()}`;
        html += ` <button class="btn btn-tiny" onclick="cancelQueuedBuild(${queueIndex}, ${pos})" style="padding:0 3px; font-size:7px; margin:0 1px;">×</button>`;
        if (pos < q.queue.length - 1) html += ', ';
      });
      html += `</div>`;
    }

    html += `</div>`;
  });

  html += `</div></div>`;
  return html;
}

/**
 * Render compact infrastructure status (mining rigs + factories) for the Builder tab.
 */
function renderBuilderInfrastructure(state, myTeamData) {
  const container = window.el('builder-infrastructure-status');
  if (!container) return;

  const myTeamName = state.myTeam;
  if (!myTeamName) {
    container.innerHTML = '<span style="color:#006633; font-size:10px;">Join a team to view infrastructure.</span>';
    return;
  }

  let html = '<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px 12px;">';
  html += renderMiningSection(state, myTeamName);
  html += renderFactorySection(state, myTeamName, myTeamData || {});
  html += '</div>';

  html += `<div style="margin-top:4px; font-size:8px; color:#004422; border-top:1px dotted #002211; padding-top:3px;">`;
  html += `Mining yields every 60s at anomaly sites. Factories synthesize minerals passively + run build queues.`;
  html += `</div>`;

  container.innerHTML = html;
}

window.renderBuilderInfrastructure = renderBuilderInfrastructure;