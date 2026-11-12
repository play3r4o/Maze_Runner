// M10 monsters (widened at the developer's request). Husks (slow, tough) and skitters (fast,
// fragile) can be killed with the crossbow or by traps. The warden cannot be hurt: bolts only
// stagger it, and it dies only to a rolling boulder, an opening pit or a closing gate, then
// returns after a delay. Monsters patrol their ring, investigate noises, chase on sight and
// never enter Sanctuary. Pure rules: positions, a cell graph and an explicit RNG state.
import { cellPosition, gateEdges, gateRect } from '../simulation/maze';
import type { MazeOpenness } from '../simulation/maze';
import { openMazeEdges } from '../simulation/mazeGraph';
import { createRng } from '../simulation/mazeGenerator';
import type { GeneratedMaze, Ring } from '../simulation/mazeGenerator';
import type { WallRect } from '../simulation/player';
import { PLAYER_HALF_WIDTH } from '../simulation/player';
import { BOLT_DAMAGE, BOLT_RANGE, BOLT_SPEED, MONSTERS_PER_RING, MONSTER_HEARING, MONSTER_REACH, MONSTER_SEARCH_WAIT,
  MONSTER_SIGHT, MONSTER_STATS, NIGHT_MONSTER_SPEED, WARDEN_BOLT_STUN, WARDEN_COUNT, WARDEN_RESPAWN_SECONDS,
  WARDEN_STEP_SECONDS, WARDEN_TRAP_STUN } from './tuning';
import type { Point2, TrapSpec } from './traps';

export type MonsterKind = 'husk' | 'skitter' | 'warden';
export type MonsterMode = 'patrol' | 'investigate' | 'chase' | 'search' | 'dead';
type HomeRing = Exclude<Ring, 'sanctuary'>;
export type Monster = {
  id: string; kind: MonsterKind; home: HomeRing[];
  x: number; z: number; yaw: number; health: number; mode: MonsterMode;
  // Cell last reached, cells still to walk to, and where the walk ends.
  at: string; path: string[]; goal: string | null;
  lastSeen: Point2 | null;
  // Seconds: waiting at a goal, staggered, until the next hit, until the next footstep.
  wait: number; stun: number; cooldown: number; stepTimer: number;
  // Warden only: seconds until it returns (0 while alive). Cause of the last death.
  respawn: number; cause: string | null;
};
// A noise monsters may hear; without a radius it carries the default hearing distance.
export type Noise = Point2 & { radius?: number };
export type Bolt = { id: number; x: number; z: number; dx: number; dz: number; travelled: number };
export const isUnkillable = (kind: MonsterKind) => kind === 'warden';
// What kills a warden.
export const WARDEN_KILLERS = new Set(['boulder', 'pit', 'gate']);

// --- Geometry helpers -------------------------------------------------------------------
type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
// Earliest t in [0, 1] where the segment p → p + d enters `r` grown by `grow`, or null.
export function segmentHit(px: number, pz: number, dx: number, dz: number, r: Rect, grow = 0): number | null {
  let t0 = 0, t1 = 1;
  for (const [p, d, min, max] of [[px, dx, r.minX - grow, r.maxX + grow], [pz, dz, r.minZ - grow, r.maxZ + grow]]) {
    if (Math.abs(d) < 1e-12) { if (p <= min || p >= max) return null; continue; }
    let a = (min - p) / d, b = (max - p) / d;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a); t1 = Math.min(t1, b);
    if (t0 > t1) return null;
  }
  return t0;
}
export const lineClear = (a: Point2, b: Point2, solids: readonly Rect[]) =>
  solids.every((rect) => segmentHit(a.x, a.z, b.x - a.x, b.z - a.z, rect) === null);
// Swept axis-separated movement for a square body of half-width `half` (as for the player).
export function moveBody(x: number, z: number, half: number, dx: number, dz: number, solids: readonly Rect[]) {
  let nx = x + dx;
  for (const w of solids) {
    if (z <= w.minZ - half || z >= w.maxZ + half) continue;
    if (dx > 0 && x <= w.minX - half && nx > w.minX - half) nx = w.minX - half;
    if (dx < 0 && x >= w.maxX + half && nx < w.maxX + half) nx = w.maxX + half;
  }
  let nz = z + dz;
  for (const w of solids) {
    if (nx <= w.minX - half || nx >= w.maxX + half) continue;
    if (dz > 0 && z <= w.minZ - half && nz > w.minZ - half) nz = w.minZ - half;
    if (dz < 0 && z >= w.maxZ + half && nz < w.maxZ + half) nz = w.maxZ + half;
  }
  return { x: nx, z: nz };
}
const overlaps = (x: number, z: number, half: number, r: Rect) => x + half > r.minX && x - half < r.maxX && z + half > r.minZ && z - half < r.maxZ;

// Nearest cell centre to a point (cells sit on a 12 m grid centred on the origin).
export function nearestCell(maze: GeneratedMaze, x: number, z: number): string {
  let best = maze.cells[0], bestD = Infinity;
  for (const cell of maze.cells) {
    const p = cellPosition(cell, maze), d = (p.x - x) ** 2 + (p.z - z) ** 2;
    if (d < bestD) { best = cell; bestD = d; }
  }
  return best.id;
}

// Breadth-first route over open corridors, never through Sanctuary cells. Includes `from`.
type Links = Map<string, { cell: string; gate?: string }[]>;
export function monsterLinks(maze: GeneratedMaze, openness: MazeOpenness): Links {
  const links: Links = new Map(maze.cells.filter((cell) => maze.rings[cell.id] !== 'sanctuary').map((cell) => [cell.id, []]));
  for (const edge of openMazeEdges(maze, openness)) {
    if (!links.has(edge.a) || !links.has(edge.b)) continue;
    links.get(edge.a)!.push({ cell: edge.b, gate: edge.gate });
    links.get(edge.b)!.push({ cell: edge.a, gate: edge.gate });
  }
  return links;
}
export function monsterRoute(links: Links, from: string, to: string): string[] | null {
  if (!links.has(from) || !links.has(to)) return null;
  const back = new Map<string, string>([[from, '']]);
  const queue = [from];
  for (let i = 0; i < queue.length && !back.has(to); i++) for (const next of links.get(queue[i])!) {
    if (!back.has(next.cell)) { back.set(next.cell, queue[i]); queue.push(next.cell); }
  }
  if (!back.has(to)) return null;
  const route = [to];
  while (route[0] !== from) route.unshift(back.get(route[0])!);
  return route;
}

// --- Explicit RNG state, so reports carry it --------------------------------------------
export function nextRandom(state: number): [number, number] {
  const s = (state + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}
export const monsterRngSeed = (maze: GeneratedMaze) => (maze.seed ^ 0x1b873593) >>> 0;

// --- Spawning ---------------------------------------------------------------------------
function freshMonster(id: string, kind: MonsterKind, home: HomeRing[], cell: string, maze: GeneratedMaze): Monster {
  const { x, z } = cellPosition(maze.cells.find((item) => item.id === cell)!, maze);
  return { id, kind, home, x, z, yaw: 0, health: MONSTER_STATS[kind].health, mode: 'patrol', at: cell, path: [], goal: null,
    lastSeen: null, wait: 0, stun: 0, cooldown: 0, stepTimer: 0, respawn: 0, cause: null };
}
// Seeded: never in Sanctuary, the cells just outside its entrances, the relic room or a room
// with a trap; one monster per cell.
export function spawnMonsters(maze: GeneratedMaze, relicCell: string, traps: readonly TrapSpec[]): Monster[] {
  const rng = createRng((maze.seed ^ 0x68e31da4) >>> 0);
  const entranceCells = new Set(maze.entrances.flatMap((id) => maze.edges.filter((edge) => edge.id === id)).flatMap((edge) => [edge.a, edge.b]));
  const used = new Set([relicCell, ...entranceCells, ...traps.filter((trap) => trap.edge === null).map((trap) => trap.cell)]);
  const monsters: Monster[] = [];
  const place = (kind: MonsterKind, ring: HomeRing, home: HomeRing[]) => {
    const options = maze.cells.filter((cell) => maze.rings[cell.id] === ring && !used.has(cell.id));
    if (!options.length) return;
    const cell = rng.pick(options);
    used.add(cell.id);
    monsters.push(freshMonster(`m${monsters.length + 1}`, kind, home, cell.id, maze));
  };
  for (const ring of ['inner', 'middle', 'outer'] as const) {
    for (const kind of ['husk', 'skitter'] as const) for (let n = 0; n < MONSTERS_PER_RING[ring][kind]; n++) place(kind, ring, [ring]);
  }
  for (let n = 0; n < WARDEN_COUNT; n++) place('warden', 'outer', ['outer', 'middle']);
  return monsters;
}

// --- Damage -----------------------------------------------------------------------------
export type MonsterHit = { monster: string; kind: MonsterKind; cause: string; killed: boolean; stunned: boolean };
// Apply damage from a bolt or a trap. Wardens are only staggered, unless the cause kills them.
export function hurtMonster(monster: Monster, amount: number, lethal: boolean, cause: string): { monster: Monster; hit: MonsterHit } {
  if (monster.mode === 'dead') return { monster, hit: { monster: monster.id, kind: monster.kind, cause, killed: false, stunned: false } };
  if (isUnkillable(monster.kind)) {
    if (WARDEN_KILLERS.has(cause)) {
      return { monster: { ...monster, mode: 'dead', path: [], goal: null, respawn: WARDEN_RESPAWN_SECONDS, cause },
        hit: { monster: monster.id, kind: monster.kind, cause, killed: true, stunned: false } };
    }
    const stun = Math.max(monster.stun, cause === 'bolt' ? WARDEN_BOLT_STUN : WARDEN_TRAP_STUN);
    return { monster: { ...monster, stun }, hit: { monster: monster.id, kind: monster.kind, cause, killed: false, stunned: true } };
  }
  const health = lethal ? 0 : Math.max(0, monster.health - amount);
  const killed = health === 0;
  return { monster: { ...monster, health, ...(killed ? { mode: 'dead' as const, path: [], goal: null, cause } : {}) },
    hit: { monster: monster.id, kind: monster.kind, cause, killed, stunned: false } };
}

// --- Bolts ------------------------------------------------------------------------------
export function newBolt(id: number, x: number, z: number, yaw: number): Bolt {
  const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
  return { id, x: x + dx * 0.4, z: z + dz * 0.4, dx, dz, travelled: 0 };
}
// Swept flight: each step the bolt stops at the first monster or stone in its path.
export function stepBolts(bolts: readonly Bolt[], monsters: readonly Monster[], solids: readonly Rect[], dt: number, targets: boolean) {
  let current = [...monsters];
  const hits: (MonsterHit & Point2)[] = [];
  const impacts: Point2[] = [];
  const flying: Bolt[] = [];
  for (const bolt of bolts) {
    const length = Math.min(BOLT_SPEED * dt, BOLT_RANGE - bolt.travelled);
    const mx = bolt.dx * length, mz = bolt.dz * length;
    let best = 1, wall = false, target = -1;
    for (const rect of solids) {
      const t = segmentHit(bolt.x, bolt.z, mx, mz, rect);
      if (t !== null && t < best) { best = t; wall = true; }
    }
    if (targets) current.forEach((monster, i) => {
      if (monster.mode === 'dead') return;
      const half = MONSTER_STATS[monster.kind].half;
      const t = segmentHit(bolt.x, bolt.z, mx, mz, { minX: monster.x - half, maxX: monster.x + half, minZ: monster.z - half, maxZ: monster.z + half });
      if (t !== null && t <= best) { best = t; target = i; wall = false; }
    });
    const x = bolt.x + mx * best, z = bolt.z + mz * best;
    if (target >= 0) {
      const outcome = hurtMonster(current[target], BOLT_DAMAGE, false, 'bolt');
      current = current.map((monster, i) => (i === target ? outcome.monster : monster));
      hits.push({ ...outcome.hit, x, z });
    } else if (wall) impacts.push({ x, z });
    else if (bolt.travelled + length < BOLT_RANGE - 1e-9) flying.push({ ...bolt, x, z, travelled: bolt.travelled + length });
  }
  return { bolts: flying, monsters: current, hits, impacts };
}

// --- Behaviour --------------------------------------------------------------------------
export type MonsterContext = {
  maze: GeneratedMaze; solids: readonly WallRect[]; plaza: Rect;
  before: MazeOpenness; openness: MazeOpenness;
  player: { x: number; z: number; alive: boolean; safe: boolean };
  noises: readonly Noise[]; night: boolean; dt: number;
};
export type MonsterSound = { kind: 'growl' | 'roar' | 'wardenStep'; x: number; z: number; monster: MonsterKind };
export type MonsterOutcome = {
  monsters: Monster[]; rng: number;
  attacks: { monster: string; kind: MonsterKind; amount: number }[];
  hits: MonsterHit[]; sounds: MonsterSound[]; notes: string[];
};

export function stepMonsters(monsters: readonly Monster[], rngState: number, ctx: MonsterContext): MonsterOutcome {
  const { maze, dt, player } = ctx;
  let rng = rngState;
  const random = () => { const [value, state] = nextRandom(rng); rng = state; return value; };
  const gateSolids = gateEdges(maze).map((edge) => gateRect(maze, edge, ctx.openness[edge.gate!]));
  const solids = [...ctx.solids, ...gateSolids];
  const links = monsterLinks(maze, ctx.openness);
  const closing = gateEdges(maze).filter((edge) => ctx.openness[edge.gate!] < ctx.before[edge.gate!]);
  const attacks: MonsterOutcome['attacks'] = [];
  const hits: MonsterHit[] = [];
  const sounds: MonsterSound[] = [];
  const notes: string[] = [];
  const cellsOf = (rings: HomeRing[]) => maze.cells.filter((cell) => rings.includes(maze.rings[cell.id] as HomeRing)).map((cell) => cell.id);

  const next = monsters.map((original) => {
    let m: Monster = { ...original, path: [...original.path] };
    const stats = MONSTER_STATS[m.kind];
    if (m.mode === 'dead') {
      if (m.kind !== 'warden' || m.respawn <= 0) return m;
      const respawn = Math.max(0, m.respawn - dt);
      if (respawn > 0) return { ...m, respawn };
      // Return in the outer room farthest from the player.
      const far = cellsOf(['outer']).map((id) => ({ id, ...cellPosition(maze.cells.find((cell) => cell.id === id)!, maze) }))
        .sort((a, b) => Math.hypot(b.x - player.x, b.z - player.z) - Math.hypot(a.x - player.x, a.z - player.z))[0];
      notes.push(`${m.id} warden returned at ${far.id}`);
      sounds.push({ kind: 'roar', x: far.x, z: far.z, monster: m.kind });
      return { ...m, x: far.x, z: far.z, at: far.id, mode: 'patrol' as const, path: [], goal: null, respawn: 0, stun: 0, wait: 0, lastSeen: null };
    }
    // A closing gate that slides into the body kills it (wardens included).
    const crusher = closing.find((edge) => overlaps(m.x, m.z, stats.half * 0.8, gateRect(maze, edge, ctx.openness[edge.gate!])));
    if (crusher) {
      const outcome = hurtMonster(m, Infinity, true, 'gate');
      hits.push(outcome.hit);
      return outcome.monster;
    }
    m.cooldown = Math.max(0, m.cooldown - dt);
    if (m.stun > 0) { m.stun = Math.max(0, m.stun - dt); return m; }

    const speed = (m.mode === 'chase' ? stats.chase : stats.patrol) * (ctx.night ? NIGHT_MONSTER_SPEED : 1);
    const distance = Math.hypot(player.x - m.x, player.z - m.z);
    const sees = player.alive && !player.safe && distance <= MONSTER_SIGHT && lineClear(m, player, solids);
    const setGoal = (goal: string | null, mode: MonsterMode) => {
      m.mode = mode; m.goal = goal; m.wait = 0;
      const from = nearestCell(maze, m.x, m.z);
      const route = goal ? monsterRoute(links, from, goal) : null;
      if (!route) { m.path = []; m.goal = null; m.wait = 1; if (mode !== 'patrol') m.mode = 'patrol'; return; }
      m.at = from;
      const start = cellPosition(maze.cells.find((cell) => cell.id === from)!, maze);
      m.path = Math.hypot(start.x - m.x, start.z - m.z) < 0.2 ? route.slice(1) : route;
    };
    if (sees) {
      if (m.mode !== 'chase') {
        sounds.push({ kind: m.kind === 'warden' ? 'roar' : 'growl', x: m.x, z: m.z, monster: m.kind });
        notes.push(`${m.id} ${m.kind} saw you`);
      }
      m.mode = 'chase'; m.lastSeen = { x: player.x, z: player.z }; m.path = []; m.goal = null;
    } else if (m.mode === 'chase') {
      setGoal(m.lastSeen ? nearestCell(maze, m.lastSeen.x, m.lastSeen.z) : null, 'search');
    } else {
      const heard = ctx.noises.find((noise) => Math.hypot(noise.x - m.x, noise.z - m.z) <= (noise.radius ?? MONSTER_HEARING));
      if (heard) setGoal(nearestCell(maze, heard.x, heard.z), 'investigate');
    }

    let target: Point2 | null = null;
    if (m.mode === 'chase') {
      const reach = stats.half + PLAYER_HALF_WIDTH + MONSTER_REACH;
      if (distance <= reach) {
        if (m.cooldown <= 0 && player.alive) { attacks.push({ monster: m.id, kind: m.kind, amount: stats.damage }); m.cooldown = stats.attackEvery; }
        m.yaw = Math.atan2(-(player.x - m.x), -(player.z - m.z)) + 0;
      } else target = player;
    } else {
      // Walk the planned route; re-plan when the next corridor has closed.
      if (m.path.length && m.path[0] !== m.at && !links.get(m.at)?.some((link) => link.cell === m.path[0])) setGoal(m.goal, m.mode);
      if (!m.path.length) {
        if (m.wait > 0) m.wait = Math.max(0, m.wait - dt);
        else if (m.mode === 'investigate' || m.mode === 'search') { m.mode = 'patrol'; m.goal = null; m.wait = MONSTER_SEARCH_WAIT; }
        else {
          const options = cellsOf(m.home).filter((id) => id !== m.at);
          setGoal(options[Math.floor(random() * options.length)] ?? null, 'patrol');
        }
      }
      if (m.path.length) target = cellPosition(maze.cells.find((cell) => cell.id === m.path[0])!, maze);
    }
    if (target) {
      const dx = target.x - m.x, dz = target.z - m.z, length = Math.hypot(dx, dz);
      const stepLength = Math.min(length, speed * dt);
      if (length > 1e-9) {
        const moved = moveBody(m.x, m.z, stats.half, (dx / length) * stepLength, (dz / length) * stepLength, solids);
        // Sanctuary is closed to monsters.
        if (!overlaps(moved.x, moved.z, stats.half, ctx.plaza)) { m.x = moved.x; m.z = moved.z; }
        m.yaw = Math.atan2(-dx, -dz) + 0; // + 0 turns -0 into 0 so reports survive JSON
        if (m.kind === 'warden') {
          m.stepTimer -= dt;
          if (m.stepTimer <= 0) { m.stepTimer = WARDEN_STEP_SECONDS; sounds.push({ kind: 'wardenStep', x: m.x, z: m.z, monster: m.kind }); }
        }
      }
      if (m.mode !== 'chase' && m.path.length && Math.hypot(target.x - m.x, target.z - m.z) < 0.2) m.at = m.path.shift()!;
    }
    return m;
  });
  return { monsters: next, rng, attacks, hits, sounds, notes };
}
