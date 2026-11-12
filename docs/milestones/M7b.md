# M7b — Pressure and wayfinding

Approved after the M7 verdict (2026-11-12: “okay in terms of fun… quite easy… continue with next step”). Implements plan rules T1–T4 and the M7b part of T8. Stop for the developer's rules-on versus rules-off comparison before M8.

## Result and boundaries

The M7 expedition gains reasons to hurry and one tool to navigate:

| Rule | What the player meets |
| --- | --- |
| T1 Unrest | Carrying the relic makes automatic shifts come every 27 s instead of 45 s. |
| T2 Dusk bell | A bell from Sanctuary tolls once at 2:30, twice at 3:15 and three times at 4:00 of the run. Then night: the light dims and the maze shifts every 10 s of idle time. Never shown as a countdown. |
| T3 Sound | Gates about to move give two quick tones; moving slabs grind; the bell is heard from anywhere. All positional (direction and distance). Volume and mute in the pause panel. |
| T4 Chalk | Press C to draw an arrow on the floor where you face, snapped to 8 directions; 12 per run. Shifts never move marks; a slab may cover one. |
| T8 Daily seed | With no `?seed=`, everyone gets today's maze: the UTC date as `YYYYMMDD`. |

Each rule, plus the M7 light beams (`beams`), has a development switch in the F2 panel. The M7 beams are kept but can be switched off: T4 called chalk "the only navigation aid" while M7 added beams, and the developer found M7 too easy, so the comparison decides.

Not in M7b: thread, gate jam, creatures, traps, a player map, audio files, wall occlusion, doors that close at dusk, any backend.

## Rules (`game/tuning.ts`, `game/pressure.ts`, `game/generatedRun.ts`)

All numbers live in `game/tuning.ts`.

- **Toggles**: `RuleToggles { unrest, dusk, sound, chalk, beams }`, all on by default. A change applies from the next step and is logged (`rules` event). `?off=dusk,sound` starts runs with those rules off; the F2 switches keep that parameter up to date, so reloads and New run keep a comparison setting. Retry keeps the current switches.
- **T1 unrest** (`unrestOf`): relic carried and unrest on → 3, else 0. Automatic interval = `max(15, 45 − 6 × unrest)` seconds (`autoShiftTicks`). The interval applies to the countdown under way: taking the relic 30 s into a 45 s countdown triggers the shift at the next idle step. Warnings, opening and closing keep their fixed durations. Debug panel only: unrest and interval.
- **T2 dusk** (`bellsDue`, `isNight`, `nightFactor`): run clock = M7 `runTicks` (starts on leaving Sanctuary, stops at death, pauses with the game). Bells at 150, 195 and 240 s ring exactly once each while dusk is on (`bell` event, `bells` count). Night = dusk on and clock ≥ 240 s; it fixes the automatic interval at 10 s, overriding unrest. Extraction still works at night and Sanctuary never closes. Rendering dims the hemisphere light, sun and sky over 10 s (presentation only).
- **T3 sound**: the run keeps the last 32 `SoundEvent { id, kind, x, z, tick, seconds?, strikes? }` with ids that only grow. `shiftWarning` at the corridor centre of both plan gates when a warning starts; `gateGrind` at the moving gate when opening (1.25 s) and closing (4 s) begin; `bellToll` at (0, 0) with the strike count. None when sound is off. `rendering/audio.ts` plays each new id once with Three.js `PositionalAudio` and buffers generated in code (tones, filtered noise, bell partials), inverse-distance falloff (bell reference 40 m, others 8 m), at most 12 voices. The audio context starts on the click that requests pointer lock. Visual equivalents: HUD shift phase/notice for gates; the HUD notice names the bell strikes for 6 s.
- **T4 chalk** (`placeChalk`): needs chalk on, a charge left, alive and the run not over. Mark `{ id, x, z, headingIndex }`, heading 0 north, clockwise to 7 north-west, from the player's yaw. Marks are never erased or moved. Rendering hides a mark while a gate slab covers it. The debug map draws them.
- **T8**: `dailySeed(now)` = UTC `YYYYMMDD`. Invalid seeds still get a random seed with a message. New run still picks a random seed. The result screen shows the seed.
- **Reports**: format 3 adds rules, chalk, charges left and bells. Older formats are refused; chalk count and charges must add to 12.
- A `#repro=` link opened on the same page (hash change only) is now applied too.

## Interface

- HUD: chalk count (or "no chalk"), C in controls and footer, bell notice. Pause panel: volume slider and mute. Header **M7b · PRESSURE**.
- F2: rule checkboxes; run line with unrest, interval, auto-shift countdown, run clock and next bell or NIGHT; chalk arrows on the map.

## Human acceptance checklist

1. On the default page, check the address uses today's seed (`seed=YYYYMMDD`, UTC).
2. Play **three runs with every rule off** (F2: untick all five, or open `?off=unrest,dusk,sound,chalk,beams`), then **three with every rule on**, on the same seed.
3. With sound on and the HUD warning ignored, turn toward a gate you hear warning and grinding. Check volume and mute.
4. Take the relic and notice shifts coming faster.
5. Stay out past the third bell (4:00) and come home at night.
6. Use all 12 chalk marks; find one made misleading by a shift (an arrow pointing at closed stone).
7. **Verdict**: are the rules-on runs tenser and still fair? Which rule should be retuned or removed?

## Automated checks

- `npm ci`, `npm run typecheck`, `npm test`, `npm run test:browser`.
- Unit (`tests/pressure.test.ts`): interval 45/27 s and unrest off; the interval applies to the countdown under way but never shortens a warning; bells at 150/195/240 s exactly once, notice texts, next bell, night interval 10 s, fade, dusk off; extraction at night; warning sounds at both gate centres, grind sounds with durations, ids and the 32 limit, silence when off; heading snapping; 12 marks, marks unchanged by three shifts, no marks when chalk is off, dead or finished; UTC daily seed; logged toggles; fresh runs reset clock, marks, bells and sounds; report round trip with rules, chalk and bells, refusal of inconsistent chalk and format 2.
- Browser: chalk count, two marks on the map, audio context running and at least three sounds played after a forced shift, chalk switched off in the address and after reload, mute; bell notice and event at 150 s and NIGHT with a 10 s interval after 240 s (both via reports that set the run clock); a hash-only `#repro=` link applies; the default page uses the daily seed. All earlier checks updated for the new header.

## Do not build yet

Thread (T5), gate jam (T6), stalker (T7), stored traces (T8 M8 part), co-op rules (T9), traps (T10 and M12), inventory (M8), wall occlusion, audio files, new dependencies. The developer asked for many more traps and enemies after M7; those belong to M10–M12 and should be widened there.
