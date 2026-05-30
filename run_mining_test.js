#!/usr/bin/env node
/**
 * Autonomous Mining Test Runner
 * - Creates a game via socket as host
 * - Launches several starbot instances against it
 * - Monitors for mining-related activity
 */

const { io } = require('/home/tcoop/Work/starbot/node_modules/socket.io-client');
const { spawn } = require('child_process');
const path = require('path');

const SERVER = 'http://localhost:3000';
const BOT_SCRIPT = path.join(__dirname, '../starbot/starbot.js');

async function main() {
  console.log('=== Starting autonomous mining test ===');

  // 1. Create a game as host
  const hostSocket = io(SERVER, { reconnection: false });

  const code = await new Promise((resolve, reject) => {
    hostSocket.on('connect', () => {
      hostSocket.emit('createGame', { hostName: 'AutoTestHost' }, (res) => {
        if (res && res.ok) {
          console.log(`Game created: ${res.code}`);
          resolve(res.code);
        } else {
          reject(new Error('Failed to create game'));
        }
      });
    });
    hostSocket.on('connect_error', reject);
  });

  hostSocket.disconnect();

  console.log(`Game code: ${code}`);
  console.log('Launching bot teams...');

  // 2. Launch multiple bot instances
  // We'll run 2 full teams (6 bots total) + 2 extra builders on one team for mining focus
  const botProcesses = [];

  // Team A (mostly balanced)
  botProcesses.push(spawnBot(code, 2, null, 'TeamA'));
  await sleep(800);

  // Team B (fill team with extra builder focus)
  botProcesses.push(spawnBot(code, 1, 'TeamB', 'TeamB')); // 1 full bot team
  await sleep(600);

  // Extra pure Builder bots on TeamB to stress mining production
  botProcesses.push(spawnPureBuilder(code, 'TeamB-Builder1'));
  botProcesses.push(spawnPureBuilder(code, 'TeamB-Builder2'));

  console.log(`${botProcesses.length} bot processes launched.`);

  // 3. Let the test run for a while and monitor
  console.log('Test running... (will auto-stop after ~8 minutes or on SIGINT)');

  // Simple observation: tail recent logs for mining keywords
  setTimeout(() => {
    console.log('\n=== Test period complete. Inspecting activity... ===');
    // In a real run we would parse logs more deeply here.
    // For now we just let the processes keep running so the user can observe.
    console.log('Bots are still running. Use `ps aux | grep starbot` or check server logs.');
    console.log('When you are ready to stop: kill the node processes.');
  }, 8 * 60 * 1000);

  // Keep the script alive
  process.stdin.resume();
}

function spawnBot(code, teams, fillTeam, label) {
  const args = [
    '--code', code,
    '--teams', teams.toString(),
    '--delay', '1800',
    '--server', SERVER
  ];
  if (fillTeam) args.push('--fill-team', fillTeam);

  const proc = spawn('node', [BOT_SCRIPT, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0' }
  });

  proc.stdout.on('data', (data) => {
    const line = data.toString().trim();
    if (line.includes('Miner') || line.includes('deploy') || line.includes('mining') || line.includes('probe')) {
      console.log(`[BOT ${label || ''}] ${line}`);
    }
  });

  proc.stderr.on('data', (data) => {
    console.error(`[BOT ERR ${label || ''}] ${data.toString().trim()}`);
  });

  proc.on('exit', (code) => {
    console.log(`[BOT ${label || ''}] exited with code ${code}`);
  });

  return proc;
}

function spawnPureBuilder(code, label) {
  // Hack: run a bot but force it to be Builder by using fill-team and hoping role assignment
  // Better: we can modify the bot later to support role preference, but for now use fill-team
  return spawnBot(code, 0, label, label);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

main().catch(err => {
  console.error('Test runner failed:', err);
  process.exit(1);
});