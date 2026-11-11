import { describe, expect, test } from 'vitest';
import { CELL_SPACING, HAND_BUILT_MAZE as maze, MAZE_GATE_IDS, MAZE_SOLIDS, MAZE_SPAWN, cellId,
  cellPosition, corridorRect, edgeId, mazeConnected, mazeGateColliders, mazeGateRect } from '../src/simulation/maze';
import { overlapsBody } from '../src/simulation/movingWalls';
import { stepPlayer } from '../src/simulation/player';

describe('hand-built maze contract', () => {
  test('25 distinct grid cells, unique adjacent edges, two stable gates and three distinct landmarks', () => {
    expect(maze.cells).toHaveLength(25);
    expect(new Set(maze.cells.map((cell) => cell.id)).size).toBe(25);
    expect(new Set(maze.edges.map((edge) => edge.id)).size).toBe(maze.edges.length);
    for (const edge of maze.edges) {
      const a = maze.cells.find((cell) => cell.id === edge.a)!;
      const b = maze.cells.find((cell) => cell.id === edge.b)!;
      expect(a).toBeDefined(); expect(b).toBeDefined();
      expect(Math.abs(a.column - b.column) + Math.abs(a.row - b.row)).toBe(1);
      expect(edge.id).toBe(edgeId(a.id, b.id));
    }
    expect(maze.edges.flatMap((edge) => edge.gate ? [edge.gate] : []).sort()).toEqual([...MAZE_GATE_IDS].sort());
    expect(new Set(maze.landmarks.map((landmark) => landmark.id)).size).toBe(3);
    expect(new Set(maze.landmarks.map((landmark) => landmark.cell)).size).toBe(3);
    for (const landmark of maze.landmarks) {
      expect(maze.cells.some((cell) => cell.id === landmark.cell)).toBe(true);
      expect(landmark.cell).not.toBe(maze.start);
    }
    expect(maze.start).toBe(cellId(2, 2));
  });
  test.each([{ north: 1, east: 0 }, { north: 0, east: 1 }, { north: 0, east: 0 }, { north: 0.5, east: 0.5 }])(
    'all cells retain a static route to Sanctuary at %j', (openness) => {
      expect(mazeConnected(maze, openness)).toBe(true);
      expect(mazeConnected({ ...maze, edges: maze.edges.filter((edge) => edge.a !== maze.start && edge.b !== maze.start) }, openness)).toBe(false);
    });
  test('spawn is clear in both arrangements and gate pockets cannot enter another corridor', () => {
    for (const openness of [{ north: 1, east: 0 }, { north: 0, east: 1 }]) {
      expect([...MAZE_SOLIDS, ...mazeGateColliders(openness)].some((rect) => overlapsBody(MAZE_SPAWN, rect))).toBe(false);
    }
    for (const id of MAZE_GATE_IDS) {
      const open = mazeGateRect(id, 1);
      const closed = mazeGateRect(id, 0);
      expect([closed.maxX - closed.minX, closed.maxZ - closed.minZ].sort((a, b) => a - b)).toEqual([4, 8]);
      expect(MAZE_SOLIDS.some((rect) => rect.minX <= open.minX && rect.maxX >= open.maxX
        && rect.minZ <= open.minZ && rect.maxZ >= open.maxZ)).toBe(true);
    }
  });
  test.each<Record<string, number>>([{ north: 1, east: 0 }, { north: 0, east: 1 }])(
    'physical centerline traversal agrees with every adjacent graph pair in %j', (openness) => {
      const solids = [...MAZE_SOLIDS, ...mazeGateColliders(openness)];
      for (const a of maze.cells) for (const b of maze.cells) {
        if (Math.abs(a.column - b.column) + Math.abs(a.row - b.row) !== 1) continue;
        const start = cellPosition(a), end = cellPosition(b);
        const edge = maze.edges.find((edge) => edge.id === edgeId(a.id, b.id));
        const open = Boolean(edge && (!edge.gate || openness[edge.gate] === 1));
        let player = { ...start, yaw: 0 };
        const intent = { strafe: Math.sign(end.x - start.x), forward: -Math.sign(end.z - start.z) };
        for (let i = 0; i < CELL_SPACING * 20; i++) player = stepPlayer(player, intent, solids, 1 / 60);
        const distance = Math.hypot(player.x - end.x, player.z - end.z);
        expect(distance, `${a.id} -> ${b.id}`).toBeCloseTo(open ? 0 : 10.3, 6);
        expect(solids.some((wall) => overlapsBody(player, wall)), `${a.id} -> ${b.id} embedded`).toBe(false);
        if (edge) {
          const passage = corridorRect(maze, edge);
          expect([passage.maxX - passage.minX, passage.maxZ - passage.minZ].sort((a, b) => a - b)).toEqual([4, 8]);
        }
      }
    });
});
