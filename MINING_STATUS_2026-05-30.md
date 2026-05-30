# Starfight Mining System — Status Note (as of 2026-05-30 evening)

**Purpose**: Quick reference for tomorrow when restarting work.

---

## Current Branch & Repo State

- **Starfight repo**: On branch `mining`
  - Uncommitted changes in:
    - `server.js`
    - `public/index.html`
    - `db.js`
  - These changes come from the autonomous mining implementation subagent.
- **Starbot repo** (`~/Work/starbot`): Not tracked as a git repo in the current view. The `starbot.js` file was modified during this session (last edit ~May 29 21:15 in local time).

---

## What Was Accomplished Today

### 1. Mining System Implementation (Game Core)
- Full autonomous implementation completed by subagent (task 019e770d-...).
- Key features implemented:
  - New buildables: `miner` ([6,4,2,5,0,1], ~55s) and `probe`.
  - `availableMiners` + `probes` counters on teams.
  - `deployedMiners` entities (with states: moving / setting_up / mining).
  - Grid-based movement (1 cell every 10 seconds / 10 ticks).
  - 60-second setup time after arrival.
  - Periodic mining yields (60s interval) with stacking (max 3 rigs per site) and diminishing returns.
  - Three anomaly types on the map:
    - `major_moon` (common resources, visible from start)
    - `gas_cloud` (medium, hidden until probed)
    - `asteroid_cluster` (rare, hidden until probed)
  - Discovery via probes (Builder builds + launches probes to reveal hidden anomalies in a radius).
  - Full persistence (new DB fields + JSON storage for deployed miners and anomalies + discovery state).
  - New socket events:
    - `deployMiner` {targetX, targetY} (Builder only)
    - `moveMiner` {minerId, targetX, targetY} (Builder or War)
    - `launchProbe` {x, y} (Builder only)
  - UI updates: Interactive map for deployment/move orders, Builder panel shows miner/probe counts, "MY DEPLOYED MINERS" list, etc.
- The subagent reported the system as "fully working and playable" with a detailed test guide in its final output.

**Important files created during planning** (in starfight root):
- `MINING_SYSTEM_IMPLEMENTATION_PLAN.md`
- `MINING_AUTONOMOUS_EXECUTION_PROMPT.md`

**Test helper scripts created** (also in starfight root):
- `create_mining_test_game.js`
- `run_mining_test.js`
- `verify_mining.js` (dedicated verification script with role hunting + resource boosting for focused testing)

### 2. Bot Modifications (`~/Work/starbot/starbot.js`)
- Updated to support the new mining economy:
  - Added `miner` and `probe` to `BUILD_COSTS` and `BUILD_TIMES`.
  - Enhanced `decideAsBuilder` to heavily prioritize building miners (then probes) when resources allow.
  - Added `maybeDeployMiner()` function that:
    - Reads `fullState.map.anomalies`
    - Filters for sites with < 3 of the bot's own rigs
    - Picks a target (prefers visible anomalies) and emits `deployMiner` with real grid coordinates.
- Bots **can** see visible major moons (and discovered anomalies) via `fullState.map.anomalies` and direct mining rigs to their exact (x, y) positions.
- Current bot behavior is functional but fairly simple/random (no sophisticated preference for moon type, distance, or spreading yet).

### 3. Testing Performed
- Multiple autonomous test runs launched on live games:
  - Game **HK79** (primary test game used with boosted resources for verification)
  - Game **BVTX** (used with `verify_mining.js`)
- Setup included:
  - Fresh game creation via socket.
  - Multiple starbot instances with `--fill-team MineTeam` (heavy focus on Builder role).
  - Dedicated verification scripts that hunt for the Builder role and directly drive/observe miner deployment + state.
  - Background processes + persistent log monitors filtered for "Miner", "deploy", "yield", "anomaly", "setup", etc.
- Observations so far:
  - Bots successfully build miners when they can afford them.
  - Deployment commands are being issued to anomaly coordinates.
  - Early-game resource constraints (per the economy design) mean it takes time before heavy mining volume appears.
  - No major crashes or broken core mechanics observed.
  - One verification run completed its observation window cleanly (though role assignment limited some tests).

**Current running processes** (at time of this note): Several background bots and monitors were active. Clean them up with `pkill -f "starbot|verify_mining|run_mining_test"` if needed on restart.

---

## Known Limitations / Open Items

- **Bot intelligence**: Still basic. They deploy to visible anomalies but don't yet have strong strategies (e.g. prefer major moons, spread across sites, react to other teams' miners, etc.).
- **Testing volume**: Early-game economics + random role assignment make it hard to get many miners deployed quickly in short autonomous runs. Resource boosting was used in verification scripts for focused testing.
- **No combat on miners yet** (as planned — this was scoped out).
- **Movement**: Greedy Manhattan stepping (no full pathfinding).
- Some test scripts have minor fragility around role assignment and long-running processes.

---

## How to Restart Tomorrow (Recommended Steps)

1. `cd ~/Work/starfight`
2. `git checkout mining`
3. `git status` (expect the uncommitted mining changes)
4. Read this file: `MINING_STATUS_2026-05-30.md`
5. (Optional but recommended) Read the implementation plan and the subagent's final completion report (it was very detailed).
6. Start the server: `node server.js`
7. Use one of the test scripts or manually create a game + launch bots with:
   ```bash
   cd ~/Work/starbot
   node starbot.js --server http://localhost:3000 --code <CODE> --teams 2 --fill-team MineTeam --delay 2000
   ```
8. For focused testing, use or adapt `verify_mining.js` (it can boost resources for quick iteration).
9. Check logs for keywords: `Miner`, `deployed`, `setup complete`, `yield`, `anomaly`.

---

## Quick Commands Reference

```bash
# Kill all test bots/monitors
pkill -f "starbot|verify_mining|run_mining_test" || true

# Fresh game + focused bots
node ~/Work/starfight/create_mining_test_game.js   # prints a code
node ~/Work/starbot/starbot.js --code XXXX --fill-team MineTeam --delay 1800

# Watch for mining activity
tail -f /path/to/server.log | grep -E 'Miner|yield|anomaly'
```

---

**Overall Assessment**: The mining foundation is solid and playable. The bots have basic integration and can see/use anomaly coordinates (including major moons). The main remaining work is polishing bot strategy and running longer/more controlled tests to surface yield and stacking behavior.

Document created: 2026-05-30 (evening session). Ready for continuation tomorrow.