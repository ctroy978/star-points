# Moon Motion Feature Notes
**Branch:** `feature/moon-motion`  
**Date:** Current session (June 2026)  
**Author:** Grok (for future reference)

## High-Level Goal
Make major and normal moons slowly orbit the gas giant as first-class **named objects** on the map. Mobile units (miners now, fleets/probes later) should be able to target these objects directly. When you target a moon, the unit follows its *current position* over time rather than a frozen coordinate.

Static objects (gas clouds, asteroid clusters, etc.) remain coordinate-targetable but will also get names for consistency and better popups.

## Design Decisions (Agreed)

### Movement
- Moons move **very slowly** (one grid cell every 5–12 minutes on average).
- Different moons have different base speeds + random variation (±20%) for personality.
- Major moons are generally slower/more stable than normal moons.
- Orbits are circular (different radii) around the gas giant.
- Movement is deterministic enough for saved games but has enough variation to feel alive.
- 5-minute ticks appear to be the better balance for a 40-minute classroom game (gives ~8 moves per session instead of 4).

### Targeting System
- **Object-based targeting** for anything that can move (starting with moons).
- When a player clicks a moon, the order stores a reference to that specific named object (`targetObject`).
- The unit always tries to go to the object's *current* location.
- Correction rule (user-specified):
  - Only attempt to correct if the expected cell is empty when the unit arrives.
  - Do a small local search for the named object.
  - If still not found after one extra tick:
    - Mining rigs → self-destruct (lost).
    - Future fleets → go into a "waiting for orders" state.
- Static objects can still be targeted by raw coordinates (or by name once everything is named).

### Naming & Information
- Every interesting grid cell gets a short, memorable name (e.g. `M-A3K`, `G-7P2`, `N-X9M`).
- Format: `[TypeLetter]-[3-4 alphanum]`
  - M = Major Moon
  - N = Normal Moon
  - G = Gas Cloud
  - A = Asteroid Cluster
- Names are stable and used for:
  - Targeting ("I'm sending a rig to G-7P2")
  - Popups
  - Team communication
- Popups (on hover/click of a cell) should show:
  1. The primary mineral target (moon/gas cloud/etc.) with its name and movement info at the top.
  2. Then in priority order: Factories → Military Academies → Mining Rigs → Fleets → Probes.
- Players should be able to look at a moon's popup and immediately understand its movement characteristics so they can make informed targeting decisions.

### UI / Client
- Map cells need richer hover/click popups (current `title` attributes are too weak).
- When clicking to issue an order on a named object, the client should prefer sending the object identity over raw `(x,y)`.
- Coordinate display in UI should use friendly map notation (A1, B4, G-7P2 style) instead of raw numbers.

## What Has Been Implemented So Far

**Server (solid foundation):**
- Anomalies now carry `id` and `name`.
- Moons have orbit parameters (`orbitRadius`, `baseIntervalMin`, `phase`, etc.).
- `processMoonOrbits()` exists and is wired into the main tick loop.
- Miner model and movement logic support `targetObject`.
- Arrival logic implements the "only correct on empty expected cell + one-tick search or self-destruct" rule.
- `deployMiner` and `moveMiner` handlers accept `targetObject`.
- Good debug logging for moon movement and correction events.
- Basic name generation during map creation.

**Client (partial):**
- `formatMapCoord()` helper exists and is used in a few places.
- Basic `#cell-popup` div + `buildCellInfo()` skeleton exists (hover support started).
- Some updates to miner list display.

**Other:**
- Per-game debug logs are already very helpful for this work.
- Logic separation (`public/client/`) from previous work is paying off.

## What Still Needs Work (Prioritized)

1. **Client click handling** — Make map clicks on named objects reliably send `targetObject` (not just raw coords). This is the most important missing piece for the targeting system to actually work.
2. **Popup quality** — Turn the current basic popup into something that properly shows the prioritized list + movement information for moons.
3. **Visual feedback** — Moons should look like they're moving (even subtly). Cells with moving objects need better indication.
4. **Orbit tuning & variation** — Finalize speeds, add per-moon random timing variation, make sure orbits feel good and don't look janky.
5. **Spreading of static objects** — Improve generation so gas clouds and asteroid clusters feel more naturally distributed.
6. **Persistence** — Make sure new fields (names, orbit params) survive save/load cleanly (mostly done via JSON, but verify edge cases).
7. **Bots** — Update starbot so it can target named objects when testing.
8. **Polish & edge cases** — Gas giant interaction with moving moons, what happens when two moons pass near each other, failure states, player feedback when a rig is lost, etc.
9. **Documentation** — Update ARCHITECTURE.md with the final movement/targeting strategy once it's stable.

## Open Questions / Things to Decide

- Exact naming format and character set (how "readable" vs "cool" do we want the names?).
- How much movement information to show in popups (exact "moves every X minutes" vs qualitative + visual cue)?
- When should the rich popup appear — hover, click, or both?
- Do we want any visual prediction (e.g. "this moon will be here in 12 minutes") or keep it observational?
- How do we handle the case where a player targets a moon that later moves behind the gas giant from their perspective?

## Recommended Next Steps (when resuming)

1. Finish wiring the client so that clicking a named object sends `targetObject`.
2. Improve the popup to actually show names + movement info + prioritized occupants.
3. Test the full loop (target moon by name → miner travels → moon moves → correction or loss).
4. Tune the orbit speeds and variation until it feels right for a 40-minute game.
5. Add basic visual indication that moons are moving.

## Tone / Constraints to Remember

- This is still a **classroom game** for 10th graders. Keep complexity and information density reasonable.
- Movement should feel **strategic but not overwhelming**.
- The "name + object targeting" system should make team communication natural ("I'm going for G-7P2").
- We are deliberately keeping pathfinding relatively simple for now (greedy + patience reroute + arrival correction) rather than building a full shared pathfinder until fleets also need grid movement.

---

This note should help future sessions (or future agents) pick up exactly where we left off without having to reconstruct the entire conversation.