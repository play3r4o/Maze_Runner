// M16 equipment: seven slots, rolled gear, derived stats and the weapon in hand.
// Pure rules on plain data; the run, the profile and the UI all use these.
import { firstFit, fits, findItem, withoutItem } from './inventory';
import type { GridItem, GridSize } from './inventory';
import { GEAR, STAT_KEYS, itemDef } from './items';
import type { GearRoll, Rarity, StatKey, WeaponSpec } from './items';
import { BASE_MAX_HEALTH, BONUS_RANGES, FISTS, RARITY_BONUS_COUNT, RARITY_BONUS_SCALE, STAT_CAP } from './tuning';

export type Slot = 'mainHand' | 'offHand' | 'chest' | 'gloves' | 'boots' | 'amulet' | 'ring';
export const SLOTS: readonly Slot[] = ['mainHand', 'offHand', 'chest', 'gloves', 'boots', 'amulet', 'ring'];
export const SLOT_NAMES: Record<Slot, string> = {
  mainHand: 'Main hand', offHand: 'Off hand', chest: 'Chest', gloves: 'Gloves', boots: 'Boots', amulet: 'Amulet', ring: 'Ring',
};
export type Equipment = Partial<Record<Slot, GridItem>>;
export type Stats = Record<StatKey, number>;
export const STARTER_WEAPON = 'rustySword';

export const isGear = (item: string) => Boolean(itemDef(item).gear);
const spec = (entry: { item: string }) => itemDef(entry.item).gear;
export const isTwoHanded = (entry: { item: string } | undefined) => Boolean(entry && spec(entry)?.twoHanded);

// Whether an item may go into a slot, given what else is worn.
export function slotAccepts(equipment: Equipment, slot: Slot, entry: { item: string }): boolean {
  const gear = spec(entry);
  if (!gear) return false;
  if (slot === 'mainHand') return gear.slot === 'weapon';
  if (slot === 'offHand') {
    if (isTwoHanded(equipment.mainHand)) return false;
    return gear.slot === 'shield' || (gear.slot === 'weapon' && !gear.twoHanded);
  }
  return gear.slot === slot;
}
// Where right-click (or a drop on the character) puts an item.
export function defaultSlot(entry: { item: string }): Slot | null {
  const gear = spec(entry);
  if (!gear) return null;
  return gear.slot === 'weapon' ? 'mainHand' : gear.slot === 'shield' ? 'offHand' : gear.slot;
}

// Equip `uid` from a grid into `slot`. Whatever it displaces (and an off-hand item blocked by
// a two-handed weapon) goes back into that grid; refused if it cannot all fit.
export function equipItem(equipment: Equipment, source: readonly GridItem[], size: GridSize, uid: string, slot: Slot)
  : { equipment: Equipment; source: GridItem[] } | null {
  const entry = findItem(source, uid);
  if (!entry) return null;
  const others = { ...equipment };
  // Any weapon may go in the main hand; a two-handed one empties the off hand.
  if (!slotAccepts(slot === 'mainHand' ? {} : equipment, slot, entry)) return null;
  const displaced = [equipment[slot], slot === 'mainHand' && isTwoHanded(entry) ? equipment.offHand : undefined].filter((item): item is GridItem => Boolean(item));
  let grid = withoutItem(source, uid);
  for (const item of displaced) {
    const spot = firstFit(grid, size, item.item, item.uid);
    if (!spot) return null;
    grid = [...grid, { ...item, x: spot.x, y: spot.y, rotated: spot.rotated }];
  }
  delete others[slot];
  if (slot === 'mainHand' && isTwoHanded(entry)) delete others.offHand;
  others[slot] = { ...entry, x: 0, y: 0, rotated: false };
  return { equipment: others, source: grid };
}
// Take the item in `slot` off into a grid, at `target` or the first free spot.
export function unequipItem(equipment: Equipment, slot: Slot, dest: readonly GridItem[], size: GridSize,
  target?: { x: number; y: number; rotated: boolean }): { equipment: Equipment; dest: GridItem[] } | null {
  const entry = equipment[slot];
  if (!entry) return null;
  const placed = target ? { ...entry, ...target } : firstFit(dest, size, entry.item, entry.uid);
  if (!placed || !fits(dest, size, placed)) return null;
  const next = { ...equipment };
  delete next[slot];
  return { equipment: next, dest: [...dest, { ...placed, roll: entry.roll }] };
}
export const equippedItems = (equipment: Equipment) => SLOTS.flatMap((slot) => (equipment[slot] ? [equipment[slot]!] : []));

// Totals of base stats and rolled bonuses over worn gear (before caps).
export function statsOf(equipment: Equipment): Stats {
  const stats = Object.fromEntries(STAT_KEYS.map((key) => [key, 0])) as Stats;
  for (const entry of equippedItems(equipment)) {
    for (const [key, value] of Object.entries(spec(entry)?.stats ?? {})) stats[key as StatKey] += value as number;
    for (const bonus of entry.roll?.bonuses ?? []) stats[bonus.stat] += bonus.value;
  }
  return stats;
}
const capped = (stats: Stats, key: keyof typeof STAT_CAP) => Math.max(-STAT_CAP[key], Math.min(STAT_CAP[key], stats[key])) / 100;
export const maxHealthOf = (equipment: Equipment) => BASE_MAX_HEALTH + Math.max(0, statsOf(equipment).maxHealth);
export const speedScaleOf = (stats: Stats) => 1 + capped(stats, 'moveSpeed');
export const attackSpeedScaleOf = (stats: Stats) => 1 + capped(stats, 'attackSpeed');
export const damageScaleOf = (stats: Stats) => 1 + Math.max(-0.5, stats.damage / 100);
export const stealthOf = (stats: Stats) => Math.max(0, capped(stats, 'stealth'));
// Armour reduces monster and non-lethal trap damage by armour / (armour + 100); trap
// resistance then reduces trap damage.
export function damageTaken(amount: number, stats: Stats, source: 'monster' | 'trap'): number {
  const armor = Math.max(0, stats.armor);
  let taken = amount * (1 - armor / (armor + 100));
  if (source === 'trap') taken *= 1 - Math.max(0, capped(stats, 'trapResist'));
  return Math.max(1, Math.round(taken));
}

// The weapon in use: the main hand, or a one-handed weapon in the off hand after Q; fists without.
export function weaponIn(equipment: Equipment, hand: 'main' | 'off'): { spec: WeaponSpec; item: GridItem | null } {
  const entry = hand === 'off' ? equipment.offHand : equipment.mainHand;
  const weapon = entry ? spec(entry)?.weapon : undefined;
  if (entry && weapon) return { spec: weapon, item: entry };
  return { spec: { kind: 'melee', damage: FISTS.damage, reach: FISTS.reach, cooldown: FISTS.cooldown, model: 'fists' }, item: null };
}
export const canSwapHands = (equipment: Equipment) => Boolean(equipment.offHand && spec(equipment.offHand)?.weapon);
export const shieldBlock = (equipment: Equipment) => (equipment.offHand ? spec(equipment.offHand)?.block ?? 0 : 0);

// Roll rarity bonuses for a gear item: count by rarity, no repeated stat, scaled ranges.
export function rollGear(rarity: Rarity, random: () => number): GearRoll {
  const pool = [...STAT_KEYS];
  const bonuses: GearRoll['bonuses'] = [];
  for (let n = 0; n < RARITY_BONUS_COUNT[rarity] && pool.length; n++) {
    const stat = pool.splice(Math.floor(random() * pool.length), 1)[0];
    const [min, max] = BONUS_RANGES[stat];
    bonuses.push({ stat, value: Math.round((min + random() * (max - min)) * RARITY_BONUS_SCALE[rarity]) });
  }
  return { rarity, bonuses };
}
// Kinds that can be found or stocked (not the free starter sword).
export const FINDABLE_GEAR = GEAR.filter((def) => def.id !== STARTER_WEAPON);
