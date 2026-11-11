# Shifting Labyrinth

Working title. A browser game project starting with a small, first-person shifting-maze prototype. **M0–M5 are accepted. M6 adds reproduction tools: freeze, teleport, events and bug reports.** Automatic shifts and extraction are later milestones.

Read [the brief](project_brief.md), [development plan](docs/development_plan.md), [M6 specification](docs/milestones/M6.md), and [current progress](docs/progress.md).

## Run

Use **Node.js 24** and npm, from this checkout:

```sh
npm ci
npm run dev
```

Open Vite's printed address in a current desktop browser. The development server binds to all interfaces for cloud access. Use your platform's supported browser/port access when working remotely; your own computer's localhost is not the cloud machine. No credentials or external services are required.

Click **Start exploring** to capture the mouse. **WASD** moves, **mouse** looks, **G** requests a gate shift, and **Escape** pauses/releases the cursor. Click **Resume exploring** to continue. Switching tabs or losing focus pauses and clears movement and pending shift requests.

The default scene is a **seeded 11×11 maze** (M4). The address carries `?seed=N`; the same seed always rebuilds the same layout, and a page opened without a seed picks one and writes it into the address. A central open Sanctuary plaza has one entrance per side. Inner, middle and outer rings each hold one landmark (Amber Spire, Blue Beacon, Rose Pillar); the side panel shows your current ring and the navigation check. Eight stone gates (G1–G8) move when you press **G**: one closed gate opens, then one open gate closes, with the same warning, pushing and crushing rules as the hand-built maze. Each shift is validated first, and the static corridors alone always connect every room, so no shift can strand a region. The F2 panel shows gate states and a shift log with each decision and its reason. See the [M5 specification](docs/milestones/M5.md).

**Debug tools (M6, F2 panel).** Below the map: **Freeze shifts** stops gate motion and shift timers while you keep walking; teleport buttons and clicking any room on the map move you to that room (debug only, counted in the return status); **Events** lists recent shifts, freezes, teleports, visits, ring changes and deaths; the page-error count should stay 0. **Copy report** produces JSON with the seed, shift requests, gate timing and your position. Paste a report into **Bug report text** and **Load report** to rebuild that exact state, even from another seed. See the [M6 specification](docs/milestones/M6.md). In the F2 debug panel, rooms are coloured by ring, and a seed field with **Load seed** and **Random** reloads the page with another seed. The panel also shows the generator version and a layout fingerprint for bug reports. See the [M4 specification](docs/milestones/M4.md).

The accepted hand-built maze from M2/M3 is at `?scene=maze`. The rest of this section describes it. It is a **fixed 5×5 maze**. Start at the warm Sanctuary floor marker. Find the **Amber Spire**, **Blue Beacon** and **Rose Pillar**, then return to Sanctuary; the navigation checklist records physical visits and your return. The colored pillars and signs are geometric placeholders. This is a route-finding exercise, with no rewards, collectibles or saved progress.

Two **eight-meter-long crushing shortcuts** alternate: NORTH initially opens and EAST starts closed. G gives a two-second warning, opens the replacement, then closes the old shortcut over four seconds. A closing slab pushes you toward the opposite wall. It kills only when the remaining space cannot fit your whole body, and never waits or cancels for occupancy. You can walk along the passage and escape while being pushed. Markings and signs identify the full danger zone. At normal speed the passage takes about 2.7 seconds to cross. Permanent corridors provide longer detours; every room remains reachable even with both shortcuts closed.

If crushed, the cursor releases and a **Retry** button appears. Gates finish closing behind the death screen. Retry resets player position/look, gates, shift count and landmark visits, then reacquires the mouse. Pausing while alive still freezes the mechanism.

Press **F2** (or click **Debug map** while paused) to toggle M3's developer graph view. It starts hidden. Compare its room/corridor IDs, player marker/heading, gate slab bounds and highlighted graph route to the 3D maze. Only fully open gates count as route links. While in a moving gate passage there is no route preview; escape along the passage. This diagnostic does not guarantee escape time and does not decide the final player map design.

The topology revision starts at **0** and usually reaches **2** per complete swap: one change when the replacement fully opens, another when the old connection starts closing. Animation between those events does not increment it every frame.

With the view open, press **V** or click **Probe isolation** to propose blocking Sanctuary's connections in a **dry run**. Read the rejection and inspect the proposed edge IDs/unreachable cells. This cannot move walls, change the revision or alter the run. Escape releases the cursor so you can scroll/expand the connection and validation details. Retry resets revision/attempt history while keeping the panel's visibility for that page.

Follow the [M6 manual checklist](docs/milestones/M6.md#human-acceptance-checklist) before approving M7. Accepted reference scenes remain available: `?scene=room` for M0, `?scene=junction` for M1 and `?scene=maze` for M2/M3. Teleport, automatic shifting, jumping and sprinting remain deferred.

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

Open the game in a desktop browser tab and click **Start exploring**. No local Node.js installation is required for the hosted version. After a new deployment, refresh and check the **M6 · REPRO TOOLS** header; remove any `scene=` parameter from the URL to play the current maze. Share a `?seed=N` address to reproduce a layout.

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

Next milestone is M7 (first complete solo extraction loop), **after M6 human acceptance and explicit approval**. Approved GitHub pushes trigger the Pages workflow; a successful local build alone does not establish a successful hosted deployment.
