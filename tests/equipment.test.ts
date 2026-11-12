import { describe, expect, it } from 'vitest';
import { cellPosition, edgeId } from '../src/simulation/maze';
import { generateMaze } from '../src/simulation/mazeGenerator';
import { attackGeneratedRun, buildGeneratedWorld, createGeneratedRun, fireCrossbow, setBlocking, stepGeneratedRun, swapHands, withEquipment } from '../src/game/generatedRun';
import type { GeneratedRun, GeneratedWorld } from '../src/game/generatedRun';
import { damageTaken, equipItem, equippedItems, maxHealthOf, rollGear, slotAccepts, statsOf, unequipItem } from '../src/game/equipment';
import type { Equipment } from '../src/game/equipment';
import { firstFit, gridValid } from '../src/game/inventory';
import type { GridItem } from '../src/game/inventory';
import { itemDef, itemValue } from '../src/game/items';
import type { Rarity } from '../src/game/items';
import { lootEquip, lootUnequip } from '../src/game/looting';
import type { Monster } from '../src/game/monsters';
import { ALL_RULES_ON } from '../src/game/pressure';
import { createRunReport, parseRunReport, reproduceRun } from '../src/game/runReport';
import { BAG_SIZE, MONSTER_STATS, RARITY_BONUS_COUNT } from '../src/game/tuning';
import { emptyProfile, finishedRun, parseProfile, startedRun } from '../src/storage/save';

const SAFE = { ...ALL_RULES_ON, traps: false };
const DT = 1 / 60;
const gear = (uid: string, item: string, rarity: Rarity = 'common', bonuses: { stat: never; value: number }[] = []): GridItem =>
  ({ uid, item, x: 0, y: 0, rotated: false, roll: { rarity, bonuses } });
const at = (uid: string, item: string, x: number, y: number): GridItem => ({ uid, item, x, y, rotated: false });
const world = buildGeneratedWorld(generateMaze(41));
function corridor(w: GeneratedWorld) {
  for (const a of w.maze.cells) {
    const b = w.maze.cells.find((cell) => cell.column === a.column + 1 && cell.row === a.row);
    if (!b || w.maze.rings[a.id] === 'sanctuary' || w.maze.rings[b.id] === 'sanctuary') continue;
    const edge = w.maze.edges.find((item) => item.id === edgeId(a.id, b.id));
    if (edge && !edge.gate) return { a: cellPosition(a, w.maze), b: cellPosition(b, w.maze) };
  }
  throw new Error('no corridor');
}
const { a } = corridor(world);
// The player at `a` facing +x (yaw −π/2), with one monster placed relative to it.
function duel(equipment: Equipment, monster: Partial<Monster>, patch: Partial<GeneratedRun> = {}): GeneratedRun {
  const base = createGeneratedRun(world, SAFE);
  const husk = base.monsters.find((m) => m.kind === 'husk')!;
  return { ...base, status: 'out', leftSanctuary: true, equipment, player: { ...a, yaw: -Math.PI / 2 },
    monsters: [{ ...husk, id: 'mx', x: a.x + 1.5, z: a.z, mode: 'patrol', path: [], goal: null, wait: 99, ...monster }], ...patch };
}

describe('M16 gear rolls', () => {
  it('bonus count by rarity, no repeated stat, deterministic; value scales with rarity', () => {
    let seed = 3;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (const rarity of ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const) {
      for (let n = 0; n < 50; n++) {
        const roll = rollGear(rarity, random);
        expect(roll.bonuses).toHaveLength(RARITY_BONUS_COUNT[rarity]);
        expect(new Set(roll.bonuses.map((b) => b.stat)).size).toBe(roll.bonuses.length);
        for (const bonus of roll.bonuses) expect(bonus.value).toBeGreaterThan(0);
      }
    }
    const values = (['common', 'rare', 'legendary'] as const).map((rarity) => itemValue(gear('x', 'chainmail', rarity)));
    expect(values).toEqual([70, 210, 630]);
    expect(itemValue(gear('r', 'rustySword'))).toBe(0);
  });

  it('chests and remains roll gear (about a third of items), every piece with a roll', () => {
    let items = 0, gearCount = 0;
    for (let seed = 1; seed <= 200; seed++) {
      for (const container of buildGeneratedWorld(generateMaze(seed)).containers) for (const entry of container.items) {
        items++;
        if (itemDef(entry.item).gear) { gearCount++; expect(entry.roll).toBeDefined(); expect(entry.item).not.toBe('rustySword'); }
      }
    }
    expect(gearCount / items).toBeGreaterThan(0.25);
    expect(gearCount / items).toBeLessThan(0.45);
  }, 30_000);
});

describe('M16 slots', () => {
  it('only matching items go in each slot; a two-handed weapon blocks the off hand', () => {
    expect(slotAccepts({}, 'chest', { item: 'chainmail' })).toBe(true);
    expect(slotAccepts({}, 'gloves', { item: 'chainmail' })).toBe(false);
    expect(slotAccepts({}, 'mainHand', { item: 'battleAxe' })).toBe(true);
    expect(slotAccepts({}, 'offHand', { item: 'buckler' })).toBe(true);
    expect(slotAccepts({}, 'offHand', { item: 'dagger' })).toBe(true);
    expect(slotAccepts({}, 'offHand', { item: 'spear' })).toBe(false);
    expect(slotAccepts({ mainHand: gear('a', 'battleAxe') }, 'offHand', { item: 'buckler' })).toBe(false);
    expect(slotAccepts({}, 'ring', { item: 'ruby' })).toBe(false);
  });

  it('equipping swaps with the bag; a two-handed weapon sends the off hand back; refused without room', () => {
    let equipment: Equipment = { mainHand: gear('s', 'shortsword'), offHand: gear('b', 'buckler') };
    let bag: GridItem[] = [at('axe', 'battleAxe', 0, 0)];
    const done = equipItem(equipment, bag, BAG_SIZE, 'axe', 'mainHand')!;
    expect(done.equipment.mainHand?.uid).toBe('axe');
    expect(done.equipment.offHand).toBeUndefined();
    expect(done.source.map((item) => item.uid).sort()).toEqual(['b', 's']);
    expect(gridValid(done.source, BAG_SIZE)).toBe(true);
    // A full bag cannot take back the shield and sword.
    bag = [at('axe', 'battleAxe', 0, 0), at('c1', 'ropeCoil', 2, 0), at('c2', 'ropeCoil', 4, 0), at('c3', 'ropeCoil', 2, 2), at('c4', 'ropeCoil', 4, 2), at('d', 'dagger', 0, 3)];
    expect(gridValid(bag, BAG_SIZE)).toBe(false); // the dagger overlaps the axe
    bag = bag.slice(0, 5);
    expect(equipItem(equipment, bag, BAG_SIZE, 'axe', 'mainHand')).toBeNull();
    // Unequip to a spot.
    const off = unequipItem(equipment, 'offHand', [], BAG_SIZE, { x: 4, y: 2, rotated: false })!;
    expect(off.dest).toEqual([{ ...equipment.offHand, x: 4, y: 2 }]);
    expect(unequipItem(equipment, 'chest', [], BAG_SIZE)).toBeNull();
    equipment = off.equipment;
    expect(equipment.offHand).toBeUndefined();
  });

  it('random equip and unequip sequences never lose or duplicate an item', () => {
    const kinds = ['shortsword', 'dagger', 'battleAxe', 'buckler', 'chainmail', 'gauntlets', 'leatherBoots', 'boneAmulet', 'copperRing', 'spear', 'crossbow', 'heaterShield'];
    let bag: GridItem[] = [];
    kinds.forEach((item, i) => { const spot = firstFit(bag, BAG_SIZE, item, `g${i}`); if (spot) bag.push({ ...spot, roll: { rarity: 'common', bonuses: [] } }); });
    let equipment: Equipment = {};
    const all = new Set(bag.map((item) => item.uid));
    let seed = 11;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const slots = ['mainHand', 'offHand', 'chest', 'gloves', 'boots', 'amulet', 'ring'] as const;
    for (let i = 0; i < 3000; i++) {
      const slot = slots[Math.floor(random() * slots.length)];
      if (random() < 0.5 && bag.length) {
        const result = equipItem(equipment, bag, BAG_SIZE, bag[Math.floor(random() * bag.length)].uid, slot);
        if (result) { equipment = result.equipment; bag = result.source; }
      } else {
        const result = unequipItem(equipment, slot, bag, BAG_SIZE);
        if (result) { equipment = result.equipment; bag = result.dest; }
      }
      expect(gridValid(bag, BAG_SIZE)).toBe(true);
      if (equipment.mainHand && itemDef(equipment.mainHand.item).gear?.twoHanded) expect(equipment.offHand).toBeUndefined();
      const uids = [...bag, ...equippedItems(equipment)].map((item) => item.uid);
      expect(new Set(uids)).toEqual(all);
      expect(uids).toHaveLength(all.size);
    }
  });
});

describe('M16 stats in the maze', () => {
  it('totals base stats and bonuses; armour and trap resistance reduce damage; max health clamps', () => {
    const equipment: Equipment = { chest: gear('c', 'chainmail', 'rare', [{ stat: 'armor' as never, value: 15 }, { stat: 'maxHealth' as never, value: 12 }]),
      ring: gear('r', 'signetRing'), amulet: gear('a', 'boneAmulet') };
    const stats = statsOf(equipment);
    expect(stats).toMatchObject({ armor: 50, maxHealth: 22, moveSpeed: -4, trapResist: 5 });
    expect(maxHealthOf(equipment)).toBe(122);
    expect(damageTaken(30, stats, 'monster')).toBe(20);
    expect(damageTaken(30, stats, 'trap')).toBe(19);
    expect(damageTaken(30, statsOf({}), 'trap')).toBe(30);
    const run = { ...createGeneratedRun(world, SAFE, { equipment }), status: 'out' as const };
    expect(run.health).toBe(122);
    expect(withEquipment(run, {}).health).toBe(100);
    expect(withEquipment({ ...run, health: 60 }, {}).health).toBe(60);
  });

  it('boots speed you up, plate slows you, a raised shield slows you more', () => {
    const walk = (equipment: Equipment, block = false) => {
      let run: GeneratedRun = setBlocking({ ...createGeneratedRun(world, SAFE, { equipment }), status: 'out', leftSanctuary: true, player: { ...a, yaw: -Math.PI / 2 } }, block);
      for (let i = 0; i < 60; i++) run = stepGeneratedRun(world, run, { forward: 1, strafe: 0 }, -Math.PI / 2, DT);
      return run.player.x - a.x;
    };
    expect(walk({})).toBeCloseTo(3, 6);
    expect(walk({ boots: gear('b', 'leatherBoots') })).toBeCloseTo(3.15, 6);
    expect(walk({ chest: gear('p', 'plateCuirass') })).toBeCloseTo(2.7, 6);
    expect(walk({ offHand: gear('s', 'buckler') }, true)).toBeCloseTo(1.8, 6);
    expect(walk({}, true)).toBeCloseTo(3, 6); // no shield, no block
  });

  it('starter kit gives the Rusty Shortsword only for an empty main hand', () => {
    expect(createGeneratedRun(world, SAFE, { starterKit: true, runNumber: 2 }).equipment.mainHand).toMatchObject({ uid: 'r2.rusty', item: 'rustySword' });
    expect(createGeneratedRun(world, SAFE, { starterKit: true, equipment: { mainHand: gear('m', 'mace') } }).equipment.mainHand?.uid).toBe('m');
    expect(createGeneratedRun(world, SAFE).equipment).toEqual({});
  });
});

describe('M16 weapons', () => {
  const sword = { mainHand: gear('s', 'shortsword') };
  it('a swing hits monsters in front within reach and in sight, with cooldown; fists without a weapon', () => {
    const hit = attackGeneratedRun(world, duel(sword, {}));
    expect(hit.monsters[0].health).toBe(MONSTER_STATS.husk.health - 28);
    expect(hit.attackCooldown).toBeCloseTo(0.7, 6);
    expect(hit.noise.at(-1)).toMatchObject({ radius: 10 });
    expect(attackGeneratedRun(world, hit)).toBe(hit); // cooling down
    expect(attackGeneratedRun(world, duel(sword, { x: a.x - 1.5 })).monsters[0].health).toBe(MONSTER_STATS.husk.health); // behind
    expect(attackGeneratedRun(world, duel(sword, { x: a.x + 3 })).monsters[0].health).toBe(MONSTER_STATS.husk.health); // too far
    expect(attackGeneratedRun(world, duel({}, {})).monsters[0].health).toBe(MONSTER_STATS.husk.health - 8);
    const fast = attackGeneratedRun(world, duel({ ...sword, gloves: gear('g', 'leatherGloves') }, {}));
    expect(fast.attackCooldown).toBeCloseTo(0.7 / 1.05, 6);
    const strong = attackGeneratedRun(world, duel({ mainHand: gear('s', 'shortsword', 'rare', [{ stat: 'damage' as never, value: 10 }]) }, {}));
    expect(strong.monsters[0].health).toBe(MONSTER_STATS.husk.health - 31);
  });

  it('melee only staggers the warden; three axe hits kill a husk and leave remains', () => {
    const warden = attackGeneratedRun(world, duel(sword, { kind: 'warden' }));
    expect(warden.monsters[0].mode).not.toBe('dead');
    expect(warden.monsters[0].stun).toBeCloseTo(0.8, 6);
    let run = duel({ mainHand: gear('x', 'battleAxe') }, {});
    for (let n = 0; n < 2; n++) run = { ...attackGeneratedRun(world, run), attackCooldown: 0 };
    expect(run.monsters[0].mode).toBe('dead');
    expect(run.containers.some((container) => container.kind === 'remains')).toBe(true);
  });

  it('the crossbow fires bolts only when it is the weapon in hand; Q swaps to an off-hand weapon', () => {
    const bow = attackGeneratedRun(world, duel({ mainHand: gear('c', 'crossbow') }, { x: a.x + 10 }));
    expect(bow.bolts).toHaveLength(1);
    expect(attackGeneratedRun(world, duel(sword, { x: a.x + 10 })).bolts).toHaveLength(0);
    const dual = duel({ mainHand: gear('s', 'shortsword'), offHand: gear('d', 'dagger') }, {});
    const swapped = swapHands(dual);
    expect(swapped.activeHand).toBe('off');
    expect(attackGeneratedRun(world, { ...swapped, attackCooldown: 0 }).monsters[0].health).toBe(MONSTER_STATS.husk.health - 18);
    expect(swapHands(duel(sword, {}))).toMatchObject({ activeHand: 'main' });
    expect(fireCrossbow).toBeTypeOf('function');
  });

  it('a raised shield takes its share off hits from the front only', () => {
    const shielded: Equipment = { mainHand: gear('s', 'shortsword'), offHand: gear('h', 'heaterShield') };
    const hitBy = (x: number, block: boolean) => {
      let run = setBlocking(duel(shielded, { kind: 'skitter', x, mode: 'chase' }), block);
      for (let i = 0; i < 3 && run.health === run.health; i++) run = stepGeneratedRun(world, setBlocking(run, block), { forward: 0, strafe: 0 }, -Math.PI / 2, DT);
      return maxHealthOf(shielded) - run.health;
    };
    const plain = hitBy(a.x + 0.9, false);
    expect(plain).toBe(damageTaken(MONSTER_STATS.skitter.damage, statsOf(shielded), 'monster'));
    expect(hitBy(a.x + 0.9, true)).toBe(Math.round(plain * 0.25));
    expect(hitBy(a.x - 0.9, true)).toBe(plain);
  });
});

describe('M16 equipping in a run, the profile and reports', () => {
  it('equips from the bag, unequips back, keeps uids; extraction keeps gear, death loses it', () => {
    let run: GeneratedRun = { ...createGeneratedRun(world, SAFE, { starterKit: true, bag: [{ ...at('m', 'chainmail', 0, 0), roll: { rarity: 'common', bonuses: [] } }] }), status: 'out', leftSanctuary: true };
    run = lootEquip(run, 'bag', 'm');
    expect(run.equipment.chest?.uid).toBe('m');
    expect(run.bag.some((item) => item.uid === 'm')).toBe(false);
    run = lootUnequip(run, 'chest', 'bag', { x: 3, y: 1, rotated: false });
    expect(run.bag.find((item) => item.uid === 'm')).toMatchObject({ x: 3, y: 1, roll: { rarity: 'common' } });
    run = lootEquip(run, 'bag', 'm');
    const profile = startedRun(emptyProfile(), 1);
    expect(profile.equipment).toEqual({});
    expect(finishedRun(profile, true, run.bag, run.equipment).equipment.chest?.uid).toBe('m');
    expect(finishedRun(profile, false, run.bag, run.equipment).equipment).toEqual({});
    const parsed = parseRunReport(JSON.stringify(createRunReport(world, run)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(reproduceRun(world, parsed.report).run.equipment).toEqual(run.equipment);
  });

  it('saves upgrade from format 2; an unfinished run loses worn gear; bad equipment resets', () => {
    expect(parseProfile(JSON.stringify({ format: 2, runs: 1, bag: [], stash: [], inRun: false, traces: [] })).profile.equipment).toEqual({});
    const worn = { ...emptyProfile(), equipment: { chest: gear('c', 'chainmail') } };
    expect(parseProfile(JSON.stringify(worn)).profile.equipment.chest?.uid).toBe('c');
    expect(parseProfile(JSON.stringify({ ...worn, inRun: true })).profile.equipment).toEqual({});
    expect(parseProfile(JSON.stringify({ ...worn, equipment: { ring: gear('c', 'chainmail') } })).notice).toContain('damaged');
  });
});
