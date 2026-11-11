# Working on Shifting Labyrinth

Read `project_brief.md`, `docs/development_plan.md`, `docs/progress.md`, and the current milestone specification before editing.

- Implement only the currently approved milestone. M0–M4 are human accepted. M5 is approved; M6 and later require a new instruction after human testing.
- Each cloud task already has an isolated checkout. Use it; do not create worktrees unless requested.
- Keep simulation and game rules independent of Three.js, DOM, storage, and networking. Rendering consumes state.
- Prefer small explicit modules, plain types, primitive geometry, and minimal dependencies.
- Preserve user changes. Do not rewrite the brief, change scope silently, or push/publish without authorization.
- Use `npm ci` with the lockfile. Run `npm run typecheck`, `npm test`, and `npm run test:browser` (which includes the production build).
- Record test evidence and limitations in `docs/progress.md`. Automated tests do not constitute human acceptance.
- At the milestone boundary, provide launch instructions and a manual checklist, then stop. Do not start the next milestone automatically.

M5 intentionally excludes automatic or timed shifting, concurrent shift plans, whole-maze movement, interaction/loot, enemies, persistence, multiplayer, art assets, gravity, sprint, jumping and map editing/teleport. The overhead view is an opt-in developer diagnostic, not a settled player navigation mechanic. Preserve M0 at `?scene=room`, M1 at `?scene=junction` and the accepted M2/M3 maze at `?scene=maze`. The default scene is the M5 seeded maze with player-triggered gate shifts.

M1 revision authorized 2026-11-11: eight-meter crushing passages, two-second warning, four-second closing. Closing contact pushes the body ahead of the stone with swept solid collision. Crush only when the full body cannot fit against the opposing wall; contact alone is not lethal. Occupancy must not hold/cancel gates. Gates finish after death, and Retry resets the attempt. This supersedes the brief's original early no-crushing rule; see its dated amendment and the updated M1 specification. Do not add the later combat/economy death systems yet.
