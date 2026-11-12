# Shifting Labyrinth

Working title. A browser game project starting with a small, first-person shifting-maze prototype. **M0–M7b and M10–12 are accepted. M8 (awaiting acceptance) turns runs into loot runs: a grid bag, chests and remains to loot, extraction with whatever you carry, a saved stash, and a maze that reacts to what you carry.**

Read [the brief](project_brief.md), [development plan](docs/development_plan.md), [M7b specification](docs/milestones/M7b.md), [M10–12 specification](docs/milestones/M10-M12.md), [M8 specification](docs/milestones/M8.md), and [current progress](docs/progress.md).

## Run

Use **Node.js 24** and npm, from this checkout:

```sh
npm ci
npm run dev
```

Open Vite's printed address in a current desktop browser. The development server binds to all interfaces for cloud access. Use your platform's supported browser/port access when working remotely; your own computer's localhost is not the cloud machine. No credentials or external services are required.

Click **Start exploring** to capture the mouse. **WASD** moves, **mouse** looks, **G** requests a gate shift, and **Escape** pauses/releases the cursor. Click **Resume exploring** to continue. Switching tabs or losing focus pauses and clears movement and pending shift requests.

**M7 expedition (default scene).** A relic waits in the outer ring under a tall **blue beam**. Leave Sanctuary, press **E** next to the relic, then carry it back into Sanctuary under the **gold beam**. Every 45 seconds the maze shifts by itself after a 2-second warning: one gate opens, another closes, so your way back may change. Crushing ends the run and loses the relic; **Abandon run** is in the pause menu. The result screen shows your time and shifts survived, with **New run** (fresh seed) and **Retry this seed**. G still forces a shift for debugging. See the [M7 specification](docs/milestones/M7.md).

**M7b pressure.** Carrying the relic makes shifts come every 27 s. A bell from Sanctuary tolls once at 2:30, twice at 3:15 and three times at 4:00 of the run; then night falls and the maze shifts every 10 s. Gates warn and grind with positional sound (volume and mute in the pause menu). Press **C** to take out the chalk, then hold the **left mouse button** and look around to draw or write on floors, walls and gates within reach; C puts it away (30 m of line per run; drawings on a gate slide with it). With no `?seed=`, everyone gets today's maze (UTC date). For comparisons, F2 has switches for each rule and the beams; `?off=unrest,dusk,sound,chalk,beams` starts with them off. See the [M7b specification](docs/milestones/M7b.md).

**M8 loot.** Chests sit in room corners; killed husks and skitters leave remains. Press **E** next to one to open it and drag items into your **bag** (6 × 4 cells; items take 1 to 6 cells; **R** rotates while dragging; right-click sends an item across; drag to the drop zone to leave it on the floor). **Tab** opens the bag. The maze keeps moving while you loot. Step back into Sanctuary to extract and keep what you carry; dying, abandoning or closing the page mid-run loses the bag. In Sanctuary before leaving, Tab shows your **stash** beside the bag. Everything is saved in this browser. The Heart of the Maze (under the blue beam) is the richest prize. Heavy items (materials, relics) make the maze shift faster; coins clink and carry your footsteps further. Each run you get a free thread spool: **T** starts or stops laying a red line on the floor (150 m). When a gate is closing near you, **F** sacrifices an item to hold it for 6 s. Dying leaves a cairn and your faded drawings for your next try at the same seed. See the [M8 specification](docs/milestones/M8.md).

**M10–12 traps.** You have 100 health. Slightly darker square plates in corridors and rooms trigger traps when stepped on: a rolling boulder down a long straight corridor, spears from the walls, spikes from the floor, a pit that opens beneath you, dart volleys, and swinging blades that need no plate. Plates glow amber while a trap fires; step off fast. Boulders and pits kill. `?off=traps` or F2 switches them off.

**M10–12 monsters.** Husks (slow, 3 bolts) and skitters (fast, 1 bolt) hunt by sight and sound. Click the **left mouse button** with the chalk away to fire the crossbow (16 bolts per run); shots are loud. The Warden cannot be killed by bolts, only staggered for a moment: lure it into a boulder's path, over an open pit or into a closing gate. It returns about 45 s later. Monsters never enter Sanctuary. `?off=monsters` or F2 switches them off. See the [M10–12 specification](docs/milestones/M10-M12.md).

The default scene is a **seeded 11×11 maze** (M4). The address carries `?seed=N`; the same seed always rebuilds the same layout, and a page opened without a seed picks one and writes it into the address. A central open Sanctuary plaza has one entrance per side. Inner, middle and outer rings each hold one landmark (Amber Spire, Blue Beacon, Rose Pillar); the side panel shows your current ring and the navigation check. Eight stone gates (G1–G8) move when you press **G**: one closed gate opens, then one open gate closes, with the same warning, pushing and crushing rules as the hand-built maze. Each shift is validated first, and the static corridors alone always connect every room, so no shift can strand a region. The F2 panel shows gate states and a shift log with each decision and its reason. See the [M5 specification](docs/milestones/M5.md).

**Debug tools (M6, F2 panel).** Below the map: **Freeze shifts** stops gate motion and shift timers while you keep walking; teleport buttons and clicking any room on the map move you to that room (debug only, counted in the return status); **Events** lists recent shifts, freezes, teleports, visits, ring changes and deaths; the page-error count should stay 0. **Copy report** produces JSON with the seed, shift requests, gate timing and your position. Paste a report into **Bug report text** and **Load report** to rebuild that exact state, even from another seed. See the [M6 specification](docs/milestones/M6.md). In the F2 debug panel, rooms are coloured by ring, and a seed field with **Load seed** and **Random** reloads the page with another seed. The panel also shows the generator version and a layout fingerprint for bug reports. See the [M4 specification](docs/milestones/M4.md).

The accepted hand-built maze from M2/M3 is at `?scene=maze`. The rest of this section describes it. It is a **fixed 5×5 maze**. Start at the warm Sanctuary floor marker. Find the **Amber Spire**, **Blue Beacon** and **Rose Pillar**, then return to Sanctuary; the navigation checklist records physical visits and your return. The colored pillars and signs are geometric placeholders. This is a route-finding exercise, with no rewards, collectibles or saved progress.

Two **eight-meter-long crushing shortcuts** alternate: NORTH initially opens and EAST starts closed. G gives a two-second warning, opens the replacement, then closes the old shortcut over four seconds. A closing slab pushes you toward the opposite wall. It kills only when the remaining space cannot fit your whole body, and never waits or cancels for occupancy. You can walk along the passage and escape while being pushed. Markings and signs identify the full danger zone. At normal speed the passage takes about 2.7 seconds to cross. Permanent corridors provide longer detours; every room remains reachable even with both shortcuts closed.

If crushed, the cursor releases and a **Retry** button appears. Gates finish closing behind the death screen. Retry resets player position/look, gates, shift count and landmark visits, then reacquires the mouse. Pausing while alive still freezes the mechanism.

Press **F2** (or click **Debug map** while paused) to toggle M3's developer graph view. It starts hidden. Compare its room/corridor IDs, player marker/heading, gate slab bounds and highlighted graph route to the 3D maze. Only fully open gates count as route links. While in a moving gate passage there is no route preview; escape along the passage. This diagnostic does not guarantee escape time and does not decide the final player map design.

The topology revision starts at **0** and usually reaches **2** per complete swap: one change when the replacement fully opens, another when the old connection starts closing. Animation between those events does not increment it every frame.

With the view open, press **V** or click **Probe isolation** to propose blocking Sanctuary's connections in a **dry run**. Read the rejection and inspect the proposed edge IDs/unreachable cells. This cannot move walls, change the revision or alter the run. Escape releases the cursor so you can scroll/expand the connection and validation details. Retry resets revision/attempt history while keeping the panel's visibility for that page.

Follow the [M8 checklist](docs/milestones/M8.md#human-acceptance-checklist-after-stage-2) before approving the next milestone. Accepted reference scenes remain available: `?scene=room` for M0, `?scene=junction` for M1 and `?scene=maze` for M2/M3. Teleport, automatic shifting, jumping and sprinting remain deferred.

## Check and build

```sh
npm run typecheck
npm test
npm run build
npm run preview
```

The production build is written to ignored `dist/`. Test the printed preview address as well as the development version.

## Browser tests

Install Playwright's matching Chromium once:

```sh
npx playwright install chromium
npm run test:browser
```

Tests build production output and manage their own preview server on port **4174**. They fail rather than reuse an existing server; stop a conflicting process first. The tests use software WebGL for repeatability, so their speed does not measure your GPU's game performance.

In a managed environment with an installed Chromium, an explicit override is available:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser
```

That shell syntax is for Linux/macOS. On other systems use the default Playwright install above. Failure artifacts go to ignored `test-results/`. Automated pointer-lock checks supplement, but do not replace, human testing of the controls.

Mouse-look checks acquire real pointer lock, dispatch DOM mouse events with explicit relative deltas, and assert resulting movement using actual keyboard input. Absolute automated cursor coordinates do not reliably produce relative motion in every headless Chromium backend. Real mouse-device feel remains a manual check. CI uses one browser worker to reduce software-rendering contention.

The turning and crushing-gate scenarios control browser time with Playwright's clock: keyboard input is held for a defined simulation duration, released, and the HUD is refreshed before assertions. `runFor` executes animation frames; it does not skip simulation steps or set game state. Other browser smoke tests still exercise normal wall-clock operation. The default test browser uses full Chromium's new headless mode in both local runs and CI, rather than a separate headless-shell backend.

The Retry check advances a bounded number of controlled frames while one native click waits for visibility, stability and hit testing. This lets rendering settle after the diagnostic panel changes with the clock paused. The original test deadlines and all reset assertions are retained.

## Play through GitHub Pages

The workflow in `.github/workflows/pages.yml` tests the app, builds `dist/`, and publishes that directory when `main` changes. Source documents and development dependencies are not part of the published website. Vite uses relative asset paths, so the build supports the repository's `/Maze_Runner/` URL path.

One-time repository setup:

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, select **GitHub Actions** as the source.
3. In **Actions → Deploy prototype to GitHub Pages**, rerun a failed deployment or choose **Run workflow** on `main`.
4. Wait for both build and deploy jobs to pass, then use the deployment's website link.

For the current repository, the expected default URL is `https://play3r4o.github.io/Maze_Runner/`. It becomes usable only after GitHub reports a successful deployment; an expected URL alone is not proof of publication.

Open the game in a desktop browser tab and click **Start exploring**. No local Node.js installation is required for the hosted version. After a new deployment, refresh and check the **M8 · LOOT** header; remove any `scene=` parameter from the URL to play the current maze. Share a `?seed=N` address to reproduce a layout.

If Pages is unavailable for the repository's visibility or account plan, keep those settings unchanged and report the limitation. Enabling Pages does not require adding credentials to the game or creating a separate server.

## Structure

- `src/simulation`: pure movement/collision, shared moving-wall pushing, fixed maze cells/edges, geometry derivation, graph validation/BFS, diagnostic data and shift rules; no Three.js or browser imports.
- `src/game`: run state, navigation checklist, death and resets.
- `src/input`: browser input produces movement intentions.
- `src/rendering`: Three.js scene/camera built from simulation geometry; repeated maze walls use one instanced mesh.
- `src/ui`: DOM HUD, pause/errors and opt-in SVG graph inspection.
- `src/loop.ts`: testable fixed-step timing.
- `tests`: pure rule tests and production-browser checks.

The local npm cache is ignored `.cache/npm` to work inside restricted cloud workspaces. Dependency versions are pinned; refresh deliberately, rather than replacing the lockfile.

Stop the development server before reinstalling dependencies and restart it afterward. If Vite reports an outdated optimized dependency after an install, restart the server rather than changing application code.

Next is M8 or M9 in the plan's order, **after the M8 checklist and explicit approval**. Approved GitHub pushes trigger the Pages workflow; a successful local build alone does not establish a successful hosted deployment.
