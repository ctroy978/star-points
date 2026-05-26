# Starfight — Current State (as of May 2026)

**Project location:** `/home/tcoop/Work/starfight/`

## Overview
Starfight is a small, fast, real-time multiplayer space fleet combat and trading game built specifically for 10th grade classrooms. It is designed to run entirely in the Chrome browser on Chromebooks from a single central server (the teacher’s laptop) behind a school firewall.

- No accounts, no internet required beyond the local network
- Pure terminal-style UI (green text on black, monospace, box-drawing characters)
- Authoritative server using Node.js + Express + Socket.IO
- Games typically last 6–12 minutes

## Core Gameplay (MVP)

**Setup**
- Teacher creates a session → gets a simple 4-character invite code
- Up to 4 players join using the code + a solar system name
- Each player starts with:
  - 100 Titanium
  - 0 Fighters
  - 0 Defense Canons
  - 1 Factory with 100 HP

**Economy**
- Passive mining: +4 Titanium every 15 seconds
- Trading: Instant transfer of 10 / 25 / 50 Titanium to any other living player

**Units**
- Fighter: 20 Ti, 30-second build time (offensive)
- Defense Canon: 10 Ti, 60-second build time (defensive)

**Build System**
- One factory per player
- Builds one unit at a time
- Simple FIFO queue (max 4 items)

**Combat**
- Players choose a target and how many fighters to send
- Fleets take **8 seconds** to travel (visible ETA to all players)
- On arrival:
  - Each defending canon destroys exactly 1 incoming fighter (1:1, deterministic)
  - Each surviving fighter deals 7 damage to the target factory
- **Recent fix**: Fighters that survive the engagement now return home and are added back to the attacker’s count (they are not lost after one attack)

**Win Condition**
- When a factory reaches 0 HP, that player is eliminated
- Last factory standing wins
- Host can end the game early

## Current Features
- Real-time multiplayer (Socket.IO)
- Full state synchronization every second
- Host controls (start game, end game)
- Rejoin support (same name + code)
- Event log with color coding
- In-transit fleet display with countdowns
- All numbers visible to everyone (good for classroom discussion and mental math)
- Clean terminal aesthetic that works well on Chromebooks

## Key Files
- `server.js` — All game logic, timers, combat resolution, session management (easy to tweak constants at the top)
- `public/index.html` — Complete single-file client (HTML + CSS + JavaScript). No build step required.
- `README.md` — Basic teacher instructions
- `STARFIGHT_CURRENT.md` — This document (current state snapshot)

## Known Limitations / Good Iteration Points
- No persistence (games live only in RAM)
- No pause/resume
- Only one resource type (Titanium)
- Only two unit types
- One player per solar system (no team roles yet)
- No bots
- No in-game chat
- Very basic lobby and game-over screens

## How to Run
```bash
cd /home/tcoop/Work/starfight
npm start
```
Then open http://localhost:3000 on the server machine. The server prints the actual usable local IP addresses for students to connect from other computers.

---

This is the current working baseline. All major mechanics the user originally requested are implemented and tested, including the important combat fix where surviving fighters return home.