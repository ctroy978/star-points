# Starfight Architecture & Development Notes

**Last updated:** June 2026

## Current Architectural State

The project is still largely monolithic by design:

- **Server**: Most logic lives in `server.js`, with some extraction already done into `db.js`.
- **Client**: The entire frontend (HTML + CSS + JavaScript) lives in a single file: `public/index.html` (~2000+ lines and growing).

This structure was originally a deliberate strength:
- Zero build step
- Extremely easy for teachers to run and even modify
- Works reliably in restricted school environments (Chromebooks, no admin rights, etc.)

## Guiding Principle Going Forward

We are gradually moving away from a fully monolithic codebase toward better separation of concerns. However, we will **not** adopt heavy modern tooling (bundlers, complex module systems, full frameworks) that would compromise the project's core strengths:
- Simplicity of deployment
- Low barrier for teachers and students to inspect or tweak the code
- No mandatory build step

## Soft Rule (Adopted June 2026)

**No new major feature should be added directly into the large monolithic files (`server.js` or `public/index.html`) without performing at least some extraction into dedicated modules/files.**

### What Counts as a "Major Feature"?
- New game systems (e.g. trading, espionage, additional unit types, new economy mechanics)
- Significant new UI sections or role panels
- Complex subsystems (advanced mining behaviors, fleet management, etc.)
- Large refactors that touch many areas

### What "Some Extraction" Means
When implementing something significant, the expectation is:
- Identify coherent pieces of logic
- Move them into their own file(s)
- Keep the main files focused on orchestration and wiring

**Server examples:**
- `mining.js`
- `combat.js`
- `team.js` or `gameState.js`

**Client examples:**
- Multiple `<script src>` files loaded by the main HTML (still no bundler)
- Suggested structure: `public/client/core.js`, `public/client/map.js`, `public/client/roles/builder.js`, etc.

### Why This Soft Rule Exists
- The monolithic approach is becoming a growing source of friction as the game increases in complexity.
- Continuing to dump everything into the same two big files will make future development significantly slower and more error-prone.
- Incremental extraction now is much safer and easier than a large refactor later.

This rule is intentionally "soft" rather than absolute. Small bug fixes, minor tweaks, and very simple features can still land in the main files when it doesn't make sense to extract.

## Future Direction (Lightweight Segregation)

We will favor pragmatic, low-friction patterns:
- Multiple JavaScript files included via `<script src>` (client)
- Logical module files required by `server.js` (server)
- Keep the ability to produce a single-file distribution for teachers if desired

Heavy architectural patterns (clean architecture, dependency injection containers, etc.) are explicitly **not** desired for this project.

---

**Note to future developers / agents:**  
When starting work on something substantial, pause and ask: "Should part of this live in its own file?" If the answer is yes, do the extraction as part of the work rather than deferring it.

---

## Movement & Map Entities Strategy (June 2026)

### Current State
- **Miners** are the only true grid-based mobile entities. They have `x/y`, `targetX/targetY`, per-tick movement, and must navigate around the gas giant (center obstacle). They use simple greedy Manhattan + patience reroute logic in `processMinerMovement()`.
- **Fleets** are currently abstract/time-based (`arrivalTime`). They do not have grid positions and do not path around the gas giant.
- **Probes** are instant actions (no persistent map presence).

### Future Vision
The long-term goal is for multiple unit types (miners, probes, fleets, future units) to exist as first-class objects on the map that can move and interact with other objects (anomalies, gas giant, each other).

### Recommendation on Pathfinding / Movement
**Do not build a shared Pathfinding or MovementSystem yet.**

Reasons:
- The movement models and interaction rules are still too different.
- The original `MINING_SYSTEM_IMPLEMENTATION_PLAN.md` explicitly called this out as a risk area: *"Grid movement on existing abstract fleet system: Keep fleets abstract for now. Miners are a separate entity system. Later we can unify."*
- Premature abstraction for pathfinding is a classic source of bad architecture. We only have one real consumer (miners) today.

**When to unify:**
- When the first non-miner unit type (likely fleets or probes) needs actual grid movement + obstacle avoidance.
- At that point, extract common concerns (position + target tracking, speed, stuck detection, basic avoidance) into a shared module.

**Light future-proofing we *should* do now:**
- Use consistent property names across any new mobile entities (`x`, `y`, `targetX`, `targetY`, `state`, `speed` or `moveInterval`).
- Document interaction rules clearly (see "Entity Interaction Rules" below when we have more examples).
- Keep miner-specific hacks (like the gas giant patience reroute) clearly isolated and commented.

### Entity Interaction Rules (Future)
Different units will need different rules when they encounter things:
- Miner + Gas Giant → Avoid / reroute
- Miner + Anomaly → Arrive and begin setup/mining
- Fleet + Enemy → Combat
- Fleet + Gas Giant → ? (TBD when fleets become grid entities)
- Miner + Miner → ? (stack, block, etc.)

These rules are more important (and harder) than the raw pathfinding algorithm. Design the interaction layer *after* we have 2+ concrete examples.

---

## Recent Extraction Work (June 2026)

**Server modules:**
- `server/production.js` — build queues, factory synthesis
- `server/probes.js` — probe movement and scanning

**Client modules:**
- `public/client/command-system.js` — map command mode (deploy miner, launch probe)
- `public/client/production.js` — resource balances, build queue rendering
- `public/client/builder-status.js` — Builder infrastructure panel
- `public/client/mining-rates.js` — mining yield display helpers
- `public/client/map.js` — grid rendering, cell popups, start markers, map overlays
- `public/client/mining-deployment.js` — legacy deploy helpers

`public/index.html` keeps HTML/CSS, tab shell, `render()` orchestration, and socket wiring.

Continue this pattern for combat (`war.js`) and server map generation (`server/map.js`) when those areas next change significantly.