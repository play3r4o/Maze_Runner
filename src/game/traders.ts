// M16 traders at the base. Each buys only certain kinds of items, for their value, and sells
// its own seeded stock at a markup. Stock refreshes after every finished run. Pure rules on
// the profile's gold, stash, bag and equipment.
import { createRng } from '../simulation/mazeGenerator';
import { FINDABLE_GEAR, rollGear } from './equipment';
import type { Equipment, Slot } from './equipment';
import { firstFit, findItem, withoutItem } from './inventory';
import type { GridItem } from './inventory';
import { RARITIES, THREAD_ITEM, itemDef, itemValue } from './items';
import type { ItemDef } from './items';
import { STASH_SIZE, TRADER_GRID, TRADER_MARKUP, TRADER_RARITY_WEIGHTS, TRADER_STOCK_SIZE } from './tuning';

export type TraderId = 'weaponsmith' | 'armourer' | 'jeweller' | 'quartermaster';
export const TRADERS: readonly { id: TraderId; name: string; buysText: string }[] = [
  { id: 'weaponsmith', name: 'Weaponsmith', buysText: 'Buys weapons and shields.' },
  { id: 'armourer', name: 'Armourer', buysText: 'Buys chest armour, gloves and boots.' },
  { id: 'jeweller', name: 'Jeweller', buysText: 'Buys amulets, rings, coins, gems, valuables and relics.' },
  { id: 'quartermaster', name: 'Quartermaster', buysText: 'Buys materials, provisions and consumables. Sells bandages, potions, torches and thread.' },
];
export type Market = { refresh: number; stock: Record<TraderId, GridItem[]> };
export type Wallet = { gold: number; stash: GridItem[]; bag: GridItem[]; equipment: Equipment; market: Market };

const deals: Record<TraderId, (def: ItemDef) => boolean> = {
  weaponsmith: (def) => def.gear?.slot === 'weapon' || def.gear?.slot === 'shield',
  armourer: (def) => def.gear?.slot === 'chest' || def.gear?.slot === 'gloves' || def.gear?.slot === 'boots',
  jeweller: (def) => def.gear?.slot === 'amulet' || def.gear?.slot === 'ring' || def.category === 'valuable' || def.category === 'relic',
  quartermaster: (def) => def.category === 'material' || def.category === 'provision' || def.category === 'tool' || def.category === 'consumable',
};
// Whether a trader will buy this item (worthless items, like the starter sword, never sell).
export const traderBuys = (trader: TraderId, entry: { item: string }) => deals[trader](itemDef(entry.item)) && itemValue(entry) > 0;
export const sellPrice = (entry: { item: string; roll?: GridItem['roll'] }) => itemValue(entry);
export const buyPrice = (entry: { item: string; roll?: GridItem['roll'] }) => Math.ceil(itemValue(entry) * TRADER_MARKUP);

const hash = (text: string) => { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
// Seeded stock for one refresh: gear of the trader's kinds (the quartermaster: thread).
export function rollStock(trader: TraderId, refresh: number): GridItem[] {
  const rng = createRng((hash(trader) ^ Math.imul(refresh + 1, 0x9e3779b1)) >>> 0);
  const items: GridItem[] = [];
  const add = (item: string, roll?: GridItem['roll']) => {
    const uid = `t${refresh}.${trader}.${items.length + 1}`;
    const spot = firstFit(items, TRADER_GRID, item, uid);
    if (spot) items.push(roll ? { ...spot, roll } : spot);
  };
  if (trader === 'quartermaster') {
    for (const [item, count] of [['bandage', 3], ['healingPotion', 2], ['torch', 2], [THREAD_ITEM, 3]] as const) for (let n = 0; n < count; n++) add(item);
    return items;
  }
  const kinds = FINDABLE_GEAR.filter((def) => deals[trader](def));
  for (let n = 0; n < TRADER_STOCK_SIZE; n++) {
    let roll = rng.next() * TRADER_RARITY_WEIGHTS.reduce((sum: number, w) => sum + w, 0);
    let rarity = 0;
    while (roll >= TRADER_RARITY_WEIGHTS[rarity]) { roll -= TRADER_RARITY_WEIGHTS[rarity]; rarity++; }
    add(rng.pick(kinds).id, rollGear(RARITIES[rarity], () => rng.next()));
  }
  return items;
}
export const freshMarket = (refresh: number): Market =>
  ({ refresh, stock: Object.fromEntries(TRADERS.map((trader) => [trader.id, rollStock(trader.id, refresh)])) as Record<TraderId, GridItem[]> });
// Stock refreshes when the run counter has moved on (after every finished run).
export const marketFor = (market: Market | null, runs: number): Market => (market && market.refresh === runs ? market : freshMarket(runs));

export type SellFrom = { grid: 'stash' | 'bag'; uid: string } | { grid: 'equipment'; slot: Slot };
// Sell one item to a trader that buys it, for its value.
export function sellTo(wallet: Wallet, trader: TraderId, from: SellFrom): Wallet | null {
  const entry = from.grid === 'equipment' ? wallet.equipment[from.slot] : findItem(wallet[from.grid], from.uid);
  if (!entry || !traderBuys(trader, entry)) return null;
  const gold = wallet.gold + sellPrice(entry);
  if (from.grid === 'equipment') { const equipment = { ...wallet.equipment }; delete equipment[from.slot]; return { ...wallet, gold, equipment }; }
  return { ...wallet, gold, [from.grid]: withoutItem(wallet[from.grid], from.uid) };
}
// Buy one stocked item into the stash: needs the gold and a free spot.
export function buyFrom(wallet: Wallet, trader: TraderId, uid: string): Wallet | null {
  const entry = findItem(wallet.market.stock[trader], uid);
  if (!entry || wallet.gold < buyPrice(entry)) return null;
  const spot = firstFit(wallet.stash, STASH_SIZE, entry.item, uid);
  if (!spot) return null;
  return { ...wallet, gold: wallet.gold - buyPrice(entry), stash: [...wallet.stash, { ...spot, ...(entry.roll ? { roll: entry.roll } : {}) }],
    market: { ...wallet.market, stock: { ...wallet.market.stock, [trader]: withoutItem(wallet.market.stock[trader], uid) } } };
}
