import { describe, expect, test } from 'vitest';
import { generateMaze } from '../src/simulation/mazeGenerator';
import { cellId, cellPosition, corridorRect, edgeId, findCell, layoutGateColliders } from '../src/simulation/maze';
import { FIXED_DT } from '../src/loop';
import { ALL_RULES_OFF, ALL_RULES_ON, BELL_TICKS, autoShiftTicks, isNight, nightFactor, nextBellTick,
  unrestOf } from '../src/game/pressure';
import { CHALK_INK_METRES, CHALK_STROKE_LIMIT, dailySeed, ticks } from '../src/game/tuning';
import { buildGeneratedWorld, createGeneratedRun, drawChalk, requestGeneratedRunShift, setRule,
  stepGeneratedRun } from '../src/game/generatedRun';
import { aimRay, raycastChalk, shownPoint, strokeLength } from '../src/game/chalk';
import type { Vec3 } from '../src/game/chalk';
import type { GeneratedRun } from '../src/game/generatedRun';
import { REPORT_FORMAT, createRunReport, parseRunReport, reproduceRun } from '../src/game/runReport';

const world = buildGeneratedWorld(generateMaze(41));
const still = { forward: 0, strafe: 0 };
const steps = (run: GeneratedRun, count: number, intent = still) => {
  for (let i = 0; i < count; i++) run = stepGeneratedRun(world, run, intent, run.player.yaw, FIXED_DT);
  return run;
};
// An expedition already under way, standing at the relic (outside Sanctuary).
// Traps and monsters are off here: these tests are about the M7b rules alone.
import { closeLoot, interactGeneratedRun, lootQuickMove } from '../src/game/looting';
const takeRelic = (run: GeneratedRun) => { const opened = interactGeneratedRun(run); return closeLoot(lootQuickMove(opened, 'container', opened.containers.find((c) => c.id === 'reliquary')!.items[0].uid)); };
const QUIET = { ...ALL_RULES_ON, traps: false, monsters: false };
const out = (patch: Partial<GeneratedRun> = {}): GeneratedRun =>
  ({ ...createGeneratedRun(world, QUIET), status: 'out', player: { x: world.relic.x, z: world.relic.z, yaw: 0 }, ...patch });

describe('T1 unrest', () => {
  test('carrying the relic shortens the automatic interval from 45 s to 27 s; switched off it stays 45 s', () => {
    const relic = [{ item: 'heartOfMaze' }];
    expect(unrestOf(ALL_RULES_ON, [])).toBe(0);
    expect(unrestOf(ALL_RULES_ON, relic)).toBe(3);
    expect(unrestOf({ ...ALL_RULES_ON, unrest: false }, relic)).toBe(0);
    expect(autoShiftTicks(ALL_RULES_ON, [], 0)).toBe(ticks(45));
    expect(autoShiftTicks(ALL_RULES_ON, relic, 0)).toBe(ticks(27));
    expect(autoShiftTicks(ALL_RULES_OFF, relic, 0)).toBe(ticks(45));
  });
  test('taking the relic applies to the countdown under way, but never to a warning already running', () => {
    // 30 s into the countdown: picking up the relic (27 s interval) triggers the shift on the next idle step.
    let run = steps(out({ autoTicks: ticks(30) - 1 }), 1);
    expect(run.shift.requests).toBe(0);
    run = steps(takeRelic(run), 1);
    expect(run.shift).toMatchObject({ requests: 1, phase: 'warning' });
    // During a warning the timing is the fixed 2 s regardless of unrest.
    let warned = requestGeneratedRunShift(world, out());
    warned = steps(takeRelic(warned), ticks(2) - 1);
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
    expect(autoShiftTicks(run.rules, [{ item: 'heartOfMaze' }], run.runTicks)).toBe(ticks(10));
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
    const silent = steps(requestGeneratedRunShift(world, out({ rules: { ...QUIET, sound: false } })), ticks(10.5));
    expect(silent.sounds).toEqual([]);
    expect(silent.shift.completedShifts).toBe(1);
  });
});

describe('T4 free-draw chalk', () => {
  const draw = (run: GeneratedRun, pitches: number[], yaws?: number[]) => {
    pitches.forEach((pitch, i) => { run = drawChalk(world, { ...run, player: { ...run.player, yaw: yaws?.[i] ?? run.player.yaw } }, pitch, true); });
    return run;
  };
  const sweep = (from: number, to: number, count: number) => Array.from({ length: count }, (_, i) => from + ((to - from) * i) / (count - 1));
  // A non-plaza room whose north side is solid stone, for wall tests.
  const walled = world.maze.cells.find((cell) => world.maze.rings[cell.id] !== 'sanctuary' && cell.row > 0
    && !world.maze.edges.some((edge) => edge.id === edgeId(cell.id, cellId(cell.column, cell.row - 1))))!;
  const at = (id: string, yaw = 0) => ({ ...cellPosition(findCell(world.maze, id), world.maze), yaw });

  test('the crosshair finds the floor, the nearest wall face and gate slabs within reach', () => {
    const down = aimRay({ x: 0, z: 0, yaw: 0 }, -Math.PI / 2 + 1e-6);
    expect(raycastChalk(down.origin, down.direction, world.solids, [])).toMatchObject({ surface: 'static', normal: [0, 1, 0] });
    const ahead = aimRay(at(walled.id), 0);
    const wall = raycastChalk(ahead.origin, ahead.direction, world.solids, []);
    expect(wall).toMatchObject({ surface: 'static', normal: [0, 0, 1] });
    expect(wall!.distance).toBeCloseTo(2, 6);
    // Out of reach: looking flat down a long open stretch hits nothing.
    expect(raycastChalk([0, 1.6, 0], [0, 0, -1], [], [])).toBeNull();
    const edge = world.maze.edges.find((item) => item.gate && world.maze.initialOpenness[item.gate] === 0)!;
    const a = cellPosition(findCell(world.maze, edge.a), world.maze), b = cellPosition(findCell(world.maze, edge.b), world.maze);
    const yaw = b.x > a.x ? -Math.PI / 2 : b.x < a.x ? Math.PI / 2 : b.z > a.z ? Math.PI : 0;
    const view = aimRay({ ...a, yaw }, 0);
    const gates = layoutGateColliders(world.maze, world.maze.initialOpenness);
    expect(raycastChalk(view.origin, view.direction, world.solids, gates)).toMatchObject({ surface: edge.gate });
  });
  test('holding C while looking around draws a stroke and spends ink by length; release ends it', () => {
    // Looking steeply down keeps the crosshair on this room's floor (0.6–1.2 m ahead).
    let run = draw(out({ player: { ...at(walled.id), yaw: 0 } }), sweep(-1.2, -0.95, 40));
    expect(run.chalk).toHaveLength(1);
    const stroke = run.chalk[0];
    expect(stroke).toMatchObject({ surface: 'static', normal: [0, 1, 0] });
    expect(stroke.points.length).toBeGreaterThan(10);
    expect(run.chalkLeft).toBeCloseTo(CHALK_INK_METRES - strokeLength(stroke), 2);
    expect(run.events.at(-1)).toMatchObject({ kind: 'chalk', detail: expect.stringContaining('stroke 1 on floor') });
    run = drawChalk(world, run, -0.95, false);
    expect(run.activeStroke).toBeNull();
    run = draw(run, sweep(-1.0, -0.95, 5));
    expect(run.chalk).toHaveLength(2);
  });
  test('moving from floor onto a wall starts a new stroke on the wall face', () => {
    const run = draw(out({ player: { ...at(walled.id), yaw: 0 } }), sweep(-0.8, 0.2, 60));
    expect(run.chalk.map((stroke) => stroke.normal)).toEqual([[0, 1, 0], [0, 0, 1]]);
  });
  test('ink runs out and never goes below zero; strokes are capped', () => {
    const run = draw(out({ chalkLeft: 0.2, player: { ...at(walled.id), yaw: 0 } }), sweep(-0.9, -0.3, 60));
    expect(run.chalkLeft).toBe(0);
    expect(strokeLength(run.chalk[0])).toBeLessThan(0.2 + 0.5);
    expect(draw(run, sweep(-0.3, -0.2, 5)).chalk).toEqual(run.chalk);
    const full = out({ chalk: Array.from({ length: CHALK_STROKE_LIMIT }, (_, i) => ({ id: i + 1, surface: 'static', normal: [0, 1, 0] as Vec3, points: [[0, 0, 0] as Vec3] })) });
    expect(draw(full, [-1]).chalk).toHaveLength(CHALK_STROKE_LIMIT);
  });
  test('no drawing when chalk is switched off, dead or the run is over', () => {
    for (const patch of [{ rules: { ...ALL_RULES_ON, chalk: false } }, { crushedBy: 'g1' }, { status: 'extracted' as const }]) {
      expect(draw(out({ ...patch, player: { ...at(walled.id), yaw: 0 } }), sweep(-0.9, -0.5, 10)).chalk).toEqual([]);
    }
  });
  test('a drawing on a gate slides with the slab; marks elsewhere never move through shifts', () => {
    const edge = world.maze.edges.find((item) => item.gate && world.maze.initialOpenness[item.gate] === 0)!;
    const a = cellPosition(findCell(world.maze, edge.a), world.maze), b = cellPosition(findCell(world.maze, edge.b), world.maze);
    const yaw = b.x > a.x ? -Math.PI / 2 : b.x < a.x ? Math.PI / 2 : b.z > a.z ? Math.PI : 0;
    const run = draw(out({ player: { ...a, yaw } }), sweep(-0.2, 0.2, 20));
    const stroke = run.chalk[0];
    expect(stroke.surface).toBe(edge.gate);
    const point = stroke.points[0];
    expect(shownPoint(world.maze, { [edge.gate!]: 0 }, stroke, point)).toEqual(point);
    const open = shownPoint(world.maze, { [edge.gate!]: 1 }, stroke, point);
    expect(Math.hypot(open[0] - point[0], open[2] - point[2])).toBeCloseTo(4.5, 6);
    let shifted = draw(out({ player: { ...at(walled.id), yaw: 0 } }), sweep(-0.9, -0.5, 20));
    const before = shifted.chalk;
    for (let i = 0; i < 3; i++) shifted = steps(requestGeneratedRunShift(world, shifted), ticks(10.5));
    expect(shifted.chalk).toEqual(before);
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
    expect(fresh).toMatchObject({ runTicks: 0, carrying: false, chalk: [], chalkLeft: CHALK_INK_METRES, bells: 0, sounds: [], rules: ALL_RULES_ON });
    expect(createGeneratedRun(world, ALL_RULES_OFF).rules).toEqual(ALL_RULES_OFF);
  });
  test('reports keep rules, chalk strokes and bells; tampered ink and older formats are refused', () => {
    const walled = world.maze.cells.find((cell) => world.maze.rings[cell.id] !== 'sanctuary')!;
    let run = setRule(out({ runTicks: ticks(160), carrying: true, player: { ...cellPosition(walled, world.maze), yaw: 0.3 } }), 'beams', false);
    for (let i = 0; i < 20; i++) run = drawChalk(world, run, -0.9 + i * 0.02, true);
    run = steps(drawChalk(world, run, 0, false), 2);
    expect(run.chalk[0].points.length).toBeGreaterThan(5);
    const text = JSON.stringify(createRunReport(world, run));
    const parsed = parseRunReport(text);
    if (!parsed.ok) throw new Error(parsed.error);
    const { run: copy, mismatches } = reproduceRun(world, parsed.report);
    expect(mismatches).toEqual([]);
    expect(copy).toMatchObject({ rules: run.rules, chalk: run.chalk, chalkLeft: run.chalkLeft, bells: 1, activeStroke: null });
    expect(parseRunReport(text.replace(`"chalkLeft":${run.chalkLeft}`, '"chalkLeft":30'))).toMatchObject({ ok: false });
    expect(parseRunReport(text.replace(`"format":${REPORT_FORMAT}`, '"format":3'))).toMatchObject({ ok: false, error: expect.stringContaining('format 3') });
  });
});
