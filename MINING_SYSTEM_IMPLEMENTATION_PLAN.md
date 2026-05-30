# Starfight Mining System - Full Implementation Plan (Autonomous Execution)

**Goal**: Implement the complete mining economy as described in the resource sheet and user requirements.

**Core Loop Enabled**:
Mine (modest, location-based, stackable up to 3 rigs) → Trade (imbalances) → Build (Miner rigs + other units + infrastructure) → Expand control / attack → Repeat.

## 1. High-Level Architecture Decisions

### 1.1 Map Anomalies
- Extend `game.map` to include `anomalies: [{x, y, type, discovered: boolean or Set of teams}]`.
- Anomaly types:
  - `major_moon`: Common (Fused Xenon, Helium-3 Lattice). Visible from start.
  - `gas_cloud`: Medium (Quantite, Plasma-Bound Carbon). Hidden until probed.
  - `asteroid_cluster`: Rare (Antimatter Catalyst, Neurocryst). Hidden until probed.
- Map generation will place a reasonable number of each, biased by type.

### 1.2 Miner Entities
- Miners are **first-class mobile entities** (like the old `fleets` array, but persistent on map).
- Stored at Game level: `game.deployedMiners = []`.
- Each:
  ```js
  {
    id,
    teamName,
    x, y,
    state: 'moving' | 'setting_up' | 'mining',
    targetX, targetY,
    lastMoveTick or nextMoveTime,
    setupCompleteTime,
    miningSite: {x, y, type}   // cached when arrives
  }
  ```
- "Available but undeployed" miners live as a simple counter on `Team`: `this.availableMiners = 0`.

### 1.3 Movement Model (Pragmatic)
- Grid-based (Manhattan or simple greedy step toward target).
- Speed: 1 cell every 10 seconds (every 10 game ticks).
- In the main 1s `gameTick`, process miner movement in batches.
- No complex pathfinding for v1 (can upgrade later). Straight-line stepping with obstacle avoidance for gas giant only.

### 1.4 Mining Mechanics
- Sites support max **3 rigs**.
- When a miner arrives and finishes 60s setup:
  - It enters `mining` state.
  - Every 60 seconds (or 120s per user note — we'll standardize on 60s for responsiveness), all active miners at a site contribute yield.
- Yield model (per rig per 60s, before splitting):
  - Major Moon (common): base 5
  - Gas Cloud (medium): base 2.5
  - Asteroid Cluster (rare): base 0.6
- Stacking rule (user: "every mining rig will get a percent"):
  - 1 rig: 100% of base
  - 2 rigs: each gets ~75% of base (total output increases but not 2x)
  - 3 rigs: each gets ~55% of base
- Total for the team at that site is summed and added to `team.resources` (clamped, integer math).
- Server enforces "cannot deploy 4th rig to a site with 3".

### 1.5 Discovery
- Major Moons always visible on map.
- Other anomalies start hidden (`discovered: false`).
- For v1: Add a cheap "Probe" buildable unit (or use existing Spy Drone cost).
- Simple "Launch Probe" action (Builder or War) that reveals all anomalies within a radius (e.g. 2-3 cells) of a target cell.
- Revealed anomalies stay revealed for the team (or globally for simplicity in v1).

### 1.6 Roles & Actions
- **Builder**:
  - New build option: "Miner" (cost 6/4/2/5/0/1, reasonable build time ~45-60s).
  - When completed, `team.availableMiners++`.
  - New action: "Deploy Miner to (x,y)" — consumes 1 available miner, creates `deployedMiner` entity at team's start or factory location in 'moving' state toward target.
- **War Commander**:
  - Sees deployed miners on the (now interactive) map.
  - Can issue move orders to existing deployed miners (change target).
- Map becomes partially interactive for miner control and probe deployment.

### 1.7 Tick Processing
- Extend the existing 1s game loop.
- New functions:
  - `processMinerMovement(game)`
  - `processMinerSetupAndMining(game)` — handle setup timers and periodic yield addition.

## 2. Detailed Data Model Changes

### Server (server.js)
- `Team`:
  - Add `this.availableMiners = 0;`
- `Game`:
  - `this.deployedMiners = [];`
  - Update `map` structure:
    ```js
    map: {
      gasGiant,
      moons,           // legacy visible
      anomalies: [ {x, y, type: 'major_moon'|'gas_cloud'|'asteroid_cluster'} ],
      starts
    }
    ```
  - Anomalies can have a `discoveredBy: Set<teamName>` or per-team visibility in broadcast.

### Client (public/index.html)
- Receive `deployedMiners` in gameUpdate (sanitized per team visibility).
- Receive `map.anomalies` (with discovery flags).
- New UI elements in Builder tab for building Miners + Deploy button (select target on map).
- Enhanced map rendering: different symbols/colors for anomaly types, miner icons (e.g. "M" or rig symbol) with team color, counts when >1 on same cell.

### Persistence (db.js)
- Add columns/tables for `available_miners` on teams.
- New table or JSON for `deployed_miners`.
- Extend map storage for anomalies.

## 3. Phased Implementation Order (for autonomous execution)

**Phase 0: Foundations (Low risk)**
- Add `availableMiners` to Team and broadcast.
- Extend BUILD_COSTS with `miner`.
- Add "Miner" button to Builder UI (with cost display).
- Wire `queueBuild('miner')` on server (allow the type).

**Phase 1: Miner Deployment & Movement**
- Add `deployedMiners` array + creation logic when Builder "deploys".
- Basic grid movement in tick (1 cell / 10s).
- Broadcast deployedMiners (position + state).
- Basic map rendering of miners (static for now).

**Phase 2: Anomalies & Mining Yield**
- Extend map generation to place all three anomaly types.
- Define yield tables.
- Mining logic: count rigs per cell (cap at 3 on deploy), periodic resource addition.
- Prevent 4th deployment to a saturated cell.

**Phase 3: Discovery System**
- Mark anomalies as hidden.
- Implement simple probe/scan action (new cheap unit or direct action).
- Reveal logic + UI (show hidden anomalies only after discovery for that team).

**Phase 4: Polish & Integration**
- Miner setup timer (60s).
- Better map visuals + interaction (click to target for deployment/move).
- Role-specific views (Builder sees availableMiners count prominently).
- Persistence.
- Event log messages ("Miner arrived at ...", "Mining rig deployed at ...", resource gains? or keep quiet).
- Edge cases (miner on gas giant, overlapping starts, game end, etc.).

**Phase 5: Testing & Balancing Hooks**
- Console logs or debug UI for yields.
- Easy constants at top of server.js for rates, speeds, setup time, stacking curve.

## 4. Risky Areas & Mitigations

- **Grid movement on existing abstract fleet system**: Keep fleets abstract for now. Miners are a separate entity system. Later we can unify.
- **Map interactivity**: Current map is read-only decorative. We will make targeted cells clickable when in "deployment" or "move order" mode (state machine in client).
- **Performance**: With small maps (13-17) and few miners (dozens max), naive per-tick loops are fine.
- **Persistence migration**: Use the existing safe ALTER + JSON pattern already in db.js.
- **UI bloat**: Keep new controls inside existing role panels. Use the same tab system.

## 5. Constants to Expose (for easy tuning)

In server.js (near other BUILD_* constants):
- MINER_SPEED_TICKS = 10
- MINER_SETUP_TIME_MS = 60000
- MINING_INTERVAL_MS = 60000
- YIELD_TABLE by type
- MAX_MINERS_PER_SITE = 3
- STACKING_MULTIPLIERS = [1.0, 0.75, 0.55]

## 6. Client/Server Contract Additions (new or extended socket payloads)

- `gameUpdate` gains:
  - `deployedMiners: [{id, team, x, y, state, ...}]` (filtered or full with visibility)
  - Enhanced `map.anomalies`
- New client emits:
  - `deployMiner` { targetX, targetY }
  - `moveMiner` { minerId, targetX, targetY }
  - `launchProbe` or `scanSector` { x, y } (for discovery)

## 7. Success Criteria

- Builder can produce Miners.
- Miner can be deployed to a map cell from the team's area.
- Miner travels grid-by-grid at the specified speed.
- Upon arrival + setup, if the cell has a valid anomaly, the owning team begins receiving periodic resources.
- Max 3 per cell enforced on deployment.
- Hidden anomalies exist and can be revealed via a discovery mechanic.
- Everything persists across restarts.
- UI makes the loop understandable (at least to the Builder and War Commander).

---

This plan is designed to be executable autonomously by a capable coding agent with access to the full codebase, the ability to run the server, and edit the single-file client.

**Next step for autonomous agent**: Read this plan + the full current `server.js`, `public/index.html`, and `db.js`. Then implement Phase 0 → Phase 5 in order, using small testable commits or edits where possible, with inline comments for all new mining-related logic.