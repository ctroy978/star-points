/**
 * war-fleets.js
 * War Commander fleet commissioning, peace flags, and fleet list UI.
 * Server-backed via commissionFleet / moveFleet / setPeaceWith socket events.
 */

const MAX_ESCORTS_PER_FLEET = 6;

function updateAssignTotal() {
  const f = parseInt(window.el('assign-frigates')?.value) || 0;
  const d = parseInt(window.el('assign-destroyers')?.value) || 0;
  const total = f + d;
  const totalEl = window.el('assign-total');
  const errEl = window.el('assign-error');
  if (totalEl) totalEl.textContent = total;

  if (errEl) {
    if (total > MAX_ESCORTS_PER_FLEET) {
      errEl.textContent = `Total cannot exceed ${MAX_ESCORTS_PER_FLEET}`;
      totalEl.style.color = '#ff3366';
    } else {
      errEl.textContent = '';
      totalEl.style.color = '';
    }
  }

  if (typeof updateAssemblyGating === 'function') updateAssemblyGating();
}

function adjustAssign(which, delta) {
  const input = window.el('assign-' + which);
  if (!input) return;
  let val = parseInt(input.value) || 0;
  val = Math.max(0, val + delta);
  input.value = val;
  updateAssignTotal();
}

function getMyTeamData(state) {
  if (!state?.myTeam) return null;
  return (state.teams || []).find(t => t.name === state.myTeam) || null;
}

function renderDroneWings() {
  const container = window.el('war-drone-wings');
  if (!container) return;

  const last = (typeof lastState !== 'undefined') ? lastState : null;
  const myTeam = last?.myTeam;
  const myTeamData = getMyTeamData(last);
  const stock = myTeamData?.droneWings ?? 0;
  const wings = (last?.deployedDroneWings || []).filter(w => w.teamName === myTeam);

  const stockEl = window.el('war-drone-wings-stock');
  if (stockEl) stockEl.textContent = stock;

  if (!myTeam) {
    container.innerHTML = '<span style="color:#006633;">—</span>';
    return;
  }

  if (wings.length === 0) {
    container.innerHTML = '<span style="color:#006633; font-size:10px;">None deployed (max 2 on map).</span>';
    return;
  }

  container.innerHTML = wings.map(w => {
    const loc = (typeof window.formatMapCoord === 'function')
      ? window.formatMapCoord(w.x, w.y)
      : `(${w.x},${w.y})`;
    const dest = w.state === 'moving' && w.targetX != null
      ? ((typeof window.formatMapCoord === 'function')
          ? window.formatMapCoord(w.targetX, w.targetY)
          : `(${w.targetX},${w.targetY})`)
      : 'On station';
    const stateLabel = w.state === 'moving' ? '→' : '■';
    const hpColor = w.hp > 8 ? '#66ffaa' : (w.hp > 4 ? '#ffcc33' : '#ff6666');
    const orderBtn = `<button class="btn btn-small" style="float:right; padding:1px 4px; font-size:9px;"
      onclick="orderDroneWingFromWar('${w.id}')">Order</button>`;
    return `
      <div style="margin:3px 0; padding:3px 4px; background:#1a1100; border-left:2px solid #664422; font-size:10px;">
        <span style="color:#ffaa66;">${stateLabel} Drone</span> at ${loc}
        <span style="color:#006633;">→</span> ${dest}
        <span style="color:${hpColor};"> HP ${w.hp}</span>
        ${orderBtn}
      </div>
    `;
  }).join('');
}

function renderReadyAssets(myTeamData) {
  if (!myTeamData) return;

  const availF = myTeamData.availableFrigates ?? myTeamData.frigates ?? 0;
  const availD = myTeamData.availableDestroyers ?? myTeamData.destroyers ?? 0;
  const totalF = (myTeamData.frigates || 0);
  const totalD = (myTeamData.destroyers || 0);

  const fEl = window.el('war-frigates');
  const fTot = window.el('war-frigates-total');
  if (fEl) fEl.textContent = availF;
  if (fTot) fTot.textContent = totalF;

  const dEl = window.el('war-destroyers');
  const dTot = window.el('war-destroyers-total');
  if (dEl) dEl.textContent = availD;
  if (dTot) dTot.textContent = totalD;

  const cEl = window.el('war-capitols');
  if (cEl) cEl.textContent = myTeamData.availableCapitols ?? myTeamData.capitolShips ?? 0;

  const aEl = window.el('war-admirals');
  const roster = myTeamData.admiralRoster || [];
  if (aEl) aEl.textContent = roster.length;

  updateAssemblyGating(myTeamData);
}

function updateAssemblyGating(myTeamData) {
  const last = (typeof lastState !== 'undefined') ? lastState : null;
  const team = myTeamData || getMyTeamData(last) || {};

  const hasCapitol = (team.availableCapitols ?? team.capitolShips ?? 0) > 0;
  const roster = team.admiralRoster || [];
  const hasAdmirals = roster.length > 0;
  const canAssemble = hasCapitol && hasAdmirals;

  const panel = window.el('fleet-assembly-panel');
  const banner = window.el('assembly-locked-banner');
  const admiralSel = window.el('admiral-select');
  const inputs = [window.el('assign-frigates'), window.el('assign-destroyers')];
  const btn = window.el('btn-commission');

  if (admiralSel) {
    const current = admiralSel.value;
    admiralSel.innerHTML = '';
    if (roster.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '(no admirals — Builder must produce at Military Academy)';
      admiralSel.appendChild(opt);
    } else {
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '— select admiral —';
      admiralSel.appendChild(placeholder);
      roster.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.name;
        admiralSel.appendChild(opt);
      });
    }
    if (current && roster.find(a => a.id === current)) admiralSel.value = current;
  }

  const shouldLock = !canAssemble;
  if (banner) banner.style.display = shouldLock ? 'block' : 'none';
  if (admiralSel) admiralSel.disabled = shouldLock || !hasCapitol;
  inputs.forEach(i => { if (i) i.disabled = shouldLock; });
  if (btn) btn.disabled = shouldLock;

  if (panel) {
    if (shouldLock) {
      panel.style.opacity = '0.65';
      panel.style.borderColor = '#442200';
    } else {
      panel.style.opacity = '';
      panel.style.borderColor = '';
    }
  }
}

function commissionFleet() {
  const admiralSel = window.el('admiral-select');
  const fInput = window.el('assign-frigates');
  const dInput = window.el('assign-destroyers');

  const admiralId = admiralSel ? admiralSel.value : '';
  if (!admiralId) {
    alert('You must select an Admiral to commission a fleet.');
    return;
  }

  const f = parseInt(fInput?.value) || 0;
  const d = parseInt(dInput?.value) || 0;
  const total = f + d;

  if (total < 1) {
    alert('Assign at least 1 escort (frigate or destroyer).');
    return;
  }
  if (total > MAX_ESCORTS_PER_FLEET) {
    alert(`A single fleet can command at most ${MAX_ESCORTS_PER_FLEET} combined escorts.`);
    return;
  }

  window.socket.emit('commissionFleet', { admiralId, frigates: f, destroyers: d }, (res) => {
    if (res && !res.ok) {
      alert('Commission failed: ' + (res.error || 'unknown error'));
      return;
    }
    if (fInput) fInput.value = 0;
    if (dInput) dInput.value = 0;
    if (admiralSel) admiralSel.value = '';
    updateAssignTotal();
  });
}

function renderWarFleets() {
  const container = window.el('war-fleets');
  if (!container) return;

  const last = (typeof lastState !== 'undefined') ? lastState : null;
  const myTeam = last?.myTeam;
  const fleets = (last?.deployedFleets || []).filter(f => f.teamName === myTeam);

  if (!myTeam || fleets.length === 0) {
    container.innerHTML = '<span style="color:#006633;">No commissioned fleets. Use Assembly panel above.</span>';
    return;
  }

  container.innerHTML = fleets.map(fl => {
    const escortStr = `${fl.frigates || 0} F + ${fl.destroyers || 0} D`;
    const hp = fl.capitolHP ?? 0;
    const healthColor = hp > 70 ? '#66ffaa' : (hp > 40 ? '#ffcc33' : '#ff3366');
    const loc = (typeof window.formatMapCoord === 'function')
      ? window.formatMapCoord(fl.x, fl.y)
      : `(${fl.x},${fl.y})`;
    const dest = fl.state === 'moving' && fl.targetX != null
      ? ((typeof window.formatMapCoord === 'function')
          ? window.formatMapCoord(fl.targetX, fl.targetY)
          : `(${fl.targetX},${fl.targetY})`)
      : 'On station';
    const stateLabel = fl.state === 'moving' ? '→ en route' : '■ stationed';
    const orderBtn = fl.state === 'moving'
      ? `<button class="btn btn-small" style="float:right; padding:1px 4px; font-size:9px;"
                onclick="redirectFleetFromWar('${fl.id}')">Redirect</button>`
      : `<button class="btn btn-small" style="float:right; padding:1px 4px; font-size:9px;"
                onclick="orderFleetFromWar('${fl.id}')">Order</button>`;

    return `
      <div class="war-fleet-card">
        <span class="capitol">${fl.admiralName}</span><br>
        <span>Escorts: <strong>${escortStr}</strong></span> |
        <span>Capitol HP: <span style="color:${healthColor}; font-weight:bold;">${hp}</span></span><br>
        <span>${stateLabel} at ${loc}</span>
        <span style="color:#006633;">→</span>
        <span>${dest}</span>
        ${orderBtn}
      </div>
    `;
  }).join('');
}

function renderPeacePanel(state) {
  const container = window.el('peace-panel');
  if (!container || !state?.myTeam) return;

  const myTeamData = getMyTeamData(state);
  const peaceWith = myTeamData?.peaceWith || {};
  const enemies = (state.teams || []).filter(t =>
    t.name !== state.myTeam && (t.factoryHP == null || t.factoryHP > 0)
  );

  if (enemies.length === 0) {
    container.innerHTML = '<span style="color:#006633; font-size:10px;">No enemy teams to set peace with.</span>';
    return;
  }

  container.innerHTML = enemies.map(t => {
    const atPeace = !!peaceWith[t.name];
    return `
      <div style="display:flex; align-items:center; justify-content:space-between; margin:3px 0; font-size:11px;">
        <span>${t.name}</span>
        <label style="cursor:pointer;">
          <input type="checkbox" ${atPeace ? 'checked' : ''}
                 onchange="togglePeaceWith('${t.name}', this.checked)"
                 ${state.myRole !== 'war' ? 'disabled' : ''}>
          <span style="color:${atPeace ? '#66ffaa' : '#ff6666'}; margin-left:4px;">
            ${atPeace ? 'PEACE' : 'WAR'}
          </span>
        </label>
      </div>
    `;
  }).join('');
}

function togglePeaceWith(targetTeam, atPeace) {
  window.socket.emit('setPeaceWith', { targetTeam, atPeace }, (res) => {
    if (res && !res.ok) alert('Peace update failed: ' + (res.error || 'unknown'));
  });
}

function orderFleetFromWar(fleetId) {
  if (typeof window.enterMapCommandMode === 'function') {
    window.enterMapCommandMode('fleet', {
      fleetId,
      action: 'move',
      instructions: `Order fleet to a map cell`
    });
  }
}

function redirectFleetFromWar(fleetId) {
  if (typeof window.enterMapCommandMode === 'function') {
    window.enterMapCommandMode('fleet', {
      fleetId,
      action: 'redirect',
      instructions: `Redirect en-route fleet to a new destination`
    });
  }
}

function startFleetCommandFromWar(fleetId) {
  const last = (typeof lastState !== 'undefined') ? lastState : null;
  const myTeam = last?.myTeam;
  const fleets = (last?.deployedFleets || []).filter(f => f.teamName === myTeam);

  if (fleets.length === 0) {
    alert('You have no commissioned fleets to order. Commission one first.');
    return;
  }

  if (fleetId) {
    orderFleetFromWar(fleetId);
    return;
  }

  const stationed = fleets.filter(f => f.state === 'stationed');
  const moving = fleets.filter(f => f.state === 'moving');
  const pick = stationed[0] || moving[0] || fleets[0];

  if (fleets.length === 1) {
    if (pick.state === 'moving') redirectFleetFromWar(pick.id);
    else orderFleetFromWar(pick.id);
    return;
  }

  if (typeof window.enterMapCommandMode === 'function') {
    window.enterMapCommandMode('fleet', {
      action: 'move',
      instructions: 'Click a map cell to order your fleet (select fleet from Active Fleets panel to target a specific one).'
    });
  }
}

window.updateAssignTotal = updateAssignTotal;
window.adjustAssign = adjustAssign;
window.renderReadyAssets = renderReadyAssets;
window.updateAssemblyGating = updateAssemblyGating;
window.commissionFleet = commissionFleet;
window.renderWarFleets = renderWarFleets;
window.renderDroneWings = renderDroneWings;
window.renderPeacePanel = renderPeacePanel;
window.togglePeaceWith = togglePeaceWith;
window.orderFleetFromWar = orderFleetFromWar;
window.redirectFleetFromWar = redirectFleetFromWar;
window.startFleetCommandFromWar = startFleetCommandFromWar;