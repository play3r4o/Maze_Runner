# Shifting Labyrinth — Development plan

Working title only. Source context: `../project_brief.md` (lowercase filename).

## Starting point and release scope

The planning inspection found only the brief: no application, dependencies, tests, or commits. Do not mistake proposed work for completed work; current evidence belongs in `progress.md`.

The full brief is too ambitious for a beginner's first release. The agreed fallback is a complete solo demo. Multiplayer is conditional on a successful small proof; garden/workshop are optional follow-up work.

| Outcome | Contents | Gate |
| --- | --- | --- |
| Solo maze proof | Primitive first person, warned shifting passages, one relic, return/extract | M7: complete runs produce understandable route decisions |
| Multiplayer proof | Two clients, authoritative movement/gates/one pickup | M9: agreement including contested pickups |
| First demo | Solo loop, inventory/stash, one creature, one crossbow, three landmarks, one trap, simple presentation | M15: a new tester finishes without coaching |

Prototype expeditions target 3–5 minutes. Expand toward 15–20 minutes only if playtesting justifies it. One biome, one floor, primitive geometry, no giant world.

## Working rules

Order: **M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M9 → M8 → M10 → M11 → M12 → M13 (conditional) → M14 (optional) → M15**.

Retain the brief's IDs. Introduce pure state early; M3 strengthens it rather than replacing mesh-based rules. Move M9 ahead of inventory/AI/combat. Split large milestones into small sessions, but never advance without human acceptance.

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

### M5 — Safe generated-maze shifts (L)

- **Build/why:** Combine generation/shifting while preserving routes home.
- **Components:** Eligible edges, candidate planner, temporary/final graph checks, M1 crush/contact rules, revisions/logs.
- **Order:** Select a few dynamic edges → plan → validate → phase execution → revision/cancellation logging.
- **Human:** Force 50 changes across seeds, test crossing/retreat/death, visit outer cells during shifts.
- **Automated:** 100 seeds × 100 attempted shifts: accepted plans retain all-cell reachability, intermediate safety, reject isolation and resolve gate pushing and insufficient body clearance consistently.
- **Done:** No accepted plan isolates a region; reasons are observable; physical tests show no embedded player/impossible accepted passage.
- **Avoid:** Concurrent plans, whole-maze movement, final run-duration guarantees. Graph tests do not prove physical safety.

### M6 — Reproduction/stability gate (M)

- **Build/why:** Make bugs cheap to reproduce.
- **Components:** Seed/force/freeze/teleport debug controls, bounded event log, reproducible scenarios.
- **Order:** Consolidate controls → expose config/revision/player cell → record edge IDs/reasons → copyable report → scenarios.
- **Human:** Reproduce a report from seed, position and shift sequence; explore for ten minutes.
- **Automated:** Replay logical gate sequences, validate teleport targets, resource disposal, repeated regeneration browser check.
- **Done:** Reports reproduce specific states; no unexplained errors during the exploration test.
- **Avoid:** General replay engine, telemetry, editor, large debug infrastructure. Debug cheats stay development-only.

### M7 — Complete solo extraction (M)

- **Build/why:** Test fun in outward travel and changed return routes.
- **Components:** One outer relic, E interaction, run states, extraction zone, result/reset/abandon.
- **Order:** Relic → pickup → warned automatic shifts → Sanctuary extraction → time/shifts result → restart/failure.
- **Human:** Five complete runs on three seeds plus an abandonment; experience an altered return route and describe a meaningful choice.
- **Automated:** Interaction range, unique ownership, extraction conditions/exactly-once terminal state, restart, no rewards for abandon.
- **Done:** Unaided complete loop with understandable changes and meaningful decisions. If dull/unfair, improve navigation/pacing here.
- **Avoid:** Inventory, upgrades, combat, map expansion, art. Start with 2 s warning, 45 s interval, no hard deadline.

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
- **Components:** Three categories, six non-stacking slots, pickup/drop, versioned local save.
- **Order:** Inventory → capacity → selection/drop → exactly-once extraction transfer → failure loss → stash save → free starter kit.
- **Human:** Fill/reject/drop/replace/extract/reload/fail; compare stash and retry after repeated loss.
- **Automated:** Capacity/ownership, duplicate prevention, transfer once, failure/reset, malformed/unsupported save handling, starter availability.
- **Done:** Extracted items persist, failed-run items do not, failure never prevents starting again.
- **Avoid:** Weight/stacking/nesting/trade/durability/economy. Offline saves remain separate from ephemeral online sessions.

### M10 — One route-aware creature (L)

- **Build/why:** Threaten navigation without a large combat system.
- **Components:** Primitive stalker, idle/patrol/investigate/chase/search, graph paths, simple sight/noise, health/contact damage.
- **Order:** Patrol → noise → chase → lose/search → topology replanning → contact damage/death integration.
- **Human:** Attract, break sight, lead through shifts, evade, deliberately die.
- **Automated:** States, wall occlusion, route revisions, unreachable fallback, damage cooldown/death once.
- **Done:** Threat can pursue/lose/reroute without repeatedly colliding with blocked routes.
- **Avoid:** Behavior-tree framework, rigs, extra archetypes, elaborate senses.

### M11 — One primitive weapon (M)

- **Build/why:** Limited defense with little combat scope.
- **Components:** Crossbow, ammo, swept projectiles, damage, hit feedback.
- **Order:** Fire → ammo → wall/target sweep → authoritative damage → creature death → restart integration.
- **Human:** Hit walls/creature, miss, exhaust ammo, defeat creature, die carrying loot.
- **Automated:** Cadence/ammo bounds, no projectile tunneling, walls block, damage/kill once, dead entities cannot attack.
- **Done:** Fight or evade; resources matter; death/inventory remain consistent.
- **Avoid:** Hatchet unless a demonstrated gap, combos, models, ballistics, upgrades, ammo variants.

### M12 — Ring identity, landmarks and one trap (M)

- **Build/why:** Read location/risk without GPS.
- **Components:** Ring reward/threat settings, three silhouettes, noisy tripwire, audio and visual equivalents/volume control.
- **Order:** Reward pools → landmarks → threat pressure → trap/noise investigation → settings/cues.
- **Human:** Navigate via landmarks, compare rings, trigger trap and observe response.
- **Automated:** Seeded loot, valid spawns, ring rules, trap reset/cooldown, noise delivery, landmark reachability.
- **Done:** Tester recognizes areas, understands the trap and outward incentive.
- **Avoid:** Biomes, realistic water, elaborate art, size increases just for longer runs.

### M13 — Small PvPvE session (L, conditional)

- **Build/why:** Humans/gates/creatures meaningfully interact. Requires passing M9 and renewed multiplayer priority.
- **Components:** Shared AI/health/projectiles/drops, safe Sanctuary, individual extraction, session reset.
- **Order:** Extend authority → two players → damage outside safety → death drops → protection → all-finished reset.
- **Human:** Two people play three sessions: contested items, gate fights, creature attraction, extraction camping.
- **Automated:** Pickup races, damage authority, safety, exactly-once drops, extracted-player isolation, reset/late join.
- **Done:** No duplication/contradictions; camping/latency do not make loop unusable.
- **Avoid:** Four players before two stable, teams/settings/matchmaking/persistent online inventory. If skipped, mark deferred.

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
| Imitation/IP | Medium/medium | Pre-art review | Original names, lore, architecture and motifs |

Defaults/decision checkpoints: solo release accepted; no player map initially (review M7); developer map M3; closing gates that push before crushing with insufficient body clearance M1 (revised 2026-11-11); connected extraction and objective alternatives M4–5; 3–5 min/no deadline M7; six non-stacking slots M8; crossbow only M11; fixed safe Sanctuary; garden/workshop optional M14; authoritative two-client ephemeral sessions M9. Accounts, hosting, matchmaking and online progression require separate later planning. Record any change and update acceptance criteria rather than silently treating proposals as requirements.

## Testing and AI-friendly workflow

Pure tests cover movement, seeds, graph topology, shifting, inventory, run rules. Integration checks compare graph, geometry and gate poses. Fixed seed/config corpora retain regressions. Browser tests exercise production output/errors/reset/save flows. Server and multi-client tests cover authority/ownership/revisions. Humans judge feel, legibility, fairness and fun. Measure performance on recorded developer hardware; cloud rendering is not evidence of laptop performance.

Each session: read brief/plan/progress → inspect existing changes → state one approved task/result → make a small change/tests → run focused plus required milestone checks → report behavior/launch/evidence/limits → update progress → stop at manual gate. Use a milestone branch when practical, no worktrees unless requested, and commit checkpoints when requested/permitted. Never reset user changes or assume local files exist on GitHub.

Review: serves current milestone? one clear state owner? rules independent of renderer? unnecessary dependencies/abstractions? previous behavior preserved? can the human demonstrate it? Do not use sweeping rewrites to resolve routine issues.
