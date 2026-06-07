// public/client/map.js
// Map grid rendering, cell popups, and map-specific interactions.
// Depends on: window.el, mining-rates.js, command-system.js (loaded before this file).

let popupHoverTimer = null;
let popupHideTimer = null;
let popupAutoDismissTimer = null;
const POPUP_HOVER_DELAY_MS = 420;
const POPUP_HIDE_DELAY_MS = 400;
const POPUP_AUTO_DISMISS_MS = 10000;

function cancelPopupHide() {
  if (popupHideTimer) {
    clearTimeout(popupHideTimer);
    popupHideTimer = null;
  }
}

function cancelPopupAutoDismiss() {
  if (popupAutoDismissTimer) {
    clearTimeout(popupAutoDismissTimer);
    popupAutoDismissTimer = null;
  }
}

function hideCellPopup(popup) {
  popup = popup || window.el('cell-popup');
  if (!popup) return;
  cancelPopupHide();
  cancelPopupAutoDismiss();
  if (popupHoverTimer) {
    clearTimeout(popupHoverTimer);
    popupHoverTimer = null;
  }
  popup.style.display = 'none';
  popup.style.pointerEvents = 'none';
}

function schedulePopupHide(popup) {
  cancelPopupHide();
  popupHideTimer = setTimeout(() => hideCellPopup(popup), POPUP_HIDE_DELAY_MS);
}

function schedulePopupAutoDismiss(popup) {
  cancelPopupAutoDismiss();
  popupAutoDismissTimer = setTimeout(() => hideCellPopup(popup), POPUP_AUTO_DISMISS_MS);
}

function showCellPopup(popup, html, cell, cursorEvent) {
  popup.innerHTML = html;
  popup.style.display = 'block';

  const hasActions = !!popup.querySelector('.popup-actions');
  positionCellPopup(popup, cell, cursorEvent, hasActions);
  popup.style.pointerEvents = 'auto';

  cancelPopupHide();
  schedulePopupAutoDismiss(popup);
}

function ensureCellPopup() {
  let popup = window.el('cell-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'cell-popup';
    document.body.appendChild(popup);
  } else if (popup.parentElement !== document.body) {
    document.body.appendChild(popup);
  }
  return popup;
}

function positionCellPopup(popup, cell, cursorEvent, hasActions) {
  popup.style.position = 'fixed';
  if (hasActions && cell) {
    const rect = cell.getBoundingClientRect();
    popup.style.left = rect.left + 'px';
    popup.style.top = (rect.bottom + 4) + 'px';
  } else {
    popup.style.left = (cursorEvent.clientX + 14) + 'px';
    popup.style.top = (cursorEvent.clientY + 10) + 'px';
  }
}

function ensurePopupHoverHandlers(popup) {
  if (popup._hoverHandlersAttached) return;
  popup._hoverHandlersAttached = true;
  popup.addEventListener('mouseenter', () => {
    cancelPopupHide();
    schedulePopupAutoDismiss(popup);
    if (popupHoverTimer) {
      clearTimeout(popupHoverTimer);
      popupHoverTimer = null;
    }
  });
  popup.addEventListener('mouseleave', () => schedulePopupHide(popup));
}

function closeCellPopup() {
  hideCellPopup();
}

function isTransitUnitState(state) {
  return state === 'moving' || state === 'setting_up';
}

function addTransitBadge(cell, symbol, color, corner, fontSizePx = 8) {
  cell.style.position = 'relative';
  const badge = document.createElement('span');
  badge.className = 'transit-badge';
  const positions = {
    'top-left': 'top:0;left:1px;',
    'top-right': 'top:0;right:1px;',
    'bottom-left': 'bottom:0;left:1px;',
    'bottom-right': 'bottom:0;right:1px;'
  };
  badge.textContent = symbol;
  badge.style.cssText = `position:absolute;${positions[corner] || positions['top-left']}font-size:${fontSizePx}px;line-height:1;font-weight:bold;color:${color};text-shadow:0 0 3px #000;pointer-events:none;`;
  cell.appendChild(badge);
}

function setTransitCellIcon(cell, symbol, color, background, fontSize) {
  cell.textContent = symbol;
  cell.style.color = color;
  cell.style.background = background;
  cell.style.fontSize = fontSize;
  if (symbol === '✧' || symbol === '◎') {
    cell.style.textShadow = symbol === '◎' ? '0 0 4px #ffcc33' : '0 0 3px #66ccff';
  }
}

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
    const anomalies = typeof window.getVisibleAnomaliesForTeam === 'function'
      ? window.getVisibleAnomaliesForTeam(state)
      : (mapData.anomalies || []);

    const myMiners = (state.deployedMiners || []).filter(m => m.teamName === state.myTeam);
    const myFactories = (state.factories || []).filter(f => f.teamName === state.myTeam);
    const myFleets = (state.deployedFleets || []).filter(f => f.teamName === state.myTeam);
    const enemyFleets = (state.deployedFleets || []).filter(f => f.teamName !== state.myTeam);
    const myDroneWings = (state.deployedDroneWings || []).filter(w => w.teamName === state.myTeam);
    const enemyDroneWings = (state.deployedDroneWings || []).filter(w => w.teamName !== state.myTeam);
    const myProbes = (state.deployedProbes || []).filter(p => p.teamName === state.myTeam);
    const probeAt = {};
    myProbes.forEach(p => {
      probeAt[`${p.x},${p.y}`] = p;
    });

    const tacticalPingCells = new Set();
    myProbes.forEach(p => {
      if (p.mode !== 'tactical' || p.state !== 'pinging') return;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (Math.abs(dx) + Math.abs(dy) > 1) continue;
          const px = p.x + dx;
          const py = p.y + dy;
          if (px >= 0 && px < size && py >= 0 && py < size) {
            tacticalPingCells.add(`${px},${py}`);
          }
        }
      }
    });

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
        const cellKeyForPing = `${col},${row}`;

        if (tacticalPingCells.has(cellKeyForPing) && !isGasGiant) {
          cell.style.boxShadow = 'inset 0 0 0 1px rgba(255,120,60,0.55)';
          if (!cell.style.background || cell.style.background === '') {
            cell.style.background = 'rgba(40,12,0,0.35)';
          }
        }

        if (isGasGiant) {
          cell.classList.add('gas-giant');
          cell.textContent = '◎';
          cell.style.color = 'var(--amber)';
          cell.style.fontSize = '18px';
          cell.style.textShadow = '0 0 4px #ffcc33';
        }

        const anom = typeof window.getPrimaryAnomalyAt === 'function'
          ? window.getPrimaryAnomalyAt(anomalies, col, row)
          : anomalies.find(a => a.x === col && a.y === row);
        if (anom && !isGasGiant) {
          if (anom.type === 'large_moon' || anom.type === 'major_moon') {
            cell.textContent = '◉';
            cell.style.color = '#00ff9f';
            cell.style.fontSize = '15px';
            cell.style.background = '#0a2200';
          } else if (anom.type === 'small_moon' || anom.type === 'normal_moon') {
            cell.textContent = '○';
            cell.style.color = '#66eeaa';
            cell.style.fontSize = '11px';
            cell.style.background = '#061a0a';
          } else if (anom.type === 'gas_cloud') {
            cell.textContent = '☁';
            cell.style.color = '#66ccff';
            cell.style.fontSize = '13px';
            cell.style.background = '#001122';
          } else if (anom.type === 'asteroid_cluster') {
            cell.textContent = '◆';
            cell.style.color = '#ffaa66';
            cell.style.fontSize = '12px';
            cell.style.background = '#221100';
          }
        }

        if (isMyStart && !isGasGiant) {
          cell.classList.add('team-start-cell');
          if (!cell.textContent || !cell.textContent.trim()) {
            cell.textContent = '★';
            cell.style.color = '#ffcc33';
            cell.style.fontSize = '14px';
            cell.style.background = '#1a2200';
          }
          const badge = document.createElement('span');
          badge.className = 'start-badge';
          badge.textContent = '★';
          cell.appendChild(badge);
        }

        const hasTerrain = isGasGiant || !!anom || isMyStart;
        const cellKey = `${col},${row}`;

        const activeMinersHere = myMiners.filter(m =>
          m.x === col && m.y === row && m.state === 'mining'
        );
        if (activeMinersHere.length > 0) {
          const sym = '⛏';
          const label = activeMinersHere.length > 1 ? `${sym}${activeMinersHere.length}` : sym;
          const color = '#66ffaa';
          if (hasTerrain) {
            addTransitBadge(cell, label, color, 'bottom-left', 10);
          } else {
            setTransitCellIcon(cell, label, color, '#002211', '12px');
          }
        }

        const transitMinersHere = myMiners.filter(m =>
          m.x === col && m.y === row && isTransitUnitState(m.state)
        );
        if (transitMinersHere.length > 0) {
          const settingUp = transitMinersHere.some(m => m.state === 'setting_up');
          const sym = settingUp ? 'M⏳' : 'M→';
          const label = transitMinersHere.length > 1 ? `${sym}${transitMinersHere.length}` : sym;
          const color = settingUp ? '#ffcc33' : '#aaffcc';
          if (hasTerrain) {
            addTransitBadge(cell, label, color, 'top-left');
          } else {
            setTransitCellIcon(cell, label, color, '#002211', '11px');
          }
        }

        const transitFactoriesHere = myFactories.filter(f =>
          f.x === col && f.y === row && !f.isHome && isTransitUnitState(f.state)
        );
        if (transitFactoriesHere.length > 0) {
          const settingUp = transitFactoriesHere.some(f => f.state === 'setting_up');
          const sym = settingUp ? 'F⏳' : 'F→';
          const label = transitFactoriesHere.length > 1 ? `${sym}${transitFactoriesHere.length}` : sym;
          const color = settingUp ? '#ffcc66' : '#88bbff';
          if (hasTerrain) {
            addTransitBadge(cell, label, color, 'bottom-right');
          } else if (!transitMinersHere.length) {
            setTransitCellIcon(cell, label, color, '#001a33', '10px');
          } else {
            addTransitBadge(cell, label, color, 'bottom-right');
          }
        }

        const myFleetsHere = myFleets.filter(f => f.x === col && f.y === row);
        if (myFleetsHere.length > 0) {
          const anyMoving = myFleetsHere.some(f => f.state === 'moving');
          const initial = (myFleetsHere[0].admiralName || 'C').charAt(0).toUpperCase();
          const sym = anyMoving ? `${initial}→` : `${initial}■`;
          const label = myFleetsHere.length > 1 ? `${sym}${myFleetsHere.length}` : sym;
          const color = '#ffaa44';
          const terrainOrOther = hasTerrain || transitMinersHere.length > 0 || transitFactoriesHere.length > 0;
          const badgeSize = anyMoving ? 8 : 10;
          if (terrainOrOther) {
            addTransitBadge(cell, label, color, 'bottom-left', badgeSize);
          } else if (!transitMinersHere.length && !transitFactoriesHere.length) {
            setTransitCellIcon(cell, label, color, '#221100', anyMoving ? '11px' : '12px');
          } else {
            addTransitBadge(cell, label, color, 'bottom-left', badgeSize);
          }
        }

        const myWingsHere = myDroneWings.filter(w => w.x === col && w.y === row);
        if (myWingsHere.length > 0) {
          const moving = myWingsHere.some(w => w.state === 'moving');
          const sym = moving ? '†→' : '†';
          const label = myWingsHere.length > 1 ? `${sym}${myWingsHere.length}` : sym;
          const wingOnTerrain = hasTerrain || transitMinersHere.length > 0 || transitFactoriesHere.length > 0 ||
            myFleetsHere.length > 0;
          if (wingOnTerrain) {
            addTransitBadge(cell, label, '#ffaa66', 'bottom-right', 12);
          } else {
            setTransitCellIcon(cell, label, '#ffaa66', '#2a1800', '15px');
            cell.style.textShadow = '0 0 4px #ff8800';
          }
        }

        const enemyWingsHere = enemyDroneWings.filter(w => w.x === col && w.y === row);
        if (enemyWingsHere.length > 0) {
          const sym = enemyWingsHere[0].state === 'moving' ? '†→' : '†';
          const label = enemyWingsHere.length > 1 ? `${sym}${enemyWingsHere.length}` : sym;
          addTransitBadge(cell, label, '#ff6666', 'top-left', 12);
        }

        const enemyFleetsHere = enemyFleets.filter(f => f.x === col && f.y === row);
        if (enemyFleetsHere.length > 0) {
          const anyMoving = enemyFleetsHere.some(f => f.state === 'moving');
          const initial = (enemyFleetsHere[0].admiralName || '?').charAt(0).toUpperCase();
          const sym = anyMoving ? `${initial}→` : `${initial}■`;
          const label = enemyFleetsHere.length > 1 ? `${sym}${enemyFleetsHere.length}` : sym;
          addTransitBadge(cell, label, '#ff6666', myFleetsHere.length > 0 ? 'top-right' : 'bottom-left', 10);
        }

        const probe = probeAt[cellKey];
        if (probe) {
          let sym = '✧';
          let color = '#66ccff';
          let bg = '#001133';
          if (probe.mode === 'tactical') {
            if (probe.state === 'pinging') { sym = '◉'; color = '#ff8844'; bg = '#331100'; }
            else { sym = '✧'; color = '#ffaa66'; bg = '#221100'; }
          } else if (probe.state === 'scanning') {
            sym = '◎'; color = '#ffdd66'; bg = '#221a00';
          } else {
            sym = '✧'; color = '#66ccff'; bg = '#001133';
          }
          const terrainOrOtherTransit = hasTerrain || transitMinersHere.length > 0 || transitFactoriesHere.length > 0 ||
            myFleetsHere.length > 0;
          if (terrainOrOtherTransit) {
            addTransitBadge(cell, sym, color, 'top-right');
          } else {
            setTransitCellIcon(cell, sym, color, bg, '12px');
          }
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

    const popup = ensureCellPopup();

    if (popupHoverTimer) {
      clearTimeout(popupHoverTimer);
      popupHoverTimer = null;
    }
    ensurePopupHoverHandlers(popup);

    const cells = wrapper.querySelectorAll('.map-cell');
    cells.forEach(cell => {
      const col = parseInt(cell.dataset.col, 10);
      const row = parseInt(cell.dataset.row, 10);
      if (Number.isNaN(col) || Number.isNaN(row)) return;

      cell.addEventListener('mouseenter', (e) => {
        cancelPopupHide();
        if (popupHoverTimer) clearTimeout(popupHoverTimer);

        popupHoverTimer = setTimeout(() => {
          const infoHtml = buildCellInfo(state, col, row);
          if (!infoHtml) return;
          showCellPopup(popup, infoHtml, cell, e);
        }, POPUP_HOVER_DELAY_MS);
      });

      cell.addEventListener('mouseleave', (e) => {
        if (popupHoverTimer) {
          clearTimeout(popupHoverTimer);
          popupHoverTimer = null;
        }
        const related = e.relatedTarget;
        if (related && popup.contains(related)) return;
        if (popup.style.display === 'block') {
          schedulePopupHide(popup);
        }
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
  const myTeam = state.myTeam;
  const myRole = state.myRole;

  const visibleAnomalies = typeof window.getVisibleAnomaliesForTeam === 'function'
    ? window.getVisibleAnomaliesForTeam(state)
    : (mapData.anomalies || []);

  const anomHere = typeof window.getPrimaryAnomalyAt === 'function'
    ? window.getPrimaryAnomalyAt(visibleAnomalies, col, row)
    : visibleAnomalies.find(a => a.x === col && a.y === row);
  const minersHere = (state.deployedMiners || []).filter(m => m.x === col && m.y === row);
  const factoriesHere = (state.factories || []).filter(f => f.x === col && f.y === row);
  const myMinersHere = minersHere.filter(m => m.teamName === myTeam);
  const myFactoriesHere = factoriesHere.filter(f => f.teamName === myTeam);
  const enemyMinersHere = minersHere.filter(m => m.teamName !== myTeam);
  const enemyFactoriesHere = factoriesHere.filter(f => f.teamName !== myTeam);
  const myProbeHere = (state.deployedProbes || []).find(p =>
    p.teamName === myTeam && p.x === col && p.y === row
  );
  const fleetsHere = (state.deployedFleets || []).filter(f => f.x === col && f.y === row);
  const myFleetsHere = fleetsHere.filter(f => f.teamName === myTeam);
  const enemyFleetsHere = fleetsHere.filter(f => f.teamName !== myTeam);
  const wingsHere = (state.deployedDroneWings || []).filter(w => w.x === col && w.y === row);
  const myWingsHere = wingsHere.filter(w => w.teamName === myTeam);
  const enemyWingsHere = wingsHere.filter(w => w.teamName !== myTeam);
  const gasGiant = mapData.gasGiant;
  const isGasGiant = gasGiant && col === gasGiant.x && row === gasGiant.y;

  const cellLabel = `${String.fromCharCode(65 + col)}${row + 1}`;
  let html = `<div class="popup-header">`;
  html += `<strong>Cell ${cellLabel}</strong>`;
  html += `<button type="button" class="popup-close" onclick="closeCellPopup()" title="Close">×</button>`;
  html += `</div>`;

  if (isGasGiant) {
    html += `<div class="section"><span class="object-name">Gas Giant</span><br><span style="color:#88aa99;">Central star system body — not targetable</span></div>`;
  }

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

    if (myTeam && typeof window.isAnomalyDiscoveredByTeam === 'function' &&
        window.isAnomalyDiscoveredByTeam(anomHere, myTeam, state)) {
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
      html += `<br><span style="color:#335544; font-size:9px;">⛯ Resources unknown — probe or land a miner here to reveal yields</span>`;
    }

    html += `</div>`;
  }

  const unitsHere = myMinersHere.length + myFactoriesHere.length + enemyMinersHere.length +
    enemyFactoriesHere.length + myFleetsHere.length + enemyFleetsHere.length +
    myWingsHere.length + enemyWingsHere.length + (myProbeHere ? 1 : 0);
  if (unitsHere > 0) {
    html += `<div class="section"><strong>Units at this site (${unitsHere}):</strong>`;
  }

  if (myMinersHere.length > 0) {
    html += `<div style="font-size:9px; color:#88aa99; margin:3px 0 1px;">Miners</div>`;
    myMinersHere.forEach(m => {
      const stateLabel = m.state === 'mining' ? '⛏ mining' : (m.state === 'setting_up' ? '⏳ setting up' : '→ moving');
      html += `<div style="margin:2px 0;">${stateLabel} <span style="color:#669977;">(id ${m.id.slice(-6)})</span></div>`;
    });

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

  if (myFactoriesHere.length > 0) {
    html += `<div style="font-size:9px; color:#88aa99; margin:5px 0 1px;">Factories</div>`;
    myFactoriesHere.forEach(f => {
      let stateLabel = f.isHome ? '🏠 home base' : '→ moving';
      if (f.state === 'operational') stateLabel = f.isHome ? '🏠 home (operational)' : '▶ operational';
      else if (f.state === 'setting_up') {
        const eta = f.setupRemaining != null ? `${f.setupRemaining}s` : '…';
        stateLabel = `⏳ setting up (${eta})`;
      } else if (f.state === 'moving') {
        const dest = f.moonName || (f.targetX != null ? `(${f.targetX},${f.targetY})` : 'moon');
        stateLabel = `→ en route to ${dest}`;
      }
      html += `<div style="margin:2px 0;">${stateLabel} <span style="color:#6699bb;">(id ${f.id.slice(-6)})</span></div>`;
    });

    if (myRole === 'builder') {
      const redirectable = myFactoriesHere.filter(f => !f.isHome && f.state === 'moving');
      if (redirectable.length > 0) {
        html += `<div class="popup-actions">`;
        html += `<div style="font-size:9px; color:#88aa99; margin-bottom:2px;">Redirect factory kit (Builder only):</div>`;
        redirectable.forEach(f => {
          html += `<button class="popup-btn" onclick="redirectFactoryFromPopup('${f.id}', ${col}, ${row})">Redirect ${f.id.slice(-6)}</button>`;
        });
        html += `</div>`;
      }
    }
  }

  if (myProbeHere) {
    const modeLabel = myProbeHere.mode === 'tactical' ? 'Tactical probe' : 'Survey probe';
    const who = myProbeHere.launchedByRoleLabel || myProbeHere.launchedByRole || 'Teammate';
    html += `<div style="font-size:9px; color:#88aa99; margin:5px 0 1px;">Probes</div>`;
    html += `<div style="margin:2px 0;">${modeLabel} <span style="color:#669977;">(${who})</span></div>`;
    if (myProbeHere.state === 'scanning') {
      const remain = myProbeHere.scanRemaining != null ? `${myProbeHere.scanRemaining}s` : '…';
      html += `<div style="margin:2px 0;">◎ surveying resources — ${remain} left</div>`;
    } else if (myProbeHere.state === 'pinging') {
      const remain = myProbeHere.pingRemaining != null ? `${myProbeHere.pingRemaining}s` : '…';
      html += `<div style="margin:2px 0;">◉ pinging zone — enemy ships visible, ${remain} left</div>`;
    } else {
      html += `<div style="margin:2px 0;">✧ en route (~8s per cell)</div>`;
    }
  }

  if (myWingsHere.length > 0) {
    html += `<div style="font-size:9px; color:#88aa99; margin:5px 0 1px;">Drone wings (${myTeam})</div>`;
    myWingsHere.forEach(w => {
      const stateLabel = w.state === 'moving' ? '→ moving' : '■ stationed';
      html += `<div style="margin:2px 0;">${stateLabel} <span style="color:#ffaa66;">HP ${w.hp}</span></div>`;
    });
    if (myRole === 'war') {
      html += `<div class="popup-actions">`;
      myWingsHere.forEach(w => {
        html += `<button class="popup-btn" onclick="orderDroneWingFromWar('${w.id}')">Order wing ${w.id.slice(-6)}</button>`;
      });
      html += `</div>`;
    }
  }

  if (myFleetsHere.length > 0) {
    html += `<div style="font-size:9px; color:#88aa99; margin:5px 0 1px;">Fleets (${myTeam})</div>`;
    myFleetsHere.forEach(fl => {
      const stateLabel = fl.state === 'moving' ? '→ moving' : '■ stationed';
      const escorts = `${fl.frigates || 0}F + ${fl.destroyers || 0}D`;
      html += `<div style="margin:2px 0;">${stateLabel} <strong>${fl.admiralName}</strong> (${escorts}, HP ${fl.capitolHP ?? '?'})</div>`;
    });

    if (myRole === 'war') {
      const redirectable = myFleetsHere.filter(f => f.state === 'moving');
      if (redirectable.length > 0) {
        html += `<div class="popup-actions">`;
        html += `<div style="font-size:9px; color:#88aa99; margin-bottom:2px;">Redirect fleet (War Commander):</div>`;
        redirectable.forEach(fl => {
          html += `<button class="popup-btn" onclick="redirectFleetFromPopup('${fl.id}')">Redirect ${fl.admiralName}</button>`;
        });
        html += `</div>`;
      }
      const stationed = myFleetsHere.filter(f => f.state === 'stationed');
      if (stationed.length > 0) {
        html += `<div class="popup-actions">`;
        html += `<div style="font-size:9px; color:#88aa99; margin-bottom:2px;">Order stationed fleet:</div>`;
        stationed.forEach(fl => {
          html += `<button class="popup-btn" onclick="orderFleetFromPopup('${fl.id}')">Order ${fl.admiralName}</button>`;
        });
        html += `</div>`;
      }
    }
  }

  if (enemyWingsHere.length > 0) {
    html += `<div style="font-size:9px; color:#88aa99; margin:5px 0 1px;">Enemy drone wings (intel)</div>`;
    enemyWingsHere.forEach(w => {
      const stateLabel = w.state === 'moving' ? '→ moving' : '■ stationed';
      html += `<div style="margin:2px 0; color:#cc8888;">${stateLabel} HP ${w.hp} <span>(${w.teamName})</span></div>`;
    });
  }

  if (enemyMinersHere.length > 0) {
    html += `<div style="font-size:9px; color:#88aa99; margin:5px 0 1px;">Enemy miners (intel)</div>`;
    enemyMinersHere.forEach(m => {
      const stateLabel = m.state === 'mining' ? '⛏ mining' : (m.state === 'setting_up' ? '⏳ setting up' : '→ moving');
      html += `<div style="margin:2px 0; color:#cc8888;">${stateLabel} <span>(${m.teamName})</span></div>`;
    });
  }

  if (enemyFactoriesHere.length > 0) {
    html += `<div style="font-size:9px; color:#88aa99; margin:5px 0 1px;">Enemy factories (intel)</div>`;
    enemyFactoriesHere.forEach(f => {
      let stateLabel = f.isHome ? '🏠 home' : (f.state === 'operational' ? '▶ operational' : f.state);
      html += `<div style="margin:2px 0; color:#cc8888;">${stateLabel} <span>(${f.teamName})</span></div>`;
    });
  }

  if (enemyFleetsHere.length > 0) {
    html += `<div style="font-size:9px; color:#88aa99; margin:5px 0 1px;">Enemy fleets (intel)</div>`;
    enemyFleetsHere.forEach(fl => {
      const stateLabel = fl.state === 'moving' ? '→ moving' : '■ stationed';
      html += `<div style="margin:2px 0; color:#cc8888;">${stateLabel} <strong>${fl.admiralName}</strong> (${fl.teamName})</div>`;
    });
  }

  if (unitsHere > 0) {
    html += `</div>`;
  }

  const myStartCell = (typeof window.resolveMyStart === 'function') ? window.resolveMyStart(state) : state.myStart;
  if (myStartCell && Number(myStartCell.x) === col && Number(myStartCell.y) === row) {
    html += `<div class="section">★ Your team's starting position</div>`;
  }

  return html;
}

function redirectFactoryFromPopup(factoryId, currentCol, currentRow) {
  hideCellPopup();

  if (typeof window.enterMapCommandMode === 'function') {
    window.enterMapCommandMode('factory', {
      factoryId: factoryId,
      action: 'move',
      instructions: `Redirect factory kit ${factoryId.slice(-6)} to a different moon`
    });
  }
}

function orderFleetFromPopup(fleetId) {
  hideCellPopup();
  if (typeof window.enterMapCommandMode === 'function') {
    window.enterMapCommandMode('fleet', {
      fleetId,
      action: 'move',
      instructions: `Order fleet to a new map cell`
    });
  }
}

function redirectFleetFromPopup(fleetId) {
  hideCellPopup();
  if (typeof window.enterMapCommandMode === 'function') {
    window.enterMapCommandMode('fleet', {
      fleetId,
      action: 'redirect',
      instructions: `Redirect en-route fleet to a new destination`
    });
  }
}

function redirectMinerFromPopup(minerId, currentCol, currentRow) {
  hideCellPopup();

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
window.redirectFactoryFromPopup = redirectFactoryFromPopup;
window.orderFleetFromPopup = orderFleetFromPopup;
window.redirectFleetFromPopup = redirectFleetFromPopup;
window.closeCellPopup = closeCellPopup;