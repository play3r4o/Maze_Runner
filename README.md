# Shifting Labyrinth

Working title. A browser game project starting with a small, first-person shifting-maze prototype. **M0 is accepted; M1, one shifting junction, is implemented for manual testing.** Extraction and the wider maze are later milestones.

Read [the brief](project_brief.md), [development plan](docs/development_plan.md), [M1 specification](docs/milestones/M1.md), and [current progress](docs/progress.md).

## Run

Use **Node.js 24** and npm, from this checkout:

```sh
npm ci
npm run dev
```

Open Vite's printed address in a current desktop browser. The development server binds to all interfaces for cloud access. Use your platform's supported browser/port access when working remotely; your own computer's localhost is not the cloud machine. No credentials or external services are required.

Click **Start exploring** to capture the mouse. **WASD** moves, **mouse** looks, **G** requests a gate shift, and **Escape** pauses/releases the cursor. Click **Resume exploring** to continue. Switching tabs or losing focus pauses and clears movement and pending shift requests.

The default scene is a four-way junction with **eight-meter-long crushing passages**. NORTH/SOUTH initially open. G gives a two-second warning, opens the other pair, then closes the old pair over four seconds. A closing slab pushes you toward the opposite wall. It kills only when the remaining space cannot fit your whole body, and never waits or cancels for occupancy. You can walk along the passage and escape while being pushed. Markings and signs identify the full danger zone. At normal speed the passage takes about 2.7 seconds to cross. Use the longer outside loop when a crossing is too risky.

If crushed, the cursor releases and a **Retry** button appears. Gates finish closing behind the death screen. Retry resets player position/look, gates and shift count, then reacquires the mouse. Pausing while alive still freezes the mechanism.

Follow the [M1 manual checklist](docs/milestones/M1.md#human-checklist) before approving M2. The accepted M0 reference room is retained by adding `?scene=room` to the page URL. Neither prototype has an objective, jumping or sprinting yet.

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

## Play through GitHub Pages

The workflow in `.github/workflows/pages.yml` tests the app, builds `dist/`, and publishes that directory when `main` changes. Source documents and development dependencies are not part of the published website. Vite uses relative asset paths, so the build supports the repository's `/Maze_Runner/` URL path.

One-time repository setup:

1. Open the repository's **Settings → Pages**.
2. Under **Build and deployment**, select **GitHub Actions** as the source.
3. In **Actions → Deploy prototype to GitHub Pages**, rerun a failed deployment or choose **Run workflow** on `main`.
4. Wait for both build and deploy jobs to pass, then use the deployment's website link.

For the current repository, the expected default URL is `https://play3r4o.github.io/Maze_Runner/`. It becomes usable only after GitHub reports a successful deployment; an expected URL alone is not proof of publication.

Open the game in a desktop browser tab and click **Start exploring**. No local Node.js installation is required for the hosted version. After a new deployment, refresh and check the M1 header before testing the junction.

If Pages is unavailable for the repository's visibility or account plan, keep those settings unchanged and report the limitation. Enabling Pages does not require adding credentials to the game or creating a separate server.

## Structure

- `src/simulation`: plain room data and pure movement/collision, no Three.js or browser imports.
- `src/input`: browser input produces movement intentions.
- `src/rendering`: Three.js scene/camera built from the room data.
- `src/ui`: DOM HUD and pause/errors.
- `src/loop.ts`: testable fixed-step timing.
- `tests`: pure rule tests and production-browser checks.

The local npm cache is ignored `.cache/npm` to work inside restricted cloud workspaces. Dependency versions are pinned; refresh deliberately, rather than replacing the lockfile.

Stop the development server before reinstalling dependencies and restart it afterward. If Vite reports an outdated optimized dependency after an install, restart the server rather than changing application code.

Next milestone is M2 (a tiny hand-built maze), **after M1 human acceptance and explicit approval**. Approved GitHub pushes trigger the Pages workflow; a successful local build alone does not establish a successful hosted deployment.
