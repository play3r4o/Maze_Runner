# Shifting Labyrinth — Development plan

Working title only. Source context: `../project_brief.md` (lowercase filename).

## Starting point and release scope

The planning inspection found only the brief: no application, dependencies, tests, or commits. Do not mistake proposed work for completed work; current evidence belongs in `progress.md`.

The full brief is too ambitious for a beginner's first release. The agreed fallback is a complete solo demo. Multiplayer is conditional on a successful small proof; garden/workshop are optional follow-up work.

| Outcome | Contents | Gate |
| --- | --- | --- |
| Solo maze proof | Primitive first person, warned shifting passages, one relic, return/extract | M7: complete runs produce understandable route decisions |
| Pressure proof | M7 plus unrest, dusk bell, directional sound, chalk | M7b: testers report a tenser return than baseline M7 |
| Multiplayer proof | Two clients, authoritative movement/gates/one pickup | M9: agreement including contested pickups |
| First demo | Solo loop, inventory/stash, one creature, one crossbow, three landmarks, one trap, simple presentation | M15: a new tester finishes without coaching |

Prototype expeditions target 3–5 minutes. Expand toward 15–20 minutes only if playtesting justifies it. One biome, one floor, primitive geometry, no giant world.

## Working rules

Order: **M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M7b → M9 → M8 → M10 → M11 → M12 → M13 (conditional, co-op PvE) → M13b (conditional, PvP) → M14 (optional) → M15**.

Retain the brief's IDs; M7b and M13b are plan additions from 2026-11-11 and have no brief counterpart. Introduce pure state early; M3 strengthens it rather than replacing mesh-based rules. Move M9 ahead of inventory/AI/combat. Split large milestones into small sessions, but never advance without human acceptance.

Every milestone must leave the app runnable in a browser, preserve previously accepted behavior, pass type checking/build/relevant unit and browser tests, provide a manual checklist, and record the developer's acceptance. An agent may say **ready for manual testing**, never claim human acceptance. Failed/skipped/unrun checks stay visible.

## Architecture

Use Node.js 24, npm with a committed lockfile, TypeScript strict mode, Three.js, Vite, HTML/CSS, Vitest, and Playwright. Pin resolved versions; subsequent installs use `npm ci`. Add `ws`, its types and `tsx` only at M9. No React, ECS, database, accounts, hosted game stack, generic event bus or plugin framework.

Create modules when needed, not empty architecture folders:

| Boundary | Ownership |
| --- | --- |
| simulation | Pure movement/collision, maze topology, seeded generation, gates, reachability; no Three.js/DOM/storage/network imports |
| game | Run state, interactions, items, extraction, health, progression; plain data and functions |
| rendering | Scene/camera/meshes/materials/interpolation; never passage state, damage or item ownership |
| input | Browser events, pointer lock, movement intentions; never direct mesh movement |
| ui | HUD, prompts, pause, debug tools; reads state/submits actions |
| network, server | Introduce at M9; typed transport and authoritative runner reusing rules |

Flow: **input → simulation/game rules → state → renderer/UI**. Offline authority is local; online authority moves to the server. Animations do not decide gameplay outcomes.

Use a 60 Hz fixed simulation and requestAnimationFrame rendering. Clamp frame elapsed time to 100 ms, at most six ticks per frame. Reset accumulation on pause/tab hiding. Solo pause freezes simulation; multiplayer menus clear local input but do not pause the server.

Early contracts: PlayerState/MoveIntent/WallRect/stepPlayer; stable maze cell and edge IDs; generateMaze(seed, config); shift plans with phase timing and validation reasons; explicit run states; typed server actions and versioned snapshots. No Three.js objects in authoritative state. No Math.random in deterministic rules. Keep configuration versions with reported seeds.

### Collision and shift rules

Start planar: square player footprint, rectangular walls, swept X then Z movement against inflated bounds, fixed camera height. Render and collision use the same geometry descriptors. Gate-imposed pushing uses the same swept movement routine; general rigid-body simulation, gravity, slopes and stairs remain deferred. Consider Rapier only through a focused experiment if the simple controller cannot reliably handle demonstrated requirements.

M1 shifts warn, open replacement routes first, then close existing routes. Validate intermediate and final connectivity. Per the developer's 2026-11-11 revision, occupancy no longer stops or cancels closure: moving stone pushes the player ahead of its leading face; crushing occurs only if the remaining physical space cannot fit the body against an opposing solid. Use a two-second warning, four-second closing, eight-meter danger passages and a longer safe outer loop. Rendered stone and collision use the same pose. Pause freezes the living attempt; after death the mechanism finishes while the player cannot move, and Retry resets the attempt. Gate-imposed displacement respects solid collisions; no teleporting through walls or living-player embedding. One shift plan at a time.

Decision record, 2026-11-11: lethal gates intentionally replace the original early nonlethal rule after the developer tested M1. Follow-up feedback replaces instant contact death with physical pushing followed by crushing when the body no longer fits. Escape input remains usable while being pushed. Long means distance along the player's crossing direction, not only slab width. The first trade-off is a risky short crossing versus a safe longer detour; loot rewards remain deferred to M7/M8. Death/Retry moves forward from later death-loop work only as needed for this gate prototype.

### Tension and wayfinding rules (added 2026-11-11)

Decision record, 2026-11-11: after a concept review the developer approved adding the rules below to the plan, and chose co-op PvE before PvP. They are planned work inside the listed milestones, not permission to start any milestone. The brief is unchanged; where a rule differs from the brief (soft deadline, creature death, PvP timing), this section is the newer decision.

Common requirements for every rule T1–T10:

- All numbers are starting defaults for playtesting. Keep each as a named constant in one tuning module (suggested `game/tuning.ts`); never scatter literals.
- Rules live in pure simulation/game state. Rendering and audio only present state and never decide outcomes.
- Each rule has a development-only on/off toggle so the plain M7 loop can be compared with the rule enabled.
- Pause freezes every timer below. Retry/new run resets every value below unless the rule says it persists.

**T1 — Unrest (the maze reacts to what is carried). M7b, extended M8.**
- State: `unrest`, a non-negative integer equal to the sum of `unrestValue` over carried items. M7b: the relic has `unrestValue` 3. M8: provisions 0, crafting materials 1, relics/seeds 3.
- Effect: seconds between automatic shifts = `max(15, 45 − 6 × unrest)`. Recompute when the carried items change. The new value applies to the next scheduled shift; never shorten a warning or closure already in progress. Warning stays 2 s and closing 4 s.
- Dropping or losing an item lowers unrest immediately.
- No number on the player HUD. Show the value and the current interval in the debug panel only.

**T2 — Dusk bell (a deadline that is heard, not displayed). M7b, extended M10.**
- State: `runClock` in simulation seconds, starting when the player first leaves the Sanctuary cell; `dayPhase` is `day` or `night`.
- Bell events at 150 s (one strike), 195 s (two strikes) and 240 s (three strikes). After the third, `dayPhase = night` until the run ends.
- Night effect: automatic shift interval is fixed at 10 s (overrides T1). Rendering dims ambient light over 10 s; this is presentation only.
- M10 addition: at night the stalker moves 1.25× faster and is always told the player's current cell.
- Extraction still works at night. The Sanctuary entrance never closes: do not add doors that shut at dusk (originality, see the IP risk).
- No countdown, clock or progress bar on the player HUD. Debug panel shows `runClock` and next bell time.

**T3 — Directional sound. M7b, extended M10/M12.**
- Simulation appends plain `SoundEvent { id, kind, x, z, tick }` records to a per-tick list. An audio module in rendering consumes the list. Simulation never reads audio state.
- Kinds in M7b: `shiftWarning` (at the centre of each gate about to move, when warning starts), `gateGrind` (while a slab moves, at the slab centre), `bellToll` (at the Sanctuary centre). Later: `creatureStep` (M10), `trapBell` (M12).
- Use Three.js `AudioListener` and `PositionalAudio` with tones generated in code (oscillators or generated noise buffers). No audio files, no new dependency. Start the audio context on the same click that requests pointer lock.
- Every sound keeps its existing visual equivalent (HUD warning text). Provide master volume and mute. No wall occlusion or muffling in the first version.
- Noise for the creature (M10) is a separate plain record `NoiseEvent { x, z, radius }`: walking 6 m plus 2 m per carried item flagged `noisy`; placing chalk 4 m; crossbow shot 20 m; moving gate 25 m.

**T4 — Chalk marks (the only navigation aid). M7b.**
- Each run starts with 12 chalk charges. Press C to place one mark on the floor at the player's position. The mark is an arrow pointing where the player faces, snapped to the nearest of eight compass directions.
- State: `ChalkMark { id, x, z, headingIndex }` with `headingIndex` 0–7, in run state. Marks cannot be erased or moved in the first version.
- Shifts never move, rotate or delete marks. A slab may physically cover a mark; hide it while covered and show it again when uncovered. An arrow that now points at a closed gate is intended behaviour, not a bug.
- Marks appear on the developer debug map. There is still no player map or minimap.

**T5 — Thread spool. M8.**
- Starter-kit item with 150 m of thread, one per run. Press T to start or stop laying thread. While laying, append the player's position to a polyline after every 1 m travelled and subtract that distance; stop automatically at zero.
- Render a thin line on the floor through the recorded points. Shifts never alter it; a slab may cover part of it.
- No rewinding or pickup in the first version.

**T6 — Gate jam (sacrifice an item to hold a gate). M8.**
- Allowed when a gate is in its closing phase, the player's centre is within 3 m of that gate's passage rectangle and the selected inventory slot holds an item. Press F.
- Result: the item is destroyed permanently, and the gate enters `jammed` for 6 s with its slab frozen at the current pose. Closing then resumes from that pose with the remaining closing time.
- At most one jam per gate per shift plan. Any item may be used, including a relic (unrest then drops by T1).
- A jammed gate is not fully open, so it is not a graph link (M3 rule) and adds no topology revision. A frozen slab blocks like a wall and cannot crush. The paired opening gate is unaffected.
- This is an explicit paid action. Occupancy alone still never holds or cancels a gate (accepted M1 rule).

**T7 — The stalker cannot be killed by the player. M10/M11.**
- The stalker has no health the player can reduce. A crossbow hit sets `staggered` for 4 s: it stops moving and cannot damage, then enters search.
- Closing gates apply the same push-then-crush routine to the stalker's footprint as to the player. A crushed stalker is removed; a replacement spawns in a random outer-ring cell (seeded RNG) after 60 s.
- The stalker emits a `creatureStep` sound event every step so it can be heard through walls.
- This supersedes "creature death" by damage in the brief and the earlier M11 wording. Luring it into a closing passage is the only way to remove it. There is no player-operated crush lever in PvE (see T10).

**T8 — Daily seed and the runner's own traces. M7b, extended M8.**
- M7b: default seed is the UTC date as the integer `YYYYMMDD`. The debug seed entry overrides it. Show the seed on the result screen.
- M8: on death, save `{ seed, configVersion, x, z }` and that run's chalk marks in the versioned local save, keeping only the most recent entry per seed. A later run with the same seed and config shows a cairn at the death position and the old marks in a faded colour. Lost items are not recoverable; the loss rule is unchanged.
- Traces left by other players need hosted storage and belong to separate later planning. Do not add a backend, accounts or network calls for this.

**T9 — Co-op rules that use the shifting maze. M13.**
- Downed state: a player whose health reaches zero while a teammate is alive becomes `downed` for 45 s, then dies. A teammate within 2 m holds E for 3 s to revive at 30 % health. Crushing always kills immediately.
- Carry: a teammate can toggle carrying a downed player with E; the carrier moves at 0.6× speed and cannot fire.
- Hold lever: each dynamic gate pair has one lever at a fixed position in the layout data. While a player holds E on it, that pair's closing gate is frozen in the T6 `jammed` state at no item cost, for at most 10 s per shift plan. The holder cannot move, so a second player is needed to benefit.
- Chalk marks and thread are shared: synchronize by stable ID through the server.
- No in-game voice. Proximity or wall-muffled voice is deferred because of its WebRTC cost; testers use an external voice call.

**T10 — Player-triggered traps (developer idea, PvP only). M13b.**
- A long-cooldown ability lets a player arm or disarm one nearby trap. Placeholder cooldown 120 s; range, eligible traps and counterplay are undecided.
- Do not build any player-operated trap or crusher trigger before M13b.

## Milestones

All milestones inherit the common completion checks above. S/M/L describes relative complexity and uncertainty, not dates. Each entry defines purpose, components, ordered work, human/automated checks, completion, and exclusions.

### M0 — Reliable first-person room (M)

- **Build/why:** A gray room proving browser rendering, controls, collision, pause and build pipeline together.
- **Components:** Vite/TS/Three.js, pure movement, browser input, HTML HUD, Vitest, Playwright.
- **Order:** Scaffold → scene → pointer lock/input → movement/collision → pause/lifecycle → tests/documentation. Detailed contract: `milestones/M0.md`.
- **Human:** Walk, look, collide with walls/block, move diagonally, pause/resume, switch tabs, resize; repeat in production preview.
- **Automated:** Movement/collision tests; production page, rendered canvas, resize and error checks.
- **Done:** All checks pass and developer accepts feel/collision in both dev and preview.
- **Avoid:** Gates, procedural maze, objectives, inventory, enemies, art, persistence, network, gravity/jump/sprint.

### M1 — One moving junction (L)

- **Build/why:** Four-way junction with two gate arrangements; validate the unique physical interaction before a maze.
- **Components:** Pure gate state machine, arrangement fixtures, moving colliders, warning, debug key, rejection display.
- **Order:** Fixture → gate states/travel paths → warning/timing → simulation-driven animation → swept crush detection/death/Retry → diagnostics.
- **Human:** Explore both states, trigger ten changes, stand in each closing path and try entering during movement.
- **Automated:** Phase ordering, repeat triggers, collision-constrained pushing, minimum body clearance, escape while pushed, uninterrupted closure, death/Retry.
- **Done:** Readable two-second warning and four-second closure, eight-meter passages, visible push-before-crush, a usable escape/detour and clean Retry; no living-player clipping.
- **Avoid:** Random/automatic pacing, full maze, polished sound, physics-engine integration.

### M2 — Tiny hand-built maze (M)

- **Build/why:** Recognize routes and return through a small changing network.
- **Components:** Minimal cell/edge types, stable IDs, fixed 5×5 fixture, central start, two dynamic connections, three colored landmarks.
- **Order:** Graph → derived passage geometry → landmarks → M1 gates → return feedback.
- **Human:** Visit every landmark, shift, return without teleport; demonstrate two outward/return routes.
- **Automated:** Endpoint/ID validity, initial connectivity, geometry/edge agreement, safe spawn.
- **Done:** The fixture is navigable with no separately handwritten mesh truth.
- **Avoid:** Seeds, collectibles, complex rooms, polished landmarks.

M2 implementation contract: `milestones/M2.md`. Hand-built cells use 12 m spacing and 4 m corridors so the accepted 8 m gates fit in actual solid wall pockets. M4's original six-meter cells are therefore provisional: choose module sizing compatible with these hazards before generation. M2 adds a visit/return navigation checklist only; M7 remains the extraction gate. Reference scenes remain available via query parameters.

### M3 — Graph validation and visible diagnostics (M)

- **Build/why:** Inspect simulation truth before procedural complexity.
- **Components:** BFS reachability/routes, topology revision, overhead debug view, edge/gate IDs.
- **Order:** Queries → cells/connections/player view → phases → validation/rejections → physical comparison.
- **Human:** Walk while observing debug map; identify changed edges and rejected route changes.
- **Automated:** Connected/disconnected fixtures, paths through open edges only, revisions, view data from live simulation.
- **Done:** Every passage can be explained and invalid route-changing actions are visibly rejected.
- **Avoid:** Player-facing GPS, sophisticated maps, level editor, generic navigation framework.

M3 implementation contract: `milestones/M3.md`. F2 enables a developer-only diagnostic view in this prototype; it starts hidden and is not a final navigation mechanic. Revision versions the set of fully open links, normally twice per completed gate swap. A separate dry-run isolation probe demonstrates the same validation without altering the live maze. Real shift requests validate current, opening and target graphs before warning/motion.

### M4 — Seeded layouts (L)

- **Build/why:** Varied reproducible mazes using the same renderer.
- **Components:** Seeded RNG, canonical traversal order, generation config/validator, seed input.
- **Order:** 13×13 six-meter cells → central 3×3 Sanctuary → three square-distance ring bands → seeded spanning tree → loops/alternative approaches → three landmarks → regeneration. Repair required alternatives with additional grid edges, not unbounded retries.
- **Human:** Inspect 20 seeds, reproduce one exactly, walk every ring.
- **Automated:** 200 fixed seeds: deterministic serialized layout, all cells reachable, rings/landmarks valid, two Sanctuary entrances, principal objectives have alternative return paths.
- **Done:** Tested layouts validate and are physically walkable; seed/config reproduces placements.
- **Avoid:** Bigger worlds, streaming, floors, runtime whole-map replacement, content variety.

M4 implementation contract: `milestones/M4.md`. Sizing decision, 2026-11-11: cells keep M2's 12 m spacing so M5 can reuse the accepted 8 m gates; the grid is 11×11 (not 13×13) because measured median walking time from Sanctuary to an outer cell is 40 s at 3 m/s, fitting the 3–5 minute target. Rings are Sanctuary 3×3, inner, middle, outer by square distance; one entrance per plaza side; one landmark per ring.

### M5 — Safe generated-maze shifts (L)

- **Build/why:** Combine generation/shifting while preserving routes home.
- **Components:** Eligible edges, candidate planner, temporary/final graph checks, M1 crush/contact rules, revisions/logs.
- **Order:** Select a few dynamic edges → plan → validate → phase execution → revision/cancellation logging.
- **Human:** Force 50 changes across seeds, test crossing/retreat/death, visit outer cells during shifts.
- **Automated:** 100 seeds × 100 attempted shifts: accepted plans retain all-cell reachability, intermediate safety, reject isolation and resolve gate pushing and insufficient body clearance consistently.
- **Done:** No accepted plan isolates a region; reasons are observable; physical tests show no embedded player/impossible accepted passage.
- **Avoid:** Concurrent plans, whole-maze movement, final run-duration guarantees. Graph tests do not prove physical safety.

M5 implementation contract: `milestones/M5.md`. Decision, 2026-11-11: eight gates per maze (four start open), each with its own pillar-block pocket. Open-gate corridors are chosen so the static corridors alone connect every cell and keep each landmark's second route, so no gate arrangement can isolate a region; the validator still checks every plan and its rejection path is tested with a fixture. Shifts stay player-triggered (G) until M7.

### M6 — Reproduction/stability gate (M)

- **Build/why:** Make bugs cheap to reproduce.
- **Components:** Seed/force/freeze/teleport debug controls, bounded event log, reproducible scenarios.
- **Order:** Consolidate controls → expose config/revision/player cell → record edge IDs/reasons → copyable report → scenarios.
- **Human:** Reproduce a report from seed, position and shift sequence; explore for ten minutes.
- **Automated:** Replay logical gate sequences, validate teleport targets, resource disposal, repeated regeneration browser check.
- **Done:** Reports reproduce specific states; no unexplained errors during the exploration test.
- **Avoid:** General replay engine, telemetry, editor, large debug infrastructure. Debug cheats stay development-only.

M6 implementation contract: `milestones/M6.md`. Reports replay the seed's shift requests and the ticks the last plan advanced, which rebuilds gate poses exactly without recording input. Seed changes still reload the page, so disposal is the browser's; the browser check loads ten seeds in a row.

### M7 — Complete solo extraction (M)

- **Build/why:** Test fun in outward travel and changed return routes.
- **Components:** One outer relic, E interaction, run states, extraction zone, result/reset/abandon.
- **Order:** Relic → pickup → warned automatic shifts → Sanctuary extraction → time/shifts result → restart/failure.
- **Human:** Five complete runs on three seeds plus an abandonment; experience an altered return route and describe a meaningful choice.
- **Automated:** Interaction range, unique ownership, extraction conditions/exactly-once terminal state, restart, no rewards for abandon.
- **Done:** Unaided complete loop with understandable changes and meaningful decisions. If dull/unfair, improve navigation/pacing here.
- **Avoid:** Inventory, upgrades, combat, map expansion, art. Start with 2 s warning, 45 s interval, no hard deadline.

M7 implementation contract: `milestones/M7.md`. Navigation aids chosen for the first test: a blue light beam over the relic and a gold beam over Sanctuary, visible above the walls. Extraction is entering the Sanctuary plaza with the relic; G stays as a debug force.

### M7b — Pressure and wayfinding (M)

- **Build/why:** Give the accepted M7 loop reasons to hurry and one tool to navigate, each switchable, and test whether the return becomes tenser. Requires M7 acceptance. Rules T1, T2, T3, T4 and the M7b part of T8.
- **Components:** Tuning constants module, unrest, run clock/dusk phase, sound-event list and generated-tone audio module, chalk marks, daily seed, debug toggles/readouts.
- **Order:** Daily seed → sound events and audio for existing shift warnings → unrest → dusk bell and night → chalk → per-rule debug toggles → documentation. Add and verify one rule at a time; the app stays runnable after each.
- **Human:** Play three runs with every rule off, then three with every rule on, on the same seed. Locate a shifting gate by ear with the HUD warning hidden. Pick up the relic and notice faster shifts. Stay out past the third bell and return at night. Place all 12 marks and find one made misleading by a shift. Check volume and mute.
- **Automated:** Interval formula at unrest 0, 3 and the 15 s floor; a running warning is never shortened; bell events fire once at 150/195/240 s and not while paused; night interval is 10 s; sound events carry the correct gate positions; chalk count never exceeds 12 and marks survive shifts unchanged; same UTC date gives the same seed; Retry resets clock, unrest, marks and phase.
- **Done:** Developer judges the rules-on runs tenser and still fair, or records which rule to retune or remove. Baseline M7 behaviour is unchanged with every toggle off.
- **Avoid:** HUD countdowns, player map, audio files, wall occlusion, thread, gate jam, creatures, closing Sanctuary doors, any backend for shared traces.

### M9 — Early two-client synchronization (L, high risk)

- **Build/why:** Prove multiplayer before inventory/AI/combat coupling.
- **Components:** Local Node server, ws/tsx, typed actions/snapshots, two clients.
- **Order:** Server simulation → initial state → movement intentions → snapshots → gate phases → contested pickup → join/disconnect/latency checks.
- **Human:** Two clients move, observe 20 shifts, race for ten pickups, repeat under 100 ms added RTT.
- **Automated:** Server collision/authority, one pickup winner, equal committed revisions, current state on fresh join, input expiry, no client-awarded extraction.
- **Done:** Agreement on all checks. Review after three focused sessions; unresolved problems defer multiplayer, preserving solo.
- **Avoid:** Accounts/matchmaking/hosting/persistent inventories/client prediction/four players/security claims. Defaults: 60 Hz sim, 20 Hz inputs, 10 Hz snapshots; remote interpolation. Disconnect removes player, rejoin starts fresh.

### M8 — Loot, capacity, failure and offline stash (M)

- **Build/why:** Minimal push/return reward decisions.
- **Components:** Three categories, six non-stacking slots, pickup/drop, versioned local save; per-item `unrestValue` and `noisy` flag (T1, T3), thread spool (T5), gate jam (T6), cairn and faded marks (T8).
- **Order:** Inventory → capacity → selection/drop → exactly-once extraction transfer → failure loss → stash save → free starter kit → item unrest values → thread → gate jam → cairn/faded marks.
- **Human:** Fill/reject/drop/replace/extract/reload/fail; compare stash and retry after repeated loss. Notice shifts speeding up as slots fill and slowing after a drop. Lay thread until it runs out. Jam a closing gate with an item and cross; confirm the item is gone. Die, restart the same seed and find the cairn and faded marks.
- **Automated:** Capacity/ownership, duplicate prevention, transfer once, failure/reset, malformed/unsupported save handling, starter availability. Unrest equals the carried sum after every pickup/drop/jam; thread length never goes below zero; jam only in closing phase and range, destroys exactly one item, lasts 6 s, once per gate per plan, adds no topology revision; one cairn per seed, never restoring items.
- **Done:** Extracted items persist, failed-run items do not, failure never prevents starting again.
- **Avoid:** Weight/stacking/nesting/trade/durability/economy, thread rewinding, chalk erasing, other players' traces. Offline saves remain separate from ephemeral online sessions.

### M10 — One route-aware creature (L)

- **Build/why:** Threaten navigation without a large combat system.
- **Components:** Primitive stalker, idle/patrol/investigate/chase/search, graph paths, simple sight, T3 noise events, contact damage to the player, gate push/crush and respawn (T7), step sounds, night behaviour (T2).
- **Order:** Patrol → noise → chase → lose/search → topology replanning → contact damage/player death integration → gate push/crush of the stalker → 60 s respawn → step sounds → night speed/tracking.
- **Human:** Attract, break sight, lead through shifts, evade, deliberately die. Hear it through a wall and point to its side. Lure it into a closing passage and see it crushed, then meet the replacement. Compare day and night pursuit.
- **Automated:** States, wall occlusion, route revisions, unreachable fallback, damage cooldown/player death once. Stalker is pushed and crushed by the shared routine, removed once, respawns after 60 s in an outer-ring cell from the seeded RNG; noise radius grows with noisy items; night multiplier applies only in night phase.
- **Done:** Threat can pursue/lose/reroute without repeatedly colliding with blocked routes.
- **Avoid:** Behavior-tree framework, rigs, extra archetypes, elaborate senses, player-depletable stalker health, crush levers, sound occlusion.

### M11 — One primitive weapon (M)

- **Build/why:** Limited defense with little combat scope. Per T7 the crossbow buys time; it does not kill the stalker.
- **Components:** Crossbow, ammo, swept projectiles, 4 s stagger, hit feedback, shot noise event.
- **Order:** Fire → ammo → wall/target sweep → authoritative hit → stagger and recovery to search → shot noise → restart integration.
- **Human:** Hit walls/creature, miss, exhaust ammo, stagger the creature and escape through a gate, die carrying loot.
- **Automated:** Cadence/ammo bounds, no projectile tunneling, walls block, one stagger per hit lasting 4 s, staggered creature cannot damage, a shot emits one 20 m noise event.
- **Done:** Delay or evade; ammo matters; death/inventory remain consistent.
- **Avoid:** Hatchet unless a demonstrated gap, combos, models, ballistics, upgrades, ammo variants, killing the stalker with damage.

### M12 — Ring identity, landmarks and one trap (M)

- **Build/why:** Read location/risk without GPS.
- **Components:** Ring reward/threat settings, three silhouettes, noisy tripwire emitting a T3 `trapBell` sound and a noise event, audio and visual equivalents reusing the M7b volume control.
- **Order:** Reward pools → landmarks → threat pressure → trap/noise investigation → settings/cues.
- **Human:** Navigate via landmarks, compare rings, trigger trap and observe response.
- **Automated:** Seeded loot, valid spawns, ring rules, trap reset/cooldown, noise delivery, landmark reachability.
- **Done:** Tester recognizes areas, understands the trap and outward incentive.
- **Avoid:** Biomes, realistic water, elaborate art, size increases just for longer runs.

### M13 — Small co-op PvE session (L, conditional)

- **Build/why:** Two friends against the maze and its creature; shifts separate and reunite them. Co-op comes before PvP per the 2026-11-11 decision. Requires passing M9 and renewed multiplayer priority. Rules T9.
- **Components:** Shared AI/health/projectiles/drops, safe Sanctuary, individual extraction, downed/revive/carry, hold levers, shared chalk/thread, session reset. No player-versus-player damage.
- **Order:** Extend authority → two players → shared creature and loot → shared marks → downed/revive → carry → hold lever → all-finished reset.
- **Human:** Two people play three sessions: get split by a shift and regroup using marks, hold a lever for the other, revive and carry through a closing passage, one extracts while the other is still out.
- **Automated:** Pickup races, damage authority, players cannot damage each other, downed timer/revive/carry state, crush kills a downed or carried player, lever freeze capped at 10 s and released when the holder moves or disconnects, mark IDs agree on both clients, exactly-once drops, extracted-player isolation, reset/late join.
- **Done:** No duplication/contradictions; both players agree on gate, lever and downed state; latency does not make crushing feel arbitrary.
- **Avoid:** PvP damage, four players before two stable, in-game voice, teams/settings/matchmaking/persistent online inventory. If skipped, mark deferred.

### M13b — PvP option (L, conditional)

- **Build/why:** Let rival players compete in the same maze only after co-op is stable and the developer renews the priority. Requires M13 acceptance.
- **Components:** Player-versus-player damage outside the Sanctuary, loot drops on death, separated entry points, T10 trap ability.
- **Order:** Damage outside safety → death drops → protection near Sanctuary → separated entries → trap arm/disarm ability with long cooldown.
- **Human:** Two people play three sessions: contested items, gate fights, creature attraction, extraction camping, trap ability use and counterplay.
- **Automated:** Damage authority, Sanctuary safety, exactly-once drops, ability cooldown enforced by the server, no duplicate trap triggers.
- **Done:** Camping, latency and the trap ability do not make the loop unusable or unfair.
- **Avoid:** Ranked play, teams, matchmaking, persistent online inventory, more than one ability. If skipped, mark deferred.

### M14 — Sanctuary progression (M, optional)

- **Build/why:** Test whether preparation deepens a proven loop; default defer until demo stable.
- **Components:** Fixed facilities, one seed/crop/buff, one crafting recipe.
- **Order:** Seed extraction → plant → growth by attempted expeditions → harvest → one-run buff → materials-to-ammo recipe.
- **Human:** Complete cycle, reload between stages, fail a buffed run, inspect persistence.
- **Automated:** Conservation, crafting/harvest once, growth, buff consumption/expiry, versioned saves.
- **Done:** Useful preparation without wall-clock waiting. Candidate crop: Bitterleaf detection reduction.
- **Avoid:** Free building, repair system, trade, extra crops, stacking/permanent combat advantages.

### M15 — Finishable browser demo (M–L)

- **Build/why:** Make accepted systems understandable to a new player.
- **Components:** Limited materials/audio, menus/prompts/settings, release-mode debug removal, documentation/profiling.
- **Order:** Selected placeholders → silhouettes → onboarding/extraction guidance → sensitivity/volume → remove cheats → profile/fix → regressions.
- **Human:** New tester completes unaided; five-minute representative performance run.
- **Automated:** Full suite/production smoke, extraction/failure/save reload, no release cheats, network regressions if included.
- **Done:** No blocking defects, unaided completion, 1080p median ≥55 FPS and p95 frame time ≤33 ms on recorded M0 reference hardware.
- **Avoid:** New mechanics, content expansion, backend commercialization, final art overhaul. Reduce cost before scope expansion.

## Risks and decisions

| Risk | Likelihood/impact | Early experiment | Fallback |
| --- | --- | --- | --- |
| Gate clipping/traps | High/high | M1 crush/escape tests | Clear cues, slow closure, shorter hazards if unfair |
| Arbitrary navigation | High/high | M2/M7 human runs | Stable landmarks, warnings, fewer shifts |
| Multiplayer consumes project | High/very high | M9 | Ship solo |
| Procedural chokepoints/confusion | Medium/high | M4 corpus and inspection | Smaller grids, curated fixtures, validation |
| Mutable AI paths | High/medium | M10 forced closures | Graph replanning, fewer creatures |
| Long dull walks | Medium/high | M7 short runs | Better choices before bigger map |
| Browser performance | Medium/high | M6/M15 | Resolution cap, simple materials, fewer objects/effects |
| Duplicate/corrupt inventory | Medium/high | M8 reload/extraction | Explicit ownership, once-only transitions, versioned saves |
| Art production | High/high | Placeholder-first gates | Tiny modular kit, silhouettes, no rigs |
| Inconsistent AI code | High/high | Every diff | Small modules, contracts, tests |
| Feature creep | High/very high | Each gate | One weapon/creature; defer progression |
| Imitation/IP | Medium/medium | Pre-art review | Original names, lore, architecture and motifs; Sanctuary never shuts at dusk |
| Pressure rules hide a weak core loop or feel unfair | Medium/high | M7b toggled comparison runs | Retune or remove single rules; keep baseline M7 |
| Audio blocked or unclear in browsers | Medium/medium | M7b locate-by-ear check | Visual equivalents stay; start audio on first click |

Defaults/decision checkpoints: solo release accepted; no player map initially (review M7); developer map M3; closing gates that push before crushing with insufficient body clearance M1 (revised 2026-11-11); connected extraction and objective alternatives M4–5; 3–5 min/no deadline M7; unrest, dusk bell at 240 s, generated directional sound, 12 chalk marks and daily seed M7b; six non-stacking slots, thread, gate jam and cairn M8; stalker removable only by crushing M10; crossbow only, stagger not kill M11; co-op PvE M13 before PvP M13b; player trap ability PvP-only M13b; fixed safe Sanctuary; garden/workshop optional M14; authoritative two-client ephemeral sessions M9. Accounts, hosting, matchmaking and online progression require separate later planning. Record any change and update acceptance criteria rather than silently treating proposals as requirements.

## Testing and AI-friendly workflow

Pure tests cover movement, seeds, graph topology, shifting, inventory, run rules. Integration checks compare graph, geometry and gate poses. Fixed seed/config corpora retain regressions. Browser tests exercise production output/errors/reset/save flows. Server and multi-client tests cover authority/ownership/revisions. Humans judge feel, legibility, fairness and fun. Measure performance on recorded developer hardware; cloud rendering is not evidence of laptop performance.

Each session: read brief/plan/progress → inspect existing changes → state one approved task/result → make a small change/tests → run focused plus required milestone checks → report behavior/launch/evidence/limits → update progress → stop at manual gate. Use a milestone branch when practical, no worktrees unless requested, and commit checkpoints when requested/permitted. Never reset user changes or assume local files exist on GitHub.

Review: serves current milestone? one clear state owner? rules independent of renderer? unnecessary dependencies/abstractions? previous behavior preserved? can the human demonstrate it? Do not use sweeping rewrites to resolve routine issues.
