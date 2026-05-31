# Popup System Notes (Deferred)

**Date:** Current session  
**Status:** Work on rich popups is intentionally paused. Focus has shifted to making a functional probe system first.

## Initial User Thoughts on the Popup System (Captured for Future Reference)

The goal is to evolve the very basic current `#cell-popup` (simple hover text) into a much more useful "rich card" experience.

### Core Desired Behaviors
- **Delayed hover activation**: Rich popups should not appear instantly. They should trigger after the mouse hovers a map cell for a set amount of time (user suggested something in the ~400-500ms range).
- **Action buttons live inside the popup**: Instead of (or in addition to) separate lists and command panels, players should be able to take direct actions from the popup itself.
  - Example: When hovering a cell with your own moving miners, a Builder should see buttons to "Redirect this specific miner".
- **Role restrictions on actions**:
  - Only the **Builder** can redirect miners via popup buttons.
  - Only the **War Commander** can redirect fleets (once fleets are spatial units on the map) via the same popup mechanism.
  - Other roles can see the information but do not get the command buttons.
- **Consistent commanding model**: The pattern used for commanding units from the popup should become the standard way to issue move/redirect orders for most mobile units (miners, future fleets, etc.).
  - Probes and spy drones are **explicit exceptions** to this pattern (see below).
- **Show the full stack**: The popup should surface everything relevant at that grid cell (anomalies, own units, scouted enemy units, factories, military academies, etc.) in a prioritized, readable way.

### Visibility / Fog-of-War Rules in Popups (Important)
Players should only see information they have actually earned:
- Moons are always visible.
- Other anomalies (gas clouds, asteroid clusters) only appear if the team has probed/revealed them (`discoveredBy`).
- Fleets / probes / temporary units: Only visible if the viewing team has a unit (fleet or probe) within a small proximity (user said "at least one grid away").
- Permanent / semi-permanent assets (own or enemy miners, factories, military academies):
  - If the team has previously uncovered them (via probe, fleet, or adjacency), show the information.
  - Include a clear note that "this information may be outdated."
- General principle: The popup respects what the team actually knows at that moment. No magical full vision.

### Probes and Spy Drones as Exceptions
- Probes and future spy drones are **cheap and disposable**.
- They "will not last long in the game after deployment."
- Because of this, they should **not** follow the same persistent popup-commanding flow as miners and fleets.
- Their deployment/usage should remain lighter weight (e.g. War Commander panel + map targeting, or a quick one-shot action).

### Other Notes
- The old "MY DEPLOYED MINERS" list below the map (with MOVE buttons) was considered deprecated and has been removed in favor of the popup approach.
- Earlier direct coordinate input panels in the Builder tab were also removed.
- The long-term vision is that the map + these smart popups become the primary way players interact with and command units on the grid.

## Why We Paused This Work
The user explicitly chose to delay further popup implementation in order to first deliver a more physical, satisfying **probe system** (see PROBE_SYSTEM_IMPLEMENTATION.md or related notes once created).

This document exists so the popup design thinking is not lost when we return to UI work later.

---
**Last updated:** Current session (probes priority active)