import { RARITY_VALUE_MULTIPLIER } from './tuning';
// M8 item catalogue. Plain data, so later milestones (equipment, traders) can extend it:
// add fields such as an equipment slot without changing grids or containers.
export type ItemCategory = 'valuable' | 'material' | 'provision' | 'relic' | 'tool' | 'gear' | 'consumable';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type ItemDef = {
  id: string; name: string;
  // Cells taken in the grid before rotation.
  width: number; height: number;
  category: ItemCategory; rarity: Rarity;
  // Gold value (shown now; traders use it later).
  value: number;
  // T1 unrest while carried, and T3 noise when walking (M8 stage 2).
  unrest: number; noisy: boolean;
  description: string;
  // M16: equipment kinds carry their slot and base stats; instances roll rarity and bonuses.
  gear?: GearSpec;
};
export type StatKey = 'maxHealth' | 'armor' | 'moveSpeed' | 'damage' | 'attackSpeed' | 'stealth' | 'trapResist';
export const STAT_KEYS: readonly StatKey[] = ['maxHealth', 'armor', 'moveSpeed', 'damage', 'attackSpeed', 'stealth', 'trapResist'];
export const STAT_NAMES: Record<StatKey, string> = {
  maxHealth: 'Max health', armor: 'Armour', moveSpeed: 'Move speed', damage: 'Damage', attackSpeed: 'Attack speed', stealth: 'Stealth', trapResist: 'Trap resistance',
};
export const PERCENT_STATS = new Set<StatKey>(['moveSpeed', 'damage', 'attackSpeed', 'stealth', 'trapResist']);
export type SlotKind = 'weapon' | 'shield' | 'chest' | 'gloves' | 'boots' | 'amulet' | 'ring';
export type WeaponSpec = { kind: 'melee' | 'crossbow'; damage: number; reach: number; cooldown: number; model: string };
export type GearSpec = { slot: SlotKind; twoHanded?: boolean; weapon?: WeaponSpec; block?: number; stats: Partial<Record<StatKey, number>> };
export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#b9b6ad', uncommon: '#6fbf73', rare: '#5aa0e6', epic: '#b07ce8', legendary: '#f0b44a',
};
export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
// Unrest by category (plan T1): provisions 0, materials 1, relics 3, valuables 0.
const UNREST: Record<ItemCategory, number> = { provision: 0, material: 1, relic: 3, valuable: 0, tool: 0, gear: 0, consumable: 0 };

const item = (id: string, name: string, size: [number, number], category: ItemCategory, rarity: Rarity, value: number,
  description: string, noisy = false): ItemDef =>
  ({ id, name, width: size[0], height: size[1], category, rarity, value, unrest: UNREST[category], noisy, description });

const gear = (id: string, name: string, size: [number, number], value: number, description: string, spec: GearSpec): ItemDef =>
  ({ ...item(id, name, size, 'gear', 'common', value, description), gear: spec });
const melee = (damage: number, reach: number, cooldown: number, model: string): WeaponSpec => ({ kind: 'melee', damage, reach, cooldown, model });

// M16 gear kinds. Base stats here; each found or stocked piece also rolls a rarity and bonuses.
export const GEAR: readonly ItemDef[] = [
  gear('rustySword', 'Rusty Shortsword', [1, 3], 0, 'Free from the Sanctuary rack. Better than fists.', { slot: 'weapon', weapon: melee(20, 1.9, 0.75, 'sword'), stats: {} }),
  gear('dagger', 'Dagger', [1, 2], 30, 'Quick and quiet.', { slot: 'weapon', weapon: melee(18, 1.6, 0.4, 'dagger'), stats: { stealth: 5 } }),
  gear('shortsword', 'Shortsword', [1, 3], 45, 'A plain, honest blade.', { slot: 'weapon', weapon: melee(28, 2, 0.7, 'sword'), stats: {} }),
  gear('mace', 'Mace', [1, 3], 50, 'Flanged iron on a wooden haft.', { slot: 'weapon', weapon: melee(34, 1.9, 0.85, 'mace'), stats: {} }),
  gear('battleAxe', 'Battle Axe', [2, 3], 80, 'Two hands, one swing, one less husk.', { slot: 'weapon', twoHanded: true, weapon: melee(48, 2.2, 1.15, 'axe'), stats: {} }),
  gear('spear', 'Spear', [1, 4], 65, 'Keeps things at a distance.', { slot: 'weapon', twoHanded: true, weapon: melee(32, 2.8, 0.9, 'spear'), stats: {} }),
  gear('crossbow', 'Crossbow', [2, 3], 90, 'Sixteen bolts per expedition. Loud.', { slot: 'weapon', twoHanded: true, weapon: { kind: 'crossbow', damage: 25, reach: 40, cooldown: 0.8, model: 'crossbow' }, stats: {} }),
  gear('buckler', 'Buckler', [2, 2], 35, 'Small round shield. Hold the right mouse button to block.', { slot: 'shield', block: 50, stats: { armor: 10 } }),
  gear('heaterShield', 'Heater Shield', [2, 3], 60, 'Hold the right mouse button to block.', { slot: 'shield', block: 75, stats: { armor: 20, moveSpeed: -3 } }),
  gear('paddedTunic', 'Padded Tunic', [2, 3], 30, 'Quilted cloth. Light.', { slot: 'chest', stats: { armor: 15 } }),
  gear('chainmail', 'Chainmail', [2, 3], 70, 'Rings of iron, heavy on the shoulders.', { slot: 'chest', stats: { armor: 35, moveSpeed: -4 } }),
  gear('plateCuirass', 'Plate Cuirass', [2, 3], 120, 'Proper armour. You will walk slower.', { slot: 'chest', stats: { armor: 60, moveSpeed: -10 } }),
  gear('leatherGloves', 'Leather Gloves', [2, 2], 20, 'Supple, good grip.', { slot: 'gloves', stats: { armor: 5, attackSpeed: 5 } }),
  gear('gauntlets', 'Gauntlets', [2, 2], 40, 'Steel knuckles.', { slot: 'gloves', stats: { armor: 14 } }),
  gear('leatherBoots', 'Leather Boots', [2, 2], 20, 'Soft soles, quick feet.', { slot: 'boots', stats: { armor: 5, moveSpeed: 5 } }),
  gear('heavyBoots', 'Heavy Boots', [2, 2], 35, 'Hobnailed and solid.', { slot: 'boots', stats: { armor: 14, moveSpeed: -3 } }),
  gear('boneAmulet', 'Bone Amulet', [1, 1], 40, 'Carved knucklebones on a cord.', { slot: 'amulet', stats: { maxHealth: 10 } }),
  gear('silverPendant', 'Silver Pendant', [1, 1], 50, 'A tiny silver blade on a chain.', { slot: 'amulet', stats: { damage: 5 } }),
  gear('copperRing', 'Copper Ring', [1, 1], 30, 'It muffles your steps, somehow.', { slot: 'ring', stats: { stealth: 5 } }),
  gear('signetRing', 'Signet Ring', [1, 1], 45, 'The seal of a careful family.', { slot: 'ring', stats: { trapResist: 5 } }),
];

export const ITEMS: readonly ItemDef[] = [
  item('copperCoins', 'Copper Coins', [1, 1], 'valuable', 'common', 6, 'A fistful of green-crusted coins. They clink.', true),
  item('boneDice', 'Bone Dice', [1, 1], 'valuable', 'common', 8, 'Worn smooth by some long-gone gambler.'),
  item('candleStub', 'Candle Stub', [1, 1], 'provision', 'common', 3, 'Half a candle of yellow tallow.'),
  item('hardtack', 'Hardtack', [1, 1], 'provision', 'common', 4, 'Hard enough to break a tooth.'),
  item('waterskin', 'Waterskin', [1, 2], 'provision', 'common', 6, 'Still holds water. Mostly.'),
  item('ironScrap', 'Iron Scrap', [1, 1], 'material', 'common', 7, 'Bent nails and a broken hinge.'),
  item('ropeCoil', 'Rope Coil', [2, 2], 'material', 'common', 12, 'Ten metres of hemp rope.'),
  item('silverCoins', 'Silver Coins', [1, 1], 'valuable', 'uncommon', 18, 'Stamped with a face nobody remembers.', true),
  item('lodestone', 'Lodestone', [1, 1], 'material', 'uncommon', 22, 'A dark stone that tugs at iron.'),
  item('silverChalice', 'Silver Chalice', [1, 2], 'valuable', 'uncommon', 30, 'Tarnished, but heavy with silver.'),
  item('goldPurse', 'Gold Coin Purse', [1, 1], 'valuable', 'rare', 45, 'A small purse, satisfyingly heavy.', true),
  item('ruby', 'Ruby', [1, 1], 'valuable', 'rare', 65, 'Deep red, the size of a thumbnail.'),
  item('jeweledGoblet', 'Jeweled Goblet', [1, 2], 'valuable', 'rare', 75, 'Set with chips of green glass and one real stone.'),
  item('quicksilverVial', 'Quicksilver Vial', [1, 1], 'material', 'rare', 55, 'It moves on its own inside the glass.'),
  item('stoneIdol', 'Stone Idol', [2, 2], 'relic', 'epic', 140, 'A squat figure with too many eyes. The walls seem to notice it.'),
  item('gildedMask', 'Gilded Mask', [2, 3], 'relic', 'epic', 170, 'A golden face, calm and wrong.'),
  // M17 consumables: used with number keys 1–3.
  item('bandage', 'Bandage', [1, 1], 'consumable', 'common', 12, 'Press 1. Three seconds of careful wrapping: +35 health. A hit spoils it.'),
  item('healingPotion', 'Healing Potion', [1, 2], 'consumable', 'uncommon', 30, 'Press 2. Drink in a second, then +50 health over five seconds.'),
  item('torch', 'Torch', [1, 2], 'consumable', 'common', 8, 'Press 3. Light for two minutes, but monsters see you from further away.'),
  // Starter kit (T5): a free spool each run if the bag has room. Never found in chests.
  item('threadSpool', 'Thread Spool', [1, 1], 'tool', 'common', 2, '150 metres of strong thread. Press T to start or stop laying it.'),
  item('heartOfMaze', 'Heart of the Maze', [2, 2], 'relic', 'legendary', 400, 'Warm, and faintly beating. The maze wants it back.'),
];
export const ITEM_BY_ID: ReadonlyMap<string, ItemDef> = new Map([...ITEMS, ...GEAR].map((def) => [def.id, def]));
export const itemDef = (id: string): ItemDef => {
  const def = ITEM_BY_ID.get(id);
  if (!def) throw new Error(`Unknown item ${id}`);
  return def;
};
export const RELIC_ITEM = 'heartOfMaze';
export const THREAD_ITEM = 'threadSpool';
export const CONSUMABLE_KEYS: Record<1 | 2 | 3, string> = { 1: 'bandage', 2: 'healingPotion', 3: 'torch' };
export const noisyCount = (bag: readonly { item: string }[]) => bag.filter((entry) => itemDef(entry.item).noisy).length;
export const bagUnrest = (bag: readonly { item: string }[]) => bag.reduce((sum, entry) => sum + itemDef(entry.item).unrest, 0);

// M16: a gear instance's rolled rarity and bonus stats (kept on the placed item).
export type GearRoll = { rarity: Rarity; bonuses: { stat: StatKey; value: number }[] };
export const itemRarity = (entry: { item: string; roll?: GearRoll }): Rarity => entry.roll?.rarity ?? itemDef(entry.item).rarity;
// Gold value of one placed item: gear scales with its rolled rarity.
export const itemValue = (entry: { item: string; roll?: GearRoll }) => {
  const def = itemDef(entry.item);
  return def.gear ? Math.round(def.value * RARITY_VALUE_MULTIPLIER[itemRarity(entry)]) : def.value;
};
