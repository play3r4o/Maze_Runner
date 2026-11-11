import { describe, expect, test } from 'vitest';
import { generateMaze, createRng } from '../src/simulation/mazeGenerator';
import { corridorRect, layoutGateColliders } from '../src/simulation/maze';
import { overlapsBody } from '../src/simulation/movingWalls';
import { FIXED_DT } from '../src/loop';
import { RUN_EVENT_LIMIT, buildGeneratedWorld, createGeneratedRun, requestGeneratedRunShift, setGeneratedRunFrozen, stepGeneratedRun,
  teleportGeneratedRun, teleportTarget } from '../src/game/generatedRun';
import type { GeneratedRun, GeneratedWorld } from '../src/game/generatedRun';
import { REPORT_FORMAT, createRunReport, parseRunReport, replayShift, reproduceRun } from '../src/game/runReport';

const worlds = new Map<number, GeneratedWorld>();
const worldFor = (seed: number) => worlds.get(seed) ?? worlds.set(seed, buildGeneratedWorld(generateMaze(seed))).get(seed)!;

// A deterministic "session": random walking, G presses, freezes and teleports, like a tester would do.
function script(seed: number, ticks: number, scriptSeed: number) {
  const world = worldFor(seed);
  const rng = createRng(scriptSeed);
  let run = createGeneratedRun(world);
  let intent = { forward: 0, strafe: 0 };
  for (let i = 0; i < ticks; i++) {
    if (rng.next() < 0.02) intent = { forward: rng.int(3) - 1, strafe: rng.int(3) - 1 };
    if (rng.next() < 0.01) run = requestGeneratedRunShift(world, run);
    if (rng.next() < 0.002) run = setGeneratedRunFrozen(run, !run.frozen);
    if (rng.next() < 0.001) run = teleportGeneratedRun(world, run, rng.pick(world.maze.cells).id).run;
    run = stepGeneratedRun(world, run, intent, rng.next() * 6, FIXED_DT);
  }
  return { world, run };
}
const roundTrip = (world: GeneratedWorld, run: GeneratedRun) => {
  const parsed = parseRunReport(JSON.stringify(createRunReport(world, run)));
  if (!parsed.ok) throw new Error(parsed.error);
  return reproduceRun(world, parsed.report);
};

describe('reports reproduce exact gate state and position', () => {
  test.each(Array.from({ length: 40 }, (_, i) => i))('scripted session %i', (i) => {
    const { world, run } = script([1, 41, 777, 20261111][i % 4], 600 + i * 97, 1000 + i);
    const { run: copy, mismatches } = roundTrip(world, run);
    expect(copy.shift.openness).toEqual(run.shift.openness);
    expect(copy.shift.phase).toBe(run.shift.phase);
    expect(copy.shift.phaseSeconds).toBe(run.shift.phaseSeconds);
    expect(copy.shift.revision).toBe(run.shift.revision);
    expect(copy.shift.completedShifts).toBe(run.shift.completedShifts);
    expect(copy.shift.plan).toEqual(run.shift.plan);
    expect(copy.shift.requests).toBe(run.shift.requests);
    if (!run.crushedBy) {
      expect(mismatches).toEqual([]);
      expect(copy.player).toEqual(run.player);
    } else {
      // A crushed body overlaps stone; it is restored alive in its last room instead.
      expect(mismatches.at(-1)).toContain('overlaps stone');
      expect(copy.crushedBy).toBeNull();
    }
    expect([...world.solids, ...layoutGateColliders(world.maze, copy.shift.openness)].some((rect) => overlapsBody(copy.player, rect))).toBe(false);
    expect(copy).toMatchObject({ tick: run.tick, shiftTicks: run.shiftTicks, frozen: run.frozen, visited: run.visited, teleports: run.teleports });
    expect(copy.events.at(-1)).toMatchObject({ kind: 'report' });
  });
  test('the scripted sessions cover mid-shift, frozen, crushed and teleported states', () => {
    const runs = Array.from({ length: 40 }, (_, i) => script([1, 41, 777, 20261111][i % 4], 600 + i * 97, 1000 + i).run);
    expect(runs.filter((run) => run.shift.phase !== 'idle').length).toBeGreaterThan(5);
    expect(runs.filter((run) => run.shift.completedShifts > 0).length).toBeGreaterThan(20);
    expect(runs.filter((run) => run.events.some((event) => event.kind === 'freeze')).length).toBeGreaterThan(3);
    expect(runs.filter((run) => run.teleports > 0).length).toBeGreaterThan(3);
  });
  test('a crushed run reproduces the gate state and restores the body alive in the nearest room', () => {
    const world = worldFor(41);
    let run = requestGeneratedRunShift(world, createGeneratedRun(world));
    const edge = world.maze.edges.find((item) => item.gate === run.shift.plan!.close)!;
    const rect = corridorRect(world.maze, edge);
    // Tests may place the body directly; gameplay never does.
    run = { ...run, player: { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2, yaw: 0 } };
    for (let i = 0; i < 9 * 60 && !run.crushedBy; i++) run = stepGeneratedRun(world, run, { forward: 0, strafe: 0 }, 0, FIXED_DT);
    for (let i = 0; i < 30; i++) run = stepGeneratedRun(world, run, { forward: 0, strafe: 0 }, 0, FIXED_DT);
    expect(run.crushedBy).toBe(edge.gate);
    const { run: copy, mismatches } = roundTrip(world, run);
    expect(copy.shift.openness).toEqual(run.shift.openness);
    expect(copy.shift.phaseSeconds).toBe(run.shift.phaseSeconds);
    expect(mismatches).toHaveLength(1);
    expect([edge.a, edge.b].map((id) => `Recorded position overlaps stone; placed at ${id} instead.`)).toContain(mismatches[0]);
    expect(copy.crushedBy).toBeNull();
    expect(copy.events.some((event) => event.kind === 'death')).toBe(true);
  });
  test('continuing a reproduced run behaves exactly like the original', () => {
    const world = worldFor(41);
    let a = requestGeneratedRunShift(world, createGeneratedRun(world));
    for (let i = 0; i < 200; i++) a = stepGeneratedRun(world, a, { forward: 0, strafe: 0 }, 0, FIXED_DT);
    let b = roundTrip(world, a).run;
    for (let i = 0; i < 400; i++) {
      a = stepGeneratedRun(world, a, { forward: 1, strafe: 0 }, 0, FIXED_DT);
      b = stepGeneratedRun(world, b, { forward: 1, strafe: 0 }, 0, FIXED_DT);
    }
    expect(b.shift.openness).toEqual(a.shift.openness);
    expect(b.player).toEqual(a.player);
    expect(b.shift.completedShifts).toBe(1);
  });
  test('freeze stops gate motion and shift time but not walking', () => {
    const world = worldFor(1);
    let run = setGeneratedRunFrozen(requestGeneratedRunShift(world, createGeneratedRun(world)), true);
    const shift = run.shift;
    for (let i = 0; i < 300; i++) run = stepGeneratedRun(world, run, { forward: 1, strafe: 0 }, 0, FIXED_DT);
    expect(run.shift).toBe(shift);
    expect(run.shiftTicks).toBe(0);
    expect(run.player.z).toBeLessThan(-1);
    expect(run.events.map((event) => event.kind)).toEqual(['shift', 'freeze']);
    expect(replayShift(world, run.shift.requests, run.shiftTicks)).toEqual(run.shift);
  });
});

describe('named reproduction scenarios', () => {
  // Fixed states a tester can be pointed at; each must rebuild identically on every build of this version.
  test('seed 41: G7 half-closed, seen from the room just north of Sanctuary', () => {
    const world = worldFor(41);
    const shift = replayShift(world, 1, Math.round((2 + 1.25 + 2) / FIXED_DT));
    expect(shift.plan).toEqual({ open: 'g8', close: 'g7' });
    expect(shift.phase).toBe('closing');
    expect(shift.openness.g7).toBeCloseTo(0.5, 6);
    expect(shift.revision).toBe(2);
  });
  test('seed 1: five completed shifts', () => {
    const world = worldFor(1);
    const shift = replayShift(world, 5, 10_000);
    expect(shift).toMatchObject({ phase: 'idle', completedShifts: 5, revision: 10 });
    expect(Object.values(shift.openness).filter((value) => value === 1)).toHaveLength(4);
  });
});

describe('report parsing and teleport validation', () => {
  const world = worldFor(1);
  const good = createRunReport(world, createGeneratedRun(world));
  test('malformed, other-version and other-config reports are rejected with reasons', () => {
    const bad = (patch: object) => parseRunReport(JSON.stringify({ ...good, ...patch }));
    expect(parseRunReport('not json')).toMatchObject({ ok: false, error: expect.stringContaining('JSON') });
    expect(parseRunReport('[]')).toMatchObject({ ok: false });
    expect(bad({ format: REPORT_FORMAT + 1 })).toMatchObject({ ok: false, error: expect.stringContaining('format') });
    expect(bad({ version: 'm4.1' })).toMatchObject({ ok: false, error: expect.stringContaining('m4.1') });
    expect(bad({ seed: -1 })).toMatchObject({ ok: false });
    expect(bad({ config: { size: 13, loopChance: 0.1, gateCount: 8 } })).toMatchObject({ ok: false, error: expect.stringContaining('config') });
    expect(bad({ requests: 1.5 })).toMatchObject({ ok: false });
    expect(bad({ player: { x: 'a', z: 0, yaw: 0 } })).toMatchObject({ ok: false });
    expect(bad({ visited: [3] })).toMatchObject({ ok: false });
    expect(parseRunReport(JSON.stringify(good))).toMatchObject({ ok: true });
  });
  test('reports for another seed are flagged', () => {
    expect(reproduceRun(worldFor(2), good).mismatches[0]).toContain('does not match');
  });
  test.each([1, 41, 20261111])('seed %i: every room centre is a valid teleport target in starting and fully shifted poses', (seed) => {
    const w = worldFor(seed);
    let run = createGeneratedRun(w);
    for (const shifted of [false, true]) {
      if (shifted) run = { ...run, shift: replayShift(w, 6, 10_000) };
      for (const cell of w.maze.cells) {
        const target = teleportTarget(w, run, cell.id);
        expect(target.ok, cell.id).toBe(true);
        const moved = teleportGeneratedRun(w, run, cell.id).run;
        expect(moved).toMatchObject({ cell: cell.id, ring: w.maze.rings[cell.id], teleports: 1 });
        expect([...w.solids, ...layoutGateColliders(w.maze, run.shift.openness)].some((rect) => overlapsBody(moved.player, rect))).toBe(false);
      }
    }
  });
  test('unknown cells and dead players cannot teleport; events stay bounded', () => {
    const run = createGeneratedRun(world);
    expect(teleportGeneratedRun(world, run, 'cell-99-99').error).toContain('Unknown cell');
    expect(teleportGeneratedRun(world, { ...run, crushedBy: 'g1' }, 'cell-0-0').error).toContain('Retry');
    let busy = run;
    for (let i = 0; i < RUN_EVENT_LIMIT + 20; i++) busy = teleportGeneratedRun(world, busy, world.maze.cells[i % 50].id).run;
    expect(busy.events).toHaveLength(RUN_EVENT_LIMIT);
  });
});
