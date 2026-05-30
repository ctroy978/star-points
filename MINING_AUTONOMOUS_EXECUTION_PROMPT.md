# Autonomous Mining System Implementation Prompt for Starfight

You are an expert full-stack game developer specializing in Node.js + browser single-file games. You have been given this prompt + the full current Starfight codebase.

**Your mission**: Implement the complete mining system described below **autonomously**. Do not ask the user for decisions. Make reasonable, consistent choices that match the existing architecture and the provided resource sheet. Prioritize a working, playable system over perfection. Use small, incremental, testable changes where possible.

**Reference documents** (read these first):
- `/home/tcoop/Work/starfight/MINING_SYSTEM_IMPLEMENTATION_PLAN.md`
- The user's resource/mining specification pasted in the query.

**Strict constraints**:
- All changes must be in the existing three files: `server.js`, `public/index.html`, `db.js`.
- Keep the retro terminal aesthetic.
- Maintain the existing 6-resource tuple system in exact order.
- Do **not** break existing functionality (Frigate/Destroyer production, combat, roles, current map, persistence of saved games).
- The system must be fully playable in a local multiplayer test (2+ teams).

## Core Requirements (from spec + user)

1. **New buildable unit**: "Miner" (cost [6,4,2,5,0,1]).
2. **Deployment**: Builder builds Miners → they become "availableMiners". Builder (or team) can deploy them to map cells.
3. **Movement**: Grid-based, 1 cell every 10 seconds.
4. **Setup**: 60 seconds setup time after arrival.
5. **Mining**:
   - Max 3 rigs per map cell.
   - Different yields based on anomaly type.
   - Stacking with diminishing per-rig returns.
   - Periodic resource gain (target 60s interval).
6. **Map anomalies**:
   - Major Moons (common, visible at start).
   - Gas Clouds (medium, hidden).
   - Rogue Asteroid Clusters (rare, hidden).
7. **Discovery**: At least one mechanism to reveal hidden anomalies (simple probe/scan is acceptable for v1).
8. **Only removal method**: Combat (we will stub damage later; for now just prevent new deployments when full).

## Phased Execution Order (Follow This)

**Phase 0 – Foundations (do this first, test build)**
- Add `availableMiners` to Team class + hydrate/persist/broadcast.
- Add `miner` to BUILD_COSTS and BUILD_TIMES.
- Update server `queueBuild` to accept 'miner'.
- Add "Miner" production button in Builder tab (show cost + time).
- When a Miner finishes building, increment `team.availableMiners` and clear currentBuild.

**Phase 1 – Deployment & Movement Core**
- Add `deployedMiners: []` at Game level.
- Add server handler `deployMiner` (from Builder role) that:
  - Consumes 1 `availableMiners`.
  - Creates a deployedMiner at the team's starting position (or factory cell) heading to target.
- Implement basic movement in a new `processMinerMovement(game)` called from the main tick.
- Broadcast `deployedMiners` (sanitized).
- Minimal client rendering: show simple markers on the map for your team's miners.

**Phase 2 – Anomalies & Actual Mining**
- Extend `generateMapForGame` to place 4-8 gas clouds and 3-6 asteroid clusters (different symbols later).
- Add `anomalies` array to game.map.
- Define yield tables (hardcode reasonable numbers matching the sheet: common ~5, medium ~2, rare ~0.5 per rig per cycle before multipliers).
- Implement `processMinerMining(game)`:
  - Group miners by cell.
  - For cells with valid anomaly + at least one rig in 'active' state:
    - Calculate yield with stacking curve.
    - Add resources to the owning team.
- Enforce the 3-rig deployment limit on the server when receiving deploy orders.

**Phase 3 – Setup Time + States**
- Miner states: 'moving' → 'setting_up' (60s timer) → 'mining'.
- Only 'mining' state contributes to yields.
- Add clear event log messages for arrival and "setup complete".

**Phase 4 – Discovery (minimum viable)**
- Mark non-moon anomalies as hidden initially.
- Add a cheap "Probe" build option (use cost from sheet if available, or invent reasonable: 1/1/1/0/0/1 or similar).
- Add a simple `launchProbe` socket handler that reveals anomalies in a small radius (2-3 cells) around a target cell.
- In map rendering, only show non-moon anomalies if the player's team has discovered them (use `myTeam` + a discovered set).

**Phase 5 – UI & Polish**
- Make the map more interactive when the player has availableMiners or selected miners:
  - Click a cell to deploy (if Builder has availableMiners).
  - Or select a deployed miner and click a destination.
- Show miner count badges on occupied cells.
- Different visual symbols for the three anomaly types (use unicode or colored letters: M, C, A or better icons).
- Prominently show `availableMiners` count in the Builder panel.
- Add a small "Deployed Miners" summary somewhere visible to the team (War tab is fine).
- Update role gating so only Builder can deploy new miners.

**Phase 6 – Persistence & Robustness**
- Update db.js for `available_miners` and a new `deployed_miners` storage (JSON or dedicated table).
- Handle hydrate for deployedMiners.
- Make sure saved games continue to work.
- Add defensive code for edge cases (miner targeting invalid cell, game ending while miners are moving, etc.).

## Important Technical Guidance

- **Movement simplification**: For v1, use simple repeated stepping toward target (dx/dy reduction) every 10 ticks. Do not implement full A* unless it is trivial.
- **Time handling**: Use `Date.now()` or tick counters consistently with how currentBuild and fleets already work.
- **Yield calculation**: Keep it in one clear function with constants at the top of server.js. Make the stacking curve tunable.
- **Client map**: The renderMap function will need significant updates. Consider adding a layer or post-processing pass for anomalies and miners. Keep it performant (small grids).
- **Role split**: Builder produces and deploys. War Commander can later control existing miners on the map. For v1, allow Builder to do both deployment and basic move orders.
- **No combat yet**: Just prevent over-deployment. Destruction can be added later.

## Quality & Autonomy Rules

- You are allowed (and expected) to make reasonable design decisions when the spec is ambiguous.
- Add clear `// MINING:` comments around all new logic.
- Expose tuning constants near the top of server.js (next to BUILD_COSTS).
- After each major phase, the code should still run without crashing (even if mining isn't fully wired).
- Test mentally for: multiple teams on same cell, moving past gas giant, reloading a game with active miners, Builder on one team deploying while War watches on another.
- When done, leave the server in a runnable state and be ready to describe what was built.

## Output Expectations When Finished

When you have completed the implementation:
1. Summarize the major files changed and key new functions.
2. List the new constants and their default values.
3. Give a short "How to test" guide (e.g., "Build 2 Miners as Builder on Red team, deploy one to a visible Major Moon, wait ~2 minutes, check resources").
4. Note any known limitations or "TODO for combat phase" items.

Begin execution now. Read the full current codebase first (especially map generation, tick loop, build system, and the renderMap function), then start with Phase 0. Work methodically through the phases. Good luck.