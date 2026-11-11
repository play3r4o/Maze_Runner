import { describe, expect, test } from 'vitest';
import { cellPosition, corridorRect, findCell, gateEdges, gateRect, layoutGateColliders } from '../src/simulation/maze';
import type { MazeLayout } from '../src/simulation/maze';
import { generateMaze } from '../src/simulation/mazeGenerator';
import type { GeneratedMaze } from '../src/simulation/mazeGenerator';
import { mazeTopologySignature, reachableMazeCells } from '../src/simulation/mazeGraph';
import { SHIFT_LOG_LIMIT, advanceGeneratedShift, createGeneratedShift, requestGeneratedShift,
  validateGatePlan } from '../src/simulation/generatedShift';
import type { GeneratedShift } from '../src/simulation/generatedShift';
import { buildGeneratedWorld, createGeneratedRun, requestGeneratedRunShift, stepGeneratedRun } from '../src/game/generatedRun';
import type { GeneratedRun, GeneratedWorld } from '../src/game/generatedRun';
import { overlapsBody } from '../src/simulation/movingWalls';

const SHIFT_SECONDS = 2 + 1.25 + 4 + 3;
function runShift(state: GeneratedShift, maze: GeneratedMaze, dt: number, check?: (state: GeneratedShift) => void) {
  for (let t = 0; t < SHIFT_SECONDS + 1 && state.phase !== 'idle'; t += dt) {
    state = advanceGeneratedShift(state, dt, maze);
    check?.(state);
  }
  return state;
}

describe('plan validation', () => {
  // Tiny fixture, all connected now: closing g1 always strands `a`; opening g2 adds a loop that cannot help.
  const fixture = {
    seed: 7, start: 'home', landmarks: [], columns: 3, rows: 2, gates: ['g1', 'g2'], initialOpenness: { g1: 1, g2: 0 },
    cells: [{ id: 'a', column: 0, row: 0 }, { id: 'home', column: 1, row: 0 }, { id: 'x', column: 2, row: 0 },
      { id: 'd', column: 1, row: 1 }, { id: 'e', column: 2, row: 1 }],
    edges: [{ id: 'a--home', a: 'home', b: 'a', gate: 'g1' }, { id: 'd--home', a: 'home', b: 'd' }, { id: 'd--e', a: 'd', b: 'e' },
      { id: 'e--x', a: 'e', b: 'x' }, { id: 'home--x', a: 'home', b: 'x', gate: 'g2' }],
  } as unknown as GeneratedMaze;
  test('unknown, identical, wrongly posed and isolating plans are rejected with reasons', () => {
    const now = { g1: 1, g2: 0 };
    expect(validateGatePlan(fixture, now, { open: 'g9', close: 'g1' }).reason).toContain('unknown gate');
    expect(validateGatePlan(fixture, now, { open: 'g1', close: 'g1' }).ok).toBe(false);
    expect(validateGatePlan(fixture, now, { open: 'g1', close: 'g2' }).reason).toContain('not fully closed');
    expect(validateGatePlan(fixture, { g1: 1, g2: 0.5 }, { open: 'g2', close: 'g1' }).reason).toContain('not fully closed');
    const isolating = validateGatePlan(fixture, now, { open: 'g2', close: 'g1' });
    expect(isolating).toMatchObject({ ok: false, unreachable: ['a'] });
    expect(isolating.reason).toContain('Target maze rejected');
  });
  test('when every candidate isolates a room the request is rejected, logged and nothing moves', () => {
    const state = requestGeneratedShift(createGeneratedShift(fixture), fixture);
    expect(state).toMatchObject({ phase: 'idle', plan: null, requests: 1, openness: { g1: 1, g2: 0 }, revision: 0 });
    expect(state.notice).toContain('Shift rejected');
    expect(state.log).toEqual([expect.objectContaining({ outcome: 'rejected', rejectedCandidates: 1, plan: null })]);
  });
});

describe('seeded shift sequences', () => {
  test('busy requests are ignored and logged; the log is bounded', () => {
    const maze = generateMaze(3);
    let state = requestGeneratedShift(createGeneratedShift(maze), maze);
    expect(state.phase).toBe('warning');
    const busy = requestGeneratedShift(state, maze);
    expect(busy).toMatchObject({ phase: 'warning', plan: state.plan, requests: 1 });
    expect(busy.log.at(-1)).toMatchObject({ outcome: 'ignored' });
    for (let i = 0; i < 30; i++) state = requestGeneratedShift(state, maze);
    expect(state.log).toHaveLength(SHIFT_LOG_LIMIT);
  });
  test('the same seed and request sequence reproduce the same plans', () => {
    const plans = (seed: number) => {
      const maze = generateMaze(seed);
      let state = createGeneratedShift(maze);
      const result: string[] = [];
      for (let i = 0; i < 10; i++) {
        state = requestGeneratedShift(state, maze);
        result.push(`${state.plan?.open}>${state.plan?.close}`);
        state = runShift(state, maze, 0.25);
      }
      return result;
    };
    expect(plans(11)).toEqual(plans(11));
    expect(plans(11)).not.toEqual(plans(12));
  });

  // Plan requirement: 100 seeds × 100 attempted shifts. Every accepted plan keeps every cell
  // reachable before, at every animation step, and after; phases run in order; revisions are
  // exactly two per completed swap.
  test('100 seeds × 100 shifts keep every cell connected at every step', () => {
    let accepted = 0;
    for (let s = 0; s < 100; s++) {
      const maze = generateMaze(s * 104729 + 1);
      let state = createGeneratedShift(maze);
      for (let i = 0; i < 100; i++) {
        state = requestGeneratedShift(state, maze);
        const entry = state.log.at(-1)!;
        if (entry.outcome !== 'accepted') { expect(state.phase).toBe('idle'); continue; }
        accepted++;
        const { plan } = state;
        const revision = state.revision;
        const before = mazeTopologySignature(maze, state.openness);
        const phases: string[] = [];
        state = runShift(state, maze, 0.25, (next) => {
          if (phases.at(-1) !== next.phase) phases.push(next.phase);
          expect(reachableMazeCells(maze, next.openness, maze.start).size).toBe(maze.cells.length);
          if (next.openness[plan!.close] < 1) expect(next.openness[plan!.open]).toBe(1);
        });
        expect(phases).toEqual(['warning', 'opening', 'closing', 'cooldown', 'idle']);
        expect(state.openness[plan!.open]).toBe(1);
        expect(state.openness[plan!.close]).toBe(0);
        expect(state.revision).toBe(revision + 2);
        expect(mazeTopologySignature(maze, state.openness)).not.toBe(before);
        expect(Object.values(state.openness).filter((value) => value === 1)).toHaveLength(4);
      }
      expect(state.completedShifts).toBe(100);
    }
    expect(accepted).toBe(100 * 100);
  }, 120_000);
});

// Physical rules reuse the accepted push-before-crush routine.
const still = { forward: 0, strafe: 0 };
function advance(world: GeneratedWorld, run: GeneratedRun, seconds: number, intent = still) {
  for (let i = 0; i < Math.round(seconds * 60); i++) run = stepGeneratedRun(world, run, intent, 0, 1 / 60);
  return run;
}
// `fromA` metres from the corridor end at edge.a, or the corridor centre when omitted.
function standInClosingGate(seed: number, fromA?: number) {
  const world = buildGeneratedWorld(generateMaze(seed));
  let run = requestGeneratedRunShift(world, createGeneratedRun(world));
  const edge = gateEdges(world.maze).find((edge) => edge.gate === run.shift.plan!.close)!;
  const rect = corridorRect(world.maze as MazeLayout, edge);
  // A test may place the body directly; gameplay code never does.
  const centre = { x: (rect.minX + rect.maxX) / 2, z: (rect.minZ + rect.maxZ) / 2 };
  if (fromA !== undefined) {
    const a = cellPosition(findCell(world.maze, edge.a), world.maze);
    const alongZ = rect.maxZ - rect.minZ > rect.maxX - rect.minX;
    if (alongZ) centre.z = (a.z < centre.z ? rect.minZ + fromA : rect.maxZ - fromA);
    else centre.x = (a.x < centre.x ? rect.minX + fromA : rect.maxX - fromA);
  }
  run = { ...run, player: { ...centre, yaw: 0 } };
  return { world, run, edge, rect };
}
describe.each([1, 5, 20261111])('seed %i closing gate', (seed) => {
  test('pushes the body before crushing it against the far wall; the mechanism finishes after death', () => {
    const { world, edge } = standInClosingGate(seed);
    let { run } = standInClosingGate(seed);
    const start = { ...run.player };
    // The slab starts 0.5 m inside its pocket and travels 4.5 m in 4 s: it reaches a centred body after ~2 s of closing.
    run = advance(world, run, 2 + 1.25 + 2.3);
    expect(run.crushedBy).toBeNull();
    expect(run.pushedBy).toBe(edge.gate);
    expect(Math.hypot(run.player.x - start.x, run.player.z - start.z)).toBeGreaterThan(0.1);
    run = advance(world, run, 1.5);
    expect(run.crushedBy).toBe(edge.gate);
    const shifts = run.shift.completedShifts;
    run = advance(world, run, 4);
    expect(run.shift.completedShifts).toBe(shifts + 1);
    expect(run.shift.openness[edge.gate!]).toBe(0);
    const fresh = createGeneratedRun(world);
    expect(fresh).toMatchObject({ crushedBy: null, visited: [], player: { x: 0, z: 0 } });
    expect(fresh.shift.openness).toEqual(world.maze.initialOpenness);
  });
  test('walking out along the passage while pushed escapes alive, never embedded', () => {
    // From the middle of an 8 m passage there is no time to escape once the push starts;
    // 1.5 m from its end there is.
    const { world, run: placed, edge, rect } = standInClosingGate(seed, 1.5);
    let run = advance(world, placed, 2 + 1.25 + 2.2);
    expect(run.pushedBy).toBe(edge.gate);
    const alongZ = rect.maxZ - rect.minZ > rect.maxX - rect.minX;
    const room = cellPosition(findCell(world.maze, edge.a), world.maze);
    const intent = alongZ ? { forward: -Math.sign(room.z - run.player.z), strafe: 0 } : { forward: 0, strafe: Math.sign(room.x - run.player.x) };
    for (let i = 0; i < 4 * 60; i++) {
      run = stepGeneratedRun(world, run, intent, 0, 1 / 60);
      expect(run.crushedBy).toBeNull();
      const solids = [...world.solids, ...layoutGateColliders(world.maze, run.shift.openness)];
      expect(solids.some((wall) => overlapsBody(run.player, wall))).toBe(false);
    }
    expect(overlapsBody(run.player, gateRect(world.maze, edge, 0))).toBe(false);
  });
});
