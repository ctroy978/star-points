/**
 * command-system.js
 *
 * General command / order system for directing mobile units via the map.
 *
 * This file continues the separation of logic started in ARCHITECTURE.md.
 * All "button on role page → switch to map → click destination → confirm" flows
 * should live here (or in role-specific files that use this).
 *
 * Currently supports:
 *   - Miner deployment / movement from Builder
 *
 * Future: Probes (War), fleets, etc. can reuse the same pattern.
 * See ARCHITECTURE.md for current guidance on when to unify movement logic.
 */

let commandMode = null; // { type, action, minerId?, factoryId?, instructions? }

/**
 * Converts numeric grid coordinates (col, row) to human-friendly map notation.
 * Columns are letters (A, B, C...), Rows are numbers (1, 2, 3...).
 * Example: (1, 3) → "B4"
 */
function formatMapCoord(col, row) {
  if (typeof col !== 'number' || typeof row !== 'number') return `${col},${row}`;
  const letter = String.fromCharCode(65 + col); // 0 → A, 1 → B, etc.
  const num = row + 1; // 0 → 1, 1 → 2, etc.
  return `${letter}${num}`;
}

// Expose for use in other parts of the UI (e.g. miner lists)
window.formatMapCoord = formatMapCoord;

// Public API to enter command mode from a role panel (Builder, War, etc.)
function enterMapCommandMode(type, options = {}) {
  commandMode = {
    type: type || 'miner',
    action: options.action || 'auto',
    minerId: options.minerId || null,
    factoryId: options.factoryId || null,
    instructions: options.instructions || getDefaultInstructions(type)
  };

  // Immediately switch to the map so the user can click a destination
  if (typeof switchTab === 'function') {
    switchTab('map');
  }

  // Show clear instructions
  showCommandInstructions(commandMode.instructions);

  // Optional: highlight that the map is now in command mode
  const mapContainer = el('map-container');
  if (mapContainer) {
    mapContainer.style.outline = '2px solid #ffcc33';
    mapContainer.style.outlineOffset = '2px';
  }
}

function cancelCommandMode() {
  const wasActive = !!commandMode;
  commandMode = null;

  // Remove visual hints
  const mapContainer = el('map-container');
  if (mapContainer) {
    mapContainer.style.outline = '';
    mapContainer.style.outlineOffset = '';
  }

  hideCommandInstructions();

  // Clear any old single-miner selection state for compatibility
  if (typeof selectedMinerId !== 'undefined') selectedMinerId = null;
  if (typeof mapClickMode !== 'undefined') mapClickMode = null;

  if (wasActive && typeof lastState !== 'undefined' && lastState) {
    // Re-render to clean up any highlights
    if (typeof render === 'function') render(lastState);
  }
}

function getDefaultInstructions(type) {
  if (type === 'miner') {
    return 'Click a map cell to send a miner rig there.';
  }
  if (type === 'factory') {
    return 'Click a moon (◉ large or ○ small) to deploy a factory kit.';
  }
  if (type === 'probe') {
    return 'Click a map cell to launch a probe. It travels ~8s per cell, scans the area for 30s on arrival, then reveals hidden sites + resources for your team.';
  }
  return 'Click a destination on the map.';
}

function showCommandInstructions(text) {
  // Create or update a floating instruction bar at the top of the map area
  let bar = el('command-instructions-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'command-instructions-bar';
    bar.style.cssText = `
      position: absolute;
      top: 4px;
      left: 50%;
      transform: translateX(-50%);
      background: #112200;
      color: #ffdd66;
      border: 2px solid #ffcc33;
      padding: 6px 14px;
      font-size: 13px;
      font-weight: bold;
      z-index: 100;
      border-radius: 4px;
      box-shadow: 0 0 8px #000;
      display: flex;
      align-items: center;
      gap: 12px;
    `;
    const mapWrap = document.querySelector('#tab-map .panel') || document.getElementById('map-container')?.parentElement;
    if (mapWrap) {
      mapWrap.style.position = 'relative';
      mapWrap.appendChild(bar);
    } else {
      document.body.appendChild(bar);
    }
  }

  bar.innerHTML = `
    <span>${text}</span>
    <button class="btn btn-small" style="background:#330000; color:#ffaaaa; border-color:#660000;" onclick="cancelCommandMode()">CANCEL</button>
  `;
  bar.style.display = 'flex';
}

function hideCommandInstructions() {
  const bar = el('command-instructions-bar');
  if (bar) bar.style.display = 'none';
}

function getMoonAtCell(state, col, row) {
  const anomalies = state?.map?.anomalies || [];
  const anom = anomalies.find(a => a.x === col && a.y === row);
  if (!anom) return null;
  if (anom.type === 'large_moon' || anom.type === 'small_moon' ||
      anom.type === 'major_moon' || anom.type === 'normal_moon') {
    return anom;
  }
  return null;
}

// Called from the map cell click handler (we will wire this in index.html patch)
function handleMapCellCommandClick(col, row) {
  if (!commandMode) return false;

  const instructions = commandMode.instructions || 'Send unit to this location?';

  // Confirmation as requested by user - use map notation (A1, B4, etc.)
  const niceCoord = formatMapCoord(col, row);
  const confirmed = confirm(
    `${instructions}\n\nDestination: ${niceCoord}\n\nConfirm order?`
  );

  if (!confirmed) {
    // User cancelled the specific click, but stay in command mode
    return true; // we handled it
  }

  // Execute based on command type
  const type = commandMode.type;

  if (type === 'miner') {
    const minerId = commandMode.minerId;

    if (minerId) {
      // Explicit move of a selected rig
      socket.emit('moveMiner', { minerId, targetX: col, targetY: row }, (res) => {
        if (res && !res.ok && res.error) alert('Move order failed: ' + res.error);
        cancelCommandMode();
        if (typeof lastState !== 'undefined' && lastState && typeof render === 'function') {
          render(lastState);
        }
      });
    } else {
      // General "direct a miner" — server will decide deploy vs move if needed,
      // but for now we prefer deploy if they have available rigs.
      // Client can check state, but simplest is just send deployMiner.
      // (The server already has good logic.)
      socket.emit('deployMiner', { targetX: col, targetY: row }, (res) => {
        if (res && !res.ok && res.error) alert('Order failed: ' + res.error);
        cancelCommandMode();
      });
    }
  } else if (type === 'factory') {
    const state = (typeof lastState !== 'undefined') ? lastState : null;
    const moon = getMoonAtCell(state, col, row);
    if (!moon) {
      alert('Factories can only be deployed to moons (◉ large moon or ○ small moon).');
      return true;
    }

    const targetObject = moon.id || moon.name || null;
    const factoryId = commandMode.factoryId;

    if (factoryId) {
      socket.emit('moveFactory', { factoryId, targetX: col, targetY: row, targetObject }, (res) => {
        if (res && !res.ok && res.error) alert('Factory redirect failed: ' + res.error);
        cancelCommandMode();
      });
    } else {
      socket.emit('deployFactory', { targetX: col, targetY: row, targetObject }, (res) => {
        if (res && !res.ok && res.error) alert('Factory deploy failed: ' + res.error);
        cancelCommandMode();
      });
    }
  } else if (type === 'probe') {
    socket.emit('launchProbe', { x: col, y: row }, (res) => {
      if (res && !res.ok && res.error) alert('Probe launch failed: ' + res.error);
      cancelCommandMode();
    });
  }

  // For now we exit command mode after one order
  // (future: we could support "repeat command" mode)
  return true;
}

// Expose the API so role panels can call it easily
window.enterMapCommandMode = enterMapCommandMode;
window.cancelCommandMode = cancelCommandMode;
window.handleMapCellCommandClick = handleMapCellCommandClick; // for integration in renderMap

// Small helper to let the main render loop know we're in command mode
function isInCommandMode() {
  return !!commandMode;
}

window.isInCommandMode = isInCommandMode;

/* ============================================================
   Role-specific entry points (called from buttons on role tabs)
   ============================================================ */

// Called when Builder clicks "DIRECT A MINER RIG TO MAP LOCATION"
function startMinerCommandFromBuilder() {
  const statusEl = el('builder-miner-command-status');

  // Use lastState (the last full game state received) — this is the reliable global
  const last = (typeof lastState !== 'undefined') ? lastState : null;
  const myTeamName = last ? last.myTeam : null;

  const myTeamData = myTeamName && last
    ? (last.teams || []).find(t => t.name === myTeamName)
    : null;

  const available = myTeamData?.availableMiners || 0;

  const deployedMoving = last
    ? (last.deployedMiners || []).filter(m =>
        m.teamName === myTeamName && m.state === 'moving'
      ).length
    : 0;

  if (!myTeamName) {
    if (statusEl) statusEl.textContent = 'You are not currently on a team.';
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
    return;
  }

  if (available === 0 && deployedMoving === 0) {
    if (statusEl) statusEl.textContent = 'You have no miner rigs available to command (deployed ones are locked to their sites).';
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 4000);
    return;
  }

  enterMapCommandMode('miner', {
    action: 'auto',
    instructions: available > 0
      ? 'Click a map cell to send a new miner rig there.'
      : 'Click a map cell to redirect one of your en-route miners.'
  });
}

// Helper exposed for other parts of the app
function getCommandMode() {
  return commandMode;
}

window.getCommandMode = getCommandMode;

// New: War Commander entry point for launching probes (as requested)
function startProbeCommandFromWar() {
  const last = (typeof lastState !== 'undefined') ? lastState : null;
  const myTeamName = last ? last.myTeam : null;

  const myTeamData = myTeamName && last
    ? (last.teams || []).find(t => t.name === myTeamName)
    : null;

  const probes = myTeamData?.probes || 0;

  if (probes < 1) {
    alert('You have no probes available. Build more as Builder.');
    return;
  }

  enterMapCommandMode('probe', {
    action: 'launch',
    instructions: 'Click destination. Probe travels slowly (~8s/cell), scans 30s on arrival, then reveals sites + yields for your team only.'
  });
}

function deployAvailableFactory() {
  const last = (typeof lastState !== 'undefined') ? lastState : null;
  const myTeamName = last ? last.myTeam : null;
  const myTeamData = myTeamName && last
    ? (last.teams || []).find(t => t.name === myTeamName)
    : null;
  const kits = myTeamData?.availableFactories || 0;

  if (kits < 1) {
    alert('No factory kits available. Queue a FACTORY KIT from the Builder production panel first.');
    return;
  }

  enterMapCommandMode('factory', {
    action: 'deploy',
    instructions: 'Click a moon (◉ or ○) to deploy one of your factory kits.'
  });
}

window.deployAvailableFactory = deployAvailableFactory;
window.getMoonAtCell = getMoonAtCell;
window.startProbeCommandFromWar = startProbeCommandFromWar;