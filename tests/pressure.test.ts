import { describe, expect, test } from 'vitest';
import { generateMaze } from '../src/simulation/mazeGenerator';
import { corridorRect } from '../src/simulation/maze';
import { FIXED_DT } from '../src/loop';
import { ALL_RULES_OFF, ALL_RULES_ON, BELL_TICKS, autoShiftTicks, headingIndexForYaw, isNight, nightFactor, nextBellTick,
  unrestOf } from '../src/game/pressure';
import { CHALK_CHARGES, dailySeed, ticks } from '../src/game/tuning';
import { buildGeneratedWorld, createGeneratedRun, interactGeneratedRun, placeChalk, requestGeneratedRunShift, setRule,
  stepGeneratedRun } from '../src/game/generatedRun';
import type { GeneratedRun } from '../src/game/generatedRun';
import { createRunReport, parseRunReport, reproduceRun } from '../src/game/runReport';

const world = buildGeneratedWorld(generateMaze(41));
const still = { forward: 0, strafe: 0 };
const steps = (run: GeneratedRun, count: number, intent = still) => {
  for (let i = 0; i < count; i++) run = stepGeneratedRun(world, run, intent, run.player.yaw, FIXED_DT);
  return run;
};
// An expedition already under way, standing at the relic (outside Sanctuary).
const out = (patch: Partial<GeneratedRun> = {}): GeneratedRun =>
  ({ ...createGeneratedRun(world), status: 'out', player: { x: world.relic.x, z: world.relic.z, yaw: 0 }, ...patch });

describe('T1 unrest', () => {
  test('carrying the relic shortens the automatic interval from 45 s to 27 s; switched off it stays 45 s', () => {
    expect(unrestOf(ALL_RULES_ON, false)).toBe(0);
    expect(unrestOf(ALL_RULES_ON, true)).toBe(3);
    expect(unrestOf({ ...ALL_RULES_ON, unrest: false }, true)).toBe(0);
    expect(autoShiftTicks(ALL_RULES_ON, false, 0)).toBe(ticks(45));
    expect(autoShiftTicks(ALL_RULES_ON, true, 0)).toBe(ticks(27));
    expect(autoShiftTicks(ALL_RULES_OFF, true, 0)).toBe(ticks(45));
  });
  test('taking the relic applies to the countdown under way, but never to a warning already running', () => {
    // 30 s into the countdown: picking up the relic (27 s interval) triggers the shift on the next idle step.
    let run = steps(out({ autoTicks: ticks(30) - 1 }), 1);
    expect(run.shift.requests).toBe(0);
    run = steps(interactGeneratedRun(world, run), 1);
    expect(run.shift).toMatchObject({ requests: 1, phase: 'warning' });
    // During a warning the timing is the fixed 2 s regardless of unrest.
    let warned = requestGeneratedRunShift(world, out());
    warned = steps(interactGeneratedRun(world, warned), ticks(2) - 1);
    expect(warned.shift.phase).toBe('warning');
    expect(steps(warned, 1).shift.phase).toBe('opening');
  });
});

describe('T2 dusk bell', () => {
  test('bells at 150, 195 and 240 s ring once each; night follows; dusk off means no bells and no night', () => {
    expect(BELL_TICKS).toEqual([ticks(150), ticks(195), ticks(240)]);
    let run = out({ shift: { ...createGeneratedRun(world).shift } });
    run = steps({ ...run, runTicks: ticks(150) - 2 }, 1);
    expect(run.bells).toBe(0);
    run = steps(run, 1);
    expect(run.bells).toBe(1);
    expect(run.events.at(-1)).toMatchObject({ kind: 'bell', detail: '1 strike' });
    expect(run.sounds.at(-1)).toMatchObject({ kind: 'bellToll', x: 0, z: 0, strikes: 1 });
    run = steps(run, 10);
    expect(run.events.filter((event) => event.kind === 'bell')).toHaveLength(1);
    run = steps({ ...run, runTicks: ticks(240) - 1 }, 1);
    // Jumping the clock past the second bell rings once with the current strike count.
    expect(run.bells).toBe(3);
    expect(run.events.at(-1)!.detail).toBe('3 strikes · night falls');
    expect(isNight(run.rules, run.runTicks)).toBe(true);
    expect(autoShiftTicks(run.rules, true, run.runTicks)).toBe(ticks(10));
    expect(nightFactor(run.rules, ticks(240))).toBe(0);
    expect(nightFactor(run.rules, ticks(245))).toBeCloseTo(0.5, 6);
    expect(nightFactor(run.rules, ticks(300))).toBe(1);
    expect(nextBellTick(ticks(100))).toBe(ticks(150));
    expect(nextBellTick(ticks(241))).toBeNull();
    const noDusk = steps(out({ rules: { ...ALL_RULES_ON, dusk: false }, runTicks: ticks(240) - 1 }), 5);
    expect(noDusk.bells).toBe(0);
    expect(isNight(noDusk.rules, noDusk.runTicks)).toBe(false);
    expect(nightFactor(noDusk.rules, ticks(300))).toBe(0);
  });
  test('at night shifts come every 10 s of idle maze; extraction still works', () => {
    let run = steps(out({ runTicks: ticks(240) }), ticks(10));
    expect(run.shift.requests).toBe(1);
    run = { ...run, shift: createGeneratedRun(world).shift, carrying: true, player: { x: 0, z: 0, yaw: 0 } };
    expect(steps(run, 1).status).toBe('extracted');
  });
});

describe('T3 sound events', () => {
  test('warnings at both moving gates, grinding while slabs move, bounded with growing ids; none when sound is off', () => {
    let run = requestGeneratedRunShift(world, out());
    const plan = run.shift.plan!;
    const centre = (gate: string) => {
      const rect = corridorRect(world.maze, world.maze.edges.find((edge) => edge.gate === gate)!);
      return { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 };
    };
    expect(run.sounds).toEqual([
      expect.objectContaining({ id: 1, kind: 'shiftWarning', ...centre(plan.open) }),
      expect.objectContaining({ id: 2, kind: 'shiftWarning', ...centre(plan.close) })]);
    run = steps(run, ticks(10.5));
    expect(run.sounds.slice(2)).toEqual([
      expect.objectContaining({ id: 3, kind: 'gateGrind', seconds: 1.25, ...centre(plan.open) }),
      expect.objectContaining({ id: 4, kind: 'gateGrind', seconds: 4, ...centre(plan.close) })]);
    let many = out();
    for (let i = 0; i < 30; i++) many = steps(requestGeneratedRunShift(world, many), ticks(10.5));
    expect(many.sounds).toHaveLength(32);
    expect(many.sounds.every((sound, i, all) => i === 0 || sound.id === all[i - 1].id + 1)).toBe(true);
    const silent = steps(requestGeneratedRunShift(world, out({ rules: { ...ALL_RULES_ON, sound: false } })), ticks(10.5));
    expect(silent.sounds).toEqual([]);
    expect(silent.shift.completedShifts).toBe(1);
  });
});

describe('T4 chalk', () => {
  test('yaw snaps to eight compass headings', () => {
    expect(headingIndexForYaw(0)).toBe(0);
    expect(headingIndexForYaw(-Math.PI / 2)).toBe(2);
    expect(headingIndexForYaw(Math.PI)).toBe(4);
    expect(headingIndexForYaw(Math.PI / 2)).toBe(6);
    expect(headingIndexForYaw(-Math.PI / 4 + 0.1)).toBe(1);
    expect(headingIndexForYaw(7 * Math.PI)).toBe(4);
  });
  test('twelve marks at most; marks survive shifts unchanged; none when chalk is off or the run is over', () => {
    let run = out();
    for (let i = 0; i < 15; i++) run = placeChalk({ ...run, player: { ...run.player, x: run.player.x + 0.1, yaw: -Math.PI / 2 } });
    expect(run.chalk).toHaveLength(CHALK_CHARGES);
    expect(run.chalkLeft).toBe(0);
    expect(run.chalk[0]).toMatchObject({ id: 1, headingIndex: 2 });
    expect(run.events.filter((event) => event.kind === 'chalk')).toHaveLength(12);
    const marks = run.chalk;
    for (let i = 0; i < 3; i++) run = steps(requestGeneratedRunShift(world, run), ticks(10.5));
    expect(run.shift.completedShifts).toBe(3);
    expect(run.chalk).toEqual(marks);
    expect(placeChalk(out({ rules: { ...ALL_RULES_ON, chalk: false } })).chalk).toEqual([]);
    expect(placeChalk(out({ status: 'extracted' })).chalk).toEqual([]);
    expect(placeChalk(out({ crushedBy: 'g1' })).chalk).toEqual([]);
  });
});

describe('T8 daily seed, toggles and reports', () => {
  test('the daily seed is the UTC date', () => {
    expect(dailySeed(new Date('2026-11-12T23:30:00Z'))).toBe(20261112);
    expect(dailySeed(new Date('2026-11-12T00:00:00+02:00'))).toBe(20261111);
  });
  test('toggles are logged; a fresh run resets clock, unrest, marks, bells and phase', () => {
    const run = setRule(setRule(out(), 'dusk', false), 'dusk', false);
    expect(run.rules.dusk).toBe(false);
    expect(run.events.filter((event) => event.kind === 'rules')).toEqual([expect.objectContaining({ detail: 'dusk off' })]);
    const fresh = createGeneratedRun(world);
    expect(fresh).toMatchObject({ runTicks: 0, carrying: false, chalk: [], chalkLeft: 12, bells: 0, sounds: [], rules: ALL_RULES_ON });
    expect(createGeneratedRun(world, ALL_RULES_OFF).rules).toEqual(ALL_RULES_OFF);
  });
  test('reports keep rules, chalk and bells; inconsistent chalk and older formats are refused', () => {
    let run = placeChalk(setRule(out({ runTicks: ticks(160), carrying: true }), 'beams', false));
    run = steps(run, 2);
    const text = JSON.stringify(createRunReport(world, run));
    const parsed = parseRunReport(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const { run: copy, mismatches } = reproduceRun(world, parsed.report);
    expect(mismatches).toEqual([]);
    expect(copy).toMatchObject({ rules: run.rules, chalk: run.chalk, chalkLeft: 11, bells: 1 });
    expect(parseRunReport(text.replace('"chalkLeft":11', '"chalkLeft":12'))).toMatchObject({ ok: false });
    expect(parseRunReport(text.replace('"format":3', '"format":2'))).toMatchObject({ ok: false, error: expect.stringContaining('format 2') });
  });
});
