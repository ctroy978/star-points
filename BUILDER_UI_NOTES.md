# Builder UI Progress Notes

**Date:** Current session (feature/moon-motion branch)

## Latest Change: Descriptive Buttons + Hover Cost Tooltips

- All production buttons in the Builder tab are now purely **descriptive** (no raw resource costs listed directly on the buttons for cleaner appearance).
  - Examples:
    - "+ FRIGATE (fast attack craft)"
    - "+ FACTORY KIT (very expensive — deploy to moons for extra build queue + synthesis)"
    - "+ CAPITOL SHIP (command vessel — forms and leads fleets)"

- Added native browser `title` tooltips (popup on hover) to every build button showing the **exact resource costs**:
  - This provides the requested "indicator for the builder showing how much of the resources will be depleted if the build goes forward."
  - Costs are listed in full resource names for clarity (matching the order: Fused Xenon, Helium-3 Lattice, Quantite, Plasma-Bound Carbon, Antimatter Catalyst, Neurocryst).
  - Tooltips appear reliably on hover without fighting state updates or requiring complex JS preview logic in the resource panel.

- Visual grouping improved:
  - **MILITARY PRODUCTION** section (Frigate, Destroyer)
  - **SUPPORT & INFRASTRUCTURE** section (Miner, Probe, Factory Kit, Admiral, Capitol Ship)

## Broader Context of Builder UI Changes (This Session)

This tooltip change is part of a larger overhaul of the Builder experience to support the new economy and infrastructure systems:

- **Multi-factory production**: Operational factories now grant additional independent build queues (one per factory). The home base always provides the first queue.
- **Mineral Synthesis**: Factories provide slow passive baseline resource income (in addition to active mining from rigs). Rates and current synthesis are displayed live in the CURRENT RESOURCES panel.
- **New buildable items exposed**: Factory kits (deployable to moons), Admirals (for fleet command), and Capitol Ships (fleet formation vessels) are now queueable from the Builder UI.
- **Queue management**: Builders can cancel individual queued items via X buttons in the PRODUCTION QUEUES panel (no resource refund on cancel, per current design).
- **Early-game bootstrapping**: Starting resources and synthesis guarantees were increased so Builders can produce multiple miners + other items early without immediate starvation.
- **Role enforcement and warnings**: Production buttons are gated to the Builder role (server-enforced with clear errors). Non-blocking warnings for building without active miners.
- **Code organization progress**: Some production and resource rendering logic extracted to `public/client/production.js` (lightweight, no bundler). Aligns with the project's ARCHITECTURE.md "Soft Rule" for gradual extraction.

## Current State of the Builder UI

- **Resources panel**: Shows all 6 resources + live synthesis rates (with fallback for restored games or timing).
- **Available Miners**: Count + easy "DEPLOY MINER TO MAP" button (enters command mode).
- **Production buttons**: Grouped, descriptive, with hover tooltips for exact costs. All supported types (military + infrastructure) are exposed.
- **Production Queues**: Shows per-factory status (current build + queued items) with per-item cancel buttons.
- **Map access**: Prominent button from Builder tab to switch to Map tab for deployment and viewing (probes, moon movement, etc.).
- **Overall**: Much cleaner and more informative than before. The Builder has good visibility into costs, synthesis, and queue state. Hover tooltips provide the cost preview without cluttering button text.

## Known Limitations / Future Work

- Still heavily reliant on the monolithic `public/index.html` (thousands of lines). Full lightweight extraction per EXTRACTION_PLAN.md is in progress on the server side but client UI extraction is partial.
- No per-button selection/preview persistence yet (hover is transient; state updates can interrupt).
- Resource synthesis and queue logic are server-authoritative and working, but full end-to-end testing with multiple factories is ongoing.
- Long-term: Consider custom styled tooltips if native `title` popups are insufficient. More advanced cost preview (e.g., "projected after build" row that persists briefly) could be added later.
- The old single-queue legacy fallback code is still present for compatibility during transition.

## Next Steps (as of this note)

- Continue lightweight extraction (more client modules via additional `<script src>` tags).
- Full testing of the Builder flow with deployed factories (extra queues + increased synthesis).
- Polish: Better error handling, more descriptive events, potential custom tooltips.
- Align with overall moon-motion / probe / factory deployment features.

This note captures the state after the tooltip/hover cost preview implementation. The Builder UI is significantly more usable and aligned with the new multi-factory + synthesis design.

---
*Note created as part of committing the current Builder UI tooltip work.*