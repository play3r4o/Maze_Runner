import type { PlayerState, WallRect } from './player';
import { reachableMazeCells } from './mazeGraph';

export type MazeCell = { id: string; column: number; row: number };
export const MAZE_GATE_IDS = ['north', 'east'] as const;
export type MazeGateId = typeof MAZE_GATE_IDS[number];
// Openness per gate ID: 1 fully open (slab in its pocket), 0 closed (slab fills the corridor).
export type MazeOpenness = Record<string, number>;
// Gate IDs are free-form strings: 'north'/'east' in the hand-built maze, 'g1'.. in generated mazes.
export type MazeEdge = { id: string; a: string; b: string; gate?: string };
export type Landmark = { id: string; name: string; color: string; cell: string };
// A rectangular block of cells carved as one open floor (the generated Sanctuary plaza).
export type CellBlock = { minColumn: number; maxColumn: number; minRow: number; maxRow: number };
// Geometry needs columns/rows; graph-only fixtures may omit them (5×5 is assumed).
export type MazeLayout = { cells: readonly MazeCell[]; edges: readonly MazeEdge[]; landmarks: readonly Landmark[]; start: string;
  columns?: number; rows?: number; plaza?: CellBlock };

export const CELL_SPACING = 12;
export const CORRIDOR_WIDTH = 4;
export const MAZE_SIZE = 60;
export const ROOM_HALF = 2;
export const MAZE_SPAWN: Readonly<PlayerState> = { x: 0, z: 0, yaw: 0 };
export const cellId = (column: number, row: number) => `cell-${column}-${row}`;
export const edgeId = (a: string, b: string) => [a, b].sort().join('--');
// Square footprint of the whole layout, including a solid border around the outer rooms.
export const mazeExtent = (layout: MazeLayout) => ({
  width: (layout.columns ?? 5) * CELL_SPACING, depth: (layout.rows ?? 5) * CELL_SPACING });
// Cell centers are placed so the middle of the grid sits at world (0, 0).
export function cellPosition(cell: MazeCell, layout: MazeLayout = HAND_BUILT_MAZE) {
  return { x: (cell.column - ((layout.columns ?? 5) - 1) / 2) * CELL_SPACING,
    z: (cell.row - ((layout.rows ?? 5) - 1) / 2) * CELL_SPACING };
}
export const findCell = (layout: MazeLayout, id: string) => layout.cells.find((cell) => cell.id === id)!;
export function plazaRect(layout: MazeLayout): WallRect | null {
  if (!layout.plaza) return null;
  const { minColumn, maxColumn, minRow, maxRow } = layout.plaza;
  const a = cellPosition({ id: '', column: minColumn, row: minRow }, layout);
  const b = cellPosition({ id: '', column: maxColumn, row: maxRow }, layout);
  return { id: 'plaza', minX: a.x - ROOM_HALF, maxX: b.x + ROOM_HALF, minZ: a.z - ROOM_HALF, maxZ: b.z + ROOM_HALF, height: 3 };
}

// Explicit rows/columns of connections, not a procedural generator.
// Each pair denotes adjacent cells. Missing pairs are solid stone.
const horizontal = [
  [0, 0], [1, 0], [3, 0],
  [1, 1], [2, 1], [3, 1],
  [0, 2], [1, 2], [3, 2],
  [1, 3],
  [0, 4], [1, 4], [2, 4], [3, 4],
];
const vertical = [
  [0, 0], [2, 0], [4, 0],
  [0, 1], [1, 1], [4, 1],
  [0, 2], [1, 2], [2, 2], [3, 2], [4, 2],
  [0, 3], [2, 3], [3, 3], [4, 3],
];
function edge(c1: number, r1: number, c2: number, r2: number, gate?: MazeGateId): MazeEdge {
  const a = cellId(c1, r1), b = cellId(c2, r2);
  return { id: edgeId(a, b), a, b, ...(gate ? { gate } : {}) };
}
export const HAND_BUILT_MAZE: MazeLayout = {
  columns: 5, rows: 5,
  cells: Array.from({ length: 25 }, (_, i) => ({ id: cellId(i % 5, Math.floor(i / 5)), column: i % 5, row: Math.floor(i / 5) })),
  edges: [
    ...horizontal.map(([c, r]) => edge(c, r, c + 1, r)),
    ...vertical.map(([c, r]) => edge(c, r, c, r + 1)),
    edge(2, 2, 2, 1, 'north'), edge(2, 2, 3, 2, 'east'),
  ],
  start: cellId(2, 2),
  landmarks: [
    { id: 'amber', name: 'Amber Spire', color: '#e9b857', cell: cellId(2, 0) },
    { id: 'blue', name: 'Blue Beacon', color: '#66bde0', cell: cellId(4, 2) },
    { id: 'rose', name: 'Rose Pillar', color: '#d984aa', cell: cellId(0, 4) },
  ],
};

export function corridorRect(layout: MazeLayout, edge: MazeEdge): WallRect {
  const a = cellPosition(findCell(layout, edge.a), layout);
  const b = cellPosition(findCell(layout, edge.b), layout);
  const vertical = a.x === b.x;
  return { id: edge.id, height: 3,
    minX: vertical ? a.x - 2 : Math.min(a.x, b.x) + 2,
    maxX: vertical ? a.x + 2 : Math.max(a.x, b.x) - 2,
    minZ: vertical ? Math.min(a.z, b.z) + 2 : a.z - 2,
    maxZ: vertical ? Math.max(a.z, b.z) - 2 : a.z + 2,
  };
}

export const GATE_TRAVEL = 4.5;
// A gate slab slides sideways out of its corridor into the solid pillar block beside it:
// +X for north–south corridors, +Z for east–west ones, or the negative side on the last
// column/row so the pocket stays inside the maze. Returns the slide direction and the
// pillar block (named by its top-left cell) that holds the open slab.
export function gatePocket(layout: MazeLayout, edge: MazeEdge) {
  const a = findCell(layout, edge.a), b = findCell(layout, edge.b);
  const alongZ = a.column === b.column;
  const column = Math.min(a.column, b.column), row = Math.min(a.row, b.row);
  if (alongZ) {
    const sign = column === (layout.columns ?? 5) - 1 ? -1 : 1;
    return { axis: 'x' as const, sign, block: { column: sign > 0 ? column : column - 1, row } };
  }
  const sign = row === (layout.rows ?? 5) - 1 ? -1 : 1;
  return { axis: 'z' as const, sign, block: { column, row: sign > 0 ? row : row - 1 } };
}
export function gateRect(layout: MazeLayout, edge: MazeEdge, openness: number): WallRect {
  const rect = corridorRect(layout, edge);
  const { axis, sign } = gatePocket(layout, edge);
  const offset = sign * Math.max(0, Math.min(1, openness)) * GATE_TRAVEL;
  const dx = axis === 'x' ? offset : 0, dz = axis === 'z' ? offset : 0;
  return { ...rect, id: `gate-${edge.gate}`, minX: rect.minX + dx, maxX: rect.maxX + dx,
    minZ: rect.minZ + dz, maxZ: rect.maxZ + dz };
}
export const gateEdges = (layout: MazeLayout) => layout.edges.filter((edge) => edge.gate !== undefined);
export const layoutGateColliders = (layout: MazeLayout, openness: MazeOpenness) =>
  gateEdges(layout).map((edge) => gateRect(layout, edge, openness[edge.gate!]));

export function mazeGateRect(id: string, openness: number, layout: MazeLayout = HAND_BUILT_MAZE): WallRect {
  return gateRect(layout, layout.edges.find((edge) => edge.gate === id)!, openness);
}
export const mazeGateColliders = (openness: MazeOpenness) => MAZE_GATE_IDS.map((id) => mazeGateRect(id, openness[id]));

const contains = (rect: WallRect, x: number, z: number) => x > rect.minX && x < rect.maxX && z > rect.minZ && z < rect.maxZ;

export function deriveMazeWalls(layout: MazeLayout): WallRect[] {
  const rooms = layout.cells.map((cell) => {
    const { x, z } = cellPosition(cell, layout);
    return { id: cell.id, minX: x - 2, maxX: x + 2, minZ: z - 2, maxZ: z + 2, height: 3 };
  });
  const plaza = plazaRect(layout);
  const passages = [...rooms, ...layout.edges.map((edge) => corridorRect(layout, edge)), ...(plaza ? [plaza] : [])];
  const { width, depth } = mazeExtent(layout);
  const cuts = (axis: 'x' | 'z') => [...new Set([axis === 'x' ? -width / 2 : -depth / 2, axis === 'x' ? width / 2 : depth / 2,
    ...rooms.flatMap((room) => axis === 'x' ? [room.minX, room.maxX] : [room.minZ, room.maxZ])])].sort((a, b) => a - b);
  const xs = cuts('x'), zs = cuts('z');
  const walls: WallRect[] = [];
  for (let x = 0; x < xs.length - 1; x++) for (let z = 0; z < zs.length - 1; z++) {
    const rect = { id: `stone-${x}-${z}`, minX: xs[x], maxX: xs[x + 1], minZ: zs[z], maxZ: zs[z + 1], height: 3 };
    if (!passages.some((passage) => contains(passage, (rect.minX + rect.maxX) / 2, (rect.minZ + rect.maxZ) / 2))) walls.push(rect);
  }
  return walls;
}
export function landmarkRect(landmark: Landmark, layout: MazeLayout = HAND_BUILT_MAZE): WallRect {
  const { x, z } = cellPosition(findCell(layout, landmark.cell), layout);
  return { id: `landmark-${landmark.id}`, minX: x + 0.5, maxX: x + 1.3, minZ: z + 0.5, maxZ: z + 1.3, height: 4 };
}
export const MAZE_WALLS = deriveMazeWalls(HAND_BUILT_MAZE);
export const MAZE_SOLIDS = [...MAZE_WALLS, ...HAND_BUILT_MAZE.landmarks.map((landmark) => landmarkRect(landmark))];

export function inCellRoom(player: PlayerState, id: string, layout: MazeLayout = HAND_BUILT_MAZE): boolean {
  const { x, z } = cellPosition(findCell(layout, id), layout);
  return Math.abs(player.x - x) < 2 && Math.abs(player.z - z) < 2;
}

// Compatibility predicate; the shared graph queries also power diagnostics.
export function mazeConnected(layout: MazeLayout, openness: MazeOpenness): boolean {
  const reached = reachableMazeCells(layout, openness, layout.start);
  return layout.cells.every((cell) => reached.has(cell.id));
}
