#!/usr/bin/env node
// Creates a fresh game and prints the code for bot testing
const { io } = require('/home/tcoop/Work/starbot/node_modules/socket.io-client');

const SERVER = 'http://localhost:3000';

const socket = io(SERVER, { reconnection: false });

socket.on('connect', () => {
  socket.emit('createGame', { hostName: 'MiningTestHost' }, (res) => {
    if (res && res.ok) {
      console.log(res.code);
      process.exit(0);
    } else {
      console.error('Failed to create game');
      process.exit(1);
    }
  });
});

socket.on('connect_error', (err) => {
  console.error('Connect error:', err.message);
  process.exit(1);
});

setTimeout(() => {
  console.error('Timeout creating game');
  process.exit(1);
}, 10000);