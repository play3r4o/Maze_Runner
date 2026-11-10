# Progress

## Current authorization

- Planning documents saved from the approved proposal.
- M0 implementation approved by the instruction to implement the proposed plan, bounded by one-milestone-at-a-time development.
- M1 and later are not approved to start.
- On 2026-11-10 the developer authorized GitHub hosting to make M0 playable without a local installation. This authorizes the deployment workflow and source upload; M1 remains unapproved.

## Status

| Milestone | Status |
| --- | --- |
| M0 | Implemented; automated checks passed; ready for manual testing; not human accepted |
| M1–M8 | Not started |
| M9 (scheduled after M7) | Not started |
| M10–M12 | Not started |
| M13 | Conditional, not started |
| M14 | Optional/deferred |
| M15 | Not started |

## Evidence

Initial inspection: only lowercase project_brief.md, no implementation or commits. The brief remains unchanged. Node 24/npm/Chromium available.

Setup finding: default npm cache was outside writable paths. Project .npmrc selects ignored .cache/npm without changing TLS or signature verification.

### M0 validation — 2026-11-09

| Check | Result |
| --- | --- |
| Clean `npm ci` from committed-format lockfile | Passed; 52 packages installed |
| `npm test` | Passed: 23 tests in two files |
| `npm run typecheck` | Passed, also executed as part of build |
| `npm run build` | Passed; production output in ignored dist/ |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser` | Passed: six production-browser tests, no skips |
| Separate development-build browser check | Passed: start panel, actual pointer lock, no console/page errors |
| Visual inspection | Start panel and running-room screenshots inspected |

Browser: system Chromium 156.0.8078.79, selected explicitly, with SwiftShader software rendering. This is functional validation, not reference-machine performance validation. Playwright-managed browser installation was not exercised.

Production browser checks covered rendered pixel variation/resize, actual pointer lock and block collision, mouse-look-relative movement, pause/resume clearing held input, blur handling, rejected pointer lock, and WebGL failure. Blur was a synthetic event; actual tab switching remains a human checklist item. Human comfort/feel acceptance has not been claimed.

The build reports a non-failing 542 kB minified JavaScript chunk (about 135 kB gzip), primarily Three.js. No threshold was raised or checks disabled; defer bundle optimization until measured need.

During the clean-install check, npm ci invalidated the already-running development server's optimized dependencies. Restarting that server resolved Vite's 504 Outdated Optimize Dep response; the subsequent separate development-browser check passed. README documents restarting after installs.

Dependencies are pinned in package.json/package-lock.json. Node 24 is recorded in engines and .nvmrc. The current development server was started with `npm run dev -- --port 5173 --strictPort` and is running on port 5173; live processes must not be assumed to survive a new cloud task.

At the end of the original M0 implementation, changes were local to this cloud checkout; no commits, pushes, environment configuration updates, or publication had been performed. Subsequent deployment progress is recorded separately below.

### GitHub Pages preparation — 2026-11-10

- Added `.github/workflows/pages.yml`: Node 24, frozen dependency install, simulation tests, Chromium installation, production browser checks, Pages artifact upload/deployment. Official action references are pinned to SHAs verified from their upstream Git tags.
- Existing relative Vite asset paths are retained for `/Maze_Runner/` hosting; no gameplay changes.
- Git read access to the origin works. GitHub API calls are blocked at the environment's CONNECT proxy with HTTP 403; this prevents checking/changing Pages settings or observing Actions through the API.
- Draft configuration read failed, so no unknown network allowlist was replaced. No environment setting or publication was changed.
- Revalidation passed: 23 unit tests, six production-browser tests, TypeScript and production build. Workflow YAML parsed with its build/deploy dependency verified.
- A separate static-server browser check mounted production output at `/Maze_Runner/` and passed asset loading, actual pointer lock, movement and pause with no HTTP/console/page errors.
- Deployment mechanism is prepared and locally verified. Hosted availability is unconfirmed: the repository's Pages source must be GitHub Actions and a deploy job must succeed. See README for the one-time setting and workflow steps.

### Pages CI mouse-input correction — 2026-11-10

- The developer's Actions screenshot shows five browser checks passed, while the coordinate-driven mouse-look check failed with X staying at zero. The deployment was therefore blocked; no successful public deployment is claimed.
- Local validation used system Chromium 156; Actions installs Playwright Chromium 158 headless shell. Installing that exact browser here failed with an explicit proxy `403 Domain forbidden` for `cdn.playwright.dev`, so the precise CI backend failure has not been independently reproduced.
- Removed the test's assumption that absolute automated cursor coordinates reliably generate pointer-locked relative movement. Look tests now acquire actual pointer lock, dispatch explicit relative DOM mouse events through the production input handler, then use actual keyboard input and assert forward movement in both left and right directions. The pause/collision test also checks that those mouse events are ignored before locking and while paused.
- No application input code, movement assertions, retries, or timeout limits were loosened. Genuine mouse-device behavior remains a human acceptance item; these integration tests do not claim to reproduce physical mouse motion.
- CI now uses one browser worker to reduce software-WebGL CPU contention. Failed jobs preserve screenshots/traces as the `browser-test-diagnostics` Actions artifact for seven days.
- Corrected local checks passed: 23 unit tests; type check/build; all seven browser tests with `CI=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser` (one worker). Workflow YAML and conditional artifact upload were checked. The next GitHub Actions result must still be verified separately with its bundled Chromium.

## Human verification

Pending. Use [the M0 checklist](milestones/M0.md#human-acceptance-not-substitutable-by-automation) in both development and production preview. CPU/GPU/browser reference details are not yet supplied.

## Next action

Wait for the developer's M0 manual results. Fix reported M0 defects if any. Do not start M1 without acceptance and explicit approval.
