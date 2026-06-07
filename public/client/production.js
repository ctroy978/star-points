// public/client/production.js
// Client-side production and resource display helpers (lightweight extraction)

// Client mirror of synthesis rates for live UI display
window.CLIENT_FACTORY_SYNTHESIS = {
  'Fused Xenon': 8,
  'Helium-3 Lattice': 6,
  'Quantite': 3,
  'Plasma-Bound Carbon': 6,
  'Antimatter Catalyst': 2,
  'Neurocryst': 2
};

window.CLIENT_SYNTHESIS_INTERVAL_SECONDS = 60;

/**
 * Render the build queue/status area, supporting multiple factories.
 */
function renderBuildQueue(state, myTeamName) {
  const container = window.el('build-status');
  const myBuild = state.builds && state.builds[myTeamName];
  if (!myBuild) {
    container.innerHTML = '<span style="color:#006633">No build data</span>';
    return;
  }

  let html = '';

  const queues = myBuild.queues || [];

  if (queues.length > 0) {
    queues.forEach((q, idx) => {
      const label = q.factoryId === 'home' ? 'Home Factory' : `Factory #${idx + 1}`;
      if (q.current) {
        html += `<strong>${label}:</strong> ${q.current.type.toUpperCase()} — ${q.current.remaining}s<br>`;
      } else {
        html += `<span style="color:#006633">${label} idle</span><br>`;
      }
      if (q.queue && q.queue.length > 0) {
        html += `&nbsp;&nbsp;Queued:<br>`;
        q.queue.forEach((itemType, pos) => {
          html += `&nbsp;&nbsp;&nbsp;&nbsp;${itemType.toUpperCase()} `;
          html += `<button class="btn btn-tiny" onclick="cancelQueuedBuild(${idx}, ${pos})" style="padding:0 4px; font-size:8px; margin-left:2px;">X</button><br>`;
        });
      }
    });
  } else {
    // Legacy fallback
    if (myBuild.current) {
      html += `<strong>BUILDING:</strong> ${myBuild.current.type.toUpperCase()} — ${myBuild.current.remaining}s left<br>`;
    } else {
      html += `<span style="color:#006633">Factory idle</span><br>`;
    }
    if (myBuild.queue && myBuild.queue.length > 0) {
      html += `<strong>QUEUED:</strong><br>`;
      myBuild.queue.forEach((itemType, pos) => {
        html += `&nbsp;&nbsp;${itemType.toUpperCase()} `;
        html += `<button class="btn btn-tiny" onclick="cancelQueuedBuild(0, ${pos})" style="padding:0 4px; font-size:8px; margin-left:2px;">X</button><br>`;
      });
    } else {
      html += `<span style="color:#006633">Queue empty</span>`;
    }
  }

  container.innerHTML = html;
}

/**
 * Enhanced resource balances display with live synthesis rates.
 * Supports optional cost preview (negative deltas) when hovering build buttons.
 */
function renderResourceBalances(teamData) {
  const container = window.el('resource-balances');
  if (!container) return;

  const resourceNames = [
    'Fused Xenon',
    'Helium-3 Lattice',
    'Quantite',
    'Plasma-Bound Carbon',
    'Antimatter Catalyst',
    'Neurocryst'
  ];

  let html = '';

  if (teamData && Array.isArray(teamData.resourcesArray)) {
    for (let i = 0; i < 6; i++) {
      const label = resourceNames[i];
      const val = teamData.resourcesArray[i] ?? 0;
      html += `<div><span style="color:#006633">${label}:</span> <strong>${val}</strong></div>`;
    }
  } else if (teamData && teamData.resources && typeof teamData.resources === 'object') {
    const order = resourceNames;
    for (let i = 0; i < 6; i++) {
      const label = order[i];
      const val = teamData.resources[label] ?? 0;
      html += `<div><span style="color:#006633">${label}:</span> <strong>${val}</strong></div>`;
    }
  } else {
    for (let i = 0; i < 6; i++) {
      const label = resourceNames[i];
      html += `<div><span style="color:#006633">${label}:</span> <strong>0</strong></div>`;
    }
  }

  container.innerHTML = html;

  // Synthesis indicator
  const synthDiv = document.createElement('div');
  synthDiv.style.cssText = 'margin-top:6px; font-size:10px; color:#006633; border-top:1px dotted #003322; padding-top:4px;';

  let operationalFactories = 0;
  if (window.lastState && window.lastState.factories && window.lastState.myTeam) {
    operationalFactories = window.lastState.factories.filter(f =>
      f.teamName === window.lastState.myTeam && f.state === 'operational'
    ).length;
  }

  // Robust fallback
  if (operationalFactories === 0 && teamData) {
    operationalFactories = 1; // home factory baseline
  }

  if (operationalFactories > 0) {
    const synthLines = Object.entries(window.CLIENT_FACTORY_SYNTHESIS || {})
      .filter(([_, amt]) => amt > 0)
      .map(([name, amt]) => `+${amt * operationalFactories} ${name}`)
      .join(', ');

    synthDiv.innerHTML = `
      <span style="color:#88aa99">Mineral Synthesis:</span> 
      <strong>${synthLines}</strong> 
      <span style="color:#005533">/min (${operationalFactories} factory${operationalFactories > 1 ? 'ies' : ''})</span>
      <div style="font-size:9px; color:#004422; margin-top:1px;">
        Slow passive production from your operational factories
      </div>
    `;
  } else {
    synthDiv.innerHTML = `
      <span style="color:#664400">Mineral Synthesis active from home factory (baseline income).</span>
    `;
  }

  container.appendChild(synthDiv);
}

// queueBuild is defined in the main index.html with improved non-blocking warning.
// We expose the render functions here.
window.renderBuildQueue = renderBuildQueue;
window.renderResourceBalances = renderResourceBalances;

/**
 * Cancel a queued build item.
 * @param {number} queueIndex - which factory's queue (0 = home, etc.)
 * @param {number} position - index within that queue's array
 */
function cancelQueuedBuild(queueIndex, position) {
  if (!window.socket) return;

  window.socket.emit('cancelQueuedBuild', { queueIndex, position }, (res) => {
    if (res && !res.ok && res.error) alert(res.error);
  });
}

window.cancelQueuedBuild = cancelQueuedBuild;
