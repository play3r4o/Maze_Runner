Shifting Labyrinth — Project Brief for Codex

Status: Pre-production / concept planning. No implemented gameplay has been confirmed.
Working title: Shifting Labyrinth (placeholder; do not assume this is the final game title).
Purpose of this document: Give Codex enough context to turn the concept into an actionable, beginner-friendly engineering and production plan. This is a game-design and technical brief, not a request to implement the full game immediately.

Design amendment — 2026-11-11

The developer revised the early nonlethal gate rule after testing M1. Updated after follow-up feedback: closing stone first pushes the character toward the opposite wall, and kills only when there is no longer enough space for the full body to fit. Contact alone is not lethal. Gates never hold/cancel for occupancy, and the player can still escape along the passage while being pushed. Defaults remain a two-second warning, four-second closing and eight-meter-long danger passages. Keep the longer outer detour, clear warnings, collision-constrained pushing, and death/Retry. This amendment supersedes conflicting no-crushing rules below and the first instant-kill-on-contact prototype. Other scope limits remain in force.

1. Executive summary

Build a browser-based, first-person, stylized 3D, extraction-survival game with an eventual small-scale multiplayer PvPvE mode. The game takes place in an immense ancient, physically shifting labyrinth, with a safe settlement (the Sanctuary) at its center.

Players begin at the Sanctuary, prepare a modest loadout, and enter a procedurally generated maze. The maze has three concentric danger rings: the farther outward players travel, the more valuable the potential loot and the more dangerous the enemies, hazards, navigation, and rival scavengers. The maze changes while players are inside it: stone walls, gates, passages, and junctions shift through ancient mechanical systems. A previously useful route may close; another may open. Players must decide how far to push, what to collect, when to return, and how to survive the trip home. Only loot extracted successfully becomes permanent progression.

Between runs, players store their haul, make limited equipment upgrades, and use a small garden to cultivate plants that offer situational expedition buffs. This home progression is meant to deepen the extraction loop, not become a second fully featured construction game.

The core fantasy is venturing into the unknown, learning a changing labyrinth, and trying to return with something worth the risk. The game’s unique mechanic is the journey back through a different route network, especially when noise, monsters, other players, and limited supplies complicate the choice.

The project must be achievable by one beginner developer using AI coding assistance. The immediate priority is to prove the maze mechanic with ugly primitive geometry, then progressively build one tiny, human-testable vertical slice. Do not build an AAA scope, giant open world, complex backend, large content library, or elaborate art pipeline at the outset.

2. Current decisions, proposed defaults, and open questions

Decisions made so far

• Primary platform: Desktop web browsers. A downloadable desktop build is not an immediate requirement.
• Technology direction: Three.js + TypeScript + Vite, not Unreal Engine. Three.js is a renderer/library rather than a complete game engine; supporting systems will need to be built or integrated.
• Presentation: First-person 3D with accessible, stylized, low-detail visuals. Not 2D or top-down as the primary camera.
• World: A central safe base surrounded by a procedural shifting maze divided into inner, middle, and outer rings.
• Genre: Extraction survival. PvPvE multiplayer is part of the long-term identity, though the first prototypes should be playable alone.
• Art direction: Primitive, mysterious, ancient-mechanical fantasy, not modern sci-fi or military realism.
• Progression: Extract loot, keep it at the sanctuary, prepare future runs; a small garden offers consumable/situational benefits.
• Development style: Short milestones where every completed step can be launched and manually verified by a human. Automated tests should reinforce—not replace—those checks.
• Development constraint: Solo novice creator, extensive use of AI assistance, limited art/animation/backend capacity. Finishing is more important than feature count.

Working proposals, not final decisions

• Target 15–20-minute expeditions once enough content exists.
• Start multiplayer tests with two clients, then perhaps 2–4 simultaneous players, not dozens.
• Treat the Sanctuary as an unraidable safe hub, with shared instanced maze expeditions. Private persistent home state and matchmaking are later design/architecture questions.
• Represent maze topology using a 2D grid/graph rendered in 3D, largely one floor initially. Occasional special rooms, stairs, and bridges can come later.
• Keep most rooms and landmarks spatially recognizable while selected connections/gates move; do not randomly rebuild the entire map around occupied players every few seconds.
• Have multiple viable return approaches to minimize extraction camping.
• Start with crossbow + hatchet, one enemy archetype, three landmarks, three broad loot classes, one trap, one crop, and basic stash/crafting.
• Use an authoritative multiplayer server eventually, likely with WebSocket communication, but avoid choosing a large online-services stack before the multiplayer proof-of-concept.
• Consider Rapier 3D for collisions/physics once movement and moving walls require robust simulation. Confirm its suitability before finalizing architecture.
• Use HTML/CSS UI over the canvas for early HUD, menus, inventory, debug panels, and interaction prompts. No frontend framework is required just to start.

Open design questions to resolve by prototypes or explicit decisions

• Shift pacing, warnings, whether shifts are timer-based, player-triggered, or both.
• What is guaranteed during a shift: perpetual connectivity, minimum route redundancy, remaining travel time, and handling of characters standing in a closing gate.
• How big a maze must be to sustain a 15–20-minute run; desired movement speed and route length.
• Whether the player has no map, a limited hand-drawn map, or a map that becomes outdated as the maze changes. Do not assume an omniscient GPS minimap.
• Whether there is a time limit/lockdown, how extraction works exactly, and what happens if the player cannot return before the limit.
• How PvP interacts with Sanctuary safety and how to reduce camping at return gates.
• Inventory capacity, stackability, death consequences, starter gear, and progression economy.
• Hosting, accounts, matchmaking, reconnects, persistence, anti-cheat, and multiplayer deployment architecture.
• Exact enemy, weapon, trap, and garden designs. Treat examples below as prototype candidates.

Codex should flag these as assumptions or decision records, not silently present them as settled requirements.

3. Design pillars and intended player experience

1. Navigation is gameplay. Recognizing landmarks, listening for shift cues, understanding gate types, and making route choices must be valuable skills.
2. Risk versus reward is constant. Each additional corridor outward offers better potential loot while increasing the chance of death or a difficult return.
3. A changing maze is legible and fair. Shifts should be announced and follow understandable rules. Difficulty should arise from decisions under pressure, not unavoidable random softlocks or sudden invisible walls.
4. The return journey is a centerpiece. The player must navigate a changed environment while carrying something worth protecting. This differentiates the game from a generic loot-and-shoot.
5. PvPvE systems interact. A fight attracts a creature; a shifting gate interrupts a pursuit; a noisy mechanism reveals a rival; loot objectives create competing route choices. PvP should leverage the maze rather than merely occur inside it.
6. Sanctuary feels persistent and valuable. The crude settlement, garden, stash, and upgrades are a reassuring contrast to the hostile maze.
7. Small, cohesive production scope. Fewer mechanics with meaningful interactions are preferred over many shallow features.

The prototype should be evaluated on whether players naturally say things like: “We have enough loot; we should turn back,” “I know another route near the bell tower,” or “The passage we used before has shifted.”

4. Setting, theme, and art direction

The setting is an isolated, primitive settlement inside a gigantic ancient labyrinth whose original purpose is unknown. The inhabitants survive by scavenging resources from the shifting structure. The world is mysterious, partly reclaimed by nature, and only partially understood.

Visual language

• Materials: large weathered stone blocks, timber, rope, cloth, rusted iron, moss, roots, simple foliage, fire, and lanterns.
• Mechanisms: giant gears, chains, counterweights, pulleys, sliding stone slabs, rails, bells, water-driven machinery. Avoid electronics, firearms, holograms, high-tech panels, and industrial sci-fi signage.
• Modeling: chunky forms, strong silhouettes, repeatable modular wall/floor/arch/gate pieces, modest textures, restrained prop density. Aim for something closer to a coherent stylized indie/retro 3D game than a realistic cinematic render.
• Atmosphere: fog, shadows, simple but effective lighting, environmental audio, contrast between warm Sanctuary and unsettling outer maze.
• Characters: simple stylized figures wearing hoods, cloth masks, scarves, backpacks, and rough equipment; minimize facial/animation complexity.
• UI: minimal, functional first-person HUD; inventory hotbar and interaction prompts; compass or limited mapping are candidates, not finalized mechanics.

Important scope distinction: Previously generated visual concepts are aspirational references, not a requirement to reproduce their high density of props, realistic lighting, water, cloth, or character detail. For several early milestones, visuals should be plain gray boxes and colored debug landmarks.

Area identity

• Sanctuary: grassy clearing, campfires, crude huts, workshop, storage, garden plots, improvised structures made from reclaimed maze components; safe and warm.
• Inner ring: more navigable and familiar; common supplies, mild threats, evidence of frequent scavenger traffic.
• Middle ring: higher-value components, larger landmarks, greater shift pressure, traps and creature encounters.
• Outer ring: rare seeds/relics/materials, unfamiliar flora and architecture, more dangerous creatures and hazards, difficult exit planning.

Candidate handcrafted landmarks, placed in procedurally generated layouts:

• Bell Tower: a cracked bronze bell rings before or during a shift, creating a memorable audio/navigation cue.
• Flooded Shrine: partially submerged stone courtyard with an unusual statue, water, and a valuable objective.
• Bone Garden: pale plants growing through enormous bones in an eerie outer-ring location.
• Other optional ideas: Hanging Tree, quarry, collapsed bridge, enormous wall mechanism.

For MVP, pick three landmarks and implement them as simple geometric silhouettes before polishing them.

5. Core gameplay loop

1. Prepare at Sanctuary. Select simple equipment and consumables from a limited stash. Optionally take a cultivated garden buff.
2. Enter a new maze expedition. A procedural seed produces a new traversable layout with three ring zones, landmarks, objectives, traps, and loot.
3. Explore outward. Navigate junctions and changing connections. Use landmarks and auditory cues. Encounter increasingly valuable loot and increasingly dangerous situations.
4. Decide whether to push or return. Inventory capacity, resources, enemies, shift timing, and rival-player activity create risk-versus-reward decisions.
5. Return to an extraction entrance at Sanctuary. Routes may have changed; surviving is not assured. Reaching safety finalizes the haul.
6. Update persistent progression. Transfer loot to stash, craft or upgrade limited equipment, tend garden, and prepare another expedition.

Loss, success, and progression

• Successful extraction: carried loot is transferred to persistent stash.
• Death / failed extraction: unextracted loot and carried gear are lost (subject to future balancing). Permanent Sanctuary progression remains.
• Recovery: provide a very inexpensive starter kit so repeated failure does not make the game unplayable.
• Campaign scope: do not require a narrative campaign for MVP. Exploration and meta-progression should motivate replayability.

6. Maze generation and shifting — the key system

Fundamental world representation

Build a pure TypeScript maze simulation distinct from the Three.js renderer. The simulation stores the authoritative abstract maze state; Three.js visualizes it. Do not encode maze logic implicitly in scattered wall meshes.

The prototype can begin with a grid of cells and edges. Each cell may have coordinates, ring assignment, room/module type, and optional landmark/objective metadata. Each neighboring connection can be open, closed, or shift-capable. Give every cell/junction/gate stable IDs.

The Sanctuary sits in the center and three concentric regions extend outward. The initial implementation should remain mostly planar even though it is rendered in 3D.

Generation requirements

• Use a deterministic seed: the same seed and generation configuration must reproduce the same logical layout.
• Start from a connected graph, with reasonable loops rather than only one path through a perfect maze.
• Place a fixed central Sanctuary/entry area and ensure meaningful routes into all three rings.
• Ensure several ways to travel outward and return; do not create mandatory single choke points by accident.
• Place a limited number of special landmarks into suitable cells while preserving reachability.
• Keep a clear boundary between generation, validation, maze state mutation, rendering, and player movement.
• In developer tooling, show current maze seed, player cell, ring, open/closed connections, and shifting edges.

Do not over-engineer a giant procedural world. Begin with one moving junction, then a tiny hand-built maze, then a generated grid sized for easy visual inspection, and only then expand.

Shift requirements

• Most of the level can be static; selected barriers/junctions change connectivity using a small set of understandable transitions.
• Telegraph impending shifts via a basic timer/light/audio cue; later use bells, grinding stone, chains, dust, and mechanisms.
• Separate shift phases: select/validate planned change → warn → animate → commit updated connectivity/collision → apply cooldown.
• For the early prototype, do not allow walls to crush players, intersect occupied positions, or strand players in permanently isolated compartments. A closing gate can delay/abort or use a safe, clearly defined rule.
• Perform graph checks before committing changes. At minimum, ensure the player’s navigable region still has a route to extraction; later enforce fair route length and viable alternatives.
• Avoid defining “reachable” solely as an abstract graph path when the travel time, physical geometry, or shift animation makes it impossible.
• Players must never disagree about which passage is open once multiplayer is added.

Maze movement design nuance

Avoid regenerating the entire 3D map while players are in it. Preserve stable room identities and landmarks; shift corridors, gates, and junction connections. This makes navigation learnable and substantially simplifies collisions, pathfinding, and networking.

7. Exploration, player actions, loot, and enemies

First-person control

Start with mouse look, WASD movement, a usable pause/release-cursor action, simple collision, and a minimal interaction key. Sprint can follow. Jump, climbing, crouching, stamina drain, or parkour should be added only if they materially serve maze navigation.

Loot

Prototype with three categories: basic provisions, crafting materials, and rare relics/seeds. Higher rings can have improved reward pools and better probabilities, but the inner ring should remain useful for ordinary supplies.

Start with a simple finite-slot inventory and an uncomplicated pickup/drop/extract process. Do not build weight simulation, nested storage, durability matrices, or complex item economies before the extraction loop works.

Enemies and AI

First enemy: one basic stalker-type creature with simple patrol/idle, investigate noise, detect player, chase, lose target, and search/return states. It must be able to reroute when a passage changes; use maze-level path planning plus local collision/navigation as appropriate. The world has very few enemy archetypes in MVP.

Sound can eventually connect AI and PvP: shooting, ringing a mechanism, or crossing noisy hazards can draw creatures and alert human players. Avoid building a complex sensory simulation immediately.

Combat

Use primitive equipment, not modern military weapons. Start with at most two mechanically distinct weapons, such as a simple crossbow and hatchet. Basic ammo, damage, health, death, and modest hit feedback are sufficient. Avoid advanced melee combo systems and dozens of unique animations.

Traps and objectives

Start with one trap, ideally one that interacts with other systems: for example, a noisy tripwire that rings a bell and attracts the stalker, rather than an elaborate insta-kill mechanism. A single relic retrieval objective is enough for the first extraction run. Later, contested landmark objectives can bring PvPvE players together.

8. PvPvE and multiplayer intentions

Multiplayer is central to the intended finished identity, but it must not make the earliest maze experiments impossible to complete. Build a single-player testable core, then do an early networking spike before content and combat become deeply coupled to local-only state.

Proposed match structure

• Players prepare in a safe Sanctuary, then enter a shared maze instance.
• Start with two connected players; test 2–4 total later.
• Player/team entry points may be separated around the inner boundary.
• Humans and monsters inhabit the same maze, competing over loot and return routes.
• Players can kill each other and drop unextracted loot; exact friendly-fire and team rules remain undecided.
• Returning to a Sanctuary extraction entrance ends that expedition and secures the haul.
• There should be multiple routes or entry points back, so camping one central hallway is not automatically optimal.
• The base itself is safe; base raids are out of MVP scope.

Networking architecture goals

• Prefer server authority for maze generation/seed, shifting gate states, collisions of gameplay significance, enemy state, loot ownership, damage, and extraction results.
• The initial client must not assume it is always the authority even when playing alone; keep authoritative game rules decoupled from rendering where practical.
• First test: two browser clients observe the same maze seed, gate transitions, player positions, and pickup results.
• Avoid synchronizing thousands of full wall transforms every frame if stable gate IDs and discrete target states/timestamps suffice. This is an architecture goal, not a fixed protocol.
• Persistent competitive inventory should eventually be managed by a trusted server, not client-editable browser storage. Local storage is acceptable for an offline prototype and noncompetitive preferences.
• Dedicated hosting, authentication, matchmaking, anti-cheat, and reconnect behavior are later scopes; identify their risks in the plan rather than implementing all at once.

9. Sanctuary, garden, and persistence

The Sanctuary is a persistent home base built with a few fixed upgrade locations, not Rust-style free placement construction.

MVP facilities:

1. Stash: stores extracted loot and selected equipment.
2. Workshop: repairs or crafts a tiny set of useful items; upgrades unlock choices rather than huge stat inflation.
3. Garden: grow one crop acquired from a maze seed, then harvest a situational expedition buff.

Example first crop: Bitterleaf, consumed before an expedition to slightly reduce detection by certain creatures. Balance and numbers are placeholders. Avoid permanent, stacking combat advantages that make newer players noncompetitive.

Do not require real-world wait timers. Crops can progress by gameplay milestones or completed/attempted expeditions. For MVP, simple persistent state is enough; complex economies, trading, decoration, animal husbandry, and freeform construction are explicitly deferred.

10. Browser technology and suggested architecture

Minimal starting stack

• TypeScript: game/simulation logic, type safety.
• Three.js: camera, rendering, geometry, lighting, animation, scene composition.
• Vite: local development and browser build pipeline.
• HTML/CSS: HUD, debug panels, menus and simple inventory.
• Physics/collision: start with the smallest reliable technique; evaluate Rapier 3D before moving gates and characters become complicated.
• Testing: lightweight unit tests for pure maze logic, validation, and seeded generation; browser smoke tests if useful.
• Network: WebSocket-based authoritative server experiment once the core extraction test works; exact library/framework to be chosen after a spike.

Avoid introducing React, databases, cloud services, an ECS framework, asset pipelines, procedural mesh systems, or elaborate abstractions without a specific demonstrated need.

Suggested boundaries (not mandatory file layout)

• simulation/ — deterministic maze cells/edges, seeds, layout generation, shift planning, connectivity and topology validation; zero Three.js imports.
• game/ — player state, progression rules, items, extraction conditions, entity/gameplay rules.
• rendering/ — Three.js scene setup, geometry modules, gate animations, camera, materials, effects.
• input/ — browser input, pointer lock, key binding, movement intentions.
• physics/ — collision and character controllers, initially minimal.
• ui/ — HUD, debug map, menus, inventory, feedback.
• network/ — later synchronization and server contracts.
• tests/ — deterministic maze and gameplay-rule tests.

Prefer small modules with simple explicit interfaces. Do not couple maze truth to rendered positions. Renderer animation is a view of a shift, not the authority that decides the change.

Development and diagnostics

Add dev-only controls/overlays very early:

• Current seed and deterministic regenerate-by-seed.
• Force a shift, freeze shift timers, show active shift warnings.
• Overhead debug maze visualization with walkable/open connections, ring colors, player location, and gate state.
• Teleport to a known ring/cell for testing once a generated maze exists.
• Console/log output for rejected shift plans and unreachable destinations.
• A short manual test checklist per milestone plus repeatable automated tests where useful.

Aim to keep the app runnable and buildable at every milestone. Do not postpone all integration until the end.

11. MVP demo definition and explicit exclusions

The first meaningful browser MVP demo should deliver one coherent extraction loop rather than a content-rich survival world.

Proposed MVP content ceiling

• One visual biome / maze asset kit.
• One Sanctuary hub (small and mostly fixed).
• One generated maze layout per expedition with three danger rings.
• Dynamic gates/junctions that visibly shift with safe route validation.
• Three simple recognizable landmarks.
• One creature archetype and one interactive trap.
• Two primitive weapons.
• Three broad loot categories; a small inventory/stash.
• Extraction success, death/failure, loot preservation/loss, basic restart.
• 2–4 players only if networking tests and performance make this feasible; two-client multiplayer proof is the minimum multiplayer gate.
• One garden crop/buff and a minimal workshop/upgrade action.
• Minimal HUD, sound cues, basic controls, a settings/pause mechanism.
• A representative 15–20-minute expedition target, adjusted based on playtesting.

Not in the first MVP

Full building placement, base raids, huge open-world streaming, dozens of enemies/weapons, elaborate character customization, skill trees, fully simulated agriculture, elaborate story quests, persistent seamless multiplayer world, realistic water/foliage, destructible buildings, advanced crafting economy, mobile controls, ranked PvP, monetization, full account system, large scale matchmaking.

If a feature cannot be justified by the maze → loot → navigate home → extract → prepare again loop, defer it.

12. Prototype roadmap with human-verifiable exit gates

Rule: Each milestone must end with a running browser build, concise manual verification instructions, and passing automated checks where relevant. Do not proceed simply because the code “looks complete.” A human must actually test the result.

M0 — Browser foundation

Build: Vite/TypeScript project, Three.js scene, flat ground, cube walls, pointer-lock mouse look, WASD player movement, mouse release/pause, basic camera and collision, simple dev HUD.

Verify: Open localhost; move, look around, stop at a wall, release/reacquire mouse, resize browser; no major console errors. Run a production build. This milestone must be boring but reliable.

M1 — Single moving junction

Build: A four-corridor junction with simple walls whose two states open/close different routes. A debug key triggers a shift with warning and a visible 2–3-second animation. Collision updates consistently.

Verify: Walk all corridors; trigger the shift repeatedly; never pass through a closed gate or end embedded in geometry. Player can tell which routes changed.

M2 — Tiny hand-built maze

Build: A small fixed maze of grid cells with several junctions, some moving connections, central start, and colored landmark cubes.

Verify: Leave the start, navigate, shift, and return without debug teleport. Check that changing paths creates navigation decisions rather than random confusion.

M3 — Headless maze data model and debug graph

Build: Pure TS cell/edge/connection state; stable IDs; tests; debug overhead visualization derived from simulation.

Verify: Each corridor shown in 3D agrees with the graph/debug map. Opening/closing an edge updates graph truth; deterministic tests pass.

M4 — Seeded procedural maze generation

Build: Simple connected grid generator with loops, central Sanctuary, ring assignments, fixed seed, and basic special-room placement.

Verify: Generate at least 20 visible layouts; reproduce a reported seed exactly; automated tests check connectivity and required ring access across many seeds.

M5 — Shifts in generated mazes

Build: Choose eligible dynamic connections; warn, validate, animate and commit shifts. Keep a route to Sanctuary and avoid collisions with players.

Verify: Force many changes while exploring different seeds; inspect route continuity, no impossible overlapping geometry, no trapped/embedded player. Invalid shift candidates are rejected clearly.

M6 — Diagnostics and stability gate

Build: Debug map, gate statuses, force-shift/regen/seed entry, basic test harness and console diagnostics.

Verify: A tester can reproduce a failed maze seed and identify which gate/state caused a problem. Repeatable navigation/shift test scenarios succeed.

M7 — First complete solo extraction loop

Build: One relic in a distant cell; pickup prompt; successful return to central extraction; completion screen with elapsed time and shifts survived; reset/new run.

Verify: Play multiple full runs manually. Assess whether outward travel and return are actually interesting. Do not continue to extra content if this core loop is dull or unfair.

M8 — Simple loot, inventory and failure

Build: Three loot categories, limited slots, pickup/drop, stash on successful extraction, carried loot loss on death/failure, basic starter loadout.

Verify: Confirm extracted items persist across runs, lost items do not, and failure never leaves player unable to start again.

M9 — Early multiplayer synchronization spike

Build: Connect two local browser clients to one authoritative session; synchronize maze seed, dynamic gate states, player presence and a pickup. No polished matchmaking.

Verify: Two windows see identical gate closures and item ownership over repeated shifts; reconnect/late join is either supported and tested or explicitly deferred with a documented limitation.

M10 — One creature and route-aware AI

Build: Simple stalker behaviour (idle/investigate/chase/search), minimal hitboxes, appropriate graph-aware rerouting when passages change.

Verify: Creature pursues and loses player, reroutes when a gate closes, and does not endlessly collide with blocked passages.

M11 — Primitive combat and death loop

Build: Crossbow, hatchet, health, damage, ammo, creature death, player death, basic feedback, loss/restart integration.

Verify: Player can fight or evade; limited resources matter; death consistently resolves the expedition and inventory state.

M12 — Three rings, landmarks, and one trap

Build: Different loot/enemy/hazard pressure by ring; three blockout landmarks; one audible or positional trap.

Verify: Player can identify approximate location via landmarks, notices escalating pressure farther outward, and understands traps after encountering them.

M13 — Basic PvPvE session

Build: Two to four human participants if feasible, shared monsters/loot, player damage and loot drops, workable extraction approaches, match reset.

Verify: Two people can compete or cooperate inside the same shifting maze; sound/gates/creatures influence encounters; neither client can duplicate loot by picking it up simultaneously. Evaluate camping and sync problems.

M14 — Minimal persistent Sanctuary loop

Build: Stash visualization, one crafting/workshop action, one seed type and garden buff that affects a later expedition; fixed facility locations, not freeform placement.

Verify: Find a seed, extract it, plant/harvest it, use resulting buff in another run, and verify persistent state. Failure cannot corrupt the saved state.

M15 — Cohesive playable vertical slice

Build: Replace a limited amount of gray boxes with reusable primitive stone/wood/iron assets; create minimal Sanctuary atmosphere, landmarks, HUD, audio cues and menu flow; performance and regression pass.

Verify: A new tester can start from a browser link or documented local build, play a complete expedition with little developer intervention, understand the core rules, and report meaningful gameplay feedback. Confirm acceptable frame rate on an explicitly chosen reference machine.

Milestone sequence is a proposal. Codex should identify dependencies and suggest reordering where technically justified, particularly introducing a multiplayer risk spike earlier if local-only assumptions would otherwise spread too far.

13. Technical and product risks to discuss explicitly

1. Multiplayer is the largest scope multiplier. Three.js does not solve synchronization or authority. The plan must include an early networking feasibility experiment and fallback if multiplayer proves too expensive.
2. Dynamic collision is harder than moving meshes. Character collisions, lag and gate timing can produce clipping or inconsistent state. Define safe gate behaviour and test it repeatedly.
3. AI navigation through a mutable graph requires deliberate design. Avoid relying on static waypoint routes that become invalid after every shift.
4. Procedural randomness can destroy readability. Curated landmarks and learnable shift rules are crucial.
5. PvP may reward camping near extraction. Multiple return approaches, route dynamics, sound cues and playtest data are needed.
6. Browser performance is finite. Avoid overdraw, excessive draw calls, giant dynamic scenes, complex materials and needless physics bodies. Profile before optimizing.
7. Persistence/security differ between offline and online play. Local browser saves are trivial to modify; they should not become authoritative competitive progression.
8. Art production can consume the project. Use procedural arrangement of small hand-made modules, primitive placeholders, and a tightly limited asset kit. AI-generated art may need cleanup.
9. AI-generated code may be inconsistent or overbuilt. Prefer small reviewed changes, tests, strict TypeScript, minimal dependencies and reproducible manual checks.
10. Feature creep threatens completion. Maintain a strict MVP boundary and a clear “not now” list.
11. IP originality: The initial inspiration was The Maze Runner, but the project should use wholly original names, creatures, architecture, lore, visual motifs and storytelling rather than copying protected film expressions.

14. Instructions to Codex: produce a practical project plan

Treat this entire document as background product context. First inspect the repository, if one exists. Determine what is implemented versus merely discussed; do not invent completed work. If the repository is empty, start planning from zero.

Do not implement the whole game. Produce a disciplined plan that a novice can follow step by step, with AI assistance, without becoming overwhelmed. Prefer the smallest useful plan that addresses the biggest risks first.

Requested deliverables

1. Architecture proposal: a minimal Three.js/TypeScript/Vite structure, module boundaries, state ownership, game loop, collision choice, future networking seam, and reasons for each major dependency. Distinguish immediate choices from future options.
2. Prioritized, dependency-aware milestone plan: refine or reorder M0–M15. Each milestone should be small enough for a beginner-assisted coding session or a short set of sessions, with an explicit output and manual acceptance test.
3. First 3–5 milestones broken into implementable tasks: exact files/modules expected, interfaces/data structures at a high level, commands for development/build/tests, concrete done criteria, and an explicit “do not build yet” note.
4. Test strategy: deterministic seed tests, connectivity/route validation, shift and collision cases, browser smoke checks, and multiplayer consistency tests when relevant. Explain what is automated versus inspected by a human.
5. Risk register: likelihood/impact, earliest inexpensive validation experiment, and fallback/reduction for the largest technical and design risks.
6. MVP scope and cut list: separate the playable single-player maze proof, the multiplayer/PvPvE proof, and the first demo. Keep features that do not serve the core loop outside MVP.
7. Decision log: list unresolved choices with recommended defaults, trade-offs, and which milestone should settle each. Ask only truly blocking questions.
8. AI-friendly workflow: recommend manageable task sizes, repository conventions, branch/commit checkpoints, and a repeatable review procedure. Ensure every step leaves the app runnable and avoids sweeping rewrites.
9. Optional estimates: relative complexity (S/M/L or risk levels) rather than confident dates or promises. Assume one beginner developer, not a professional studio.

Nonnegotiable planning rules

• Playable and human-verifiable after each milestone. State exactly what the developer should see/do and what result constitutes passing.
• Build the moving-maze interaction before building the wider game. Start with simple boxes.
• Never confuse visual rendering with maze simulation truth. Keep the simulation testable without Three.js.
• Implement only the next approved milestone at a time, with clear changes, local run instructions, tests, and what remains incomplete.
• No unnecessary frameworks, cloud infrastructure, accounts, asset packs or monetization in the first proof of concept.
• Plan multiplayer early, implement a small synchronization spike early, but don’t let full backend scope prevent testing the fun.
• If any idea is overambitious for one novice using AI, say so explicitly and offer a narrower alternative without losing the core maze/extraction identity.

15. Starting point and success conditions

Start with M0: a fresh browser project in which the player can move in first person through a tiny room with walls and basic collision.

Then M1: a single four-way junction where some simple wall blocks slide between two valid states, with a warning, a debug shift key, and consistent collision. The maze should be physically readable; no assets, enemies, inventory, garden or multiplayer are required.

The first key design gate is M7: a player can start in Sanctuary, reach an outer objective, obtain a relic, face altered routes on the way back, and successfully extract or fail. If this is not enjoyable, the next action should be to improve the maze, navigation, and pacing—not add crafting, story, or art.

Ultimate near-term target: a small, coherent browser demo that showcases a shifting ancient labyrinth, meaningful loot decisions, a stressful journey home, and (if the technical spike succeeds) a handful of players interacting with the same enemies and maze. Finish a small real game before expanding it.
