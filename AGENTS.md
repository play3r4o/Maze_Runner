# Working on Shifting Labyrinth

Read `project_brief.md`, `docs/development_plan.md`, `docs/progress.md`, and the current milestone specification before editing.

- Implement only the currently approved milestone. M0 is human accepted. M1 is approved; M2 and later require a new instruction after human testing.
- Each cloud task already has an isolated checkout. Use it; do not create worktrees unless requested.
- Keep simulation and game rules independent of Three.js, DOM, storage, and networking. Rendering consumes state.
- Prefer small explicit modules, plain types, primitive geometry, and minimal dependencies.
- Preserve user changes. Do not rewrite the brief, change scope silently, or push/publish without authorization.
- Use `npm ci` with the lockfile. Run `npm run typecheck`, `npm test`, and `npm run test:browser` (which includes the production build).
- Record test evidence and limitations in `docs/progress.md`. Automated tests do not constitute human acceptance.
- At the milestone boundary, provide launch instructions and a manual checklist, then stop. Do not start the next milestone automatically.

M1 intentionally excludes random/automatic shifting, procedural generation, interaction/loot, enemies, persistence, multiplayer, art assets, gravity, sprint, and jumping. Preserve the accepted M0 reference scene at `?scene=room`.

M1 revision authorized 2026-11-11: eight-meter crushing passages, two-second warning, four-second closing. Physical swept contact kills; occupancy must not hold/cancel gates. Gates finish after death, and Retry resets the attempt. This supersedes the brief's original early no-crushing rule; see its dated amendment and the updated M1 specification. Do not add the later combat/economy death systems yet.
