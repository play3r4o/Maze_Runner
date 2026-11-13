// M18 rework: turning rings. A ring's quarter turn rotates its corridors (and the gates, traps,
// chests and landmarks in them) about the octagon's centre; ring doors, the home gate, the core
// and the bases stay put. Anyone inside rides the ring: the run's bodies in it turn with it.
// Worlds for each combination of turns are derived from the generated one and cached.
import { cellId, cellPosition, corridorRect, deriveMazeWalls, edgeId, findCell, landmarkRect, roomHalfOf } from '../simulation/maze';
import type { MazeEdge } from '../simulation/maze';
import type { GeneratedMaze } from '../simulation/mazeGenerator';
import type { TrapSpec, Rect2, Point2 } from './traps';
import type { Container } from './loot';
import type { GeneratedRun, GeneratedWorld } from './generatedRun';
import type { RingTurns, TurningRing } from './ringTurns';
import { NO_TURNS, sameTurns } from './ringTurns';

const quarter = (q: number) => ((q % 4) + 4) % 4;
// One clockwise quarter (seen from above, north up): (x, z) → (−z, x).
export function rotatePoint<T extends Point2>(point: T, q: number): T {
  let { x, z } = point;
  for (let i = 0; i < quarter(q); i++) [x, z] = [-z, x];
  return { ...point, x: x + 0, z: z + 0 };
}
// Facing turns with the body (forward is (−sin yaw, −cos yaw)).
export const rotateYaw = (yaw: number, q: number) => yaw - quarter(q) * Math.PI / 2;
function rotateRect<T extends Rect2>(rect: T, q: number): T {
  const a = rotatePoint({ x: rect.minX, z: rect.minZ }, q), b = rotatePoint({ x: rect.maxX, z: rect.maxZ }, q);
  return { ...rect, minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x), minZ: Math.min(a.z, b.z), maxZ: Math.max(a.z, b.z) };
}
export function rotateCell(maze: GeneratedMaze, id: string, q: number) {
  const cell = findCell(maze, id), centre = (maze.columns! - 1) / 2;
  const turned = rotatePoint({ x: cell.column - centre, z: cell.row - centre }, q);
  return cellId(turned.x + centre, turned.z + centre);
}

const tierOf = (maze: GeneratedMaze, id: string) => maze.rings[id];
const turning = (maze: GeneratedMaze, id: string, turns: RingTurns): TurningRing | null => {
  const tier = tierOf(maze, id);
  return (tier === 'inner' || tier === 'middle') && turns[tier] ? tier : null;
};
// The layout with each ring's own corridors turned (ring doors and the home gate cross rings and stay).
export function turnedMaze(base: GeneratedMaze, turns: RingTurns): GeneratedMaze {
  if (sameTurns(turns, NO_TURNS)) return base;
  const edges = base.edges.map((edge): MazeEdge => {
    const ring = turning(base, edge.a, turns);
    if (!ring || tierOf(base, edge.b) !== ring) return edge;
    const a = rotateCell(base, edge.a, turns[ring]), b = rotateCell(base, edge.b, turns[ring]);
    return { ...edge, id: edgeId(a, b), a, b };
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const landmarks = base.landmarks.map((landmark) => {
    const ring = turning(base, landmark.cell, turns);
    return ring ? { ...landmark, cell: rotateCell(base, landmark.cell, turns[ring]) } : landmark;
  });
  return { ...base, edges, landmarks };
}

const cache = new WeakMap<GeneratedWorld, Map<string, GeneratedWorld>>();
// The world after these turns (the generated world itself when nothing has turned).
export function worldFor(world: GeneratedWorld, turns: RingTurns): GeneratedWorld {
  const base = world.base ?? world;
  if (sameTurns(turns, NO_TURNS)) return base;
  const key = `${turns.inner},${turns.middle}`;
  let byTurns = cache.get(base);
  if (!byTurns) cache.set(base, byTurns = new Map());
  const hit = byTurns.get(key);
  if (hit) return hit;
  const maze = turnedMaze(base.maze, turns);
  const walls = deriveMazeWalls(maze);
  const turnTrap = (trap: TrapSpec): TrapSpec => {
    const ring = turning(base.maze, trap.cell, turns);
    if (!ring) return trap;
    const q = turns[ring];
    const edge = trap.edge ? base.maze.edges.find((item) => item.id === trap.edge)! : null;
    return { ...trap, cell: rotateCell(base.maze, trap.cell, q),
      edge: edge ? edgeId(rotateCell(base.maze, edge.a, q), rotateCell(base.maze, edge.b, q)) : null,
      plate: trap.plate ? rotateRect(trap.plate, q) : null, zone: rotateRect(trap.zone, q),
      axis: q % 2 ? (trap.axis === 'x' ? 'z' : 'x') : trap.axis,
      path: trap.path ? { from: rotatePoint(trap.path.from, q), to: rotatePoint(trap.path.to, q) } : null };
  };
  const turnContainer = (container: Container): Container => {
    const ring = turning(base.maze, container.cell, turns);
    return ring ? { ...rotatePoint(container, turns[ring]), cell: rotateCell(base.maze, container.cell, turns[ring]) } : container;
  };
  const relicRing = turning(base.maze, base.relic.cell, turns);
  const relic = relicRing ? { ...rotatePoint(base.relic, turns[relicRing]), cell: rotateCell(base.maze, base.relic.cell, turns[relicRing]) } : base.relic;
  const next: GeneratedWorld = { ...base, base, maze, walls, solids: [...walls, ...maze.landmarks.map((landmark) => landmarkRect(landmark, maze))],
    relic, traps: base.traps.map(turnTrap), containers: base.containers.map(turnContainer) };
  byTurns.set(key, next);
  return next;
}

// Which turning ring a point is in: inside one of its junctions or corridors (not a ring door,
// not the core or a base).
export function ringAtPoint(world: GeneratedWorld, point: Point2): TurningRing | null {
  const { maze } = world, h = roomHalfOf(maze);
  for (const cell of maze.cells) {
    const tier = tierOf(maze, cell.id);
    if (tier !== 'inner' && tier !== 'middle') continue;
    const { x, z } = cellPosition(cell, maze);
    if (Math.abs(point.x - x) <= h && Math.abs(point.z - z) <= h) return tier;
  }
  for (const edge of maze.edges) {
    const tier = tierOf(maze, edge.a);
    if ((tier !== 'inner' && tier !== 'middle') || tierOf(maze, edge.b) !== tier) continue;
    const r = corridorRect(maze, edge);
    if (point.x >= r.minX && point.x <= r.maxX && point.z >= r.minZ && point.z <= r.maxZ) return tier;
  }
  return null;
}

// Turn the run's bodies with their rings, going from `from` to `to` turns. Chalk, thread,
// bolts and globs in a turning ring are lost (the stone grinds them away).
export function turnRun(world: GeneratedWorld, run: GeneratedRun, from: RingTurns, to: RingTurns): GeneratedRun {
  const before = worldFor(world, from);
  const delta = { inner: quarter(to.inner - from.inner), middle: quarter(to.middle - from.middle) };
  const q = (point: Point2) => { const ring = ringAtPoint(before, point); return ring && delta[ring] ? delta[ring] : 0; };
  const cellTurn = (id: string, turns: number) => turns && (tierOf(before.maze, id) === 'inner' || tierOf(before.maze, id) === 'middle') ? rotateCell(before.maze, id, turns) : id;
  const pq = q(run.player);
  const player = pq ? { ...rotatePoint(run.player, pq), yaw: rotateYaw(run.player.yaw, pq) } : run.player;
  const monsters = run.monsters.map((monster) => {
    const mq = q(monster);
    if (!mq) return monster;
    return { ...rotatePoint(monster, mq), yaw: rotateYaw(monster.yaw, mq), at: cellTurn(monster.at, mq), path: [], goal: null, lastSeen: null, charge: null };
  });
  const containers = run.containers.map((container) => {
    const ring = tierOf(before.maze, container.cell);
    const cq = ring === 'inner' || ring === 'middle' ? delta[ring] : 0;
    return cq ? { ...rotatePoint(container, cq), cell: rotateCell(before.maze, container.cell, cq) } : container;
  });
  const keep = (point: Point2) => q(point) === 0;
  const chalk = run.chalk.filter((stroke) => stroke.points.every(([x, , z]) => keep({ x, z })));
  const thread = run.thread.filter((line) => line.every(keep));
  return { ...run, player, monsters, containers, chalk, thread,
    bolts: run.bolts.filter(keep), globs: run.globs.filter(keep),
    activeStroke: chalk.some((stroke) => stroke.id === run.activeStroke) ? run.activeStroke : null };
}
