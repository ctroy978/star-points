// server/fleets.js
// Map fleets: commission, movement, peace flags, and combat.

const visibility = require('./visibility');

const FLEET_SPEED_TICKS = 10;
const FLEET_VISIBILITY_RADIUS = visibility.FLEET_VISION_RADIUS;
const MAX_ESCORTS_PER_FLEET = 6;
const CAPITOL_START_HP = 100;
const FRIGATE_DAMAGE = 7;
const DESTROYER_DAMAGE = 14;

const ADMIRAL_NAME_POOL = [
  'Elena Voss', 'Marcus Hale', 'Soren Kade', 'Lira Solene',
  'Tomas Vek', 'Nyra Quinn', 'Orin Ash', 'Cassian Morrow'
];

function createAdmiralEntry() {
  const name = ADMIRAL_NAME_POOL[Math.floor(Math.random() * ADMIRAL_NAME_POOL.length)];
  return {
    id: 'adm-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    name
  };
}

function manhattan(x1, y1, x2, y2) {
  return Math.abs(x1 - x2) + Math.abs(y1 - y2);
}

function isAtPeace(team, otherTeamName) {
  if (!team || !otherTeamName) return false;
  return !!(team.peaceWith && team.peaceWith[otherTeamName]);
}

function getEscortsCommitted(game, teamName) {
  let frigates = 0;
  let destroyers = 0;
  for (const f of game.deployedFleets || []) {
    if (f.teamName !== teamName) continue;
    frigates += f.frigates || 0;
    destroyers += f.destroyers || 0;
  }
  return { frigates, destroyers };
}

function getAvailableEscorts(team, game) {
  const used = getEscortsCommitted(game, team.name);
  return {
    frigates: Math.max(0, (team.frigates || 0) - used.frigates),
    destroyers: Math.max(0, (team.destroyers || 0) - used.destroyers)
  };
}

function getDeployedFleetCount(game, teamName) {
  return (game.deployedFleets || []).filter(f => f.teamName === teamName).length;
}

function getAvailableCapitols(team, game) {
  return Math.max(0, (team.capitolShips || 0) - getDeployedFleetCount(game, team.name));
}

function fleetFirepower(fleet) {
  return (fleet.frigates || 0) * FRIGATE_DAMAGE + (fleet.destroyers || 0) * DESTROYER_DAMAGE;
}

function commissionFleet(game, teamName, admiralId, frigates, destroyers) {
  const team = game.getTeamByName(teamName);
  if (!team) return { ok: false, error: 'Team not found' };
  if (!game.map?.starts) return { ok: false, error: 'Map not ready' };

  if (getAvailableCapitols(team, game) < 1) {
    return { ok: false, error: 'No Capitol hull available' };
  }

  const roster = team.admiralRoster || [];
  const admiral = roster.find(a => a.id === admiralId);
  if (!admiral) return { ok: false, error: 'Select an available Admiral' };

  const escorts = getAvailableEscorts(team, game);
  const f = Math.max(0, Math.floor(frigates || 0));
  const d = Math.max(0, Math.floor(destroyers || 0));
  const total = f + d;

  if (total < 1) return { ok: false, error: 'Assign at least 1 escort' };
  if (total > MAX_ESCORTS_PER_FLEET) {
    return { ok: false, error: `Max ${MAX_ESCORTS_PER_FLEET} escorts per fleet` };
  }
  if (f > escorts.frigates || d > escorts.destroyers) {
    return { ok: false, error: 'Not enough unassigned escorts' };
  }

  const start = game.map.starts[teamName] || { x: 1, y: 1 };
  team.admiralRoster = roster.filter(a => a.id !== admiralId);
  team.availableAdmirals = team.admiralRoster.length;

  const fleet = {
    id: 'fleet-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    teamName,
    admiralId: admiral.id,
    admiralName: admiral.name,
    x: start.x,
    y: start.y,
    state: 'stationed',
    targetX: start.x,
    targetY: start.y,
    frigates: f,
    destroyers: d,
    capitolHP: CAPITOL_START_HP
  };

  if (!game.deployedFleets) game.deployedFleets = [];
  game.deployedFleets.push(fleet);
  game.addEvent(`[${teamName}] Fleet "${admiral.name}" commissioned (${f} F, ${d} D) at home base`);
  return { ok: true, fleet };
}

function orderFleetMove(game, teamName, fleetId, targetX, targetY) {
  const fleet = (game.deployedFleets || []).find(f => f.id === fleetId && f.teamName === teamName);
  if (!fleet) return { ok: false, error: 'Fleet not found or not yours' };

  const size = game.mapSize || 13;
  const tx = Math.max(0, Math.min(size - 1, Math.floor(targetX)));
  const ty = Math.max(0, Math.min(size - 1, Math.floor(targetY)));

  const gas = game.map?.gasGiant;
  if (gas && tx === gas.x && ty === gas.y) {
    return { ok: false, error: 'Cannot order fleet to the gas giant' };
  }

  if (fleet.state === 'moving') {
    fleet.targetX = tx;
    fleet.targetY = ty;
    game.addEvent(`[${teamName}] Fleet "${fleet.admiralName}" re-tasked to (${tx},${ty})`);
    return { ok: true, fleet };
  }

  if (fleet.state === 'stationed') {
    fleet.targetX = tx;
    fleet.targetY = ty;
    fleet.state = 'moving';
    game.addEvent(`[${teamName}] Fleet "${fleet.admiralName}" ordered to (${tx},${ty})`);
    return { ok: true, fleet };
  }

  return { ok: false, error: 'Fleet cannot move right now' };
}

function setPeaceWith(game, teamName, targetTeam, atPeace) {
  const team = game.getTeamByName(teamName);
  if (!team) return { ok: false, error: 'Team not found' };
  if (!game.getTeamByName(targetTeam)) return { ok: false, error: 'Target team not found' };
  if (teamName === targetTeam) return { ok: false, error: 'Cannot set peace with your own team' };

  if (!team.peaceWith) team.peaceWith = {};
  if (atPeace) {
    team.peaceWith[targetTeam] = true;
    game.addEvent(`[${teamName}] War Commander declared PEACE with ${targetTeam} (fleets will not auto-attack)`);
  } else {
    delete team.peaceWith[targetTeam];
    game.addEvent(`[${teamName}] War Commander ended peace with ${targetTeam}`);
  }
  return { ok: true };
}

function applyDamageToFleet(fleet, damage) {
  let remaining = damage;
  while (remaining > 0 && (fleet.destroyers > 0 || fleet.frigates > 0)) {
    if (fleet.destroyers > 0) {
      fleet.destroyers--;
      remaining -= DESTROYER_DAMAGE;
    } else if (fleet.frigates > 0) {
      fleet.frigates--;
      remaining -= FRIGATE_DAMAGE;
    }
  }
  fleet.capitolHP = Math.max(0, (fleet.capitolHP || CAPITOL_START_HP) - Math.max(0, remaining));
}

function removeFleet(game, fleet, reason) {
  const team = game.getTeamByName(fleet.teamName);
  if (team) {
    team.capitolShips = (team.capitolShips || 0);
  }
  game.deployedFleets = (game.deployedFleets || []).filter(f => f.id !== fleet.id);
  game.addEvent(`[${fleet.teamName}] Fleet "${fleet.admiralName}" ${reason}`);
}

function resolveFleetCombatAtCell(game, fleet, x, y) {
  const attackerTeam = game.getTeamByName(fleet.teamName);
  if (!attackerTeam || attackerTeam.factoryHP <= 0) return;

  const enemies = new Set();

  for (const m of game.deployedMiners || []) {
    if (m.teamName !== fleet.teamName && m.x === x && m.y === y) enemies.add(m.teamName);
  }
  for (const fac of game.factories || []) {
    if (fac.teamName !== fleet.teamName && fac.x === x && fac.y === y && fac.state === 'operational') {
      enemies.add(fac.teamName);
    }
  }
  for (const ef of game.deployedFleets || []) {
    if (ef.teamName !== fleet.teamName && ef.id !== fleet.id && ef.x === x && ef.y === y) {
      enemies.add(ef.teamName);
    }
  }
  if (game.map?.starts) {
    for (const [tName, pos] of Object.entries(game.map.starts)) {
      if (tName !== fleet.teamName && pos.x === x && pos.y === y) enemies.add(tName);
    }
  }

  for (const enemyTeamName of enemies) {
    if (isAtPeace(attackerTeam, enemyTeamName)) continue;

    const power = fleetFirepower(fleet);
    if (power <= 0 && (fleet.capitolHP || 0) <= 0) continue;

    game.deployedMiners = (game.deployedMiners || []).filter(m => {
      if (m.teamName === enemyTeamName && m.x === x && m.y === y) {
        game.addEvent(`[${fleet.teamName}] Fleet "${fleet.admiralName}" destroyed ${enemyTeamName} mining rig at (${x},${y})`);
        return false;
      }
      return true;
    });

    const factoriesToRemove = [];
    for (const fac of game.factories || []) {
      if (fac.teamName === enemyTeamName && fac.x === x && fac.y === y && !fac.isHome && fac.state === 'operational') {
        factoriesToRemove.push(fac.id);
        game.addEvent(`[${fleet.teamName}] Fleet "${fleet.admiralName}" destroyed ${enemyTeamName} forward factory at (${x},${y})`);
      }
    }
    if (factoriesToRemove.length > 0) {
      game.factories = game.factories.filter(f => !factoriesToRemove.includes(f.id));
      const enemy = game.getTeamByName(enemyTeamName);
      if (enemy) {
        const operational = game.factories.filter(f => f.teamName === enemyTeamName && f.state === 'operational');
        enemy.buildQueues = (enemy.buildQueues || []).slice(0, operational.length);
      }
    }

    const enemyDroneWings = (game.deployedDroneWings || []).filter(w =>
      w.teamName === enemyTeamName && w.x === x && w.y === y && (w.hp || 0) > 0
    );
    if (enemyDroneWings.length > 0) {
      const droneWings = require('./drone-wings');
      for (const dw of enemyDroneWings) {
        droneWings.applyDamageToWing(dw, Math.max(FRIGATE_DAMAGE, power));
        game.addEvent(`[${fleet.teamName}] Fleet "${fleet.admiralName}" engaged ${enemyTeamName} drone wing at (${x},${y})`);
        if ((dw.hp || 0) <= 0) {
          droneWings.removeWing(game, dw, 'destroyed by fleet');
        }
      }
    }

    const enemyFleets = (game.deployedFleets || []).filter(ef =>
      ef.teamName === enemyTeamName && ef.x === x && ef.y === y && ef.id !== fleet.id
    );
    for (const ef of enemyFleets) {
      const enemyTeam = game.getTeamByName(enemyTeamName);
      if (enemyTeam && !isAtPeace(enemyTeam, fleet.teamName)) {
        const counter = fleetFirepower(ef);
        applyDamageToFleet(fleet, counter);
        applyDamageToFleet(ef, power);
        game.addEvent(`[${fleet.teamName}] Fleet "${fleet.admiralName}" engaged ${ef.admiralName} at (${x},${y})`);
        if ((ef.frigates || 0) + (ef.destroyers || 0) === 0 || (ef.capitolHP || 0) <= 0) {
          removeFleet(game, ef, 'destroyed in combat');
        }
      } else {
        applyDamageToFleet(ef, power);
        game.addEvent(`[${fleet.teamName}] Fleet "${fleet.admiralName}" attacked ${ef.admiralName} at (${x},${y})`);
        if ((ef.frigates || 0) + (ef.destroyers || 0) === 0 || (ef.capitolHP || 0) <= 0) {
          removeFleet(game, ef, 'destroyed in combat');
        }
      }
      if ((fleet.frigates || 0) + (fleet.destroyers || 0) === 0 || (fleet.capitolHP || 0) <= 0) {
        removeFleet(game, fleet, 'destroyed in combat');
        return;
      }
    }

    const start = game.map.starts?.[enemyTeamName];
    if (start && start.x === x && start.y === y) {
      const defender = game.getTeamByName(enemyTeamName);
      if (defender && defender.factoryHP > 0) {
        const dmg = Math.max(FRIGATE_DAMAGE, power);
        defender.factoryHP = Math.max(0, defender.factoryHP - dmg);
        game.addEvent(`[${fleet.teamName}] Fleet "${fleet.admiralName}" struck ${enemyTeamName} home base for ${dmg} damage`);
      }
    }
  }
}

function processFleetMovement(game, debugLog) {
  if (!game.deployedFleets?.length || !game.map) return;

  const size = game.mapSize || 13;
  const gasX = game.map.gasGiant ? game.map.gasGiant.x : Math.floor(size / 2);
  const gasY = game.map.gasGiant ? game.map.gasGiant.y : Math.floor(size / 2);

  for (const fleet of game.deployedFleets) {
    if (fleet.state !== 'moving') {
      resolveFleetCombatAtCell(game, fleet, fleet.x, fleet.y);
      continue;
    }

    const shouldStep = (game.tickCounter % FLEET_SPEED_TICKS) === 0;
    if (!shouldStep) continue;

    const tx = fleet.targetX != null ? fleet.targetX : fleet.x;
    const ty = fleet.targetY != null ? fleet.targetY : fleet.y;

    if (fleet.x === tx && fleet.y === ty) {
      fleet.state = 'stationed';
      game.addEvent(`[${fleet.teamName}] Fleet "${fleet.admiralName}" on station at (${tx},${ty})`);
      resolveFleetCombatAtCell(game, fleet, fleet.x, fleet.y);
      continue;
    }

    const dx = tx - fleet.x;
    const dy = ty - fleet.y;
    let stepX = 0;
    let stepY = 0;
    if (Math.abs(dx) >= Math.abs(dy)) stepX = Math.sign(dx);
    else stepY = Math.sign(dy);

    let nx = fleet.x + stepX;
    let ny = fleet.y + stepY;

    if (nx === gasX && ny === gasY) {
      if (stepX !== 0) { ny = fleet.y + Math.sign(dy); nx = fleet.x; }
      else { nx = fleet.x + Math.sign(dx); ny = fleet.y; }
    }
    if (nx === gasX && ny === gasY) { nx = fleet.x; ny = fleet.y; }

    fleet.x = Math.max(0, Math.min(size - 1, nx));
    fleet.y = Math.max(0, Math.min(size - 1, ny));

    resolveFleetCombatAtCell(game, fleet, fleet.x, fleet.y);
    if (debugLog) debugLog(game, `FLEET STEP: ${fleet.admiralName} to (${fleet.x},${fleet.y})`);
  }

  game.deployedFleets = (game.deployedFleets || []).filter(f =>
    ((f.frigates || 0) + (f.destroyers || 0) > 0) && (f.capitolHP || 0) > 0
  );
}

function serializeDeployedFleetForClient(f) {
  return {
    id: f.id,
    teamName: f.teamName,
    admiralId: f.admiralId,
    admiralName: f.admiralName,
    x: f.x,
    y: f.y,
    state: f.state,
    targetX: f.targetX,
    targetY: f.targetY,
    frigates: f.frigates || 0,
    destroyers: f.destroyers || 0,
    capitolHP: f.capitolHP || 0,
    escortTotal: (f.frigates || 0) + (f.destroyers || 0)
  };
}

module.exports = {
  FLEET_SPEED_TICKS,
  FLEET_VISIBILITY_RADIUS,
  MAX_ESCORTS_PER_FLEET,
  FRIGATE_DAMAGE,
  DESTROYER_DAMAGE,
  createAdmiralEntry,
  getEscortsCommitted,
  getAvailableEscorts,
  getAvailableCapitols,
  fleetFirepower,
  applyDamageToFleet,
  removeFleet,
  getVisionCells: visibility.getVisionCells,
  filterVisibleMiners: visibility.filterVisibleMiners,
  filterVisibleFactories: visibility.filterVisibleFactories,
  filterVisibleDeployedFleets: visibility.filterVisibleDeployedFleets,
  commissionFleet,
  orderFleetMove,
  setPeaceWith,
  processFleetMovement,
  serializeDeployedFleetForClient
};