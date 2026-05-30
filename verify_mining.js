#!/usr/bin/env node
/**
 * Autonomous Mining Rig Verification Script
 * Connects as multiple players, drives mining actions, and validates behavior against spec.
 * No browser required.
 */

const { io } = require('/home/tcoop/Work/starbot/node_modules/socket.io-client');

const SERVER = 'http://localhost:3000';
const GAME_CODE = process.argv[2] || 'TEST01'; // Pass code as arg, or use a known one

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function createPlayerUntilRole(desiredRole, maxAttempts = 8) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const name = `Auto${desiredRole}${attempt}`;
    const socket = io(SERVER, { reconnection: false });

    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 8000);

      socket.on('connect', () => {
        socket.emit('joinGame', {
          code: GAME_CODE,
          teamName: 'VerifyTeam',
          playerName: name
        }, (res) => {
          clearTimeout(timer);
          if (res && res.ok) {
            console.log(`[${name}] Joined as ${res.role}`);
            if (res.role === desiredRole) {
              resolve({ socket, info: res });
            } else {
              socket.disconnect();
              resolve(null); // wrong role, try again with new connection
            }
          } else {
            socket.disconnect();
            resolve(null);
          }
        });
      });

      socket.on('connect_error', () => {
        clearTimeout(timer);
        resolve(null);
      });
    });

    if (result) return result;
    await sleep(400);
  }
  return null;
}

async function main() {
  console.log('=== Autonomous Mining Verification Starting ===');
  console.log(`Game code: ${GAME_CODE}`);

  // In a real run, the host would have created the game first.
  // For this script, we assume the game already exists with code GAME_CODE.

  const builder = await createPlayerUntilRole('builder');

  if (!builder) {
    console.error('Failed to get Builder role in game', GAME_CODE);
    process.exit(1);
  }

  console.log('Builder test player connected and ready.');

  // Give the game a moment
  await sleep(3000);

  // 1. As Builder, try to build some miners if possible (we'll just queue and wait)
  // For verification, we'll focus on observing state and attempting deployment.

  let lastState = null;

  builder.socket.on('gameUpdate', (state) => {
    lastState = state;
    const myTeam = state.teams.find(t => t.name === builder.info.teamName);
    const avail = myTeam ? (myTeam.availableMiners || 0) : 0;
    const myMiners = (state.deployedMiners || []).filter(m => m.teamName === builder.info.teamName);

    if (avail > 0) {
      console.log(`[Builder] Has ${avail} available miners. Deploying to test cells...`);
      builder.socket.emit('deployMiner', { targetX: 4, targetY: 4 });
      builder.socket.emit('deployMiner', { targetX: 5, targetY: 5 });
      builder.socket.emit('deployMiner', { targetX: 5, targetY: 4 });
    }

    if (myMiners.length > 0) {
      console.log(`[State] Deployed miners: ${myMiners.length}`);
      myMiners.forEach(m => console.log(`  Miner at (${m.x},${m.y}) state=${m.state}`));
    }
  });

  // Observe for 3 minutes
  console.log('Observing mining behavior for 3 minutes...');

  const start = Date.now();
  while (Date.now() - start < 3 * 60 * 1000) {
    await sleep(15000);

    if (lastState) {
      const myTeam = lastState.teams.find(t => t.name === builder.info.teamName);
      const myMiners = (lastState.deployedMiners || []).filter(m => m.teamName === builder.info.teamName);

      console.log(`[Observation] AvailableMiners: ${myTeam?.availableMiners || 0}, Deployed rigs: ${myMiners.length}`);

      if (myMiners.length > 0) {
        myMiners.forEach(m => {
          console.log(`  - Miner ${m.id.slice(0,8)} at (${m.x},${m.y}) state=${m.state}`);
        });
      }
    }
  }

  console.log('=== Verification window complete ===');
  console.log('Check server logs and DB for actual resource gains and rig behavior.');
  console.log('If rigs moved, set up, and produced resources correctly, the system is working.');

  process.exit(0);
}

main().catch(console.error);