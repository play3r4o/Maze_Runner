import { expect, test } from 'vitest';
import { createMazeRun, requestMazeRunShift, stepMazeRun } from '../src/game/mazeRun';
import type { MazeRun } from '../src/game/mazeRun';
import { HAND_BUILT_MAZE, MAZE_SOLIDS, mazeConnected, mazeGateColliders } from '../src/simulation/maze';
import { overlapsBody } from '../src/simulation/movingWalls';

const still = { forward: 0, strafe: 0 };
function advance(run: MazeRun, seconds: number, intent = still) {
  for (let i = 0; i < Math.round(seconds * 60); i++) run = stepMazeRun(run, intent, 0, 1 / 60);
  return run;
}
function walk(run: MazeRun, x: number, z: number) {
  const dx = x - run.player.x, dz = z - run.player.z;
  expect(Math.abs(dx) < 1e-6 || Math.abs(dz) < 1e-6).toBe(true);
  run = advance(run, Math.hypot(dx, dz) / 3, {
    forward: Math.abs(dz) < 1e-6 ? 0 : -Math.sign(dz), strafe: Math.abs(dx) < 1e-6 ? 0 : Math.sign(dx),
  });
  expect(run.player.x).toBeCloseTo(x, 6); expect(run.player.z).toBeCloseTo(z, 6);
  expect(run.crushedBy).toBeNull();
  return run;
}
test('phase order, all intermediate connectivity, busy trigger and alternate arrangement', () => {
  let run = requestMazeRunShift(createMazeRun());
  expect(run.shift.phase).toBe('warning');
  expect(requestMazeRunShift(run).shift.notice).toContain('ignored');
  run = advance(run, 1.9);
  expect(run.shift.openness).toEqual({ north: 1, east: 0 });
  const phases = new Set<string>();
  for (let i = 0; i < 600; i++) {
    run = stepMazeRun(run, still, 0, 1 / 60); phases.add(run.shift.phase);
    expect(mazeConnected(HAND_BUILT_MAZE, run.shift.openness)).toBe(true);
    if (run.shift.openness.north < 1) expect(run.shift.openness.east).toBe(1);
  }
  expect([...phases]).toEqual(['warning', 'opening', 'closing', 'cooldown', 'idle']);
  expect(run.shift.completedShifts).toBe(1);
  expect(run.shift.openness).toEqual({ north: 0, east: 1 });
  run = advance(requestMazeRunShift(run), 11);
  expect(run.shift.completedShifts).toBe(2);
  expect(run.shift.openness).toEqual({ north: 1, east: 0 });
});
test('actual traversal visits landmarks, uses changed return route and completes only back home', () => {
  let run = advance(createMazeRun(), 1);
  expect(run.returned).toBe(false); expect(run.visited).toEqual([]);
  run = walk(run, 0, -12); run = walk(run, 0, -24);
  expect(run.visited).toEqual(['amber']);
  run = advance(requestMazeRunShift(run), 11);
  run = walk(run, 0, -12);
  const blocked = advance(run, 4, { forward: -1, strafe: 0 });
  expect(blocked.player.z).toBeCloseTo(-10.3, 6);
  run = walk(run, -12, -12); run = walk(run, -12, 0); run = walk(run, 0, 0);
  expect(run.returned).toBe(false);
  run = walk(run, 24, 0);
  expect(run.visited).toEqual(['amber', 'blue']);
  run = walk(run, 0, 0); run = walk(run, -24, 0); run = walk(run, -24, 24);
  expect(run.visited).toEqual(['amber', 'blue', 'rose']); expect(run.returned).toBe(false);
  run = walk(run, 0, 24); run = walk(run, 0, 0);
  expect(run.returned).toBe(true); expect(new Set(run.visited).size).toBe(3);
});
test.each(['north', 'east'] as const)('%s uses accepted push-before-crush, terminal death and clean Retry', (gate) => {
  let run = createMazeRun();
  if (gate === 'east') run = advance(requestMazeRunShift(run), 11);
  run = gate === 'north' ? walk(run, 0, -4.5) : walk(run, 4.5, 0);
  run = advance(requestMazeRunShift(run), 5.6);
  expect(run.pushedBy).toBe(gate); expect(run.crushedBy).toBeNull();
  expect(gate === 'north' ? run.player.x : run.player.z).toBeLessThan(-0.25);
  expect([...MAZE_SOLIDS, ...mazeGateColliders(run.shift.openness)].some((wall) => overlapsBody(run.player, wall))).toBe(false);
  run = advance(run, 1.5);
  expect(run.crushedBy).toBe(gate);
  expect(gate === 'north' ? run.player.x : run.player.z).toBeCloseTo(-1.7, 6);
  const pinned = run.player;
  expect(requestMazeRunShift(run)).toBe(run);
  run = advance(run, 5, { forward: 1, strafe: 1 });
  expect(run.player).toEqual(pinned); expect(run.shift.openness[gate]).toBe(0);
  expect(createMazeRun()).toMatchObject({ player: { x: 0, z: 0 }, visited: [], returned: false, leftSanctuary: false,
    crushedBy: null, pushedBy: null, shift: { phase: 'idle', completedShifts: 0, openness: { north: 1, east: 0 } } });
});
test('escape along the passage while pushed and warning-zone occupancy alone are not lethal', () => {
  let run = walk(createMazeRun(), 0, -4.5);
  run = advance(requestMazeRunShift(run), 2);
  expect(run.pushedBy).toBeNull(); expect(run.crushedBy).toBeNull();
  run = advance(run, 3.6); expect(run.pushedBy).toBe('north');
  run = advance(run, 1.1, { forward: -1, strafe: 0 });
  expect(run.player.z).toBeGreaterThan(-1.7);
  run = advance(run, 5); expect(run.crushedBy).toBeNull();
});
