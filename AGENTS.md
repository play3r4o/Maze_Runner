# Working on Shifting Labyrinth

Read `project_brief.md`, `docs/development_plan.md`, `docs/progress.md`, and the current milestone specification before editing.

- Implement only the currently approved milestone. M0–M6 are human accepted. M7 is approved; M7b and later require a new instruction after human testing.
- Each cloud task already has an isolated checkout. Use it; do not create worktrees unless requested.
- Keep simulation and game rules independent of Three.js, DOM, storage, and networking. Rendering consumes state.
- Prefer small explicit modules, plain types, primitive geometry, and minimal dependencies.
- Preserve user changes. Do not rewrite the brief, change scope silently, or push/publish without authorization.
- Use `npm ci` with the lockfile. Run `npm run typecheck`, `npm test`, and `npm run test:browser` (which includes the production build).
- Record test evidence and limitations in `docs/progress.md`. Automated tests do not constitute human acceptance.
- At the milestone boundary, provide launch instructions and a manual checklist, then stop. Do not start the next milestone automatically.

M7 intentionally excludes inventory, rewards, persistence, deadlines, the M7b pressure rules, concurrent shift plans, whole-maze movement, input-recording replay, telemetry, loot beyond the single relic, enemies, multiplayer, art assets, gravity, sprint, jumping and map editing. Freeze, teleport and bug reports are developer tools in the F2 panel only. The overhead view is an opt-in developer diagnostic, not a settled player navigation mechanic. Preserve M0 at `?scene=room`, M1 at `?scene=junction` and the accepted M2/M3 maze at `?scene=maze`. The default scene is the M7 solo expedition: relic in the outer ring, automatic warned shifts every 45 s, extraction at Sanctuary, plus the M6 debug tools.

M1 revision authorized 2026-11-11: eight-meter crushing passages, two-second warning, four-second closing. Closing contact pushes the body ahead of the stone with swept solid collision. Crush only when the full body cannot fit against the opposing wall; contact alone is not lethal. Occupancy must not hold/cancel gates. Gates finish after death, and Retry resets the attempt. This supersedes the brief's original early no-crushing rule; see its dated amendment and the updated M1 specification. Do not add the later combat/economy death systems yet.
