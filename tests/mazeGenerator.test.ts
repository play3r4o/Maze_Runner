import { describe, expect, test, vi } from 'vitest';
import { CELL_SPACING, cellPosition, corridorRect, edgeId, findCell, gatePocket, gateRect, layoutGateColliders, mazeExtent, plazaRect } from '../src/simulation/maze';
import { mazeLayoutErrors, findMazeRoute, reachableMazeCells } from '../src/simulation/mazeGraph';
import { DEFAULT_GENERATOR_CONFIG, GENERATOR_VERSION, createRng, findBridgeToSanctuary, generateMaze, layoutFingerprint,
  parseSeed, ringFor, serializeMaze } from '../src/simulation/mazeGenerator';
import type { GeneratedMaze } from '../src/simulation/mazeGenerator';
import { buildGeneratedWorld, createGeneratedRun, stepGeneratedRun } from '../src/game/generatedRun';
import type { GeneratedRun, GeneratedWorld } from '../src/game/generatedRun';
import { overlapsBody } from '../src/simulation/movingWalls';
import { stepPlayer } from '../src/simulation/player';

const SEEDS = Array.from({ length: 200 }, (_, i) => i * 7919 + 13);
const size = DEFAULT_GENERATOR_CONFIG.size;
const center = (size - 1) / 2;
const sectorOf = (maze: GeneratedMaze, id: string) => {
  const cell = findCell(maze, id);
  return Math.floor(((Math.atan2(cell.row - center, cell.column - center) + Math.PI) / (2 * Math.PI)) * 4) % 4;
};

describe('seed parsing and RNG', () => {
  test('only whole numbers 0..2^32-1 are accepted', () => {
    expect(parseSeed('0')).toBe(0);
    expect(parseSeed(' 4294967295 ')).toBe(4294967295);
    for (const bad of [null, '', '-1', '1.5', '4294967296', 'abc', '12a', '99999999999']) expect(parseSeed(bad)).toBeNull();
  });
  test('the RNG is deterministic per seed and generation never calls Math.random', () => {
    const a = createRng(42), b = createRng(42), c = createRng(43);
    const draws = (rng: ReturnType<typeof createRng>) => Array.from({ length: 8 }, () => rng.next());
    expect(draws(a)).toEqual(draws(b));
    expect(draws(createRng(42))).not.toEqual(draws(c));
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Math.random used'); });
    try { expect(() => generateMaze(5)).not.toThrow(); } finally { spy.mockRestore(); }
  });
  test('invalid seeds and configs are rejected instead of coerced', () => {
    expect(() => generateMaze(-1)).toThrow();
    expect(() => generateMaze(1.5)).toThrow();
    expect(() => generateMaze(1, { size: 10, loopChance: 0.1, gateCount: 8 })).toThrow();
    expect(() => generateMaze(1, { size: 11, loopChance: 2, gateCount: 8 })); expect(() => generateMaze(1, { size: 11, loopChance: 0.1, gateCount: 3 })).toThrow();
  });
  test('ring bands by square distance from the centre', () => {
    expect([0, 1, 2, 3, 4, 5].map((d) => ringFor(5 + d, 5, 11))).toEqual(['sanctuary', 'sanctuary', 'inner', 'inner', 'middle', 'outer']);
    expect([2, 3, 4, 5, 6].map((d) => ringFor(6, 6 - d, 13))).toEqual(['inner', 'inner', 'middle', 'middle', 'outer']);
  });
});

describe('reproducibility', () => {
  test('the same seed and config rebuild an identical layout; seeds differ', () => {
    const texts = SEEDS.map((seed) => serializeMaze(generateMaze(seed)));
    expect(SEEDS.map((seed) => serializeMaze(generateMaze(seed)))).toEqual(texts);
    expect(new Set(texts).size).toBe(SEEDS.length);
  }, 30_000);
  test(`pinned fingerprints for ${GENERATOR_VERSION}: change GENERATOR_VERSION if these must change`, () => {
    expect(GENERATOR_VERSION).toBe('m5.1');
    expect(layoutFingerprint(generateMaze(1))).toBe('93586853');
    expect(layoutFingerprint(generateMaze(20261111))).toBe('6c77ffa0');
  });
});

describe.each(SEEDS)('seed %i layout rules', (seed) => {
  const maze = generateMaze(seed);
  test('valid graph, every cell reachable, correct rings and plaza', () => {
    expect(mazeLayoutErrors(maze)).toEqual([]);
    expect(maze.cells).toHaveLength(size * size);
    expect(reachableMazeCells(maze, maze.initialOpenness, maze.start).size).toBe(size * size);
    const counts = { sanctuary: 0, inner: 0, middle: 0, outer: 0 };
    for (const cell of maze.cells) counts[maze.rings[cell.id]]++;
    expect(counts).toEqual({ sanctuary: 9, inner: 40, middle: 32, outer: 40 });
    const sanctuary = (id: string) => maze.rings[id] === 'sanctuary';
    expect(maze.edges.filter((edge) => sanctuary(edge.a) && sanctuary(edge.b))).toHaveLength(12);
    expect(maze.edges.length).toBeGreaterThan(maze.cells.length - 1 - 8); // more than a tree: loops exist
  });
  test('exactly one Sanctuary entrance per side', () => {
    const exits = maze.edges.filter((edge) => (maze.rings[edge.a] === 'sanctuary') !== (maze.rings[edge.b] === 'sanctuary'));
    expect(exits.map((edge) => edge.id).sort()).toEqual([...maze.entrances].sort());
    const sides = maze.entrances.map((id) => {
      const edge = exits.find((exit) => exit.id === id)!;
      const outside = findCell(maze, maze.rings[edge.a] === 'sanctuary' ? edge.b : edge.a);
      return outside.row < center - 1 ? 'N' : outside.column > center + 1 ? 'E' : outside.row > center + 1 ? 'S' : 'W';
    });
    expect(sides).toEqual(['N', 'E', 'S', 'W']);
  });
  test('eight gates: half open, outside Sanctuary, unique pockets that stay inside solid stone', () => {
    const gates = maze.edges.filter((edge) => edge.gate);
    expect(gates.map((edge) => edge.gate).sort()).toEqual([...maze.gates].sort());
    expect(maze.gates).toEqual(['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8']);
    expect(maze.gates.map((gate) => maze.initialOpenness[gate])).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
    const blocks = new Set<string>();
    const { width } = mazeExtent(maze);
    const plaza = plazaRect(maze)!;
    const overlaps = (a: { minX: number; maxX: number; minZ: number; maxZ: number }, b: typeof a) =>
      a.minX < b.maxX - 1e-9 && a.maxX > b.minX + 1e-9 && a.minZ < b.maxZ - 1e-9 && a.maxZ > b.minZ + 1e-9;
    for (const edge of gates) {
      expect(maze.rings[edge.a]).not.toBe('sanctuary'); expect(maze.rings[edge.b]).not.toBe('sanctuary');
      const { block } = gatePocket(maze, edge);
      blocks.add(`${block.column},${block.row}`);
      const open = gateRect(maze, edge, 1);
      expect(Math.max(Math.abs(open.minX), Math.abs(open.maxX), Math.abs(open.minZ), Math.abs(open.maxZ))).toBeLessThanOrEqual(width / 2);
      expect(overlaps(open, plaza), edge.id).toBe(false);
      for (const cell of maze.cells) {
        const { x, z } = cellPosition(cell, maze);
        expect(overlaps(open, { minX: x - 2, maxX: x + 2, minZ: z - 2, maxZ: z + 2 }), `${edge.id} pocket in room`).toBe(false);
      }
      for (const other of maze.edges) expect(overlaps(open, corridorRect(maze, other)), `${edge.id} pocket in ${other.id}`).toBe(false);
    }
    expect(blocks.size).toBe(8);
    // Static corridors alone (every gate closed) still reach every cell.
    expect(reachableMazeCells(maze, {}, maze.start).size).toBe(size * size);
  });
  test('one landmark per ring, spread across quadrants, each with an alternative route home', () => {
    expect(maze.landmarks.map((landmark) => maze.rings[landmark.cell])).toEqual(['inner', 'middle', 'outer']);
    expect(new Set(maze.landmarks.map((landmark) => sectorOf(maze, landmark.cell))).size).toBe(3);
    // Holds with every gate closed, so it holds in every gate arrangement (opening only adds links).
    for (const landmark of maze.landmarks) expect(findBridgeToSanctuary(maze, landmark.cell, {}), landmark.id).toBeNull();
  });
});

// Physical checks: geometry agrees with the graph, and real walking reaches every landmark and home.
function walkRoute(world: GeneratedWorld, run: GeneratedRun, cells: string[]): GeneratedRun {
  for (const id of cells.slice(1)) {
    const target = cellPosition(findCell(world.maze, id), world.maze);
    const intent = { strafe: Math.sign(Math.round(target.x - run.player.x)), forward: -Math.sign(Math.round(target.z - run.player.z)) };
    for (let i = 0; i < CELL_SPACING * 20; i++) run = stepGeneratedRun(world, run, intent, 0, 1 / 60);
    expect(Math.hypot(run.player.x - target.x, run.player.z - target.z), `reach ${id}`).toBeLessThan(1e-6);
  }
  return run;
}
describe.each([1, 20261111, 4294967295])('seed %i physical walkability', (seed) => {
  const world = buildGeneratedWorld(generateMaze(seed));
  const { maze } = world;
  test('spawn and every room centre are clear; open edges are 8 m corridors', () => {
    expect(world.solids.some((rect) => overlapsBody({ x: 0, z: 0, yaw: 0 }, rect))).toBe(false);
    for (const cell of maze.cells) expect(world.walls.some((rect) => overlapsBody({ ...cellPosition(cell, maze), yaw: 0 }, rect)), cell.id).toBe(false);
    for (const edge of maze.edges) {
      const rect = corridorRect(maze, edge);
      expect([rect.maxX - rect.minX, rect.maxZ - rect.minZ].sort((a, b) => a - b)).toEqual([4, 8]);
    }
  });
  test('centreline traversal is possible exactly where the graph has a connection', () => {
    for (const a of maze.cells) for (const b of maze.cells) {
      if (b.column - a.column + b.row - a.row !== 1 || (b.column !== a.column && b.row !== a.row)) continue;
      const start = cellPosition(a, maze), end = cellPosition(b, maze);
      const edge = maze.edges.find((edge) => edge.id === edgeId(a.id, b.id));
      const open = Boolean(edge && (!edge.gate || maze.initialOpenness[edge.gate] === 1));
      const solids = [...world.walls, ...layoutGateColliders(maze, maze.initialOpenness)];
      let player = { ...start, yaw: 0 };
      const intent = { strafe: Math.sign(end.x - start.x), forward: -Math.sign(end.z - start.z) };
      for (let i = 0; i < CELL_SPACING * 20; i++) player = stepPlayer(player, intent, solids, 1 / 60);
      expect(Math.hypot(player.x - end.x, player.z - end.z), `${a.id} -> ${b.id}`).toBeCloseTo(open ? 0 : 10.3, 6);
    }
  });
  test('walking the graph route visits every landmark, then reports the return home', () => {
    let run = createGeneratedRun(world);
    let from = maze.start;
    for (const landmark of maze.landmarks) {
      run = walkRoute(world, run, findMazeRoute(maze, maze.initialOpenness, from, landmark.cell)!.cells);
      expect(run.visited).toContain(landmark.id);
      expect(run.ring).toBe(maze.rings[landmark.cell]);
      from = landmark.cell;
    }
    expect(run.returned).toBe(false);
    run = walkRoute(world, run, findMazeRoute(maze, maze.initialOpenness, from, maze.start)!.cells);
    expect(run).toMatchObject({ returned: true, ring: 'sanctuary', leftSanctuary: true });
  });
});
