// M8 item catalogue. Plain data, so later milestones (equipment, traders) can extend it:
// add fields such as an equipment slot without changing grids or containers.
export type ItemCategory = 'valuable' | 'material' | 'provision' | 'relic' | 'tool';
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
};
export const RARITY_COLORS: Record<Rarity, string> = {
  common: '#b9b6ad', uncommon: '#6fbf73', rare: '#5aa0e6', epic: '#b07ce8', legendary: '#f0b44a',
};
export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
// Unrest by category (plan T1): provisions 0, materials 1, relics 3, valuables 0.
const UNREST: Record<ItemCategory, number> = { provision: 0, material: 1, relic: 3, valuable: 0, tool: 0 };

const item = (id: string, name: string, size: [number, number], category: ItemCategory, rarity: Rarity, value: number,
  description: string, noisy = false): ItemDef =>
  ({ id, name, width: size[0], height: size[1], category, rarity, value, unrest: UNREST[category], noisy, description });

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
  // Starter kit (T5): a free spool each run if the bag has room. Never found in chests.
  item('threadSpool', 'Thread Spool', [1, 1], 'tool', 'common', 2, '150 metres of strong thread. Press T to start or stop laying it.'),
  item('heartOfMaze', 'Heart of the Maze', [2, 2], 'relic', 'legendary', 400, 'Warm, and faintly beating. The maze wants it back.'),
];
export const ITEM_BY_ID: ReadonlyMap<string, ItemDef> = new Map(ITEMS.map((def) => [def.id, def]));
export const itemDef = (id: string): ItemDef => {
  const def = ITEM_BY_ID.get(id);
  if (!def) throw new Error(`Unknown item ${id}`);
  return def;
};
export const RELIC_ITEM = 'heartOfMaze';
export const THREAD_ITEM = 'threadSpool';
export const noisyCount = (bag: readonly { item: string }[]) => bag.filter((entry) => itemDef(entry.item).noisy).length;
export const bagUnrest = (bag: readonly { item: string }[]) => bag.reduce((sum, entry) => sum + itemDef(entry.item).unrest, 0);
