import { describe, expect, it } from 'vitest';
import { cellPosition, edgeId, gateEdges, gateRect } from '../src/simulation/maze';
import { generateMaze } from '../src/simulation/mazeGenerator';
import { buildGeneratedWorld, createGeneratedRun, fireCrossbow, stepGeneratedRun } from '../src/game/generatedRun';
import type { GeneratedRun, GeneratedWorld } from '../src/game/generatedRun';
import { hurtMonster, lineClear, monsterLinks, monsterRoute, newBolt, spawnMonsters, stepBolts, stepMonsters } from '../src/game/monsters';
import type { Monster, MonsterContext } from '../src/game/monsters';
import { ALL_RULES_ON } from '../src/game/pressure';
import { createRunReport, parseRunReport, reproduceRun } from '../src/game/runReport';
import { BOLT_RANGE, CROSSBOW_BOLTS, MONSTERS_PER_RING, MONSTER_STATS, WARDEN_RESPAWN_SECONDS } from '../src/game/tuning';

const DT = 1 / 60;
const STILL = { forward: 0, strafe: 0 };
const NO_TRAPS = { ...ALL_RULES_ON, traps: false };
const worldFor = (seed: number) => buildGeneratedWorld(generateMaze(seed));
const pos = (world: GeneratedWorld, id: string) => cellPosition(world.maze.cells.find((cell) => cell.id === id)!, world.maze);

// Two neighbouring non-Sanctuary cells joined by a static corridor (or, with `joined` false,
// separated by solid stone), away from traps.
function pair(world: GeneratedWorld, joined: boolean) {
  const { maze } = world;
  const trapCells = new Set(world.traps.flatMap((trap) => [trap.cell, ...(trap.edge ? trap.edge.split('--') : [])]));
  for (const a of maze.cells) for (const b of maze.cells) {
    if (b.column !== a.column + 1 || b.row !== a.row) continue;
    if ([a, b].some((cell) => maze.rings[cell.id] === 'sanctuary' || trapCells.has(cell.id))) continue;
    const edge = maze.edges.find((item) => item.id === edgeId(a.id, b.id));
    if (joined ? edge && !edge.gate : !edge) return { a: a.id, b: b.id };
  }
  throw new Error('no pair');
}
const make = (world: GeneratedWorld, kind: Monster['kind'], cell: string, patch: Partial<Monster> = {}): Monster =>
  ({ ...spawnMonsters(world.maze, world.relic.cell, world.traps)[0], id: 'mx', kind, home: ['outer'], at: cell,
    ...pos(world, cell), health: MONSTER_STATS[kind].health, mode: 'patrol', path: [], goal: null, wait: 0, ...patch });
const context = (world: GeneratedWorld, player: { x: number; z: number }, patch: Partial<MonsterContext> = {}): MonsterContext => ({
  maze: world.maze, solids: world.solids, plaza: world.plaza, before: world.maze.initialOpenness, openness: world.maze.initialOpenness,
  player: { ...player, alive: true, safe: false }, noises: [], night: false, dt: DT, ...patch });
// A run with only the given monster, out on an expedition.
function soloMonsterRun(world: GeneratedWorld, monster: Monster, patch: Partial<GeneratedRun> = {}): GeneratedRun {
  return { ...createGeneratedRun(world, NO_TRAPS), status: 'out', monsters: [monster], ...patch };
}
function steps(world: GeneratedWorld, run: GeneratedRun, count: number, yaw = 0) {
  for (let i = 0; i < count; i++) run = stepGeneratedRun(world, run, STILL, yaw, DT);
  return run;
}

describe('M10 monster placement', () => {
  it('is seeded, keeps out of Sanctuary, entrances, the relic room and trap rooms, one per cell', () => {
    const per = (ring: 'inner' | 'middle' | 'outer') => MONSTERS_PER_RING[ring].husk + MONSTERS_PER_RING[ring].skitter;
    for (let seed = 1; seed <= 200; seed++) {
      const world = worldFor(seed);
      const { maze } = world;
      expect(spawnMonsters(maze, world.relic.cell, world.traps)).toEqual(world.monsters);
      const entrance = new Set(maze.entrances.flatMap((id) => id.split('--')));
      const trapRooms = new Set(world.traps.filter((trap) => trap.edge === null).map((trap) => trap.cell));
      const cells = world.monsters.map((monster) => monster.at);
      expect(new Set(cells).size).toBe(cells.length);
      for (const monster of world.monsters) {
        expect(maze.rings[monster.at]).not.toBe('sanctuary');
        expect(entrance.has(monster.at) || trapRooms.has(monster.at) || monster.at === world.relic.cell).toBe(false);
      }
      for (const ring of ['inner', 'middle', 'outer'] as const) {
        expect(world.monsters.filter((monster) => monster.kind !== 'warden' && maze.rings[monster.at] === ring)).toHaveLength(per(ring));
      }
      const wardens = world.monsters.filter((monster) => monster.kind === 'warden');
      expect(wardens).toHaveLength(1);
      expect(maze.rings[wardens[0].at]).toBe('outer');
    }
  }, 30_000);
});

describe('M10 monster behaviour', () => {
  const world = worldFor(20261112);

  it('patrols deterministically, never enters Sanctuary or stone', () => {
    const run = { ...createGeneratedRun(world, NO_TRAPS), status: 'out' as const };
    const a = steps(world, run, 60 * 40), b = steps(world, run, 60 * 40);
    expect(a.monsters).toEqual(b.monsters);
    expect(a.monsterRng).toBe(b.monsterRng);
    expect(a.monsters.filter((monster, i) => Math.hypot(monster.x - run.monsters[i].x, monster.z - run.monsters[i].z) > 4).length).toBeGreaterThan(5);
    for (const monster of a.monsters) {
      const half = MONSTER_STATS[monster.kind].half - 0.01;
      const inside = (r: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
        monster.x + half > r.minX && monster.x - half < r.maxX && monster.z + half > r.minZ && monster.z - half < r.maxZ;
      expect(inside(world.plaza)).toBe(false);
      expect(world.solids.some(inside)).toBe(false);
    }
  });

  it('sees along a clear corridor and chases; stone blocks the view', () => {
    const open = pair(world, true);
    const husk = make(world, 'husk', open.a);
    const out = stepMonsters([husk], 1, context(world, pos(world, open.b)));
    expect(out.monsters[0].mode).toBe('chase');
    expect(out.sounds.map((sound) => sound.kind)).toContain('growl');
    const shut = pair(world, false);
    const blind = stepMonsters([make(world, 'husk', shut.a)], 1, context(world, pos(world, shut.b)));
    expect(blind.monsters[0].mode).not.toBe('chase');
    expect(lineClear(pos(world, shut.a), pos(world, shut.b), world.solids)).toBe(false);
  });

  it('a player in Sanctuary is not seen', () => {
    const open = pair(world, true);
    const out = stepMonsters([make(world, 'husk', open.a)], 1, context(world, pos(world, open.b), { player: { ...pos(world, open.b), alive: true, safe: true } }));
    expect(out.monsters[0].mode).toBe('patrol');
  });

  it('hears a noise through stone and walks to it', () => {
    const shut = pair(world, false);
    const out = stepMonsters([make(world, 'husk', shut.a)], 1, context(world, { x: 999, z: 999 }, { noises: [pos(world, shut.b)] }));
    expect(out.monsters[0].mode).toBe('investigate');
    expect(out.monsters[0].goal).toBe(shut.b);
    expect(out.monsters[0].path.at(-1)).toBe(shut.b);
  });

  it('catches and hits the player, who can die to it', () => {
    const open = pair(world, true);
    let run = soloMonsterRun(world, make(world, 'skitter', open.a), { player: { ...pos(world, open.b), yaw: 0 } });
    run = steps(world, run, 60 * 5);
    expect(run.health).toBeLessThan(100);
    expect(run.events.some((event) => event.kind === 'hurt' && event.detail.startsWith('skitter'))).toBe(true);
    run = steps(world, run, 60 * 60);
    expect(run.status).toBe('failed');
    expect(run.killedBy).toBe('skitter');
  });

  it('routes avoid closed gates and Sanctuary', () => {
    const links = monsterLinks(world.maze, world.maze.initialOpenness);
    for (const cell of world.maze.cells) expect(links.has(cell.id)).toBe(world.maze.rings[cell.id] !== 'sanctuary');
    const closed = gateEdges(world.maze).find((edge) => world.maze.initialOpenness[edge.gate!] === 0)!;
    expect(links.get(closed.a)?.some((link) => link.cell === closed.b) ?? false).toBe(false);
    const route = monsterRoute(links, world.monsters[0].at, world.monsters[1].at)!;
    expect(route[0]).toBe(world.monsters[0].at);
    expect(route.every((id) => world.maze.rings[id] !== 'sanctuary')).toBe(true);
  });
});

describe('M10 damage and M11 crossbow', () => {
  const world = worldFor(20261112);
  const open = pair(world, true);
  const shoot = (monster: Monster, count: number) => {
    let monsters = [monster];
    const from = pos(world, open.b), to = pos(world, open.a);
    const yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z));
    for (let n = 0; n < count; n++) {
      let bolts = [newBolt(n + 1, from.x, from.z, yaw)];
      for (let i = 0; i < 120 && bolts.length; i++) ({ bolts, monsters } = stepBolts(bolts, monsters, world.solids, DT, true));
    }
    return monsters[0];
  };

  it('one bolt kills a skitter, a husk takes three, a warden is only staggered', () => {
    expect(shoot(make(world, 'skitter', open.a), 1).mode).toBe('dead');
    expect(shoot(make(world, 'husk', open.a), 2).mode).not.toBe('dead');
    const husk = shoot(make(world, 'husk', open.a), 3);
    expect(husk.mode).toBe('dead');
    expect(husk.cause).toBe('bolt');
    const warden = shoot(make(world, 'warden', open.a), 5);
    expect(warden.mode).not.toBe('dead');
    expect(warden.stun).toBeGreaterThan(0);
  });

  it('bolts stop at stone and fly at most their range', () => {
    const shut = pair(world, false);
    const from = pos(world, shut.a), to = pos(world, shut.b);
    const yaw = Math.atan2(-(to.x - from.x), -(to.z - from.z));
    const target = make(world, 'skitter', shut.b);
    let state = { bolts: [newBolt(1, from.x, from.z, yaw)], monsters: [target], impacts: [] as unknown[] };
    for (let i = 0; i < 120 && state.bolts.length; i++) state = stepBolts(state.bolts, state.monsters, world.solids, DT, true);
    expect(state.monsters[0].mode).not.toBe('dead');
    let free = [newBolt(1, 0, 0, 0)];
    let flown = 0;
    for (let i = 0; i < 600 && free.length; i++) { free = stepBolts(free, [], [], DT, true).bolts; flown = free[0]?.travelled ?? flown; }
    expect(free).toHaveLength(0);
    expect(flown).toBeLessThanOrEqual(BOLT_RANGE);
  });

  it('fires from the run with limited bolts, a reload and a shot noise', () => {
    let run: GeneratedRun = { ...createGeneratedRun(world, NO_TRAPS), status: 'out' };
    run = fireCrossbow(run);
    expect(run.boltsLeft).toBe(CROSSBOW_BOLTS - 1);
    expect(run.noise).toHaveLength(1);
    expect(fireCrossbow(run)).toBe(run); // reloading
    run = steps(world, { ...run, monsters: [] }, 60);
    for (let n = 0; n < CROSSBOW_BOLTS + 3; n++) run = steps(world, fireCrossbow(run), 60);
    expect(run.boltsLeft).toBe(0);
  });

  it('wardens die only to boulders, pits and gates, then return far from the player', () => {
    const warden = make(world, 'warden', open.a);
    for (const cause of ['spears', 'floorSpikes', 'darts', 'blade', 'bolt']) expect(hurtMonster(warden, 999, false, cause).monster.mode).not.toBe('dead');
    for (const cause of ['boulder', 'pit', 'gate']) expect(hurtMonster(warden, Infinity, true, cause).monster.mode).toBe('dead');
    let run = soloMonsterRun(world, { ...hurtMonster(warden, Infinity, true, 'pit').monster }, { player: { x: 0, z: 0, yaw: 0 } });
    run = steps(world, run, Math.round(WARDEN_RESPAWN_SECONDS * 60) + 2);
    const back = run.monsters[0];
    expect(back.mode).not.toBe('dead');
    expect(world.maze.rings[back.at]).toBe('outer');
    expect(Math.hypot(back.x, back.z)).toBeGreaterThan(40);
  });

  it('a monster sets off a plate, and a pit kills a warden standing over it', () => {
    const pit = world.traps.find((trap) => trap.kind === 'pit')!;
    const centre = { x: (pit.plate!.minX + pit.plate!.maxX) / 2, z: (pit.plate!.minZ + pit.plate!.maxZ) / 2 };
    const warden: Monster = { ...make(world, 'warden', pit.cell), ...centre, mode: 'investigate', wait: 10 };
    let run = soloMonsterRun(world, warden, { rules: ALL_RULES_ON, player: { x: 0, z: 0, yaw: 0 } });
    run = steps(world, run, 2);
    expect(run.events.some((event) => event.kind === 'trap' && event.detail.includes('triggered by mx'))).toBe(true);
    run = steps(world, run, 60);
    expect(run.monsters[0].mode).toBe('dead');
    expect(run.monsters[0].cause).toBe('pit');
    expect(run.events.some((event) => event.detail.includes('warden killed by pit'))).toBe(true);
  });

  it('a closing gate crushes a monster in its path', () => {
    const edge = gateEdges(world.maze).find((item) => world.maze.initialOpenness[item.gate!] === 1)!;
    const before = { ...world.maze.initialOpenness };
    const after = { ...before, [edge.gate!]: 0.5 };
    const slab = gateRect(world.maze, edge, 0.5);
    const at = { x: (slab.minX + slab.maxX) / 2, z: (slab.minZ + slab.maxZ) / 2 };
    const out = stepMonsters([{ ...make(world, 'warden', edge.a), ...at }], 1, context(world, { x: 999, z: 999 }, { before, openness: after }));
    expect(out.monsters[0].mode).toBe('dead');
    expect(out.monsters[0].cause).toBe('gate');
  });

  it('patrolling monsters step around plates; left alone they survive the maze', () => {
    const pit = world.traps.find((trap) => trap.kind === 'pit')!;
    const centre = { x: (pit.plate!.minX + pit.plate!.maxX) / 2, z: (pit.plate!.minZ + pit.plate!.maxZ) / 2 };
    let run = soloMonsterRun(world, { ...make(world, 'husk', pit.cell), ...centre, wait: 2 }, { rules: ALL_RULES_ON, player: { x: 0, z: 0, yaw: 0 } });
    run = steps(world, run, 60);
    expect(run.events.some((event) => event.kind === 'trap')).toBe(false);
    let all: GeneratedRun = { ...createGeneratedRun(world), status: 'out' };
    all = steps(world, all, 60 * 300);
    expect(all.monsters.filter((monster) => monster.mode === 'dead').map((m) => m.cause)).toEqual([]);
  }, 30_000);

  it('with monsters switched off nothing moves or attacks', () => {
    const open2 = pair(world, true);
    let run = soloMonsterRun(world, make(world, 'skitter', open2.a), { rules: { ...NO_TRAPS, monsters: false }, player: { ...pos(world, open2.b), yaw: 0 } });
    const start = run.monsters[0];
    run = steps(world, run, 60 * 5);
    expect(run.monsters[0]).toEqual(start);
    expect(run.health).toBe(100);
  });

  it('reports carry monsters, bolts and the RNG, and reproduce the same next steps', () => {
    let run: GeneratedRun = { ...createGeneratedRun(world, NO_TRAPS), status: 'out' };
    run = steps(world, fireCrossbow(run), 60 * 12);
    const parsed = parseRunReport(JSON.stringify(createRunReport(world, run)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { run: again } = reproduceRun(world, parsed.report);
    expect(again.monsters).toEqual(run.monsters);
    expect(again.boltsLeft).toBe(run.boltsLeft);
    expect(steps(world, again, 120).monsters).toEqual(steps(world, run, 120).monsters);
  });
});
