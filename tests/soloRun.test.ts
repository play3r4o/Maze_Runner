import { describe, expect, test } from 'vitest';
import { generateMaze } from '../src/simulation/mazeGenerator';
import { cellPosition, findCell } from '../src/simulation/maze';
import { findMazeRoute } from '../src/simulation/mazeGraph';
import { FIXED_DT } from '../src/loop';
import { AUTO_SHIFT_TICKS, RELIC_REACH, abandonGeneratedRun, buildGeneratedWorld, createGeneratedRun, interactGeneratedRun,
  isRunOver, placeRelic, relicInReach, requestGeneratedRunShift, setGeneratedRunFrozen, stepGeneratedRun,
  teleportTarget } from '../src/game/generatedRun';
import type { GeneratedRun, GeneratedWorld } from '../src/game/generatedRun';
import { createRunReport, parseRunReport, reproduceRun } from '../src/game/runReport';

const still = { forward: 0, strafe: 0 };
const worlds = new Map<number, GeneratedWorld>();
const worldFor = (seed: number) => worlds.get(seed) ?? worlds.set(seed, buildGeneratedWorld(generateMaze(seed))).get(seed)!;
const steps = (world: GeneratedWorld, run: GeneratedRun, ticks: number, intent = still) => {
  for (let i = 0; i < ticks; i++) run = stepGeneratedRun(world, run, intent, 0, FIXED_DT);
  return run;
};
// Walk cell to cell along the current graph route (recomputed from the current gate poses).
function walkTo(world: GeneratedWorld, run: GeneratedRun, target: string) {
  const from = run.cell ?? world.maze.start;
  const route = findMazeRoute(world.maze, run.shift.openness, from, target)!;
  for (const id of route.cells.slice(1)) {
    const goal = cellPosition(findCell(world.maze, id), world.maze);
    const intent = { strafe: Math.sign(Math.round(goal.x - run.player.x)), forward: -Math.sign(Math.round(goal.z - run.player.z)) };
    run = steps(world, run, 240, intent);
  }
  return { run, route: route.cells };
}

describe('relic placement', () => {
  test.each(Array.from({ length: 200 }, (_, i) => i * 7919 + 13))('seed %i: outer ring, far half, not a landmark, clear', (seed) => {
    const world = worldFor(seed);
    const { maze, relic } = world;
    expect(placeRelic(maze)).toEqual(relic);
    expect(maze.rings[relic.cell]).toBe('outer');
    expect(maze.landmarks.map((landmark) => landmark.cell)).not.toContain(relic.cell);
    const length = (id: string) => findMazeRoute(maze, {}, id, maze.start)!.edges.length;
    const outer = maze.cells.filter((cell) => maze.rings[cell.id] === 'outer').map((cell) => length(cell.id)).sort((a, b) => a - b);
    expect(length(relic.cell)).toBeGreaterThanOrEqual(outer[Math.floor(outer.length / 2)] - 1);
    expect(teleportTarget(world, createGeneratedRun(world), relic.cell).ok).toBe(true);
    worlds.delete(seed);
  });
});

describe('run rules', () => {
  const world = worldFor(41);
  const at = (run: GeneratedRun, dx: number) => ({ ...run, status: 'out' as const, player: { x: world.relic.x + dx, z: world.relic.z, yaw: 0 } });
  test('E takes the relic only within reach; ownership is unique', () => {
    const base = createGeneratedRun(world);
    expect(relicInReach(world, at(base, RELIC_REACH + 0.05))).toBe(false);
    expect(interactGeneratedRun(world, at(base, RELIC_REACH + 0.05)).carrying).toBe(false);
    const taken = interactGeneratedRun(world, at(base, RELIC_REACH - 0.05));
    expect(taken.carrying).toBe(true);
    expect(taken.events.at(-1)).toMatchObject({ kind: 'relic' });
    expect(interactGeneratedRun(world, taken)).toBe(taken);
    expect(interactGeneratedRun(world, { ...at(base, 0), crushedBy: 'g1' }).carrying).toBe(false);
    expect(interactGeneratedRun(world, { ...at(base, 0), status: 'abandoned' }).carrying).toBe(false);
  });
  test('leaving Sanctuary starts the clock; only carrying the relic home extracts, exactly once', () => {
    let run = steps(world, createGeneratedRun(world), 60);
    expect(run).toMatchObject({ status: 'ready', runTicks: 0 });
    // Teleport to an outer room: out of the plaza, the run starts on the next step.
    run = { ...run, player: { ...run.player, ...cellPosition(findCell(world.maze, world.relic.cell), world.maze) } };
    run = steps(world, run, 1);
    expect(run.status).toBe('out');
    run = steps(world, run, 59);
    // The clock counts from the step after leaving.
    expect(run.runTicks).toBe(59);
    // Back home without the relic: not extracted.
    const empty = steps(world, { ...run, player: { x: 0, z: 0, yaw: 0 } }, 5);
    expect(empty.status).toBe('out');
    // Back home with it: extracted once, then frozen as a record.
    const home = steps(world, { ...run, carrying: true, player: { x: 0, z: 0, yaw: 0 } }, 1);
    expect(home.status).toBe('extracted');
    expect(home.events.filter((event) => event.detail.startsWith('extracted'))).toHaveLength(1);
    expect(steps(world, home, 600, { forward: 1, strafe: 0 })).toBe(home);
    expect(abandonGeneratedRun(home)).toBe(home);
    expect(requestGeneratedRunShift(world, home)).toBe(home);
  });
  test('abandon ends ready or running runs with nothing secured, once', () => {
    const ready = abandonGeneratedRun(createGeneratedRun(world));
    expect(ready.status).toBe('abandoned');
    const carrying = abandonGeneratedRun({ ...createGeneratedRun(world), status: 'out', carrying: true });
    expect(carrying.status).toBe('abandoned');
    expect(carrying.events.at(-1)!.detail).toContain('relic (lost)');
    expect(abandonGeneratedRun(carrying)).toBe(carrying);
    expect(isRunOver('abandoned') && isRunOver('failed') && isRunOver('extracted') && !isRunOver('out')).toBe(true);
  });
  test('automatic shifts: none before the run starts, every 45 s of idle maze, paused by freeze, reset by G', () => {
    let run = steps(world, createGeneratedRun(world), AUTO_SHIFT_TICKS + 10);
    expect(run.shift.requests).toBe(0);
    run = { ...run, status: 'out' };
    run = steps(world, run, AUTO_SHIFT_TICKS - 1);
    expect(run.shift.requests).toBe(0);
    run = steps(world, run, 1);
    expect(run.shift).toMatchObject({ requests: 1, phase: 'warning' });
    expect(run.events.at(-1)!.detail).toContain('auto accepted');
    run = steps(world, run, Math.round(10.25 / FIXED_DT) + 5);
    expect(run.shift.phase).toBe('idle');
    const idleSince = run.autoTicks;
    run = steps(world, run, AUTO_SHIFT_TICKS - idleSince - 1);
    expect(run.shift.requests).toBe(1);
    run = steps(world, run, 1);
    expect(run.shift.requests).toBe(2);
    // Freeze holds the countdown; G resets it.
    let frozen = setGeneratedRunFrozen({ ...createGeneratedRun(world), status: 'out', autoTicks: 100 }, true);
    frozen = steps(world, frozen, AUTO_SHIFT_TICKS);
    expect(frozen).toMatchObject({ autoTicks: 100, shift: { requests: 0 } });
    const forced = requestGeneratedRunShift(world, { ...createGeneratedRun(world), status: 'out', autoTicks: 2000 });
    expect(forced.autoTicks).toBe(0);
  });
  test('being crushed fails the run once, carrying or not', () => {
    // Place the body (test only) where the closing gate will pin it; the real step does the rest.
    let run = requestGeneratedRunShift(world, { ...createGeneratedRun(world), status: 'out', carrying: true });
    const edge = world.maze.edges.find((item) => item.gate === run.shift.plan!.close)!;
    const a = cellPosition(findCell(world.maze, edge.a), world.maze), b = cellPosition(findCell(world.maze, edge.b), world.maze);
    run = { ...run, player: { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, yaw: 0 } };
    run = steps(world, run, 9 * 60);
    expect(run).toMatchObject({ status: 'failed', crushedBy: edge.gate });
    expect(run.events.filter((event) => event.kind === 'run' && event.detail.startsWith('failed'))).toHaveLength(1);
    expect(run.events.at(-1)!.detail).toContain('relic lost');
  });
});

describe.each([1, 41, 20261111])('seed %i complete solo loop', (seed) => {
  test('walk out, take the relic, survive a shift that changes the graph, walk the new route home, extract', () => {
    const world = worldFor(seed);
    // Walk out frozen so the scripted route stays valid, then let real shifts run.
    let run = setGeneratedRunFrozen(createGeneratedRun(world), true);
    run = walkTo(world, run, world.relic.cell).run;
    expect(run.cell).toBe(world.relic.cell);
    run = interactGeneratedRun(world, run);
    expect(run.carrying).toBe(true);
    run = setGeneratedRunFrozen(run, false);
    run = steps(world, run, AUTO_SHIFT_TICKS + Math.round(10.5 / FIXED_DT));
    expect(run.shift.completedShifts).toBeGreaterThanOrEqual(1);
    expect(run.status).toBe('out');
    run = setGeneratedRunFrozen(run, true);
    const home = walkTo(world, run, world.maze.start);
    run = steps(world, home.run, 2);
    expect(run.status).toBe('extracted');
    expect(run.runTicks).toBeGreaterThan(AUTO_SHIFT_TICKS);
    expect(run.events.find((event) => event.detail.startsWith('extracted'))!.detail).toMatch(/extracted in \d+\.\ds, \d+ shifts/);
  });
});

describe('reports keep the expedition', () => {
  test('carrying, status, run clock and automatic countdown survive a round trip', () => {
    const world = worldFor(41);
    let run: GeneratedRun = { ...createGeneratedRun(world), status: 'out', carrying: true,
      player: { x: world.relic.x, z: world.relic.z, yaw: 0 } };
    run = steps(world, run, AUTO_SHIFT_TICKS + 300);
    const parsed = parseRunReport(JSON.stringify(createRunReport(world, run)));
    if (!parsed.ok) throw new Error(parsed.error);
    const { run: copy, mismatches } = reproduceRun(world, parsed.report);
    expect(mismatches).toEqual([]);
    expect(copy).toMatchObject({ status: 'out', carrying: true, runTicks: run.runTicks, autoTicks: run.autoTicks });
    const a = steps(world, run, 3000), b = steps(world, copy, 3000);
    expect(b.shift.openness).toEqual(a.shift.openness);
    expect(b.shift.requests).toBe(a.shift.requests);
  });
  test('format 1 reports are refused', () => {
    const world = worldFor(41);
    const old = { ...createRunReport(world, createGeneratedRun(world)), format: 1 };
    expect(parseRunReport(JSON.stringify(old))).toMatchObject({ ok: false, error: expect.stringContaining('format 1') });
  });
});
