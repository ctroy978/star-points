# Lightweight Extraction Plan - Starfight

**Date:** Current session  
**Branch:** feature/moon-motion  
**Goal:** Reduce bloat in the two main monolithic files (`server.js` and `public/index.html`) using only lightweight patterns that preserve the project's core strengths (zero build step, easy for teachers to inspect/modify, no heavy tooling).

This plan follows the guidelines already documented in `ARCHITECTURE.md` (the "Soft Rule").

## Principles
- Server: Use CommonJS `require()` for logical modules.
- Client: Use additional `<script src>` files (no bundler, no ES modules if they complicate things).
- Extract coherent pieces only (processors, related logic).
- Do not over-fragment. Focus on the largest sources of bloat from recent work: production system, factories/synthesis, and probes.
- Keep orchestration and wiring in the main files.
- Make changes incrementally and testable.

## Phase 1: Server Extraction (Highest Impact)

### 1.1 Create `server/production.js`
Extract:
- `BUILD_COSTS`
- `BUILD_TIMES`
- `MAX_QUEUE`
- `processBuilds(game)`
- Multi-queue logic and related helpers
- `FACTORY_SYNTHESIS_INTERVAL_TICKS`
- `FACTORY_SYNTHESIS_PER_FACTORY`
- `processFactorySynthesis(game)`
- Any supporting constants or small helpers for production

Export:
- `processBuilds`
- `processFactorySynthesis`
- The cost/time objects (for queue validation)

Update `server.js` to:
- `const production = require('./production');`
- Call `production.processBuilds(game);` and `production.processFactorySynthesis(game);`
- Move queueBuild socket handler logic that belongs here (or keep thin wrapper).

### 1.2 Create `server/probes.js`
Extract:
- All `PROBE_*` constants (including new mobile probe ones)
- `processProbeMovement(game)`
- Any probe snapshot helpers

Export:
- `processProbeMovement`

Update `server.js`:
- Require and call from game loop.

### 1.3 (Optional but recommended) Minor model cleanup
- Consider moving `Team` class and related resource helpers to `server/models/Team.js` in a follow-up if time permits. For this pass, leave models in `server.js` to keep scope small.

## Phase 2: Client Extraction (Medium Impact)

### 2.1 Create `public/client/production.js`
Extract from index.html:
- `renderBuildQueue(state, myTeamName)`
- `renderResourceBalances(teamData)` (or split if too big)
- `queueBuild(type)` (including the warning logic)
- `CLIENT_FACTORY_SYNTHESIS` and related client constants
- Any production-related UI helpers

### 2.2 Create `public/client/resources.js` (if renderResourceBalances is large)
- Move resource display logic here.
- Keep a thin re-export or direct call.

### 2.3 Update `public/index.html`
- Add `<script src="/client/production.js"></script>` (and others) near the other client scripts.
- Remove the moved functions from the main file.
- Keep wiring (e.g., onclick handlers that call the now-global functions) in index.html for now.

## Execution Rules for This Pass
- Prioritize production-related code (biggest recent addition and source of complexity).
- Probes second (new mobile system).
- Make sure the game still runs after each logical extraction step (use `node --check server.js` and quick manual verification where possible).
- Update any obvious comments/references.
- Do not touch mining yields, probe snapshot size, or other tuning values.
- After extractions, the main files should be noticeably smaller and more focused on orchestration.

## Success Criteria
- `server.js` drops by at least 400-600 lines.
- Clear separation of production and probe concerns.
- Client has at least one additional well-named JS file loaded via script tag.
- No breakage to core flows (building, deploying miners/probes, synthesis, multiple queues).
- Code remains easy to understand for a teacher or student reading the files.

## Out of Scope for This Pass
- Full model extraction (Team/Game classes)
- Combat/fleet logic
- Map rendering extraction
- Any bundling or modern module systems
- Database schema changes

This plan is deliberately conservative and pragmatic.
