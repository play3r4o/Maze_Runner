# Progress

## Current authorization

- Planning documents saved from the approved proposal.
- M0 implementation approved by the instruction to implement the proposed plan, bounded by one-milestone-at-a-time development.
- On 2026-11-10 the developer authorized GitHub hosting to make the prototype playable without a local installation. Approved pushes use the existing Pages workflow.
- The developer confirmed M0 mouse/WASD/collision worked, then confirmed all remaining manual checks passed and explicitly approved the next step. M0 is accepted; M1 is approved. M2 and later are not approved to start.
- On 2026-11-11 the developer confirmed the original gates work, then requested lethal contact instead of obstruction holds, slower closing, and longer crossings. This authorizes an M1 revision with death/Retry; M2 remains unapproved. Proposed tuning defaults are 8 m passages, 2 s warning and 4 s closing.
- Follow-up instruction on 2026-11-11: the wall must push the character toward the opposite wall first, and kill only when the remaining gap cannot fit the body. This supersedes immediate contact death. Existing passage length/timings remain; M2 is still unapproved.

## Status

| Milestone | Status |
| --- | --- |
| M0 | Human accepted on 2026-11-10 |
| M1 | Original lethal revision deployed; push-before-crush follow-up locally verified, awaiting deployment/manual acceptance |
| M2–M8 | Not started |
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

M0 accepted: the developer confirmed mouse movement, WASD, collision, then all remaining checks (pause/resume, switching tabs, movement edges, camera/resize and reload) passed. CPU/GPU/browser reference details are not yet supplied; performance targets are not yet verified.

The developer confirmed M1's original gates work and requested the lethal revision. Acceptance of that revision is pending; use the [updated M1 checklist](milestones/M1.md#human-checklist).

### M1 implementation — 2026-11-10

- Four-way fixture with a fixed perimeter return loop, four stable gate IDs, signs, moving slabs and marked safety areas. NORTH/SOUTH and EAST/WEST are the two intended arrangements.
- Pure shift state machine: two-second warning, 1.25-second opening then 1.25-second closing, three-second cooldown. Repeated G is not queued; pause freezes simulation. Five-node fixture connectivity is checked before planning and during motion.
- Occupancy checks hold closing gates before each step. A two-second obstruction cancels to all-open recovery, then cooldown; retry preserves the cancelled target. All-open is explicitly labelled, not counted as a completed shift.
- Rendered gate poses and movement colliders use the same rectangle function. No application assets, dependencies, procedural generation, general maze framework or physics engine were added.
- The accepted M0 reference is retained at `?scene=room`, and its browser regressions select it explicitly.
- Verification passed: `npm test` ran 46 tests across three files. `CI=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser` passed TypeScript/build and all ten browser checks (three M1 scenarios plus seven M0 regressions), with one worker and no skips/retries.
- M1 browser scenarios cover a closed corridor becoming usable after a warned shift, busy request rejection, occupied-gate hold/cancel/all-open recovery without displacement, and pause freezing shift time/ignoring G input while paused.
- The initial M1 test pass exposed two test synchronization errors: reading a stale 10 Hz position diagnostic after key release, and issuing G before the pointer-lock event handler had marked input active. Tests now wait for the running HUD and the post-keyup diagnostic sample. The movement/safety assertions were retained; the complete corrected suite passed.
- Separate development-browser verification captured and visually inspected startup, NORTH open, EAST closed, a moving EAST gate and EAST open. No console/page errors were observed. Software rendering/system Chromium was used; matching Playwright browser installation remains blocked by the previously documented CDN policy.
- Local production output is about 551 kB minified / 138 kB gzip in its main JS chunk, retaining the existing non-failing Vite size warning. No dependencies or thresholds were changed.
- The approved GitHub update triggers the existing Pages workflow. The developer reported the hosted site still shows M0. Public Actions HTML confirms the M0 run for `4500589` (42869146815) succeeded, while the first M1 run for `ac5fb1b` (42875503965) failed in **Build and test production app** after 2m 58s. Deployment therefore did not update M0. No remote M1 success or human acceptance is claimed.
- GitHub's normal public webpages are accessible despite the blocked API domain; use their run metadata to distinguish pending/failed/successful deployments. Full job logs require sign-in. The failed M1 run has a `browser-test-diagnostics` artifact (about 715 KB), but its error text/trace is not available anonymously. Obtain the failed step output or artifact before diagnosing or weakening any test. Do not push documentation-only changes while diagnosis is blocked, as every main push starts another deployment.

### M1 CI timing correction — 2026-11-10

- The developer's next screenshot identifies the two failed cases: occupied-gate recovery and left-turn movement. Eight checks passed. The numeric Expected/Received blocks are above the screenshot and were requested; no exact remote browser failure has been claimed reproduced from that partial log.
- Code inspection found wall-clock-dependent test actions: lifting W based on a sampled HUD value can overshoot a narrow gate area while CDP requests run, and separate position assertions can observe different running-game moments. The known 150 ms settling delay also assumes a sufficiently fast rendering cadence.
- Those timed scenarios now use Playwright's clock, installed before navigation and paused after actual pointer lock. `runFor` fires all animation frames/fixed simulation steps: walk for a defined duration, release the real keyboard input, update the HUD, then assert while the clock is paused. No game state is set directly. The turning test reads X/Z in one DOM snapshot.
- All existing left/right position thresholds, gate-held/cancelled/open states, no-displacement check and post-recovery walk remain. No product code, physics rules, retries, assertion thresholds or timeouts were relaxed. Other browser tests still run with normal time.
- Tests select full Chromium/new headless in CI, matching the local installed browser mode rather than silently using the separate headless shell. Version 158 CI versus system 156 remains a limitation of local verification.
- Local targeted checks passed for all three affected cases. Separate checks with 8× CPU throttling passed left movement (X=-1.30, Z=5.24) and gate occupancy/recovery (Z stayed -4.00 throughout). Final local validation passed: 46 unit tests, TypeScript/build and all ten production-browser tests in 48.8 seconds with one worker.
- Corrective commit `c298a63` was pushed to main. GitHub Actions run [42888374451](https://github.com/play3r4o/Maze_Runner/actions/runs/42888374451) completed successfully: build 1m 14s, deploy 31s, overall 1m 56s. Public run summary confirms the deployment URL `https://play3r4o.github.io/Maze_Runner/`. M1 is now deployed; human acceptance remains pending. Use `?v=c298a63` for a fresh page request and ensure `scene=room` is absent when testing M1.
- Deployment success was recorded locally after the tested commit; this evidence-only edit is intentionally left for the next source checkpoint rather than triggering a redundant deployment.

## Next action

Deploy the approved push-before-crush follow-up, verify the workflow result, then wait for revised M1 manual checks. Do not start M2 without acceptance and explicit approval.

### M1 crushing-gate revision — 2026-11-11

- The original no-crushing rule is superseded by the developer's explicit request. Added a dated brief amendment and updated the architecture/M1 plan rather than silently preserving contradictory safety instructions.
- Expanded the test junction to 40×40 m to fit 8 m slabs inside wall pockets, with a physically clear outer loop. Slabs travel 4.5 m sideways; they still span the four-meter corridor. Marks outline the full eight-meter crossing and signs identify CRUSH ZONE entrances.
- Retained the two-second warning and 1.25-second replacement opening; old routes now close over four seconds. Removed occupancy holds/cancellation. Swept old/new slab bounds detect positive body-footprint overlap only for closing movement, not warning-zone occupancy or opening.
- Added pure junction-run state: crush is terminal for the player, input/cursor releases, mechanism finishes closing, and Retry resets player/look/gates/count. No inventory, health economy, enemies or M2 scope added. Living pause/tab behavior and the M0 reference scene remain.
- Updated tests to the new requirements: crush contact in all four directions, late entry, body footprint, no premature death, retreat/outside safety, stationary-gate blocking, continued motion after death and clean Retry. Final validation passed: 53 unit tests across four files, TypeScript/build, and all 11 production-browser checks (four revised M1 scenarios plus seven M0 regressions). No skips or retries. Longer M1 scenarios use a 90 s test budget because they execute every frame of the longer walks/animations.
- Warning assertions advance 200 ms of controlled time so they sample beyond the HUD's 100 ms diagnostic interval. Initial checks at exactly one interval could read the previous idle label; the two-second gameplay warning was not shortened or bypassed.
- Production screenshots of instructions, eight-meter passage, closing marks, crush screen and Retry were visually inspected. The visual browser run observed no console/page errors. System Chromium 156/full headless/SwiftShader was used locally; GitHub's matching bundled-browser deployment run is still to be confirmed.
- Commit `aed8dfc` was pushed to main. GitHub Actions run [42983560785](https://github.com/play3r4o/Maze_Runner/actions/runs/42983560785) passed build (3m 1s) and deployment (12s), overall 3m 21s. The public summary confirms `https://play3r4o.github.io/Maze_Runner/`. Use `?v=aed8dfc` for a fresh request and check M1 / CRUSHING GATES. Human acceptance of this revised lethal behavior remains pending.
- This deployment result is recorded locally for the next source checkpoint, avoiding an otherwise redundant documentation-only deployment.

### M1 push-before-crush follow-up — 2026-11-11

- Replaced immediate contact death with collision-constrained kinematic pushing. Closing stone sweeps the character ahead of its leading face; the same displacement collision routine used by walking clamps against real static walls and other gates. Gates continue without occupancy holds or cancellation.
- Death occurs only if the resolved player footprint still overlaps the advanced gate: the body cannot fit against the opposing obstacle. Exact 0.6 m clearance survives; the next narrower step kills. Without an opposing wall, closing can push the player clear and is not inherently fatal. No pushing through solids, automatic escape teleport, or forced camera rotation.
- Player input along the corridor remains active while being pushed. HUD reports the pushing gate and prompts escape. The camera follows the displaced body; terminal death/continued mechanism/Retry behavior remains. Dead/Retry state clears push feedback. Eight-meter passages, two-second warning, four-second closing and outer route are unchanged.
- Updated brief amendment, architecture, M1 specification, README and agent instructions so future work follows push-before-crush instead of the earlier contact-death rule.
- Verification passed: 58 unit tests, TypeScript/build and all 11 production-browser checks in 2.2 minutes. Added/updated checks cover push-before-death in all four directions, exact fit and narrower gap, no opposing wall, large gate displacement, resistance without tunneling, escape while pushed, dead input and clean Retry. The full browser test checks visible camera-position displacement while still alive, pinning at the wall, death, continued closure and reset. No tests were skipped/retried.
- Separate production-browser screenshots were visually inspected at initial pushing, a narrow but survivable gap, and final pinning/death. The camera follows the sideways displacement and the HUD changes from escape feedback to Crushed/Retry. No console/page errors were observed. Local verification used system Chromium 156/full headless/SwiftShader; GitHub deployment confirmation and human acceptance remain pending. No M2 work started.
