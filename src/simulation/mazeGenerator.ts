import { cellId, edgeId, gatePocket } from './maze';
import type { CellBlock, Landmark, MazeCell, MazeEdge, MazeLayout, MazeOpenness } from './maze';
import { findMazeRoute, reachableMazeCells } from './mazeGraph';

// Bump whenever the same seed could produce a different layout.
export const GENERATOR_VERSION = 'm5.1';

// gateCount must be even: half the gates start open, half closed.
export type GeneratorConfig = { size: number; loopChance: number; gateCount: number };
// 11×11 cells at 12 m spacing; see docs/milestones/M4.md for the walking-time measurement.
export const DEFAULT_GENERATOR_CONFIG: Readonly<GeneratorConfig> = { size: 11, loopChance: 0.1, gateCount: 8 };

export type Ring = 'sanctuary' | 'inner' | 'middle' | 'outer';
export const RINGS: readonly Exclude<Ring, 'sanctuary'>[] = ['inner', 'middle', 'outer'];
export type GeneratedMaze = MazeLayout & {
  seed: number; version: string; config: GeneratorConfig;
  columns: number; rows: number; plaza: CellBlock;
  rings: Readonly<Record<string, Ring>>;
  // Sanctuary-to-outside connections, in canonical order: north, east, south, west.
  entrances: readonly string[];
  // Gate IDs g1..gN in selection order, and each gate's starting openness (1 open, 0 closed).
  gates: readonly string[];
  initialOpenness: Readonly<Record<string, number>>;
  // M18 octagon only. homeGate: the lobby gate (not part of shifts; opens when the match starts).
  // hub: the room just inside it. core: the centre of the core chamber (night extract).
  // sanctuaries: all eight team bases (one is home, the other seven are sealed in solo).
  // ringNames: what the HUD calls each danger tier. counts: spawn tables for this layout.
  homeGate?: string; hub?: string; core?: { x: number; z: number };
  sanctuaries?: readonly Sanctuary[]; ringNames?: Readonly<Record<Ring, string>>; counts?: SpawnCounts;
};
export type Sanctuary = { id: string; name: string; column: number; row: number; inner: { column: number; row: number }; home: boolean };
type TierCounts = Readonly<Record<Exclude<Ring, 'sanctuary'>, number>>;
export type SpawnCounts = {
  traps: TierCounts; chests: TierCounts;
  monsters: Readonly<Record<Exclude<Ring, 'sanctuary'>, Readonly<{ husk: number; skitter: number; spitter: number; brute: number }>>>;
};
export const isOctagon = (maze: GeneratedMaze) => maze.homeGate !== undefined;

const LANDMARKS = [
  { id: 'amber', name: 'Amber Spire', color: '#e9b857' },
  { id: 'blue', name: 'Blue Beacon', color: '#66bde0' },
  { id: 'rose', name: 'Rose Pillar', color: '#d984aa' },
] as const;

// Used before any gates exist: every listed connection is an open corridor.
const ALL_OPEN: MazeOpenness = { north: 1, east: 1 };
// Gate IDs are absent here, so every gate edge counts as closed.
const GATES_CLOSED: MazeOpenness = {};

export const MAX_SEED = 0xffffffff;
// Seeds are whole numbers 0..4294967295. Anything else is rejected, never coerced.
export function parseSeed(text: string | null | undefined): number | null {
  if (!text || !/^\d{1,10}$/.test(text.trim())) return null;
  const value = Number(text.trim());
  return value <= MAX_SEED ? value : null;
}

// mulberry32: tiny deterministic 32-bit PRNG. Never use Math.random in generation.
export function createRng(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (count: number) => Math.floor(next() * count),
    pick<T>(items: readonly T[]): T { return items[Math.floor(next() * items.length)]; },
    shuffle<T>(items: readonly T[]): T[] {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
  };
}

export function ringFor(column: number, row: number, size: number): Ring {
  const center = (size - 1) / 2;
  const distance = Math.max(Math.abs(column - center), Math.abs(row - center));
  if (distance <= 1) return 'sanctuary';
  const bands = center - 1; // distances 2..center
  return RINGS[Math.min(2, Math.floor(((distance - 2) * 3) / bands))];
}

// Quadrant index 0..3 around the grid center, used to spread landmarks apart.
function sector(cell: MazeCell, size: number) {
  const center = (size - 1) / 2;
  const angle = Math.atan2(cell.row - center, cell.column - center);
  return Math.floor(((angle + Math.PI) / (2 * Math.PI)) * 4) % 4;
}

function configErrors(config: GeneratorConfig): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(config.size) || config.size < 9 || config.size % 2 === 0) errors.push('Size must be an odd integer ≥ 9.');
  if (!(config.loopChance >= 0 && config.loopChance <= 1)) errors.push('Loop chance must be between 0 and 1.');
  if (!Number.isInteger(config.gateCount) || config.gateCount < 0 || config.gateCount % 2 !== 0 || config.gateCount > 16) {
    errors.push('Gate count must be an even integer from 0 to 16.');
  }
  return errors;
}

/**
 * Deterministic layout from (seed, config, GENERATOR_VERSION). Order of work:
 * grid → rings → open 3×3 Sanctuary plaza → one entrance per side → seeded spanning tree
 * (Kruskal over shuffled edges) → extra loop edges → landmarks → repair so every landmark
 * keeps an alternative route home (no single connection can cut it off).
 */
export function generateMaze(seed: number, config: GeneratorConfig = DEFAULT_GENERATOR_CONFIG): GeneratedMaze {
  const errors = configErrors(config);
  if (errors.length) throw new Error(errors.join(' '));
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) throw new Error('Seed must be an integer 0..4294967295.');
  const rng = createRng(seed);
  const { size } = config;
  const center = (size - 1) / 2;
  const cells: MazeCell[] = [];
  const rings: Record<string, Ring> = {};
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const id = cellId(column, row);
    cells.push({ id, column, row });
    rings[id] = ringFor(column, row, size);
  }
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const inSanctuary = (id: string) => rings[id] === 'sanctuary';
  const pairEdge = (a: MazeCell, b: MazeCell): MazeEdge => ({ id: edgeId(a.id, b.id), a: a.id, b: b.id });
  // Canonical candidate order: every horizontal then every vertical neighbour pair, row-major.
  const candidates: MazeEdge[] = [];
  for (let row = 0; row < size; row++) for (let column = 0; column < size - 1; column++) {
    candidates.push(pairEdge(byId.get(cellId(column, row))!, byId.get(cellId(column + 1, row))!));
  }
  for (let row = 0; row < size - 1; row++) for (let column = 0; column < size; column++) {
    candidates.push(pairEdge(byId.get(cellId(column, row))!, byId.get(cellId(column, row + 1))!));
  }

  const parent = new Map(cells.map((cell) => [cell.id, cell.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };
  const open = new Map<string, MazeEdge>();
  const add = (edge: MazeEdge) => { open.set(edge.id, edge); union(edge.a, edge.b); };

  // The Sanctuary is one open plaza: all 12 internal connections exist.
  for (const edge of candidates) if (inSanctuary(edge.a) && inSanctuary(edge.b)) add(edge);
  // Exactly one entrance on each side, at a seeded position along that side.
  const entrances: string[] = [];
  const offsets = [-1, 0, 1];
  const sides = [
    (o: number) => [center + o, center - 1, center + o, center - 2], // north (row decreases)
    (o: number) => [center + 1, center + o, center + 2, center + o], // east
    (o: number) => [center + o, center + 1, center + o, center + 2], // south
    (o: number) => [center - 1, center + o, center - 2, center + o], // west
  ];
  for (const side of sides) {
    const [c1, r1, c2, r2] = side(rng.pick(offsets));
    const edge = pairEdge(byId.get(cellId(c1, r1))!, byId.get(cellId(c2, r2))!);
    add(edge); entrances.push(edge.id);
  }
  // Spanning tree over the remaining cells. Sanctuary walls stay solid except the entrances.
  const outside = candidates.filter((edge) => !inSanctuary(edge.a) && !inSanctuary(edge.b));
  const leftovers: MazeEdge[] = [];
  for (const edge of rng.shuffle(outside)) {
    if (find(edge.a) !== find(edge.b)) add(edge); else leftovers.push(edge);
  }
  // A few extra connections create loops, so routes are not a single tree.
  for (const edge of leftovers) if (rng.next() < config.loopChance) add(edge);

  // One landmark per ring, each in a different quadrant around Sanctuary.
  const usedSectors: number[] = [];
  const landmarks: Landmark[] = RINGS.map((ring, index) => {
    const options = cells.filter((cell) => rings[cell.id] === ring && !usedSectors.includes(sector(cell, size)));
    const cell = rng.pick(options);
    usedSectors.push(sector(cell, size));
    return { ...LANDMARKS[index], cell: cell.id };
  });

  const start = cellId(center, center);
  const layoutNow = (): MazeLayout => ({ cells, edges: [...open.values()], landmarks, start });
  // Repair: while some connection on a landmark's route is a bridge, add one grid edge
  // that reconnects the cut-off side. Each addition removes that bridge, so this terminates.
  for (const landmark of landmarks) {
    for (let guard = 0; guard < cells.length; guard++) {
      const bridge = findBridgeToSanctuary(layoutNow(), landmark.cell);
      if (!bridge) break;
      const without = reachableMazeCells(layoutNow(), ALL_OPEN, landmark.cell, [bridge]);
      const repairs = candidates.filter((edge) => !open.has(edge.id) && !inSanctuary(edge.a) && !inSanctuary(edge.b)
        && without.has(edge.a) !== without.has(edge.b));
      if (!repairs.length) throw new Error(`Seed ${seed}: no repair edge for ${landmark.id}.`);
      add(rng.pick(repairs));
    }
  }

  // Gates (M5). A separate RNG stream keeps everything above independent of gate choices.
  // Each open-gate candidate must be removable while every gate chosen so far is closed,
  // so the static corridors alone connect every cell and keep every landmark's second route:
  // no gate arrangement can isolate a region or leave a landmark one connection from cut off.
  // Alternate picks: an existing loop corridor that can close without cutting anything off
  // (starts open), then a new corridor between unconnected neighbours (starts closed).
  // Never in or at the Sanctuary, and never two gates sharing one pillar-block pocket.
  const gateRng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const grid: MazeLayout = { cells, edges: [], landmarks: [], start, columns: size, rows: size };
  const usedBlocks = new Set<string>();
  const blockOf = (edge: MazeEdge) => {
    const { block } = gatePocket(grid, edge);
    return `${block.column},${block.row}`;
  };
  const outsidePlaza = (edge: MazeEdge) => !inSanctuary(edge.a) && !inSanctuary(edge.b);
  const sortById = (items: MazeEdge[]) => items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const openPool = gateRng.shuffle(sortById([...open.values()].filter(outsidePlaza)));
  const closedPool = gateRng.shuffle(sortById(candidates.filter((edge) => outsidePlaza(edge) && !open.has(edge.id))));
  const gates: string[] = [];
  const initialOpenness: Record<string, number> = {};
  for (let i = 0; i < config.gateCount; i++) {
    const startsOpen = i % 2 === 0;
    const pool = startsOpen ? openPool : closedPool;
    const findCandidate = () => pool.findIndex((edge) => {
      if (usedBlocks.has(blockOf(edge))) return false;
      if (!startsOpen) return true;
      // Test as if this edge were already a closed gate.
      const trial = { ...layoutNow(), edges: layoutNow().edges.filter((other) => other.id !== edge.id) };
      return reachableMazeCells(trial, GATES_CLOSED, start).size === cells.length
        && landmarks.every((landmark) => findBridgeToSanctuary(trial, landmark.cell, GATES_CLOSED) === null);
    });
    let index = findCandidate();
    // Too few redundant corridors for a safe open gate: add one permanent corridor
    // (seeded choice) and look again. Bounded by the number of unused neighbour pairs.
    while (index < 0 && startsOpen && closedPool.length) {
      const [extra] = closedPool.splice(gateRng.int(closedPool.length), 1);
      add(extra); openPool.push(extra);
      index = findCandidate();
    }
    if (index < 0) throw new Error(`Seed ${seed}: not enough gate candidates.`);
    const [edge] = pool.splice(index, 1);
    const gate = `g${i + 1}`;
    usedBlocks.add(blockOf(edge));
    open.set(edge.id, { ...edge, gate });
    gates.push(gate); initialOpenness[gate] = startsOpen ? 1 : 0;
  }

  const edges = [...open.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    seed, version: GENERATOR_VERSION, config: { ...config }, columns: size, rows: size,
    plaza: { minColumn: center - 1, maxColumn: center + 1, minRow: center - 1, maxRow: center + 1 },
    cells, edges, landmarks, start, rings, entrances, gates, initialOpenness,
  };
}

// Returns an open edge whose removal disconnects `from` from Sanctuary, or null if none.
// Any such edge lies on every route home, so checking the shortest route's edges is enough.
// Gate edges count as open only if `openness` lists them as 1.
export function findBridgeToSanctuary(layout: MazeLayout, from: string, openness: MazeOpenness = ALL_OPEN): string | null {
  const route = findMazeRoute(layout, openness, from, layout.start);
  if (!route) return null;
  for (const edge of route.edges) {
    if (!reachableMazeCells(layout, openness, from, [edge]).has(layout.start)) return edge;
  }
  return null;
}

// Stable text form for reproducibility checks and bug reports.
export function serializeMaze(maze: GeneratedMaze): string {
  return [`${maze.version}:${maze.seed}:${maze.config.size}:${maze.config.loopChance}:${maze.config.gateCount}`,
    maze.edges.map((edge) => edge.gate ? `${edge.id}#${edge.gate}=${maze.initialOpenness[edge.gate]}` : edge.id).join(','),
    maze.landmarks.map((landmark) => `${landmark.id}@${landmark.cell}`).join(','),
    maze.entrances.join(',')].join('|');
}

// Short FNV-1a hash of the serialized layout, shown in the debug panel.
export function layoutFingerprint(maze: GeneratedMaze): string {
  let hash = 0x811c9dc5;
  for (const char of serializeMaze(maze)) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}
