// server/factories.js
// Deployable forward factories: moon-only placement, movement, setup, per-factory queues.

const FACTORY_DEPLOY_SPEED_TICKS = 8;
const FACTORY_SETUP_TIME_MS = 180000;
const MAX_FACTORIES_PER_MOON = 1;
const MAX_QUEUE_PER_FACTORY = 4;

const MOON_TYPES = new Set(['large_moon', 'small_moon', 'major_moon', 'normal_moon']);

function isMoonType(type) {
  return MOON_TYPES.has(type);
}

function getMoonAt(game, x, y) {
  if (!game.map?.anomalies) return null;
  const anom = game.map.anomalies.find(a => a.x === x && a.y === y);
  return anom && isMoonType(anom.type) ? anom : null;
}

function resolveMoonRef(game, x, y, targetObject = null) {
  if (targetObject) {
    const byId = game.map.anomalies.find(a =>
      (a.id === targetObject || a.name === targetObject) && isMoonType(a.type)
    );
    if (byId) return byId;
  }
  return getMoonAt(game, x, y);
}

function moonKey(moon) {
  if (!moon) return null;
  return moon.id || moon.name || `${moon.x},${moon.y}`;
}

function factoryOccupiesMoon(factory, moon) {
  if (!factory || !moon || factory.isHome) return false;
  const key = moonKey(moon);
  if (factory.targetObject && key && (factory.targetObject === moon.id || factory.targetObject === moon.name)) {
    return true;
  }
  if (factory.state === 'operational') {
    const here = getMoonAt(factory, factory.x, factory.y);
    return here && moonKey(here) === key;
  }
  if (factory.state === 'moving' || factory.state === 'setting_up') {
    if (factory.targetX === moon.x && factory.targetY === moon.y) return true;
  }
  return false;
}

function countFactoriesAtMoon(game, teamName, moon, excludeFactoryId = null) {
  return (game.factories || []).filter(f => {
    if (f.teamName !== teamName) return false;
    if (excludeFactoryId && f.id === excludeFactoryId) return false;
    return factoryOccupiesMoon(f, moon);
  }).length;
}

function getQueueDepth(q) {
  return (q.queue?.length || 0) + (q.current ? 1 : 0);
}

function syncBuildQueuesForTeam(team, game) {
  const operational = (game.factories || []).filter(f =>
    f.teamName === team.name && f.state === 'operational'
  );

  while (team.buildQueues.length < operational.length) {
    const factory = operational[team.buildQueues.length];
    team.buildQueues.push({
      factoryId: factory ? factory.id : 'home',
      queue: [],
      current: null
    });
  }

  if (team.buildQueues.length > operational.length) {
    team.buildQueues.length = operational.length;
  }

  for (let i = 0; i < operational.length; i++) {
    team.buildQueues[i].factoryId = operational[i].id;
  }
}

function findShortestBuildQueue(team, game) {
  syncBuildQueuesForTeam(team, game);

  let best = null;
  let bestDepth = Infinity;

  for (const q of team.buildQueues) {
    if ((q.queue?.length || 0) >= MAX_QUEUE_PER_FACTORY) continue;
    const depth = getQueueDepth(q);
    if (depth < bestDepth) {
      bestDepth = depth;
      best = q;
    }
  }

  return best;
}

function factoryLabelForQueue(game, teamName, factoryId) {
  const factory = (game.factories || []).find(f => f.id === factoryId && f.teamName === teamName);
  if (!factory) return factoryId === 'home' ? 'Home Base' : 'Forward Factory';
  if (factory.isHome) return 'Home Base';
  const moon = factory.targetObject
    ? game.map?.anomalies?.find(a => a.id === factory.targetObject || a.name === factory.targetObject)
    : getMoonAt(game, factory.x, factory.y);
  return moon?.name ? `Factory @ ${moon.name}` : `Factory @ (${factory.x},${factory.y})`;
}

function createDeployedFactory(game, teamName, targetX, targetY, targetObject = null) {
  const team = game.getTeamByName(teamName);
  if (!team || (team.availableFactories || 0) < 1) {
    return { ok: false, error: 'No factory kits available' };
  }
  if (!game.map?.starts) return { ok: false, error: 'Map not ready' };

  const size = game.mapSize || 13;
  const tx = Math.max(0, Math.min(size - 1, Math.floor(targetX)));
  const ty = Math.max(0, Math.min(size - 1, Math.floor(targetY)));

  const gas = game.map.gasGiant;
  if (gas && tx === gas.x && ty === gas.y) {
    return { ok: false, error: 'Cannot deploy to the gas giant' };
  }

  const moon = resolveMoonRef(game, tx, ty, targetObject);
  if (!moon) {
    return { ok: false, error: 'Factories can only be deployed to moons' };
  }

  if (countFactoriesAtMoon(game, teamName, moon) >= MAX_FACTORIES_PER_MOON) {
    return { ok: false, error: `This moon already has your factory (max ${MAX_FACTORIES_PER_MOON} per moon)` };
  }

  const start = game.map.starts[teamName] || { x: 1, y: 1 };
  team.availableFactories--;

  const factory = {
    id: 'factory-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    teamName,
    x: start.x,
    y: start.y,
    state: 'moving',
    targetX: moon.x,
    targetY: moon.y,
    targetObject: moon.id || moon.name,
    isHome: false,
    setupCompleteTime: null
  };

  game.factories.push(factory);
  game.addEvent(`[${teamName}] Builder deployed FACTORY KIT toward ${moon.name || `(${moon.x},${moon.y})`}`);
  return { ok: true, factory };
}

function moveFactory(game, teamName, factoryId, targetX, targetY, targetObject = null) {
  const factory = (game.factories || []).find(f => f.id === factoryId && f.teamName === teamName);
  if (!factory) return { ok: false, error: 'Factory not found or not yours' };
  if (factory.isHome) return { ok: false, error: 'Home base factory cannot be moved' };

  if (factory.state !== 'moving') {
    return { ok: false, error: 'Only en-route factory kits can be redirected' };
  }

  const size = game.mapSize || 13;
  const tx = Math.max(0, Math.min(size - 1, Math.floor(targetX)));
  const ty = Math.max(0, Math.min(size - 1, Math.floor(targetY)));

  const gas = game.map?.gasGiant;
  if (gas && tx === gas.x && ty === gas.y) {
    return { ok: false, error: 'Cannot move factory to the gas giant' };
  }

  const moon = resolveMoonRef(game, tx, ty, targetObject);
  if (!moon) {
    return { ok: false, error: 'Factories can only be deployed to moons' };
  }

  if (countFactoriesAtMoon(game, teamName, moon, factoryId) >= MAX_FACTORIES_PER_MOON) {
    return { ok: false, error: `That moon already has your factory (max ${MAX_FACTORIES_PER_MOON} per moon)` };
  }

  factory.targetX = moon.x;
  factory.targetY = moon.y;
  factory.targetObject = moon.id || moon.name;

  game.addEvent(`[${teamName}] Factory kit re-tasked to ${moon.name || `(${moon.x},${moon.y})`}`);
  return { ok: true, factory };
}

function processFactoryMovement(game, debugLog) {
  if (!game.map || !game.factories?.length) return;

  const size = game.mapSize || 13;
  const gasX = game.map.gasGiant ? game.map.gasGiant.x : Math.floor(size / 2);
  const gasY = game.map.gasGiant ? game.map.gasGiant.y : Math.floor(size / 2);
  const now = Date.now();

  for (const factory of game.factories) {
    if (factory.isHome || factory.state !== 'moving') continue;

    const shouldStep = (game.tickCounter % FACTORY_DEPLOY_SPEED_TICKS) === 0;
    if (!shouldStep) continue;

    let tx = factory.targetX != null ? factory.targetX : factory.x;
    let ty = factory.targetY != null ? factory.targetY : factory.y;

    if (factory.targetObject) {
      const targetAnom = (game.map.anomalies || []).find(a =>
        a.name === factory.targetObject || a.id === factory.targetObject
      );
      if (targetAnom) {
        tx = targetAnom.x;
        ty = targetAnom.y;
        factory.targetX = tx;
        factory.targetY = ty;
      }
    }

    if (factory.x === tx && factory.y === ty) {
      factory.state = 'setting_up';
      factory.setupCompleteTime = now + FACTORY_SETUP_TIME_MS;
      const label = factory.targetObject || `(${tx},${ty})`;
      game.addEvent(`[${factory.teamName}] Factory kit arrived at ${label} — setting up (3 min)`);
      if (debugLog) debugLog(game, `FACTORY ARRIVED: id=${factory.id} team=${factory.teamName} at=(${factory.x},${factory.y})`);
      continue;
    }

    const dx = tx - factory.x;
    const dy = ty - factory.y;
    let stepX = 0;
    let stepY = 0;
    if (Math.abs(dx) >= Math.abs(dy)) {
      stepX = Math.sign(dx);
    } else {
      stepY = Math.sign(dy);
    }

    let nx = factory.x + stepX;
    let ny = factory.y + stepY;

    if (nx === gasX && ny === gasY) {
      if (stepX !== 0) {
        ny = factory.y + Math.sign(dy);
        nx = factory.x;
      } else {
        nx = factory.x + Math.sign(dx);
        ny = factory.y;
      }
    }

    if (nx === gasX && ny === gasY) {
      nx = factory.x;
      ny = factory.y;
    }

    factory.x = Math.max(0, Math.min(size - 1, nx));
    factory.y = Math.max(0, Math.min(size - 1, ny));

    if (debugLog) {
      debugLog(game, `FACTORY STEP: id=${factory.id} team=${factory.teamName} to=(${factory.x},${factory.y}) target=(${tx},${ty})`);
    }
  }
}

function processFactorySetup(game, debugLog) {
  if (!game.factories?.length) return;
  const now = Date.now();

  for (const factory of game.factories) {
    if (factory.state !== 'setting_up' || !factory.setupCompleteTime) continue;
    if (now < factory.setupCompleteTime) continue;

    factory.state = 'operational';
    factory.setupCompleteTime = null;

    const team = game.getTeamByName(factory.teamName);
    if (team) syncBuildQueuesForTeam(team, game);

    const moon = factory.targetObject
      ? game.map?.anomalies?.find(a => a.id === factory.targetObject || a.name === factory.targetObject)
      : getMoonAt(game, factory.x, factory.y);
    const label = moon?.name || `(${factory.x},${factory.y})`;
    game.addEvent(`[${factory.teamName}] Factory operational at ${label} — new build queue online`);
    if (debugLog) debugLog(game, `FACTORY OPERATIONAL: id=${factory.id} team=${factory.teamName} at=${label}`);
  }
}

function serializeFactoryForClient(f, game) {
  const payload = {
    id: f.id,
    teamName: f.teamName,
    x: f.x,
    y: f.y,
    state: f.state,
    isHome: !!f.isHome
  };

  if (!f.isHome && (f.state === 'moving' || f.state === 'setting_up')) {
    payload.targetX = f.targetX;
    payload.targetY = f.targetY;
    payload.targetObject = f.targetObject || null;
  }

  if (f.state === 'setting_up' && f.setupCompleteTime) {
    payload.setupRemaining = Math.max(0, Math.ceil((f.setupCompleteTime - Date.now()) / 1000));
  }

  if (!f.isHome && f.targetObject) {
    const moon = game.map?.anomalies?.find(a => a.id === f.targetObject || a.name === f.targetObject);
    if (moon?.name) payload.moonName = moon.name;
  }

  return payload;
}

module.exports = {
  FACTORY_DEPLOY_SPEED_TICKS,
  FACTORY_SETUP_TIME_MS,
  MAX_FACTORIES_PER_MOON,
  MAX_QUEUE_PER_FACTORY,
  isMoonType,
  getMoonAt,
  createDeployedFactory,
  moveFactory,
  processFactoryMovement,
  processFactorySetup,
  findShortestBuildQueue,
  factoryLabelForQueue,
  syncBuildQueuesForTeam,
  serializeFactoryForClient
};