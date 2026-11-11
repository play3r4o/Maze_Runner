import { expect, test } from 'vitest';
import { createMazeRun } from '../src/game/mazeRun';
import { HAND_BUILT_MAZE, cellId, edgeId } from '../src/simulation/maze';
import { buildMazeDiagnostics, probeSanctuaryIsolation } from '../src/simulation/mazeDiagnostics';
import { validateMazeTopology } from '../src/simulation/mazeGraph';

test('diagnostic location and route follow actual room/corridor position and heading', () => {
  const run = createMazeRun();
  expect(buildMazeDiagnostics(run)).toMatchObject({ location: cellId(2, 2), origin: cellId(2, 2), route: { edges: [] } });
  run.player = { x: 0, z: -8.1, yaw: Math.PI / 2 };
  const view = buildMazeDiagnostics(run);
  const northEdge = edgeId(cellId(2, 2), cellId(2, 1));
  expect(view.location).toBe(northEdge); expect(view.origin).toBe(cellId(2, 1));
  expect(view.route?.edges).toEqual([northEdge]); expect(view.player).toEqual(run.player);
});
test('moving passage shows actual slab bounds, excludes its edge and offers no false escape-route preview', () => {
  const run = createMazeRun(); run.player.z = -8.1;
  run.shift = { ...run.shift, phase: 'closing', openness: { north: 0.5, east: 1 } };
  const view = buildMazeDiagnostics(run);
  expect(view.route).toBeNull(); expect(view.origin).toBeNull(); expect(view.routeNote).toContain('Moving/closed');
  expect(view.gates.find((gate) => gate.id === 'north')).toMatchObject({ status: 'closing', openness: 0.5,
    rect: { minX: 0.25, maxX: 4.25, minZ: -10, maxZ: -2 } });
  run.player.z = -12;
  const safe = buildMazeDiagnostics(run);
  expect(safe.route?.cells).toEqual([cellId(2, 1), cellId(1, 1), cellId(1, 2), cellId(2, 2)]);
  expect(safe.route?.edges).not.toContain(edgeId(cellId(2, 2), cellId(2, 1)));
});
test('warning still represents an open graph link, death and outside positions have no route', () => {
  const run = createMazeRun(); run.shift.phase = 'warning';
  expect(buildMazeDiagnostics(run).gates.find((gate) => gate.id === 'north')?.status).toBe('warning');
  run.crushedBy = 'north'; expect(buildMazeDiagnostics(run).route).toBeNull();
  run.crushedBy = null; run.player = { x: 29, z: 29, yaw: 0 };
  expect(buildMazeDiagnostics(run)).toMatchObject({ origin: null, route: null, location: 'Outside walkable maze' });
});
test('isolation probe is rejected with useful edge/cell IDs and cannot mutate the live graph', () => {
  const run = createMazeRun(); const original = structuredClone(run); const layout = structuredClone(HAND_BUILT_MAZE);
  const result = probeSanctuaryIsolation(HAND_BUILT_MAZE, run.shift.openness);
  expect(result.check).toMatchObject({ ok: false, reachableCount: 1 });
  expect(result.check.unreachable).toHaveLength(24); expect(result.blockedEdges).toHaveLength(4);
  expect(result.blockedEdges).toContain(edgeId(cellId(2, 2), cellId(2, 1)));
  expect(run).toEqual(original); expect(HAND_BUILT_MAZE).toEqual(layout);
  expect(validateMazeTopology(HAND_BUILT_MAZE, run.shift.openness).ok).toBe(true);
});
