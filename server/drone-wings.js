// server/drone-wings.js — deployable skirmish wings (harassment, not fleet replacement)

const mapFleets = require('./fleets');

const DRONE_SPEED_TICKS = 6;
const MAX_DEPLOYED_DRONE_WINGS = 2;
const DRONE_WING_START_HP = 12;
const DRONE_DAMAGE = 10;
const DRONE_FACTORY_SIEGE_DAMAGE = 5;
const DRONE_HOME_CHIP_DAMAGE = 3;
const MINER_DRONE_SIEGE_HP = 15;
const FORWARD_FACTORY_SIEGE_HP = 40;

function isAtPeace(team, otherTeamName) {
  if (!team || !otherTeamName) return false;
  return !!(team.peaceWith && team.peaceWith[otherTeamName]);
}

function countDeployedWings(game, teamName) {
  return (game.deployedDroneWings || []).filter(w =>
    w.teamName === teamName && (w.hp || 0) > 0
  ).length;
}

function applyDamageToWing(wing, damage) {
  wing.hp = Math.max(0, (wing.hp || DRONE_WING_START_HP) - Math.max(0, damage));
}

function removeWing(game, wing, reason) {
  game.deployedDroneWings = (game.deployedDroneWings || []).filter(w => w.id !== wing.id);
  game.addEvent(`[${wing.teamName}] Drone wing ${wing.id.slice(-6)} ${reason}`);
}

function removeEnemyForwardFactories(game, enemyTeamName, x, y, attackerLabel) {
  const factoriesToRemove = [];
  for (const fac of game.factories || []) {
    if (fac.teamName === enemyTeamName && fac.x === x && fac.y === y && !fac.isHome && fac.state === 'operational') {
      factoriesToRemove.push(fac.id);
      game.addEvent(`[${attackerLabel}] destroyed ${enemyTeamName} forward factory at (${x},${y})`);
    }
  }
  if (factoriesToRemove.length === 0) return;
  game.factories = game.factories.filter(f => !factoriesToRemove.includes(f.id));
  const enemy = game.getTeamByName(enemyTeamName);
  if (enemy) {
    const operational = game.factories.filter(f => f.teamName === enemyTeamName && f.state === 'operational');
    enemy.buildQueues = (enemy.buildQueues || []).slice(0, operational.length);
  }
}

function enemyDroneBlockingCell(game, wingTeam, x, y) {
  return (game.deployedDroneWings || []).some(w =>
    w.teamName !== wingTeam && w.x === x && w.y === y && (w.hp || 0) > 0
  );
}

function resolveDroneWingCombatAtCell(game, wing, x, y) {
  if ((wing.hp || 0) <= 0) return;

  const attackerTeam = game.getTeamByName(wing.teamName);
  if (!attackerTeam || attackerTeam.factoryHP <= 0) return;

  const enemyDrones = (game.deployedDroneWings || []).filter(w =>
    w.teamName !== wing.teamName && w.x === x && w.y === y && (w.hp || 0) > 0
  );

  for (const enemyWing of enemyDrones) {
    if (isAtPeace(attackerTeam, enemyWing.teamName)) continue;
    const defenderTeam = game.getTeamByName(enemyWing.teamName);
    if (defenderTeam && !isAtPeace(defenderTeam, wing.teamName)) {
      applyDamageToWing(wing, DRONE_DAMAGE);
      applyDamageToWing(enemyWing, DRONE_DAMAGE);
      game.addEvent(`[${wing.teamName}] Drone wing engaged ${enemyWing.teamName} drone at (${x},${y})`);
      if ((wing.hp || 0) <= 0) {
        removeWing(game, wing, 'destroyed in drone combat');
        return;
      }
      if ((enemyWing.hp || 0) <= 0) {
        removeWing(game, enemyWing, 'destroyed in drone combat');
      }
    } else {
      applyDamageToWing(enemyWing, DRONE_DAMAGE);
      game.addEvent(`[${wing.teamName}] Drone wing attacked ${enemyWing.teamName} drone at (${x},${y})`);
      if ((enemyWing.hp || 0) <= 0) {
        removeWing(game, enemyWing, 'destroyed in drone combat');
      }
    }
    return;
  }

  const enemyTeams = new Set();
  for (const m of game.deployedMiners || []) {
    if (m.teamName !== wing.teamName && m.x === x && m.y === y) enemyTeams.add(m.teamName);
  }
  for (const fac of game.factories || []) {
    if (fac.teamName !== wing.teamName && fac.x === x && fac.y === y && fac.state === 'operational') {
      enemyTeams.add(fac.teamName);
    }
  }
  for (const ef of game.deployedFleets || []) {
    if (ef.teamName !== wing.teamName && ef.x === x && ef.y === y) enemyTeams.add(ef.teamName);
  }
  if (game.map?.starts) {
    for (const [tName, pos] of Object.entries(game.map.starts)) {
      if (tName !== wing.teamName && pos.x === x && pos.y === y) enemyTeams.add(tName);
    }
  }

  for (const enemyTeamName of enemyTeams) {
    if (isAtPeace(attackerTeam, enemyTeamName)) continue;
    if (enemyDroneBlockingCell(game, wing.teamName, x, y)) continue;

    const enemyFleets = (game.deployedFleets || []).filter(ef =>
      ef.teamName === enemyTeamName && ef.x === x && ef.y === y
    );
    if (enemyFleets.length > 0) {
      for (const ef of enemyFleets) {
        const enemyTeam = game.getTeamByName(enemyTeamName);
        const power = mapFleets.fleetFirepower(ef);
        if (enemyTeam && !isAtPeace(enemyTeam, wing.teamName)) {
          mapFleets.applyDamageToFleet(ef, DRONE_DAMAGE);
          applyDamageToWing(wing, power);
          game.addEvent(`[${wing.teamName}] Drone wing engaged fleet "${ef.admiralName}" at (${x},${y})`);
          if ((ef.frigates || 0) + (ef.destroyers || 0) === 0 || (ef.capitolHP || 0) <= 0) {
            mapFleets.removeFleet(game, ef, 'destroyed in combat');
          }
        } else {
          mapFleets.applyDamageToFleet(ef, DRONE_DAMAGE);
          game.addEvent(`[${wing.teamName}] Drone wing struck fleet "${ef.admiralName}" at (${x},${y})`);
          if ((ef.frigates || 0) + (ef.destroyers || 0) === 0 || (ef.capitolHP || 0) <= 0) {
            mapFleets.removeFleet(game, ef, 'destroyed in combat');
          }
        }
        if ((wing.hp || 0) <= 0) {
          removeWing(game, wing, 'destroyed in combat');
          return;
        }
      }
      continue;
    }

    const minersHere = (game.deployedMiners || []).filter(m =>
      m.teamName === enemyTeamName && m.x === x && m.y === y
    );
    if (minersHere.length > 0) {
      const toRemove = [];
      for (const miner of minersHere) {
        if (miner.droneSiegeHP == null) miner.droneSiegeHP = MINER_DRONE_SIEGE_HP;
        miner.droneSiegeHP -= DRONE_DAMAGE;
        if (miner.droneSiegeHP <= 0) {
          toRemove.push(miner.id);
          game.addEvent(`[${wing.teamName}] Drone wing destroyed ${enemyTeamName} mining rig at (${x},${y})`);
        }
      }
      if (toRemove.length > 0) {
        game.deployedMiners = game.deployedMiners.filter(m => !toRemove.includes(m.id));
      }
      continue;
    }

    for (const fac of game.factories || []) {
      if (fac.teamName !== enemyTeamName || fac.x !== x || fac.y !== y || fac.isHome || fac.state !== 'operational') {
        continue;
      }
      if (fac.siegeHP == null) fac.siegeHP = FORWARD_FACTORY_SIEGE_HP;
      fac.siegeHP -= DRONE_FACTORY_SIEGE_DAMAGE;
      game.addEvent(`[${wing.teamName}] Drone wing sieging ${enemyTeamName} factory at (${x},${y}) (${Math.max(0, fac.siegeHP)} HP left)`);
      if (fac.siegeHP <= 0) {
        removeEnemyForwardFactories(game, enemyTeamName, x, y, wing.teamName);
      }
      continue;
    }

    const start = game.map.starts?.[enemyTeamName];
    if (start && start.x === x && start.y === y) {
      const defender = game.getTeamByName(enemyTeamName);
      if (defender && defender.factoryHP > 0) {
        defender.factoryHP = Math.max(0, defender.factoryHP - DRONE_HOME_CHIP_DAMAGE);
        game.addEvent(`[${wing.teamName}] Drone wing chipped ${enemyTeamName} home base for ${DRONE_HOME_CHIP_DAMAGE} damage`);
      }
    }
  }
}

function deployDroneWing(game, teamName, x, y) {
  const team = game.getTeamByName(teamName);
  if (!team) return { ok: false, error: 'Team not found' };
  if (!game.map?.starts) return { ok: false, error: 'Map not ready' };
  if ((team.droneWings || 0) < 1) {
    return { ok: false, error: 'No drone wings in stock — Builder can queue DRONE WING' };
  }
  if (countDeployedWings(game, teamName) >= MAX_DEPLOYED_DRONE_WINGS) {
    return { ok: false, error: `Max ${MAX_DEPLOYED_DRONE_WINGS} drone wings on map` };
  }

  const size = game.mapSize || 13;
  const tx = Math.max(0, Math.min(size - 1, Math.floor(x)));
  const ty = Math.max(0, Math.min(size - 1, Math.floor(y)));
  const gas = game.map?.gasGiant;
  if (gas && tx === gas.x && ty === gas.y) {
    return { ok: false, error: 'Cannot deploy to the gas giant' };
  }

  const start = game.map.starts[teamName] || { x: 1, y: 1 };
  team.droneWings--;

  const wing = {
    id: 'wing-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
    teamName,
    x: start.x,
    y: start.y,
    state: 'moving',
    targetX: tx,
    targetY: ty,
    hp: DRONE_WING_START_HP
  };

  if (!game.deployedDroneWings) game.deployedDroneWings = [];
  game.deployedDroneWings.push(wing);
  game.addEvent(`[${teamName}] War Commander deployed drone wing toward (${tx},${ty})`);
  return { ok: true, wing };
}

function orderDroneWingMove(game, teamName, wingId, targetX, targetY) {
  const wing = (game.deployedDroneWings || []).find(w => w.id === wingId && w.teamName === teamName);
  if (!wing || (wing.hp || 0) <= 0) return { ok: false, error: 'Drone wing not found or destroyed' };

  const size = game.mapSize || 13;
  const tx = Math.max(0, Math.min(size - 1, Math.floor(targetX)));
  const ty = Math.max(0, Math.min(size - 1, Math.floor(targetY)));
  const gas = game.map?.gasGiant;
  if (gas && tx === gas.x && ty === gas.y) {
    return { ok: false, error: 'Cannot order drone wing to the gas giant' };
  }

  wing.targetX = tx;
  wing.targetY = ty;
  if (wing.state === 'stationed') wing.state = 'moving';
  game.addEvent(`[${teamName}] Drone wing re-tasked to (${tx},${ty})`);
  return { ok: true, wing };
}

function processDroneWingMovement(game, debugLog) {
  if (!game.deployedDroneWings?.length || !game.map) return;

  const size = game.mapSize || 13;
  const gasX = game.map.gasGiant ? game.map.gasGiant.x : Math.floor(size / 2);
  const gasY = game.map.gasGiant ? game.map.gasGiant.y : Math.floor(size / 2);

  for (const wing of [...game.deployedDroneWings]) {
    if ((wing.hp || 0) <= 0) continue;

    if (wing.state !== 'moving') {
      resolveDroneWingCombatAtCell(game, wing, wing.x, wing.y);
      continue;
    }

    if ((game.tickCounter % DRONE_SPEED_TICKS) !== 0) continue;

    const tx = wing.targetX != null ? wing.targetX : wing.x;
    const ty = wing.targetY != null ? wing.targetY : wing.y;

    if (wing.x === tx && wing.y === ty) {
      wing.state = 'stationed';
      game.addEvent(`[${wing.teamName}] Drone wing on station at (${tx},${ty})`);
      resolveDroneWingCombatAtCell(game, wing, wing.x, wing.y);
      continue;
    }

    const dx = tx - wing.x;
    const dy = ty - wing.y;
    let stepX = 0;
    let stepY = 0;
    if (Math.abs(dx) >= Math.abs(dy)) stepX = Math.sign(dx);
    else stepY = Math.sign(dy);

    let nx = wing.x + stepX;
    let ny = wing.y + stepY;

    if (nx === gasX && ny === gasY) {
      if (stepX !== 0) { ny = wing.y + Math.sign(dy); nx = wing.x; }
      else { nx = wing.x + Math.sign(dx); ny = wing.y; }
    }
    if (nx === gasX && ny === gasY) { nx = wing.x; ny = wing.y; }

    wing.x = Math.max(0, Math.min(size - 1, nx));
    wing.y = Math.max(0, Math.min(size - 1, ny));

    resolveDroneWingCombatAtCell(game, wing, wing.x, wing.y);
    if (debugLog) debugLog(game, `DRONE WING STEP: id=${wing.id} team=${wing.teamName} to=(${wing.x},${wing.y})`);
  }

  game.deployedDroneWings = (game.deployedDroneWings || []).filter(w => (w.hp || 0) > 0);
}

function serializeDroneWingForClient(w) {
  return {
    id: w.id,
    teamName: w.teamName,
    x: w.x,
    y: w.y,
    state: w.state,
    targetX: w.targetX,
    targetY: w.targetY,
    hp: w.hp || 0
  };
}

module.exports = {
  DRONE_SPEED_TICKS,
  MAX_DEPLOYED_DRONE_WINGS,
  DRONE_WING_START_HP,
  deployDroneWing,
  orderDroneWingMove,
  processDroneWingMovement,
  resolveDroneWingCombatAtCell,
  applyDamageToWing,
  removeWing,
  serializeDroneWingForClient,
  FORWARD_FACTORY_SIEGE_HP
};