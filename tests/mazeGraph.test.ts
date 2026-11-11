import { expect, test } from 'vitest';
import { HAND_BUILT_MAZE } from '../src/simulation/maze';
import type { MazeLayout } from '../src/simulation/maze';
import { findMazeRoute, mazeLayoutErrors, openMazeEdges, reachableMazeCells, validateMazeShiftPlan, validateMazeTopology } from '../src/simulation/mazeGraph';
import { advanceMazeShift, createMazeShift, requestMazeShift } from '../src/simulation/mazeShift';

const loop: MazeLayout = {
  start: 'home', landmarks: [],
  cells: [{ id: 'home', column: 0, row: 0 }, { id: 'north', column: 0, row: -1 },
    { id: 'east', column: 1, row: 0 }, { id: 'corner', column: 1, row: -1 }],
  edges: [{ id: 'home-north', a: 'home', b: 'north', gate: 'north' }, { id: 'home-east', a: 'home', b: 'east', gate: 'east' },
    { id: 'north-corner', a: 'north', b: 'corner' }, { id: 'east-corner', a: 'east', b: 'corner' }],
};
const tree: MazeLayout = { ...loop, cells: loop.cells.slice(0, 3), edges: loop.edges.slice(0, 2) };

test('valid connected loop, disconnected fixture and conservative partially open gates', () => {
  expect(mazeLayoutErrors(loop)).toEqual([]);
  expect(validateMazeTopology(loop, { north: 1, east: 0 })).toMatchObject({ ok: true, reachableCount: 4 });
  expect(validateMazeTopology(loop, { north: 0.99, east: 0 })).toMatchObject({ ok: false, reachableCount: 1,
    unreachable: ['north', 'east', 'corner'] });
  expect([...reachableMazeCells(loop, { north: 0, east: 0 }, 'home')]).toEqual(['home']);
  expect(openMazeEdges(loop, { north: 0.5, east: 1 }).map((edge) => edge.id)).not.toContain('home-north');
});
test('runtime layout validation rejects ambiguous IDs, bad endpoints, coordinates, start and landmarks', () => {
  const malformed: MazeLayout[] = [
    { ...loop, cells: [...loop.cells, loop.cells[0]] },
    { ...loop, cells: [...loop.cells, { id: 'extra', column: 0, row: 0 }] },
    { ...loop, cells: [{ ...loop.cells[0], column: 0.5 }, ...loop.cells.slice(1)] },
    { ...loop, edges: [...loop.edges, { ...loop.edges[0] }] },
    { ...loop, edges: [...loop.edges, { id: 'duplicate-pair', a: 'north', b: 'home' }] },
    { ...loop, edges: [...loop.edges, { id: 'unknown', a: 'home', b: 'phantom' }] },
    { ...loop, edges: [{ id: 'diagonal', a: 'home', b: 'corner' }] },
    { ...loop, start: 'missing' },
    { ...loop, landmarks: [{ id: 'lost', name: 'Lost', color: '#fff', cell: 'missing' }] },
  ];
  for (const fixture of malformed) expect(validateMazeTopology(fixture, { north: 1, east: 1 }).ok).toBe(false);
  expect(validateMazeTopology(loop, { north: NaN, east: 1 }).reason).toContain('north');
  expect(validateMazeTopology(loop, { north: 1, east: 1 }, ['unknown-edge']).ok).toBe(false);
  const phantom = { ...tree, edges: [{ id: 'bad', a: 'home', b: 'phantom' }, { id: 'bad2', a: 'phantom', b: 'north' }] };
  expect(findMazeRoute(phantom, { north: 1, east: 1 }, 'home', 'north')).toBeNull();
});
test('BFS returns a shortest route, reroutes around closed gates, and handles unknown/unreachable targets', () => {
  expect(findMazeRoute(loop, { north: 1, east: 0 }, 'north', 'home')).toEqual({ cells: ['north', 'home'], edges: ['home-north'] });
  expect(findMazeRoute(loop, { north: 0, east: 1 }, 'north', 'home')).toEqual({
    cells: ['north', 'corner', 'east', 'home'], edges: ['north-corner', 'east-corner', 'home-east'],
  });
  expect(findMazeRoute(loop, { north: 0.5, east: 1 }, 'north', 'home')?.edges).not.toContain('home-north');
  expect(findMazeRoute(loop, { north: 0, east: 0 }, 'north', 'home')).toBeNull();
  expect(findMazeRoute(loop, { north: 1, east: 1 }, 'unknown', 'home')).toBeNull();
  expect(findMazeRoute(loop, { north: 1, east: 1 }, 'home', 'unknown')).toBeNull();
  expect(findMazeRoute(loop, { north: 0, east: 0 }, 'home', 'home')).toEqual({ cells: ['home'], edges: [] });
});
test('equal-length routes remain deterministic when source connection order changes', () => {
  const forward = findMazeRoute(loop, { north: 1, east: 1 }, 'north', 'east');
  expect(forward?.edges).toHaveLength(2);
  expect(findMazeRoute({ ...loop, edges: [...loop.edges].reverse() }, { north: 1, east: 1 }, 'north', 'east')).toEqual(forward);
});
test('invalid actual gate plan is rejected without changing topology, phase or revision', () => {
  const state = { ...createMazeShift(), openness: { north: 1, east: 1 } };
  const original = structuredClone(state);
  const rejected = requestMazeShift(state, tree);
  expect(state).toEqual(original);
  expect(rejected).toMatchObject({ phase: 'idle', revision: 0, completedShifts: 0, openness: state.openness,
    validation: { ok: false, unreachable: ['north'] } });
  expect(rejected.notice).toContain('Target maze rejected');
  expect(rejected.notice).toContain('north');
  expect(validateMazeShiftPlan(loop, { north: 1, east: 0 }, { north: 0, east: 1 }).ok).toBe(true);
  expect(validateMazeShiftPlan(loop, { north: 1, east: 0 }, { north: 0.5, east: 1 }).ok).toBe(false);
});
test('unexpected invalid intermediate pose cannot commit a wall move or revision', () => {
  const state = { ...createMazeShift(), phase: 'closing' as const, openness: { north: 1, east: 1 } };
  const rejected = advanceMazeShift(state, 1 / 60, tree);
  expect(rejected.openness).toEqual(state.openness); expect(rejected.revision).toBe(0);
  expect(rejected.validation?.ok).toBe(false); expect(rejected.notice).toContain('north');
});
test('revision changes on fully-open connectivity changes, not each animation tick or warning/cooldown', () => {
  let state = requestMazeShift(createMazeShift());
  expect(state.revision).toBe(0);
  for (let i = 0; i < 120; i++) state = advanceMazeShift(state, 1 / 60);
  expect(state.phase).toBe('opening'); expect(state.revision).toBe(0);
  for (let i = 0; i < 100 && state.phase === 'opening'; i++) state = advanceMazeShift(state, 1 / 60);
  expect(state.phase).toBe('closing'); expect(state.revision).toBe(1);
  expect(state.openness).toEqual({ north: 1, east: 1 });
  state = advanceMazeShift(state, 1 / 60);
  expect(state.revision).toBe(2);
  for (let i = 0; i < 600; i++) {
    state = advanceMazeShift(state, 1 / 60); expect(state.revision).toBe(2);
    expect(validateMazeTopology(HAND_BUILT_MAZE, state.openness).ok).toBe(true);
  }
  expect(state.phase).toBe('idle');
  state = requestMazeShift(state);
  for (let i = 0; i < 660; i++) state = advanceMazeShift(state, 1 / 60);
  expect(state.revision).toBe(4); expect(state.completedShifts).toBe(2);
  expect(createMazeShift().revision).toBe(0);
});
