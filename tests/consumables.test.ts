import { describe, expect, it } from 'vitest';
import { cellPosition, edgeId } from '../src/simulation/maze';
import { generateMaze } from '../src/simulation/mazeGenerator';
import { buildGeneratedWorld, createGeneratedRun, stepGeneratedRun, useConsumable } from '../src/game/generatedRun';
import type { GeneratedRun } from '../src/game/generatedRun';
import { stepMonsters } from '../src/game/monsters';
import type { GridItem } from '../src/game/inventory';
import { itemDef } from '../src/game/items';
import { ALL_RULES_ON } from '../src/game/pressure';
import { createRunReport, parseRunReport, reproduceRun } from '../src/game/runReport';
import { rollStock, traderBuys } from '../src/game/traders';
import { MONSTER_SIGHT, ticks } from '../src/game/tuning';

const QUIET = { ...ALL_RULES_ON, traps: false, monsters: false };
const DT = 1 / 60;
const world = buildGeneratedWorld(generateMaze(41));
const item = (uid: string, kind: string, x: number, y: number): GridItem => ({ uid, item: kind, x, y, rotated: false });
const out = (bag: GridItem[], patch: Partial<GeneratedRun> = {}): GeneratedRun =>
  ({ ...createGeneratedRun(world, QUIET), status: 'out', leftSanctuary: true, player: { x: 999, z: 999, yaw: 0 }, bag, ...patch });
const steps = (run: GeneratedRun, count: number, intent = { forward: 0, strafe: 0 }) => {
  for (let i = 0; i < count; i++) run = stepGeneratedRun(world, run, intent, 0, DT);
  return run;
};

describe('M17 consumables', () => {
  it('a bandage takes 3 s, heals 35 up to the maximum, and is used up', () => {
    let run = useConsumable(out([item('b', 'bandage', 0, 0), item('b2', 'bandage', 1, 0)], { health: 50 }), 1);
    expect(run.using).toMatchObject({ uid: 'b', item: 'bandage', seconds: 3 });
    expect(useConsumable(run, 2)).toBe(run); // one at a time
    run = steps(run, ticks(3) - 1);
    expect(run.health).toBe(50);
    run = steps(run, 2);
    expect(run.health).toBe(85);
    expect(run.bag.map((e) => e.uid)).toEqual(['b2']);
    expect(run.using).toBeNull();
    run = steps(useConsumable({ ...run, health: 90 }, 1), ticks(3) + 1);
    expect(run.health).toBe(100);
  });

  it('the first matching item is used (top row first); nothing to use, nothing happens; not before leaving', () => {
    const bag = [item('late', 'bandage', 0, 3), item('early', 'bandage', 5, 0)];
    expect(useConsumable(out(bag), 1).using?.uid).toBe('early');
    const none = out([]);
    expect(useConsumable(none, 1)).toBe(none);
    const ready = { ...out(bag), status: 'ready' as const };
    expect(useConsumable(ready, 1)).toBe(ready);
  });

  it('bandaging halves walking speed', () => {
    const start = { x: 0, z: 0 };
    const { maze } = world;
    const pair = maze.cells.flatMap((a) => maze.cells.filter((b) => b.column === a.column + 1 && b.row === a.row && maze.rings[a.id] !== 'sanctuary'
      && maze.rings[b.id] !== 'sanctuary' && maze.edges.some((e) => e.id === edgeId(a.id, b.id) && !e.gate)).map((b) => [a, b]))[0];
    Object.assign(start, cellPosition(pair[0], maze));
    const walk = (run: GeneratedRun) => { let r = run; for (let i = 0; i < 60; i++) r = stepGeneratedRun(world, r, { forward: 1, strafe: 0 }, -Math.PI / 2, DT); return r.player.x - start.x; };
    const base = out([item('b', 'bandage', 0, 0)], { player: { ...start, yaw: -Math.PI / 2 } });
    expect(walk(base)).toBeCloseTo(3, 6);
    expect(walk(useConsumable(base, 1))).toBeCloseTo(1.5, 6);
  });

  it('a hit cancels a bandage and keeps it; a potion heals 50 over 5 s and is not stopped by hits', () => {
    // A trap hit while bandaging: put the player on a spike plate.
    const spikes = world.traps.find((trap) => trap.kind === 'floorSpikes')!;
    const centre = { x: (spikes.plate!.minX + spikes.plate!.maxX) / 2, z: (spikes.plate!.minZ + spikes.plate!.maxZ) / 2 };
    let run = useConsumable(out([item('b', 'bandage', 0, 0)], { rules: { ...QUIET, traps: true }, player: { ...centre, yaw: 0 } }), 1);
    run = steps(run, ticks(2));
    expect(run.health).toBeLessThan(100);
    expect(run.using).toBeNull();
    expect(run.bag.map((e) => e.uid)).toEqual(['b']);
    expect(run.events.some((event) => event.detail === 'Bandage interrupted')).toBe(true);

    let potion = useConsumable(out([item('p', 'healingPotion', 0, 0)], { health: 30 }), 2);
    potion = steps(potion, ticks(1) + 1);
    expect(potion.bag).toEqual([]);
    expect(potion.regen).not.toBeNull();
    potion = steps(potion, ticks(2.5));
    expect(potion.health).toBeGreaterThanOrEqual(54);
    expect(potion.health).toBeLessThanOrEqual(56);
    potion = steps({ ...potion, health: potion.health - 10 }, ticks(3)); // hurt meanwhile: healing continues
    expect(potion.health).toBe(70);
    expect(potion.regen).toBeNull();
  });

  it('a torch burns 120 s, can be put out, and lets monsters see from further', () => {
    let run = useConsumable(out([item('t', 'torch', 0, 0)]), 3);
    expect(run.torch).toBe(120);
    expect(run.bag).toEqual([]);
    expect(steps(run, ticks(60)).torch).toBeCloseTo(60, 6);
    run = useConsumable(run, 3);
    expect(run.torch).toBe(0);
    // Sight: a husk 25 m away down a clear line sees a lit player, not an unlit one.
    const husk = { ...world.monsters.find((m) => m.kind === 'husk')!, x: 0, z: 0, mode: 'patrol' as const, wait: 9 };
    const ctx = { maze: world.maze, solids: [], plaza: { minX: 900, maxX: 901, minZ: 900, maxZ: 901 }, before: world.maze.initialOpenness,
      openness: world.maze.initialOpenness, noises: [], night: false, dt: DT };
    const far = MONSTER_SIGHT + 5;
    expect(stepMonsters([husk], 1, { ...ctx, player: { x: far, z: 0, alive: true, safe: false } }).monsters[0].mode).not.toBe('chase');
    expect(stepMonsters([husk], 1, { ...ctx, player: { x: far, z: 0, alive: true, safe: false, lit: true } }).monsters[0].mode).toBe('chase');
  });

  it('consumables are in loot and the Quartermaster stock, and he buys them; reports carry their state', () => {
    const found = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) for (const c of buildGeneratedWorld(generateMaze(seed)).containers) for (const e of c.items) found.add(e.item);
    for (const kind of ['bandage', 'healingPotion', 'torch']) expect(found.has(kind)).toBe(true);
    const stock = rollStock('quartermaster', 0).map((e) => e.item);
    expect(stock.filter((i) => i === 'bandage')).toHaveLength(3);
    expect(stock.filter((i) => i === 'healingPotion')).toHaveLength(2);
    expect(stock.filter((i) => i === 'torch')).toHaveLength(2);
    expect(traderBuys('quartermaster', { item: 'healingPotion' })).toBe(true);
    expect(itemDef('torch').category).toBe('consumable');
    let run = useConsumable(useConsumable(out([item('t', 'torch', 0, 0), item('p', 'healingPotion', 1, 0)], { health: 40 }), 3), 2);
    run = steps(run, 30);
    const parsed = parseRunReport(JSON.stringify(createRunReport(world, run)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const copy = reproduceRun(world, parsed.report).run;
    expect(copy.using).toEqual(run.using);
    expect(copy.torch).toBe(run.torch);
    expect(steps(copy, 120).health).toBe(steps(run, 120).health);
  });
});
