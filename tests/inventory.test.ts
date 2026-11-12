import { describe, expect, it } from 'vitest';
import { generateMaze } from '../src/simulation/mazeGenerator';
import { buildGeneratedWorld, createGeneratedRun, stepGeneratedRun, abandonGeneratedRun } from '../src/game/generatedRun';
import type { GeneratedRun, GeneratedWorld } from '../src/game/generatedRun';
import { firstFit, fits, footprint, gridValid, moveBetween, quickMove } from '../src/game/inventory';
import type { GridItem } from '../src/game/inventory';
import { ITEMS, itemDef } from '../src/game/items';
import { placeContainers } from '../src/game/loot';
import { closeLoot, containerInReach, dropFromBag, interactGeneratedRun, lootMove, lootQuickMove, openContainerOf } from '../src/game/looting';
import { ALL_RULES_ON } from '../src/game/pressure';
import { createRunReport, parseRunReport, reproduceRun } from '../src/game/runReport';
import { BAG_SIZE, CHESTS_PER_RING, LOOT_REACH, STASH_SIZE } from '../src/game/tuning';
import { SAVE_FORMAT, emptyProfile, finishedRun, loadProfile, parseProfile, saveProfile, startedRun } from '../src/storage/save';

const SAFE = { ...ALL_RULES_ON, traps: false, monsters: false };
const STILL = { forward: 0, strafe: 0 };
const worldFor = (seed: number) => buildGeneratedWorld(generateMaze(seed));
const steps = (world: GeneratedWorld, run: GeneratedRun, count: number) => {
  for (let i = 0; i < count; i++) run = stepGeneratedRun(world, run, STILL, 0, 1 / 60);
  return run;
};
const entry = (uid: string, item: string, x: number, y: number, rotated = false): GridItem => ({ uid, item, x, y, rotated });

describe('M8 grid', () => {
  it('items fit inside bounds without overlapping; rotation swaps the footprint', () => {
    const grid = [entry('a', 'ropeCoil', 0, 0)];
    expect(fits(grid, BAG_SIZE, entry('b', 'ruby', 2, 0))).toBe(true);
    expect(fits(grid, BAG_SIZE, entry('b', 'ruby', 1, 1))).toBe(false);
    expect(fits(grid, BAG_SIZE, entry('b', 'ruby', 6, 0))).toBe(false);
    expect(fits(grid, BAG_SIZE, entry('b', 'waterskin', 0, 3))).toBe(false);
    expect(fits(grid, BAG_SIZE, entry('b', 'waterskin', 0, 3, true))).toBe(true);
    expect(footprint(entry('m', 'gildedMask', 0, 0, true))).toEqual({ w: 3, h: 2 });
    expect(fits([], BAG_SIZE, entry('r', 'ruby', 0, 0, true))).toBe(false); // square items do not rotate
    expect(fits([], BAG_SIZE, entry('x', 'nothing', 0, 0))).toBe(false);
  });

  it('first fit tries upright, then rotated; a full bag returns null', () => {
    const tall = [entry('a', 'gildedMask', 0, 0), entry('b', 'gildedMask', 2, 0), entry('c', 'gildedMask', 4, 0)];
    expect(firstFit(tall, BAG_SIZE, 'waterskin', 'w')).toMatchObject({ x: 0, y: 3, rotated: true });
    const full = [0, 2, 4].flatMap((x) => [0, 2].map((y) => entry(`r${x}${y}`, 'ropeCoil', x, y)));
    expect(firstFit(full, BAG_SIZE, 'ruby', 'w')).toBeNull();
    expect(firstFit(tall.slice(0, 2), BAG_SIZE, 'gildedMask', 'm')).toMatchObject({ x: 4, y: 0, rotated: false });
    const wide = firstFit([entry('a', 'ropeCoil', 0, 0), entry('b', 'ropeCoil', 2, 0), entry('c', 'ropeCoil', 4, 0)], BAG_SIZE, 'gildedMask', 'm');
    expect(wide).toMatchObject({ x: 0, y: 2, rotated: true });
  });

  it('random sequences of moves never duplicate, lose or overlap an item', () => {
    let a: GridItem[] = [], b: GridItem[] = [];
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let n = 0; n < 40; n++) {
      const spot = firstFit(a, BAG_SIZE, ITEMS[n % ITEMS.length].id, `u${n}`);
      if (spot) a = [...a, spot];
    }
    const uids = new Set([...a, ...b].map((item) => item.uid));
    for (let i = 0; i < 2000; i++) {
      const fromA = rand() < 0.5;
      const [src, dst] = fromA ? [a, b] : [b, a];
      if (!src.length) continue;
      const item = src[Math.floor(rand() * src.length)];
      const r = rand();
      const same = r > 0.8;
      const size = (fromA !== same) ? STASH_SIZE : BAG_SIZE;
      const result = r < 0.4 ? quickMove(src, dst, fromA ? STASH_SIZE : BAG_SIZE, item.uid)
        : moveBetween(src, dst, size, item.uid, { x: Math.floor(rand() * 12), y: Math.floor(rand() * 10), rotated: rand() < 0.3 }, r > 0.8);
      if (!result) continue;
      if (r > 0.8) { if (fromA) a = result.from; else b = result.from; } else if (fromA) { a = result.from; b = result.to; } else { b = result.from; a = result.to; }
      expect(gridValid(a, BAG_SIZE) && gridValid(b, STASH_SIZE)).toBe(true);
    }
    expect(new Set([...a, ...b].map((item) => item.uid))).toEqual(uids);
    expect(a.length + b.length).toBe(uids.size);
  });
});

describe('M8 containers', () => {
  it('chests are seeded, one per cell, never in Sanctuary, the relic room or trap rooms; outer chests are richer', () => {
    const value = { inner: 0, outer: 0 }, count = { inner: 0, outer: 0 };
    for (let seed = 1; seed <= 200; seed++) {
      const world = worldFor(seed);
      const { maze } = world;
      expect(placeContainers(maze, world.relic, world.traps)).toEqual(world.containers);
      const chests = world.containers.filter((container) => container.kind === 'chest');
      expect(new Set(chests.map((chest) => chest.cell)).size).toBe(chests.length);
      const trapRooms = new Set(world.traps.filter((trap) => trap.edge === null).map((trap) => trap.cell));
      for (const ring of ['inner', 'middle', 'outer'] as const) {
        expect(chests.filter((chest) => maze.rings[chest.cell] === ring).length).toBeLessThanOrEqual(CHESTS_PER_RING[ring]);
      }
      for (const chest of chests) {
        expect(maze.rings[chest.cell]).not.toBe('sanctuary');
        expect(chest.cell === world.relic.cell || trapRooms.has(chest.cell)).toBe(false);
        expect(gridValid(chest.items, chest)).toBe(true);
        expect(chest.items.every((item) => item.item !== 'heartOfMaze')).toBe(true);
        const ring = maze.rings[chest.cell];
        if (ring === 'inner' || ring === 'outer') { value[ring] += chest.items.reduce((sum, item) => sum + itemDef(item.item).value, 0); count[ring]++; }
      }
      const reliquary = world.containers.find((container) => container.kind === 'reliquary')!;
      expect(reliquary).toMatchObject({ cell: world.relic.cell, items: [{ item: 'heartOfMaze' }] });
    }
    expect(value.outer / count.outer).toBeGreaterThan(2 * (value.inner / count.inner));
  }, 30_000);

  it('item uids are unique within a run and differ between runs', () => {
    const world = worldFor(41);
    const one = createGeneratedRun(world, SAFE, { runNumber: 1 }), two = createGeneratedRun(world, SAFE, { runNumber: 2 });
    const uids = (run: GeneratedRun) => run.containers.flatMap((container) => container.items.map((item) => item.uid));
    expect(new Set(uids(one)).size).toBe(uids(one).length);
    expect(uids(one).filter((uid) => uids(two).includes(uid))).toEqual([]);
  });
});

describe('M8 looting in a run', () => {
  const world = worldFor(41);
  const chest = world.containers.find((container) => container.kind === 'chest' && container.items.length >= 2)!;
  const at = (x: number, z: number, patch: Partial<GeneratedRun> = {}): GeneratedRun =>
    ({ ...createGeneratedRun(world, SAFE), status: 'out', leftSanctuary: true, player: { x, z, yaw: 0 }, ...patch });

  it('E opens only within reach; items move by drag and right-click; moves are validated', () => {
    expect(containerInReach(at(chest.x + LOOT_REACH + 0.1, chest.z))).toBeNull();
    let run = interactGeneratedRun(at(chest.x + 1, chest.z));
    expect(openContainerOf(run)?.id).toBe(chest.id);
    expect(run.events.at(-1)).toMatchObject({ kind: 'loot' });
    const [first, second] = openContainerOf(run)!.items;
    run = lootQuickMove(run, 'container', first.uid);
    expect(run.bag.map((item) => item.uid)).toEqual([first.uid]);
    run = lootMove(run, 'container', second.uid, 'bag', { x: 5, y: 3, rotated: false });
    const placed = run.bag.find((item) => item.uid === second.uid);
    if (placed) expect(placed).toMatchObject({ x: 5, y: 3 });
    // An overlapping or out-of-range target is refused.
    const before = run;
    expect(lootMove(run, 'bag', first.uid, 'bag', { x: 9, y: 0, rotated: false })).toBe(before);
    // Moving within the bag and back to the chest.
    run = lootMove(run, 'bag', first.uid, 'bag', { x: 2, y: 1, rotated: false });
    expect(run.bag.find((item) => item.uid === first.uid)).toMatchObject({ x: 2, y: 1 });
    run = lootQuickMove(run, 'bag', first.uid);
    expect(openContainerOf(run)!.items.some((item) => item.uid === first.uid)).toBe(true);
    expect(closeLoot(run).openContainer).toBeNull();
  });

  it('the world keeps running while a container is open; walking away closes it', () => {
    let run = interactGeneratedRun(at(chest.x + 1, chest.z));
    run = steps(world, run, 60);
    expect(run.runTicks).toBe(60);
    expect(run.openContainer).toBe(chest.id);
    run = steps(world, { ...run, player: { ...run.player, x: chest.x + 4 } }, 1);
    expect(run.openContainer).toBeNull();
    expect(lootQuickMove(run, 'container', chest.items[0].uid)).toBe(run);
  });

  it('dropping makes a sack at the feet, joins it, and the sack vanishes when emptied', () => {
    let run = interactGeneratedRun(at(chest.x + 1, chest.z));
    for (const item of [...openContainerOf(run)!.items]) run = lootQuickMove(run, 'container', item.uid);
    run = closeLoot(run);
    const carried = run.bag.map((item) => item.uid);
    run = dropFromBag(run, carried[0]);
    run = dropFromBag(run, carried[1]);
    const sacks = run.containers.filter((container) => container.kind === 'sack');
    expect(sacks).toHaveLength(1);
    expect(sacks[0].items.map((item) => item.uid)).toEqual(carried.slice(0, 2));
    run = interactGeneratedRun(run);
    expect(run.openContainer).toBe(sacks[0].id);
    for (const uid of carried.slice(0, 2)) run = lootQuickMove(run, 'container', uid);
    expect(run.containers.some((container) => container.kind === 'sack')).toBe(false);
    expect(run.openContainer).toBeNull();
    expect(run.bag.map((item) => item.uid).sort()).toEqual([...carried].sort());
  });

  it('entering Sanctuary extracts with the bag; death and abandon leave it lost', () => {
    let run = interactGeneratedRun(at(chest.x + 1, chest.z));
    run = closeLoot(lootQuickMove(run, 'container', openContainerOf(run)!.items[0].uid));
    const home = steps(world, { ...run, player: { x: 0, z: 0, yaw: 0 } }, 1);
    expect(home.status).toBe('extracted');
    expect(home.bag).toHaveLength(1);
    expect(home.events.some((event) => event.detail.includes('1 items'))).toBe(true);
    expect(abandonGeneratedRun(run).status).toBe('abandoned');
    // The profile keeps the bag only after extraction.
    const profile = startedRun({ ...emptyProfile(), bag: [] }, 1);
    expect(finishedRun(profile, true, home.bag).bag).toHaveLength(1);
    expect(finishedRun(profile, false, home.bag).bag).toEqual([]);
  });

  it('a killed husk leaves seeded remains; the warden leaves none', () => {
    const husk = world.monsters.findIndex((monster) => monster.kind === 'husk');
    const warden = world.monsters.findIndex((monster) => monster.kind === 'warden');
    const pit = world.traps.find((trap) => trap.kind === 'pit')!;
    const centre = { x: (pit.zone.minX + pit.zone.maxX) / 2, z: (pit.zone.minZ + pit.zone.maxZ) / 2 };
    const states = world.traps.map((trap) => ({ id: trap.id, phase: trap.id === pit.id ? 'active' as const : 'armed' as const, seconds: 0, hits: {} }));
    for (const [index, expected] of [[husk, 1], [warden, 0]] as const) {
      let run: GeneratedRun = { ...createGeneratedRun(world), status: 'out', traps: states,
        monsters: world.monsters.map((monster, i) => (i === index ? { ...monster, ...centre, mode: 'investigate' as const, wait: 5 } : { ...monster, mode: 'dead' as const })) };
      run = steps(world, run, 2);
      expect(run.monsters[index].mode).toBe('dead');
      expect(run.containers.filter((container) => container.kind === 'remains')).toHaveLength(expected);
    }
  });

  it('reports carry the bag and containers', () => {
    let run = interactGeneratedRun(at(chest.x + 1, chest.z));
    run = lootQuickMove(run, 'container', openContainerOf(run)!.items[0].uid);
    run = dropFromBag(run, run.bag[0].uid);
    const parsed = parseRunReport(JSON.stringify(createRunReport(world, run)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { run: copy } = reproduceRun(world, parsed.report);
    expect(copy.bag).toEqual(run.bag);
    expect(copy.containers).toEqual(run.containers);
    expect(copy.openContainer).toBe(run.openContainer);
  });
});

describe('M8 save', () => {
  const memory = () => { const data = new Map<string, string>(); return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } }; };
  it('round trips; a run left unfinished loses the bag; damaged and newer saves reset with a notice', () => {
    const store = memory();
    const profile = { ...emptyProfile(), runs: 3, bag: [entry('a', 'ruby', 0, 0)], stash: [entry('b', 'ropeCoil', 4, 4)] };
    expect(saveProfile(profile, store)).toBe(true);
    expect(loadProfile(store)).toEqual({ profile, notice: null });
    saveProfile(startedRun(profile, 4), store);
    const after = loadProfile(store);
    expect(after.profile).toMatchObject({ runs: 4, bag: [], inRun: false, stash: profile.stash });
    expect(after.notice).toContain('never finished');
    expect(parseProfile('{oops').notice).toContain('could not be read');
    expect(parseProfile(JSON.stringify({ ...profile, format: SAVE_FORMAT + 1 })).notice).toContain('newer version');
    expect(parseProfile(JSON.stringify({ ...profile, bag: [entry('a', 'ruby', 0, 0), entry('c', 'ruby', 0, 0)] })).notice).toContain('damaged');
    expect(parseProfile(JSON.stringify({ ...profile, stash: [entry('a', 'ruby', 1, 1)] })).notice).toContain('damaged');
    expect(parseProfile(null)).toEqual({ profile: emptyProfile(), notice: null });
  });
});
