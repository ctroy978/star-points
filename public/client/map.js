// public/client/map.js
// Map grid rendering, cell popups, and map-specific interactions.
// Depends on: window.el, mining-rates.js, command-system.js (loaded before this file).

let popupHoverTimer = null;
const POPUP_HOVER_DELAY_MS = 420;

function renderMap(state) {
  const container = window.el('map-container');
  if (!container) {
    console.warn('Map container not found');
    return;
  }

  try {
    const size = state.mapSize || 13;
    const mapData = state.map || {};
    const myStart = (typeof window.resolveMyStart === 'function')
      ? window.resolveMyStart(state)
      : (state.myStart || null);

    const sizeDisplay = window.el('map-size-display');
    if (sizeDisplay) sizeDisplay.textContent = `${size}×${size}`;

    container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `display: grid; grid-template-columns: 22px repeat(${size}, 1fr); grid-template-rows: 18px repeat(${size}, 1fr); gap: 1px;`;

    const corner = document.createElement('div');
    corner.style.cssText = 'font-size:9px; color:#003322;';
    wrapper.appendChild(corner);

    for (let col = 0; col < size; col++) {
      const label = document.createElement('div');
      label.textContent = String.fromCharCode(65 + col);
      label.style.cssText = 'text-align:center; font-size:9px; color:#006633; line-height:1;';
      wrapper.appendChild(label);
    }

    const gasGiant = mapData.gasGiant || { x: Math.floor(size / 2), y: Math.floor(size / 2) };
    const myTeamForDisc = state.myTeam;
    const rawAnomalies = mapData.anomalies || [];
    const anomalies = rawAnomalies.filter(a => {
      if (a.type === 'large_moon' || a.type === 'small_moon' || a.type === 'major_moon' || a.type === 'normal_moon') return true;
      const db = a.discoveredBy || {};
      return !!(myTeamForDisc && db[myTeamForDisc]);
    });

    const myMiners = (state.deployedMiners || []).filter(m => m.teamName === state.myTeam);
    const minerCounts = {};
    myMiners.forEach(m => {
      const k = `${m.x},${m.y}`;
      minerCounts[k] = (minerCounts[k] || 0) + 1;
    });

    const myProbes = (state.deployedProbes || []).filter(p => p.teamName === state.myTeam);
    const probeAt = {};
    myProbes.forEach(p => {
      probeAt[`${p.x},${p.y}`] = p;
    });

    const anomalyAt = {};
    anomalies.forEach(a => { anomalyAt[`${a.x},${a.y}`] = a; });

    for (let row = 0; row < size; row++) {
      const rowLabel = document.createElement('div');
      rowLabel.textContent = (row + 1).toString();
      rowLabel.style.cssText = 'text-align:right; padding-right:3px; font-size:9px; color:#006633; line-height:1;';
      wrapper.appendChild(rowLabel);

      for (let col = 0; col < size; col++) {
        const cell = document.createElement('div');
        cell.className = 'map-cell';
        cell.style.cssText = 'width:100%; aspect-ratio:1; border:1px solid #003322; display:flex; align-items:center; justify-content:center; font-size:14px;';
        cell.dataset.col = col;
        cell.dataset.row = row;

        const isGasGiant = (col === gasGiant.x && row === gasGiant.y);
        const isMyStart = myStart && col === Number(myStart.x) && row === Number(myStart.y);

        if (isGasGiant) {
          cell.classList.add('gas-giant');
          cell.textContent = '◎';
          cell.style.color = 'var(--amber)';
          cell.style.fontSize = '18px';
          cell.style.textShadow = '0 0 4px #ffcc33';
        }

        const cellKeyForAnom = `${col},${row}`;
        const anom = anomalyAt[cellKeyForAnom];
        if (anom && !isGasGiant) {
          if (anom.type === 'large_moon' || anom.type === 'major_moon') {
            cell.textContent = '◉';
            cell.style.color = '#00ff9f';
            cell.style.fontSize = '15px';
            cell.style.background = '#0a2200';
            const moveNote = anom.orbitRadius ? ' (orbiting)' : '';
            let tip = (anom.name || 'Large Moon') + moveNote;
            if (myTeamForDisc && typeof window.isAnomalyDiscoveredByTeam === 'function' && window.isAnomalyDiscoveredByTeam(anom, myTeamForDisc)) {
              tip += ' — Mine/min: ' + window.formatMiningRatesForAnomaly(anom, 1);
            } else {
              tip += ' — probe to reveal resources';
            }
            cell.title = tip;
          } else if (anom.type === 'small_moon' || anom.type === 'normal_moon') {
            cell.textContent = '○';
            cell.style.color = '#66eeaa';
            cell.style.fontSize = '11px';
            cell.style.background = '#061a0a';
            const moveNote = anom.orbitRadius ? ' (orbiting)' : '';
            let tip = (anom.name || 'Small Moon') + moveNote;
            if (myTeamForDisc && typeof window.isAnomalyDiscoveredByTeam === 'function' && window.isAnomalyDiscoveredByTeam(anom, myTeamForDisc)) {
              tip += ' — Mine/min: ' + window.formatMiningRatesForAnomaly(anom, 1);
            } else {
              tip += ' — probe to reveal resources';
            }
            cell.title = tip;
          } else if (anom.type === 'gas_cloud') {
            cell.textContent = '☁';
            cell.style.color = '#66ccff';
            cell.style.fontSize = '13px';
            cell.style.background = '#001122';
            let tip = (anom.name || 'Gas Cloud');
            if (myTeamForDisc && typeof window.isAnomalyDiscoveredByTeam === 'function' && window.isAnomalyDiscoveredByTeam(anom, myTeamForDisc)) {
              tip += ' — Mine/min: ' + window.formatMiningRatesForAnomaly(anom, 1);
            } else {
              tip += ' (probe to reveal resources)';
            }
            cell.title = tip;
          } else if (anom.type === 'asteroid_cluster') {
            cell.textContent = '◆';
            cell.style.color = '#ffaa66';
            cell.style.fontSize = '12px';
            cell.style.background = '#221100';
            let tip = (anom.name || 'Asteroid Cluster');
            if (myTeamForDisc && typeof window.isAnomalyDiscoveredByTeam === 'function' && window.isAnomalyDiscoveredByTeam(anom, myTeamForDisc)) {
              tip += ' — Mine/min: ' + window.formatMiningRatesForAnomaly(anom, 1);
            } else {
              tip += ' (probe to reveal resources)';
            }
            cell.title = tip;
          }
        }

        const cellKey = `${col},${row}`;
        if (minerCounts[cellKey]) {
          const cnt = minerCounts[cellKey];
          const minersHere = myMiners.filter(m => m.x === col && m.y === row);
          const hasMining = minersHere.some(m => m.state === 'mining');
          const hasSetup = minersHere.some(m => m.state === 'setting_up');
          cell.textContent = cnt > 1 ? `M${cnt}` : (hasMining ? 'M★' : 'M');
          cell.style.color = hasMining ? '#66ffaa' : (hasSetup ? '#ffcc33' : '#aaffcc');
          cell.style.fontSize = cnt > 1 ? '10px' : '12px';
          cell.style.background = hasMining ? '#003322' : '#002211';
          const states = minersHere.map(m => m.state).join(',');
          cell.title = cnt + ' miner(s) here — ' + states;
        }

        const probeKey = `${col},${row}`;
        if (probeAt[probeKey]) {
          const p = probeAt[probeKey];
          if (p.state === 'scanning') {
            cell.textContent = '◎';
            cell.style.color = '#ffdd66';
            cell.style.fontSize = '13px';
            cell.style.background = '#221a00';
            cell.style.textShadow = '0 0 4px #ffcc33';
            const remain = p.scanRemaining != null ? `${p.scanRemaining}s` : '…';
            cell.title = `Probe scanning area — results in ${remain}`;
          } else {
            cell.textContent = '✧';
            cell.style.color = '#66ccff';
            cell.style.fontSize = '13px';
            cell.style.background = '#001133';
            cell.style.textShadow = '0 0 3px #66ccff';
            cell.title = 'Probe en route (1 cell ~8s)';
          }
        }

        if (isMyStart && !isGasGiant) {
          cell.classList.add('team-start-cell');
          const hasSymbol = cell.textContent && cell.textContent.trim().length > 0;
          if (!hasSymbol) {
            const center = document.createElement('span');
            center.textContent = '★';
            center.style.color = '#ffcc33';
            center.style.fontSize = '14px';
            cell.appendChild(center);
          }
          const badge = document.createElement('span');
          badge.className = 'start-badge';
          badge.textContent = '★';
          cell.appendChild(badge);
          const startNote = '★ Your team starting position';
          cell.title = cell.title ? `${startNote} | ${cell.title}` : startNote;
        }

        const inCommandMode = (typeof window.isInCommandMode === 'function') && window.isInCommandMode();
        if (inCommandMode && !isGasGiant) {
          cell.style.cursor = 'crosshair';
          cell.style.pointerEvents = 'auto';
          cell.onclick = (e) => {
            e.stopPropagation();
            if (typeof window.isInCommandMode === 'function' && window.isInCommandMode() &&
                typeof window.handleMapCellCommandClick === 'function') {
              window.handleMapCellCommandClick(col, row);
            }
          };
        } else {
          cell.style.pointerEvents = 'auto';
        }

        wrapper.appendChild(cell);
      }
    }

    container.appendChild(wrapper);

    const popup = window.el('cell-popup') || document.createElement('div');
    popup.id = 'cell-popup';
    if (!window.el('cell-popup')) document.body.appendChild(popup);

    if (popupHoverTimer) {
      clearTimeout(popupHoverTimer);
      popupHoverTimer = null;
    }

    const cells = wrapper.querySelectorAll('.map-cell');
    cells.forEach(cell => {
      const col = parseInt(cell.dataset.col, 10);
      const row = parseInt(cell.dataset.row, 10);
      if (Number.isNaN(col) || Number.isNaN(row)) return;

      cell.addEventListener('mouseenter', (e) => {
        if (popupHoverTimer) clearTimeout(popupHoverTimer);

        popupHoverTimer = setTimeout(() => {
          const infoHtml = buildCellInfo(state, col, row);
          if (!infoHtml) return;

          popup.innerHTML = infoHtml;
          popup.style.display = 'block';
          popup.style.left = (e.pageX + 14) + 'px';
          popup.style.top = (e.pageY + 10) + 'px';

          const hasActions = popup.querySelector('.popup-actions');
          popup.style.pointerEvents = hasActions ? 'auto' : 'none';
        }, POPUP_HOVER_DELAY_MS);
      });

      cell.addEventListener('mouseleave', () => {
        if (popupHoverTimer) {
          clearTimeout(popupHoverTimer);
          popupHoverTimer = null;
        }
        popup.style.display = 'none';
        popup.style.pointerEvents = 'none';
      });
    });
  } catch (e) {
    console.error('renderMap error:', e);
    container.innerHTML = '<div style="color:#ff6666; padding:10px; border:1px solid #440000;">Map failed to render — check browser console (F12) for details.</div>';
  }
}

function buildCellInfo(state, col, row) {
  if (!state || !state.map) return null;

  const mapData = state.map;
  const rawAnomalies = mapData.anomalies || [];
  const myTeam = state.myTeam;
  const myRole = state.myRole;

  const visibleAnomalies = rawAnomalies.filter(a => {
    if (a.type === 'large_moon' || a.type === 'small_moon') return true;
    const db = a.discoveredBy || {};
    return !!(myTeam && db[myTeam]);
  });

  const anomHere = visibleAnomalies.find(a => a.x === col && a.y === row);
  const myMinersHere = (state.deployedMiners || []).filter(m =>
    m.teamName === myTeam && m.x === col && m.y === row
  );

  let html = `<div><strong>Cell ${String.fromCharCode(65 + col)}${row + 1}</strong></div>`;

  if (anomHere) {
    const name = anomHere.name || `${anomHere.type} at ${col},${row}`;
    let extra = '';
    if (anomHere.orbitRadius) {
      extra = ` <span style="color:#ffcc33;">(orbiting ~${Math.round(anomHere.baseIntervalMin || 8)}min/cell)</span>`;
    }
    const typeLabel = anomHere.type === 'large_moon' ? 'Large Moon' :
                      anomHere.type === 'small_moon' ? 'Small Moon' :
                      anomHere.type.replace('_', ' ');
    html += `<div class="section"><span class="object-name">${name}</span>${extra}<br><span style="color:#88aa99;">${typeLabel}</span>`;

    if (myTeam && typeof window.isAnomalyDiscoveredByTeam === 'function' && window.isAnomalyDiscoveredByTeam(anomHere, myTeam)) {
      const rigsHere = typeof window.countActiveMinersAtSite === 'function'
        ? window.countActiveMinersAtSite(state.deployedMiners, col, row, myTeam)
        : 0;
      const mineLine = typeof window.formatMiningRatesForAnomaly === 'function'
        ? window.formatMiningRatesForAnomaly(anomHere, Math.max(1, rigsHere))
        : '';
      html += `<br><span style="color:#66ccaa; font-size:9px;">Mine/min (1 rig): <strong>${mineLine}</strong></span>`;
      if (rigsHere > 1) {
        const stacked = window.formatMiningRatesForAnomaly(anomHere, rigsHere);
        html += `<br><span style="color:#448866; font-size:8px;">Current stack (${rigsHere} rigs): ${stacked}</span>`;
      }
    } else if (myTeam) {
      html += `<br><span style="color:#335544; font-size:9px;">⛯ Resources unknown — probe this site to reveal yields</span>`;
    }

    html += `</div>`;
  }

  if (myMinersHere.length > 0) {
    html += `<div class="section"><strong>Your Miners here:</strong>`;
    myMinersHere.forEach(m => {
      const stateLabel = m.state === 'mining' ? '⛏ mining' : (m.state === 'setting_up' ? '⏳ setting up' : '→ moving');
      html += `<div style="margin:2px 0;">${stateLabel} <span style="color:#669977;">(id ${m.id.slice(-6)})</span></div>`;
    });
    html += `</div>`;

    if (myRole === 'builder') {
      const redirectable = myMinersHere.filter(m => m.state === 'moving');
      if (redirectable.length > 0) {
        html += `<div class="popup-actions">`;
        html += `<div style="font-size:9px; color:#88aa99; margin-bottom:2px;">Redirect miner (Builder only):</div>`;
        redirectable.forEach(m => {
          html += `<button class="popup-btn" onclick="redirectMinerFromPopup('${m.id}', ${col}, ${row})">Redirect ${m.id.slice(-6)}</button>`;
        });
        html += `</div>`;
      }
    }
  }

  const myStartCell = (typeof window.resolveMyStart === 'function') ? window.resolveMyStart(state) : state.myStart;
  if (myStartCell && Number(myStartCell.x) === col && Number(myStartCell.y) === row) {
    html += `<div class="section">★ Your team's starting position</div>`;
  }

  return html;
}

function redirectMinerFromPopup(minerId, currentCol, currentRow) {
  const popup = window.el('cell-popup');
  if (popup) popup.style.display = 'none';

  if (typeof window.enterMapCommandMode === 'function') {
    window.enterMapCommandMode('miner', {
      minerId: minerId,
      action: 'move',
      instructions: `Redirect miner ${minerId.slice(-6)} to a new location`
    });
  } else if (typeof window.socket !== 'undefined' && window.socket) {
    const x = prompt('New target X (column 0-12):');
    const y = prompt('New target Y (row 0-12):');
    if (x !== null && y !== null) {
      window.socket.emit('moveMiner', { minerId, targetX: parseInt(x, 10), targetY: parseInt(y, 10) }, (res) => {
        if (res && !res.ok && res.error) alert('Redirect failed: ' + res.error);
      });
    }
  }
}

window.renderMap = renderMap;
window.buildCellInfo = buildCellInfo;
window.redirectMinerFromPopup = redirectMinerFromPopup;