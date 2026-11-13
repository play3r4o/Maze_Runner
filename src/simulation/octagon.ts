// M18 "The Octagon": an eight-sided maze of rooms joined by doorways, with eight team
// sanctuaries on its edge. Outer ring (entry) → middle ring → core chamber. Solo uses one
// sanctuary (south); the other seven are sealed. Deterministic from (seed, OCTAGON_VERSION).
import { cellId, edgeId, gatePocket } from './maze';
import type { CellBlock, Landmark, MazeCell, MazeEdge, MazeLayout, MazeOpenness } from './maze';
import { LOBBY_GATE, reachableMazeCells } from './mazeGraph';
import { MAX_SEED, createRng, findBridgeToSanctuary } from './mazeGenerator';
import type { GeneratedMaze, GeneratorConfig, Ring, Sanctuary, SpawnCounts } from './mazeGenerator';

export const OCTAGON_VERSION = 'o2';
// 13×13 grid: the octagon fills distance ≤ 5 from the centre with the corners cut; the
// sanctuaries sit one cell outside it. gateCount shift gates, as in the square maze.
export const OCTAGON_CONFIG: Readonly<GeneratorConfig> = { size: 13, loopChance: 0.12, gateCount: 8 };
// M18 rework: the square maze's corridors (4 m junctions, 8 m × 4 m corridors) with walls
// four times as tall, so the maze towers over you as in the films.
export const OCTAGON_WALL_HEIGHT = 12;
export const HOME_GATE = LOBBY_GATE;
// Ring doors per boundary (one per octagon side); boundary 1 is outer↔middle, 2 middle↔core.
export const RING_SLOTS = 8;
export const ringGate = (boundary: 1 | 2, slot: number) => `ring${boundary}-${slot}`;
export const parseRingGate = (gate: string) => { const m = /^ring([12])-(\d)$/.exec(gate); return m ? { boundary: Number(m[1]) as 1 | 2, slot: Number(m[2]) } : null; };

// Danger tiers reuse the square maze's ring keys: 'inner' is the safest (the octagon's outer,
// entry ring) and 'outer' the deadliest (the core). The HUD shows these names instead.
export const OCTAGON_RING_NAMES: Readonly<Record<Ring, string>> = { sanctuary: 'Sanctuary', inner: 'Outer ring', middle: 'Middle ring', outer: 'Core' };
export const OCTAGON_COUNTS: SpawnCounts = {
  traps: { inner: 4, middle: 6, outer: 2 },
  chests: { inner: 4, middle: 6, outer: 4 },
  monsters: {
    inner: { husk: 2, skitter: 1, spitter: 0, brute: 0 },
    middle: { husk: 2, skitter: 2, spitter: 1, brute: 1 },
    outer: { husk: 1, skitter: 2, spitter: 1, brute: 0 },
  },
};

const LANDMARKS = [
  { id: 'amber', name: 'Amber Spire', color: '#e9b857' },
  { id: 'blue', name: 'Blue Beacon', color: '#66bde0' },
  { id: 'rose', name: 'Rose Pillar', color: '#d984aa' },
] as const;
// The eight bases by compass side, as offsets from the centre (dx, dy; +dy is south) of the
// sanctuary and of the room inside its gate. Under a quarter turn each maps onto another.
const SANCTUARY_SLOTS = [
  ['north', 0, -6, 0, -5], ['northeast', 4, -5, 4, -4], ['east', 6, 0, 5, 0], ['southeast', 5, 4, 4, 4],
  ['south', 0, 6, 0, 5], ['southwest', -4, 5, -4, 4], ['west', -6, 0, -5, 0], ['northwest', -5, -4, -4, -4],
] as const;
const HOME_SLOT = 'south';

export const inOctagon = (dx: number, dy: number) => Math.max(Math.abs(dx), Math.abs(dy)) <= 5 && Math.abs(dx) + Math.abs(dy) <= 8;
export function octagonTier(dx: number, dy: number): Exclude<Ring, 'sanctuary'> {
  const d = Math.max(Math.abs(dx), Math.abs(dy));
  return d <= 1 ? 'outer' : d <= 3 ? 'middle' : 'inner';
}

export function generateOctagon(seed: number): GeneratedMaze {
  if (!Number.isInteger(seed) || seed < 0 || seed > MAX_SEED) throw new Error('Seed must be an integer 0..4294967295.');
  const config = OCTAGON_CONFIG;
  const rng = createRng((seed ^ 0x0c7a90f1) >>> 0);
  const size = config.size, centre = (size - 1) / 2;
  const cells: MazeCell[] = [];
  const rings: Record<string, Ring> = {};
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const dx = column - centre, dy = row - centre;
    if (!inOctagon(dx, dy)) continue;
    const id = cellId(column, row);
    cells.push({ id, column, row });
    rings[id] = octagonTier(dx, dy);
  }
  const sanctuaries: Sanctuary[] = SANCTUARY_SLOTS.map(([name, sx, sy, ix, iy]) => ({
    id: `base-${name}`, name, column: centre + sx, row: centre + sy, inner: { column: centre + ix, row: centre + iy }, home: name === HOME_SLOT }));
  const home = sanctuaries.find((base) => base.home)!;
  const homeCell: MazeCell = { id: cellId(home.column, home.row), column: home.column, row: home.row };
  // The home base is a 3-room-wide yard outside the south side (its middle room holds the gate).
  const yard = [-1, 1].map((side): MazeCell => ({ id: cellId(home.column + side, home.row), column: home.column + side, row: home.row }));
  for (const cell of [homeCell, ...yard]) { cells.push(cell); rings[cell.id] = 'sanctuary'; }
  const hub = cellId(home.inner.column, home.inner.row);

  const byPos = new Map(cells.map((cell) => [`${cell.column},${cell.row}`, cell]));
  const pairEdge = (a: MazeCell, b: MazeCell): MazeEdge => ({ id: edgeId(a.id, b.id), a: a.id, b: b.id });
  const candidates: MazeEdge[] = [];
  for (const cell of cells) {
    if (rings[cell.id] === 'sanctuary') continue;
    for (const [dc, dr] of [[1, 0], [0, 1]]) {
      const other = byPos.get(`${cell.column + dc},${cell.row + dr}`);
      if (other && rings[other.id] !== 'sanctuary') candidates.push(pairEdge(cell, other));
    }
  }
  const tierOf = (id: string) => rings[id];
  const isCore = (id: string) => tierOf(id) === 'outer';
  const sameTier = (edge: MazeEdge) => tierOf(edge.a) === tierOf(edge.b);

  const parent = new Map(cells.map((cell) => [cell.id, cell.id]));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const open = new Map<string, MazeEdge>();
  const add = (edge: MazeEdge) => { open.set(edge.id, edge); parent.set(find(edge.a), find(edge.b)); };

  // The core is one open chamber: every connection inside it exists.
  for (const edge of candidates) if (isCore(edge.a) && isCore(edge.b)) add(edge);
  // Each ring is its own maze of rooms (spanning tree within the ring, then a few loops).
  const leftovers: MazeEdge[] = [];
  for (const edge of rng.shuffle(candidates.filter((edge) => sameTier(edge) && !isCore(edge.a)))) {
    if (find(edge.a) !== find(edge.b)) add(edge); else leftovers.push(edge);
  }
  for (const edge of leftovers) if (rng.next() < config.loopChance) add(edge);
  // Rings are joined only by ring doors: one doorway per octagon side (eight per boundary),
  // seeded. They stay where they are; the rings turn behind them on each bell (ringTurns).
  const sectorOf = (edge: MazeEdge) => {
    const a = cells.find((cell) => cell.id === edge.a)!, b = cells.find((cell) => cell.id === edge.b)!;
    const angle = Math.atan2((a.row + b.row) / 2 - centre, (a.column + b.column) / 2 - centre);
    return ((Math.round(angle / (Math.PI / 4)) % RING_SLOTS) + RING_SLOTS) % RING_SLOTS;
  };
  const ringDoors: MazeEdge[] = [];
  for (const [boundary, outer, inner] of [[1, 'inner', 'middle'], [2, 'middle', 'outer']] as const) {
    const crossing = candidates.filter((edge) => (tierOf(edge.a) === outer && tierOf(edge.b) === inner) || (tierOf(edge.a) === inner && tierOf(edge.b) === outer));
    for (let slot = 0; slot < RING_SLOTS; slot++) {
      const options = crossing.filter((edge) => sectorOf(edge) === slot);
      if (!options.length) throw new Error(`Seed ${seed}: no ring door for boundary ${boundary} slot ${slot}.`);
      ringDoors.push({ ...rng.pick(options), gate: ringGate(boundary, slot) });
    }
  }
  for (const door of ringDoors) { open.set(door.id, door); parent.set(find(door.a), find(door.b)); }
  // The home gate: the only way from the lobby into the maze. Closed until the match starts.
  const homeEdge: MazeEdge = { ...pairEdge(homeCell, cells.find((cell) => cell.id === hub)!), gate: HOME_GATE };
  open.set(homeEdge.id, homeEdge);
  for (const cell of yard) open.set(edgeId(cell.id, homeCell.id), pairEdge(cell, homeCell));

  // One landmark per ring, in different quadrants.
  const quadrant = (cell: MazeCell) => Math.floor(((Math.atan2(cell.row - centre, cell.column - centre) + Math.PI) / (2 * Math.PI)) * 4) % 4;
  const used: number[] = [];
  const landmarks: Landmark[] = (['inner', 'middle', 'outer'] as const).map((tier, index) => {
    const options = cells.filter((cell) => tierOf(cell.id) === tier && cell.id !== hub && !used.includes(quadrant(cell))
      && !(tier === 'outer' && cell.column === centre && cell.row === centre));
    const cell = rng.pick(options);
    used.push(quadrant(cell));
    return { ...LANDMARKS[index], cell: cell.id };
  });

  // Checks run from the hub (the room inside the home gate), with the home gate ignored.
  const fromHub = (): MazeLayout => ({ cells, edges: [...open.values()].filter((edge) => edge.gate !== HOME_GATE), landmarks, start: hub,
    columns: size, rows: size });
  const mazeCells = cells.length - 1 - yard.length;
  const ALL_OPEN: MazeOpenness = {};
  // Repair: no single connection may cut a landmark off from the hub.
  for (const landmark of landmarks) {
    for (let guard = 0; guard < cells.length; guard++) {
      const layout = { ...fromHub(), edges: fromHub().edges.map((edge) => ({ ...edge, gate: undefined })) };
      const bridge = findBridgeToSanctuary(layout, landmark.cell, ALL_OPEN);
      if (!bridge) break;
      const without = reachableMazeCells(layout, ALL_OPEN, landmark.cell, [bridge]);
      const repairs = candidates.filter((edge) => !open.has(edge.id) && without.has(edge.a) !== without.has(edge.b) && sameTier(edge));
      if (!repairs.length) throw new Error(`Seed ${seed}: no repair edge for ${landmark.id}.`);
      add(rng.pick(repairs));
    }
  }

  // Shift gates, as in the square maze but never in the core chamber, at a ring doorway or
  // beside the hub. Open-starting gates must be removable with every chosen gate closed.
  const ringsOpen: MazeOpenness = Object.fromEntries(ringDoors.map((door) => [door.gate!, 1]));
  const gateRng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const grid: MazeLayout = { cells, edges: [], landmarks: [], start: hub, columns: size, rows: size };
  const blockOf = (edge: MazeEdge) => { const { block } = gatePocket(grid, edge); return `${block.column},${block.row}`; };
  const usedBlocks = new Set<string>(ringDoors.map(blockOf));
  const allowed = (edge: MazeEdge) => sameTier(edge) && !isCore(edge.a) && edge.a !== hub && edge.b !== hub && edge.gate === undefined;
  const sortById = (items: MazeEdge[]) => items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const openPool = gateRng.shuffle(sortById([...open.values()].filter(allowed)));
  const closedPool = gateRng.shuffle(sortById(candidates.filter((edge) => allowed(edge) && !open.has(edge.id))));
  const gates: string[] = [];
  const initialOpenness: Record<string, number> = { [HOME_GATE]: 0 };
  for (const door of ringDoors) initialOpenness[door.gate!] = 1;
  for (let i = 0; i < config.gateCount; i++) {
    const startsOpen = i % 2 === 0;
    const pool = startsOpen ? openPool : closedPool;
    const findCandidate = () => pool.findIndex((edge) => {
      if (usedBlocks.has(blockOf(edge))) return false;
      if (!startsOpen) return true;
      const trial = { ...fromHub(), edges: fromHub().edges.filter((other) => other.id !== edge.id) };
      return reachableMazeCells(trial, ringsOpen, hub).size === mazeCells
        && landmarks.every((landmark) => findBridgeToSanctuary(trial, landmark.cell, ringsOpen) === null);
    });
    let index = findCandidate();
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

  const core: CellBlock = { minColumn: centre - 1, maxColumn: centre + 1, minRow: centre - 1, maxRow: centre + 1 };
  const edges = [...open.values()].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return {
    seed, version: OCTAGON_VERSION, config: { ...config }, columns: size, rows: size,
    plaza: { minColumn: home.column - 1, maxColumn: home.column + 1, minRow: home.row, maxRow: home.row },
    chambers: [core], wallHeight: OCTAGON_WALL_HEIGHT,
    cells, edges, landmarks, start: homeCell.id, rings, entrances: [homeEdge.id], gates, initialOpenness,
    homeGate: HOME_GATE, hub, core: { x: 0, z: 0 }, sanctuaries, ringNames: OCTAGON_RING_NAMES, counts: OCTAGON_COUNTS,
  };
}
