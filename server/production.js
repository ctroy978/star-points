// server/production.js
// Extracted production / build queue system (including multi-factory queues and mineral synthesis).
// This module handles costs, times, queue processing, and passive synthesis from factories.

const RESOURCE_ORDER = [
  'Fused Xenon',
  'Helium-3 Lattice',
  'Quantite',
  'Plasma-Bound Carbon',
  'Antimatter Catalyst',
  'Neurocryst'
];

// Build costs for all producible items
const BUILD_COSTS = {
  frigate:   [4, 2, 0, 3, 0, 0],
  destroyer: [5, 3, 0, 4, 2, 0],
  miner:     [6, 4, 2, 5, 0, 1],
  probe:     [1, 1, 1, 0, 0, 1],
  factory:   [22, 16, 10, 14, 8, 6],
  admiral:   [10, 7, 5, 6, 4, 3],
  capitol:   [35, 24, 15, 20, 12, 9]
};

const BUILD_TIMES = {
  frigate: 38,
  destroyer: 42,
  miner: 55,
  probe: 18,
  factory: 180,
  admiral: 75,
  capitol: 240
};

const MAX_QUEUE_PER_FACTORY = 4;

// Mineral Synthesis rates (per operational factory, per cycle)
const FACTORY_SYNTHESIS_INTERVAL_TICKS = 60; // every 60 seconds
const FACTORY_SYNTHESIS_PER_FACTORY = {
  // Significantly increased baseline to allow building multiple things early
  // (in addition to active mining from rigs). This is the "permanent flow".
  'Fused Xenon': 8,
  'Helium-3 Lattice': 6,
  'Quantite': 3,
  'Plasma-Bound Carbon': 6,
  'Antimatter Catalyst': 2,
  'Neurocryst': 2
};

/**
 * Process all build queues for every team.
 * Supports multiple parallel queues (one per operational factory).
 */
function processBuilds(game) {
  for (const team of game.teams.values()) {
    if (team.factoryHP <= 0) continue;

    const operationalFactories = (game.factories || []).filter(f =>
      f.teamName === team.name && f.state === 'operational'
    );

    // Ensure correct number of queues
    while (team.buildQueues.length < operationalFactories.length) {
      const factory = operationalFactories[team.buildQueues.length];
      team.buildQueues.push({
        factoryId: factory ? factory.id : 'home',
        queue: [],
        current: null
      });
    }

    if (team.buildQueues.length > operationalFactories.length) {
      team.buildQueues.length = operationalFactories.length;
    }

    for (let i = 0; i < team.buildQueues.length; i++) {
      const q = team.buildQueues[i];
      let current = q.current;

      if (!current && q.queue.length > 0) {
        const nextType = q.queue.shift();
        const time = BUILD_TIMES[nextType] || 30;

        current = { type: nextType, remaining: time };
        q.current = current;

        const factoryLabel = operationalFactories[i]?.isHome ? 'Home Base' : 'Forward Factory';
        game.addEvent(`[${team.name}] Builder started ${nextType.toUpperCase()} at ${factoryLabel}`);
      }

      if (current) {
        current.remaining--;
        if (current.remaining <= 0) {
          // Complete the item
          if (current.type === 'frigate') team.frigates++;
          else if (current.type === 'destroyer') team.destroyers++;
          else if (current.type === 'miner') team.availableMiners = (team.availableMiners || 0) + 1;
          else if (current.type === 'probe') team.probes = (team.probes || 0) + 1;
          else if (current.type === 'factory') team.availableFactories = (team.availableFactories || 0) + 1;
          else if (current.type === 'admiral') team.availableAdmirals = (team.availableAdmirals || 0) + 1;
          else if (current.type === 'capitol') team.capitolShips = (team.capitolShips || 0) + 1;

          const factoryLabel = operationalFactories[i]?.isHome ? 'Home Base' : 'Forward Factory';
          game.addEvent(`[${team.name}] completed 1 ${current.type.toUpperCase()} at ${factoryLabel}`);
          q.current = null;
        }
      }
    }
  }
}

/**
 * Slow passive mineral synthesis from every operational factory.
 */
function processFactorySynthesis(game) {
  if (!game.factories || game.factories.length === 0) return;

  if (game.tickCounter % FACTORY_SYNTHESIS_INTERVAL_TICKS !== 0) return;

  const operationalCount = {};

  for (const f of game.factories) {
    if (f.state === 'operational') {
      operationalCount[f.teamName] = (operationalCount[f.teamName] || 0) + 1;
    }
  }

  for (const [teamName, count] of Object.entries(operationalCount)) {
    const team = game.getTeamByName(teamName);
    if (!team || team.factoryHP <= 0) continue;

    const gains = [];
    for (const [resource, perFactory] of Object.entries(FACTORY_SYNTHESIS_PER_FACTORY)) {
      const total = perFactory * count;
      if (total > 0) {
        team.resources[resource] = (team.resources[resource] || 0) + total;
        gains.push(`+${total} ${resource}`);
      }
    }

    if (gains.length > 0 && game.tickCounter % (FACTORY_SYNTHESIS_INTERVAL_TICKS * 3) === 0) {
      // Only debug log occasionally
      console.debug(`[SYNTHESIS] ${teamName} (${count} factories) → ${gains.join(', ')}`);
    }
  }
}

module.exports = {
  BUILD_COSTS,
  BUILD_TIMES,
  MAX_QUEUE_PER_FACTORY,
  processBuilds,
  processFactorySynthesis,
  FACTORY_SYNTHESIS_INTERVAL_TICKS,
  FACTORY_SYNTHESIS_PER_FACTORY
};
