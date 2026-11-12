import { describe, expect, it } from 'vitest';
import { cellPosition, edgeId } from '../src/simulation/maze';
import { generateMaze } from '../src/simulation/mazeGenerator';
import { buildGeneratedWorld, createGeneratedRun, setBlocking, stepGeneratedRun } from '../src/game/generatedRun';
import type { GeneratedRun, GeneratedWorld } from '../src/game/generatedRun';
import { hurtMonster, stepMonsters } from '../src/game/monsters';
import type { Monster, MonsterContext } from '../src/game/monsters';
import { interactGeneratedRun } from '../src/game/looting';
import { itemDef } from '../src/game/items';
import { ALL_RULES_ON } from '../src/game/pressure';
import { createRunReport, parseRunReport, reproduceRun } from '../src/game/runReport';
import { MIMIC, MONSTER_STATS, RAM, ticks } from '../src/game/tuning';

const DT = 1 / 60;
const NO_TRAPS = { ...ALL_RULES_ON, traps: false };
const world = buildGeneratedWorld(generateMaze(41));
// Three cells in a row joined by static corridors (24 m straight), away from Sanctuary and traps.
function straight(w: GeneratedWorld) {
  const { maze } = w;
  const trapCells = new Set(w.traps.flatMap((t) => [t.cell, ...(t.edge ? t.edge.split('--') : [])]));
  const at = (c: number, r: number) => maze.cells.find((cell) => cell.column === c && cell.row === r);
  const linked = (a: { id: string }, b: { id: string }) => maze.edges.some((e) => e.id === edgeId(a.id, b.id) && !e.gate);
  for (const a of maze.cells) {
    const b = at(a.column + 1, a.row), c = at(a.column + 2, a.row);
    if (!b || !c || [a, b, c].some((x) => maze.rings[x.id] === 'sanctuary' || trapCells.has(x.id))) continue;
    if (linked(a, b) && linked(b, c)) return [a, b, c].map((cell) => ({ id: cell.id, ...cellPosition(cell, maze) }));
  }
  throw new Error('no straight run');
}
const line = straight(world);
const base = (kind: Monster['kind'], patch: Partial<Monster> = {}): Monster => {
  const template = world.monsters.find((m) => m.kind === kind)!;
  return { ...template, id: 'mx', x: line[0].x, z: line[0].z, at: line[0].id, mode: 'patrol', path: [], goal: null, wait: 99, stun: 0, cooldown: 0, windup: 0, charge: null, ...patch };
};
const ctx = (player: { x: number; z: number }, patch: Partial<MonsterContext> = {}): MonsterContext => ({
  maze: world.maze, solids: world.solids, plaza: world.plaza, before: world.maze.initialOpenness, openness: world.maze.initialOpenness,
  player: { ...player, alive: true, safe: false }, noises: [], night: false, dt: DT, ...patch });
const runWith = (monster: Monster, player: { x: number; z: number; yaw?: number }, patch: Partial<GeneratedRun> = {}): GeneratedRun =>
  ({ ...createGeneratedRun(world, NO_TRAPS), status: 'out', leftSanctuary: true, monsters: [monster], player: { yaw: 0, ...player }, ...patch });
const steps = (run: GeneratedRun, n: number, yaw = 0) => { for (let i = 0; i < n; i++) run = stepGeneratedRun(world, run, { forward: 0, strafe: 0 }, yaw, DT); return run; };
const along = (metres: number) => ({ x: line[0].x + metres, z: line[0].z });

describe('M17 spitter', () => {
  it('backs off when close, spits with a clear line at most every 2.5 s', () => {
    let m = base('spitter', { mode: 'chase' });
    let out = stepMonsters([m], 1, ctx(along(3)));
    expect(out.monsters[0].x).toBeLessThan(m.x);
    expect(out.spits).toHaveLength(1);
    m = { ...out.monsters[0] };
    for (let i = 0; i < ticks(2.4); i++) { out = stepMonsters([m], 1, ctx(along(8))); m = out.monsters[0]; expect(out.spits).toHaveLength(0); }
    for (let i = 0; i < ticks(0.2) && !out.spits.length; i++) { out = stepMonsters([m], 1, ctx(along(8))); m = out.monsters[0]; }
    expect(out.spits).toHaveLength(1);
  });

  it('a glob hits for 15, stops at stone, and a raised shield blocks most of it from the front', () => {
    let run = steps(runWith(base('spitter', { mode: 'chase' }), along(8)), ticks(1.5));
    expect(100 - run.health).toBe(MONSTER_STATS.spitter.damage);
    expect(run.events.some((e) => e.detail.startsWith('spitter -15'))).toBe(true);
    // Facing the spitter (−x is yaw π/2) with a heater shield up.
    const shield = { offHand: { uid: 's', item: 'heaterShield', x: 0, y: 0, rotated: false, roll: { rarity: 'common' as const, bonuses: [] } } };
    run = setBlocking(runWith(base('spitter', { mode: 'chase' }), along(8), { equipment: shield, player: { ...along(8), yaw: Math.PI / 2 } }), true);
    for (let i = 0; i < ticks(1.5); i++) run = setBlocking(stepGeneratedRun(world, run, { forward: 0, strafe: 0 }, Math.PI / 2, DT), true);
    expect(100 - run.health).toBe(Math.round(Math.round(15 * (100 / 120)) * 0.25));
  });
});

describe('M17 brute', () => {
  it('takes 30 % less damage, winds up for 0.8 s, and misses if you step out of reach', () => {
    expect(hurtMonster(base('brute'), 50, false, 'melee').monster.health).toBe(MONSTER_STATS.brute.health - 35);
    let run = runWith(base('brute', { mode: 'chase' }), along(1.2));
    run = steps(run, ticks(0.5));
    expect(run.monsters[0].windup).toBeGreaterThan(0);
    expect(run.health).toBe(100);
    run = steps(run, ticks(0.5));
    expect(run.health).toBe(100 - MONSTER_STATS.brute.damage);
    let dodge = steps(runWith(base('brute', { mode: 'chase' }), along(1.2)), ticks(0.4));
    dodge = { ...dodge, player: { ...dodge.player, ...along(6) } };
    dodge = steps(dodge, ticks(0.5));
    expect(dodge.health).toBe(100);
  });

  it('drops a rare-or-better gear piece', () => {
    const run = steps(runWith(base('brute', { health: 1, mode: 'patrol' }), along(20)), 1);
    const killed = hurtMonster(run.monsters[0], 999, true, 'pit');
    expect(killed.hit.killed).toBe(true);
    const pit = world.traps.find((t) => t.kind === 'pit')!;
    const centre = { x: (pit.zone.minX + pit.zone.maxX) / 2, z: (pit.zone.minZ + pit.zone.maxZ) / 2 };
    let dead = runWith(base('brute', { ...centre, mode: 'investigate', wait: 9 }), { x: 999, z: 999 }, { rules: ALL_RULES_ON,
      traps: world.traps.map((t) => ({ id: t.id, phase: t.id === pit.id ? 'active' as const : 'armed' as const, seconds: 0, hits: {} })) });
    dead = steps(dead, 2);
    const remains = dead.containers.find((c) => c.kind === 'remains')!;
    const gear = remains.items.filter((i) => itemDef(i.item).gear);
    expect(gear.length).toBeGreaterThanOrEqual(1);
    expect(['rare', 'epic']).toContain(gear[0].roll?.rarity);
  });
});

describe('M17 mimic', () => {
  it('opening it bites, removes the chest, and the mimic carries its loot until killed', () => {
    const mimic = world.monsters.find((m) => m.kind === 'mimic')!;
    const chest = world.containers.find((c) => c.id === mimic.container)!;
    let run: GeneratedRun = { ...createGeneratedRun(world, NO_TRAPS), status: 'out', leftSanctuary: true, player: { x: chest.x + 1, z: chest.z, yaw: 0 } };
    const items = run.containers.find((c) => c.id === chest.id)!.items;
    run = interactGeneratedRun(run);
    expect(run.health).toBe(100 - MIMIC.bite);
    expect(run.openContainer).toBeNull();
    expect(run.containers.some((c) => c.id === chest.id)).toBe(false);
    const awake = run.monsters.find((m) => m.id === mimic.id)!;
    expect(awake).toMatchObject({ mode: 'chase', loot: items });
    // With monsters off it is just a chest.
    const off: GeneratedRun = { ...createGeneratedRun(world, { ...NO_TRAPS, monsters: false }), status: 'out', leftSanctuary: true, player: { x: chest.x + 1, z: chest.z, yaw: 0 } };
    expect(interactGeneratedRun(off).openContainer).toBe(chest.id);
  });
});

describe('M17 the Ram', () => {
  it('lowers its head for 1 s, then charges in a line; hitting the player costs 50 and shoves', () => {
    let m = base('ram', { mode: 'chase' });
    let out = stepMonsters([m], 1, ctx(along(12)));
    expect(out.monsters[0].windup).toBe(RAM.windup);
    expect(out.sounds.map((s) => s.kind)).toContain('ramBellow');
    let run = runWith(base('ram', { mode: 'chase' }), along(12));
    run = steps(run, ticks(1) + 2);
    expect(run.monsters[0].charge).toBeTruthy();
    const before = run.player.x;
    run = steps(run, ticks(1.5));
    expect(run.health).toBe(100 - MONSTER_STATS.ram.damage);
    expect(run.player.x).toBeGreaterThan(before + 1);
    void out; void m;
  });

  it('charging into stone stuns it for 4 s; stunned it takes double damage, otherwise a fifth', () => {
    // Charge out of the room centre towards a side with no corridor: stone 2 m away.
    const room = world.maze.cells.find((c) => c.id === line[0].id)!;
    const side = [[0, -1], [0, 1], [-1, 0]].find(([dc, dr]) => {
      const other = world.maze.cells.find((c) => c.column === room.column + dc && c.row === room.row + dr);
      return !other || !world.maze.edges.some((e) => e.id === edgeId(room.id, other.id));
    })!;
    let found = runWith(base('ram', { mode: 'chase', charge: { dx: side[0], dz: side[1], travelled: 0 } }), along(20));
    for (let i = 0; i < ticks(1) && !found.monsters[0].stun; i++) found = steps(found, 1);
    expect(found.monsters[0].stun).toBeGreaterThan(3.9);
    expect(found.events.some((e) => e.detail.includes('ram hit stone'))).toBe(true);
    const stunned = base('ram', { stun: 3 });
    expect(hurtMonster(stunned, 40, false, 'melee').monster.health).toBe(MONSTER_STATS.ram.health - 80);
    expect(hurtMonster(base('ram'), 40, false, 'melee').monster.health).toBe(MONSTER_STATS.ram.health - 8);
    expect(hurtMonster(base('ram'), Infinity, true, 'pit').monster.mode).toBe('dead');
  });

  it('killed, it leaves an epic or legendary piece and two valuables, and never returns', () => {
    const pit = world.traps.find((t) => t.kind === 'pit')!;
    const centre = { x: (pit.zone.minX + pit.zone.maxX) / 2, z: (pit.zone.minZ + pit.zone.maxZ) / 2 };
    let run = runWith(base('ram', { ...centre, mode: 'investigate', wait: 9 }), { x: 999, z: 999 }, { rules: ALL_RULES_ON,
      traps: world.traps.map((t) => ({ id: t.id, phase: t.id === pit.id ? 'active' as const : 'armed' as const, seconds: 0, hits: {} })) });
    run = steps(run, 2);
    expect(run.monsters[0].mode).toBe('dead');
    const remains = run.containers.find((c) => c.kind === 'remains')!;
    const gear = remains.items.filter((i) => itemDef(i.item).gear);
    expect(gear).toHaveLength(1);
    expect(['epic', 'legendary']).toContain(gear[0].roll?.rarity);
    expect(remains.items.filter((i) => ['valuable', 'relic'].includes(itemDef(i.item).category))).toHaveLength(2);
    expect(steps(run, ticks(60)).monsters[0].mode).toBe('dead');
  });
});

describe('M17 reports', () => {
  it('carry globs and the new monster states', () => {
    let run = steps(runWith(base('spitter', { mode: 'chase' }), along(8)), 10);
    const parsed = parseRunReport(JSON.stringify(createRunReport(world, run)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const copy = reproduceRun(world, parsed.report).run;
    expect(copy.globs).toEqual(run.globs);
    expect(copy.monsters).toEqual(run.monsters);
    run = steps(run, 30);
    expect(steps(copy, 30).health).toBe(run.health);
  });
});
