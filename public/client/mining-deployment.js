/**
 * mining-deployment.js
 *
 * Separated client-side logic for Builder miner deployment and shared map targeting.
 *
 * This is the start of logic separation per the soft rule in ARCHITECTURE.md.
 * New major Builder / mining UI features should live in dedicated files like this
 * rather than being dumped into the monolithic index.html.
 *
 * === IMPORTANT FUTURE ARCHITECTURE NOTE ===
 * See ARCHITECTURE.md → "Movement & Map Entities Strategy".
 * The original mining plan recommended keeping miner movement isolated until
 * fleets/probes actually need grid movement. Do not build a shared pathfinder
 * until we have a second concrete consumer.
 */

// Deploy a miner using the shared coordinate inputs (used by both Builder tab and Map tab)
function deployMinerToCoords() {
  const xEl = el('deploy-x');
  const yEl = el('deploy-y');
  const statusEl = el('deploy-miner-status');
  if (!xEl || !yEl) return;

  const x = parseInt(xEl.value) || 0;
  const y = parseInt(yEl.value) || 0;

  socket.emit('deployMiner', { targetX: x, targetY: y }, (res) => {
    if (res && res.ok) {
      if (statusEl) statusEl.textContent = 'Miner dispatched! Watch map.';
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2500);
    } else if (res && res.error) {
      if (statusEl) statusEl.textContent = res.error;
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
      alert('Deploy failed: ' + res.error);
    }
  });
}

// Launch probe using shared coordinate inputs.
// Note: Permission is enforced server-side (War Commander only).
// This function can be called from War panel or Map.
function launchProbeAtCoords() {
  const xEl = el('deploy-x');
  const yEl = el('deploy-y');
  const statusEl = el('deploy-miner-status');
  if (!xEl || !yEl) return;

  const x = parseInt(xEl.value) || 0;
  const y = parseInt(yEl.value) || 0;

  socket.emit('launchProbe', { x, y }, (res) => {
    if (res && res.ok) {
      if (statusEl) statusEl.textContent = res.revealed ? `Revealed ${res.revealed}!` : 'Scanned.';
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2500);
    } else if (res && res.error) {
      if (statusEl) statusEl.textContent = res.error;
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
      alert('Probe failed: ' + res.error);
    }
  });
}

// Convenience wrapper for the War Commander's launch button
function launchProbeFromWar() {
  launchProbeAtCoords();
}

// Helper: Set the shared coordinate inputs (useful for future "click on map to set target" + "then act")
function setMapTarget(x, y) {
  const xEl = el('deploy-x');
  const yEl = el('deploy-y');
  if (xEl) xEl.value = x;
  if (yEl) yEl.value = y;

  // Optional: flash a status in the common deploy status area
  const statusEl = el('deploy-miner-status');
  if (statusEl) {
    statusEl.textContent = `Target set to (${x},${y})`;
    setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2000);
  }
}

// Expose for map click handlers if needed (kept minimal)
window.setMapTarget = setMapTarget;

/* ============================================================
   Builder Tab Specific Helpers (DEPRECATED for miner control)
   Miners are no longer directed from the Builder UI.
   These remain for shared coordinate helpers used by probes (War).
   ============================================================ */

// Deploy using the Builder tab's own coordinate inputs
function deployMinerFromBuilder() {
  const xEl = el('builder-deploy-x');
  const yEl = el('builder-deploy-y');
  const statusEl = el('builder-deploy-status');
  if (!xEl || !yEl) return;

  const x = parseInt(xEl.value) || 0;
  const y = parseInt(yEl.value) || 0;

  // Also sync the shared Map tab inputs so everything stays consistent
  const sharedX = el('deploy-x');
  const sharedY = el('deploy-y');
  if (sharedX) sharedX.value = x;
  if (sharedY) sharedY.value = y;

  socket.emit('deployMiner', { targetX: x, targetY: y }, (res) => {
    if (res && res.ok) {
      if (statusEl) statusEl.textContent = 'Miner dispatched to (' + x + ',' + y + ').';
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
    } else if (res && res.error) {
      if (statusEl) statusEl.textContent = res.error;
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 4000);
      alert('Deploy failed: ' + res.error);
    }
  });
}

// Set the shared map target from the Builder tab inputs (helps War Commander with probe targeting)
function setSharedMapTargetFromBuilder() {
  const xEl = el('builder-deploy-x');
  const yEl = el('builder-deploy-y');
  if (!xEl || !yEl) return;

  const x = parseInt(xEl.value) || 0;
  const y = parseInt(yEl.value) || 0;

  // Use the shared helper defined above
  if (typeof setMapTarget === 'function') {
    setMapTarget(x, y);
  } else {
    // Fallback: directly set the Map tab inputs
    const sharedX = el('deploy-x');
    const sharedY = el('deploy-y');
    if (sharedX) sharedX.value = x;
    if (sharedY) sharedY.value = y;
  }
}