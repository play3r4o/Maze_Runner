// M12 traps (widened at the developer's request): hidden pressure plates set off rolling
// boulders, wall spears, floor spikes, opening pits and dart volleys; swinging blades guard
// some corridors with no plate. Anything with a body triggers plates and is hurt: the player
// and (stage 2) monsters, so bosses can be lured into lethal traps. Pure rules, seeded placement.
import { cellPosition, corridorRect, edgeId, findCell } from '../simulation/maze';
import type { MazeEdge } from '../simulation/maze';
import { createRng } from '../simulation/mazeGenerator';
import type { GeneratedMaze, Ring } from '../simulation/mazeGenerator';
import { BLADE_HIT_COOLDOWN, BLADE_PERIOD, BLADE_SWING, BLADE_THICKNESS, BLADE_WIDTH, BOULDER_MIN_EDGES, BOULDER_RADIUS,
  BOULDER_SPEED, CORRIDOR_ZONE_LENGTH, DART_VOLLEY_SECONDS, PIT_SIZE, PLATE_SIZE, SPIKE_FIELD_SIZE, TRAPS_PER_RING,
  TRAP_DAMAGE, TRAP_TIMING } from './tuning';

export type TrapKind = 'boulder' | 'spears' | 'floorSpikes' | 'pit' | 'darts' | 'blade';
export type Rect2 = { minX: number; maxX: number; minZ: number; maxZ: number };
export type Point2 = { x: number; z: number };
export type TrapSpec = {
  id: string; kind: TrapKind; ring: Exclude<Ring, 'sanctuary'>;
  // Where it is: a room (cell) or a corridor (edge between two cells).
  cell: string; edge: string | null;
  // The pressure plate (null for blades) and the area it hurts.
  plate: Rect2 | null; zone: Rect2;
  // Corridor direction ('x' or 'z'); for boulders the line it rolls along.
  axis: 'x' | 'z'; path: { from: Point2; to: Point2 } | null;
};
export type TrapPhase = 'armed' | 'warning' | 'active' | 'cooldown';
// `hits` lists bodies already hurt this activation (blades: body → step of last hit).
export type TrapState = { id: string; phase: TrapPhase; seconds: number; hits: Record<string, number> };
// `careful` bodies (patrolling monsters, who know the floor) neither press plates nor walk
// into blades; anything inside a trap that is firing is still hurt.
export type Body = { id: string; x: number; z: number; half: number; careful?: boolean };
export type TrapOutcome = {
  states: TrapState[];
  damage: { body: string; amount: number; cause: TrapKind; lethal: boolean }[];
  triggered: { trap: TrapSpec; by: string }[];
};

const rect = (x: number, z: number, half: number): Rect2 => ({ minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half });
export const bodyOverlaps = (body: Body, r: Rect2) =>
  body.x + body.half > r.minX && body.x - body.half < r.maxX && body.z + body.half > r.minZ && body.z - body.half < r.maxZ;
const circleTouches = (body: Body, centre: Point2, radius: number) => {
  const dx = Math.max(Math.abs(body.x - centre.x) - body.half, 0), dz = Math.max(Math.abs(body.z - centre.z) - body.half, 0);
  return Math.hypot(dx, dz) < radius;
};

// Which kinds each ring may hold, by weight. Lethal traps only further out.
const KIND_WEIGHTS: Record<'inner' | 'middle' | 'outer', [TrapKind, number][]> = {
  inner: [['spears', 3], ['darts', 3], ['floorSpikes', 2], ['blade', 2]],
  middle: [['spears', 2], ['darts', 2], ['floorSpikes', 2], ['blade', 2], ['pit', 2], ['boulder', 2]],
  outer: [['spears', 2], ['darts', 1], ['floorSpikes', 2], ['blade', 2], ['pit', 3], ['boulder', 3]],
};
const ROOM_KINDS = new Set<TrapKind>(['floorSpikes', 'pit']);

// Seeded placement. Never in Sanctuary or the cells just outside its entrances, the relic
// room or landmark rooms, or on gate corridors; one trap per cell; boulder lines use static
// corridors only, so no gate can cut a roll short.
export function placeTraps(maze: GeneratedMaze, relicCell: string): TrapSpec[] {
  const rng = createRng((maze.seed ^ 0x2545f491) >>> 0);
  const entranceCells = new Set(maze.entrances.flatMap((id) => maze.edges.find((edge) => edge.id === id)!).flatMap((edge) => [edge.a, edge.b]));
  const blocked = new Set([relicCell, ...maze.landmarks.map((landmark) => landmark.cell), ...entranceCells]);
  const used = new Set<string>();
  const usable = (cell: string) => maze.rings[cell] !== 'sanctuary' && !blocked.has(cell) && !used.has(cell);
  const staticEdge = (a: string, b: string) => maze.edges.find((edge) => edge.id === edgeId(a, b) && !edge.gate);
  const traps: TrapSpec[] = [];
  for (const ring of ['inner', 'middle', 'outer'] as const) {
    // Variety: no kind takes more than a third of a ring's traps (rounded up).
    const perRing = maze.counts?.traps ?? TRAPS_PER_RING;
    const cap = Math.ceil(perRing[ring] / 3);
    const counts: Partial<Record<TrapKind, number>> = {};
    for (let n = 0; n < perRing[ring]; n++) {
      const weights = KIND_WEIGHTS[ring].filter(([kind]) => (counts[kind] ?? 0) < cap);
      let roll = rng.next() * weights.reduce((sum, [, w]) => sum + w, 0);
      let kind = weights[0][0];
      for (const [candidate, w] of weights) { if ((roll -= w) < 0) { kind = candidate; break; } }
      const spec = ROOM_KINDS.has(kind) ? roomTrap(kind) : corridorTrap(kind);
      if (spec) { traps.push(spec); counts[kind] = (counts[kind] ?? 0) + 1; }
    }
    function roomTrap(kind: TrapKind): TrapSpec | null {
      const options = maze.cells.filter((cell) => maze.rings[cell.id] === ring && usable(cell.id));
      if (!options.length) return null;
      const cell = rng.pick(options);
      used.add(cell.id);
      const { x, z } = cellPosition(cell, maze);
      const size = kind === 'pit' ? PIT_SIZE : SPIKE_FIELD_SIZE;
      return { id: `t${traps.length + 1}`, kind, ring, cell: cell.id, edge: null, axis: 'x', path: null,
        plate: rect(x, z, PLATE_SIZE / 2), zone: rect(x, z, size / 2) };
    }
    function corridorTrap(kind: TrapKind): TrapSpec | null {
      const options = maze.edges.filter((edge) => !edge.gate && usable(edge.a) && usable(edge.b)
        && (maze.rings[edge.a] === ring || maze.rings[edge.b] === ring));
      const shuffled = rng.shuffle(options);
      for (const edge of shuffled) {
        const spec = kind === 'boulder' ? boulderTrap(edge) : lineTrap(kind, edge);
        if (spec) return spec;
      }
      return null;
    }
    function lineTrap(kind: TrapKind, edge: MazeEdge): TrapSpec {
      used.add(edge.a); used.add(edge.b);
      const r = corridorRect(maze, edge);
      const x = (r.minX + r.maxX) / 2, z = (r.minZ + r.maxZ) / 2;
      // Along the corridor (M18 doorways are wider than they are long).
      const axis = findCell(maze, edge.a).column === findCell(maze, edge.b).column ? 'z' : 'x';
      const half = CORRIDOR_ZONE_LENGTH / 2;
      const zone = axis === 'z' ? { minX: r.minX, maxX: r.maxX, minZ: z - half, maxZ: z + half }
        : { minX: x - half, maxX: x + half, minZ: r.minZ, maxZ: r.maxZ };
      return { id: `t${traps.length + 1}`, kind, ring, cell: edge.a, edge: edge.id, axis, path: null,
        plate: kind === 'blade' ? null : rect(x, z, PLATE_SIZE / 2), zone };
    }
    // A plate in the middle of a straight run of static corridors; the boulder starts at one
    // end of the run and rolls past the plate to the other end.
    function boulderTrap(edge: MazeEdge): TrapSpec | null {
      const a = findCell(maze, edge.a), b = findCell(maze, edge.b);
      const dc = b.column - a.column, dr = b.row - a.row;
      const line = [a.id, b.id];
      const extend = (from: typeof a, sc: number, sr: number, push: (id: string) => void) => {
        let current = from;
        for (;;) {
          const next = maze.cells.find((cell) => cell.column === current.column + sc && cell.row === current.row + sr);
          if (!next || !usable(next.id) || !staticEdge(current.id, next.id)) return;
          push(next.id); current = next;
        }
      };
      extend(b, dc, dr, (id) => line.push(id));
      extend(a, -dc, -dr, (id) => line.unshift(id));
      if (line.length - 1 < BOULDER_MIN_EDGES) return null;
      for (const id of line) used.add(id);
      const ends = [cellPosition(findCell(maze, line[0]), maze), cellPosition(findCell(maze, line.at(-1)!), maze)];
      const [from, to] = rng.next() < 0.5 ? ends : [ends[1], ends[0]];
      const r = corridorRect(maze, edge);
      const x = (r.minX + r.maxX) / 2, z = (r.minZ + r.maxZ) / 2;
      const axis = dc !== 0 ? 'x' : 'z';
      return { id: `t${traps.length + 1}`, kind: 'boulder', ring, cell: edge.a, edge: edge.id, axis, path: { from, to },
        plate: rect(x, z, PLATE_SIZE / 2),
        zone: { minX: Math.min(from.x, to.x) - 2, maxX: Math.max(from.x, to.x) + 2, minZ: Math.min(from.z, to.z) - 2, maxZ: Math.max(from.z, to.z) + 2 } };
    }
  }
  return traps;
}

export const createTrapStates = (traps: readonly TrapSpec[]): TrapState[] =>
  traps.map((trap) => ({ id: trap.id, phase: 'armed', seconds: 0, hits: {} }));

export const boulderRollSeconds = (trap: TrapSpec) =>
  trap.path ? Math.hypot(trap.path.to.x - trap.path.from.x, trap.path.to.z - trap.path.from.z) / BOULDER_SPEED : 0;
// Where the boulder is while rolling (null otherwise).
export function boulderPosition(trap: TrapSpec, state: TrapState): Point2 | null {
  if (trap.kind !== 'boulder' || !trap.path || state.phase !== 'active') return null;
  const total = boulderRollSeconds(trap);
  const k = Math.min(1, state.seconds / total);
  return { x: trap.path.from.x + (trap.path.to.x - trap.path.from.x) * k, z: trap.path.from.z + (trap.path.to.z - trap.path.from.z) * k };
}
// The swinging blade's rectangle at simulation time `time` (seconds).
export function bladeRect(trap: TrapSpec, time: number): Rect2 {
  const offset = BLADE_SWING * Math.sin((2 * Math.PI * time) / BLADE_PERIOD);
  const cx = (trap.zone.minX + trap.zone.maxX) / 2, cz = (trap.zone.minZ + trap.zone.maxZ) / 2;
  return trap.axis === 'z'
    ? { minX: cx + offset - BLADE_WIDTH / 2, maxX: cx + offset + BLADE_WIDTH / 2, minZ: cz - BLADE_THICKNESS / 2, maxZ: cz + BLADE_THICKNESS / 2 }
    : { minX: cx - BLADE_THICKNESS / 2, maxX: cx + BLADE_THICKNESS / 2, minZ: cz + offset - BLADE_WIDTH / 2, maxZ: cz + offset + BLADE_WIDTH / 2 };
}
export const pitOpen = (trap: TrapSpec, state: TrapState) => trap.kind === 'pit' && state.phase === 'active';
export const spikesUp = (trap: TrapSpec, state: TrapState) =>
  (trap.kind === 'spears' || trap.kind === 'floorSpikes') && state.phase === 'active';

// One simulation step for every trap. `time` is the run's simulation time in seconds (blades);
// `step` the integer step (blade hit cooldown). Plates trigger only when armed.
export function stepTraps(traps: readonly TrapSpec[], states: readonly TrapState[], bodies: readonly Body[],
  dt: number, time: number, step: number): TrapOutcome {
  const damage: TrapOutcome['damage'] = [];
  const triggered: TrapOutcome['triggered'] = [];
  const next = states.map((state, i) => {
    const trap = traps[i];
    if (trap.kind === 'blade') {
      const blade = bladeRect(trap, time);
      const hits = { ...state.hits };
      for (const body of bodies) {
        if (body.careful || !bodyOverlaps(body, blade) || step - (hits[body.id] ?? -Infinity) < BLADE_HIT_COOLDOWN * 60) continue;
        hits[body.id] = step;
        damage.push({ body: body.id, amount: TRAP_DAMAGE.blade, cause: 'blade', lethal: false });
      }
      return { ...state, hits };
    }
    const timing = TRAP_TIMING[trap.kind];
    let { phase, seconds } = state;
    let hits = state.hits;
    // Time already spent active before this step (−1 if it only becomes active now).
    const before = state.phase === 'active' ? state.seconds : -1;
    seconds += dt;
    if (phase === 'armed') {
      const by = bodies.find((body) => !body.careful && trap.plate && bodyOverlaps(body, trap.plate));
      if (!by) return { ...state, seconds: 0 };
      triggered.push({ trap, by: by.id });
      return { ...state, phase: 'warning' as const, seconds: 0, hits: {} };
    }
    if (phase === 'warning' && seconds >= timing.warning) { phase = 'active'; seconds = 0; hits = {}; }
    const activeFor = trap.kind === 'boulder' ? boulderRollSeconds(trap) : timing.active;
    if (phase === 'active') {
      hits = { ...hits };
      for (const body of bodies) {
        if (trap.kind === 'boulder') {
          const at = boulderPosition(trap, { ...state, phase, seconds });
          if (at && circleTouches(body, at, BOULDER_RADIUS) && !hits[body.id]) { hits[body.id] = 1; damage.push({ body: body.id, amount: Infinity, cause: 'boulder', lethal: true }); }
        } else if (trap.kind === 'pit') {
          // Falling needs the body's centre over the hole, not just an edge.
          const z = trap.zone;
          if (body.x > z.minX && body.x < z.maxX && body.z > z.minZ && body.z < z.maxZ && !hits[body.id]) {
            hits[body.id] = 1; damage.push({ body: body.id, amount: Infinity, cause: 'pit', lethal: true });
          }
        } else if (trap.kind === 'darts') {
          // Each volley fires once, on the step whose active time first reaches it.
          const volleys = DART_VOLLEY_SECONDS.filter((at) => before < at - 1e-9 && seconds >= at - 1e-9).length;
          if (volleys && bodyOverlaps(body, trap.zone)) damage.push({ body: body.id, amount: TRAP_DAMAGE.dart * volleys, cause: 'darts', lethal: false });
        } else if (bodyOverlaps(body, trap.zone) && !hits[body.id]) {
          hits[body.id] = 1;
          damage.push({ body: body.id, amount: TRAP_DAMAGE[trap.kind as 'spears' | 'floorSpikes'], cause: trap.kind, lethal: false });
        }
      }
      if (seconds >= activeFor) { phase = 'cooldown'; seconds = 0; }
    } else if (phase === 'cooldown' && seconds >= timing.cooldown) { phase = 'armed'; seconds = 0; hits = {}; }
    return { ...state, phase, seconds, hits };
  });
  return { states: next, damage, triggered };
}
