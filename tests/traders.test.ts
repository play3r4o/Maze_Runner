import { describe, expect, it } from 'vitest';
import { buyFrom, buyPrice, freshMarket, marketFor, rollStock, sellPrice, sellTo, traderBuys, TRADERS } from '../src/game/traders';
import type { TraderId, Wallet } from '../src/game/traders';
import { itemDef, itemValue } from '../src/game/items';
import type { GridItem } from '../src/game/inventory';
import { gridValid } from '../src/game/inventory';
import { STASH_SIZE } from '../src/game/tuning';
import { emptyProfile, parseProfile } from '../src/storage/save';

const gear = (uid: string, item: string, rarity: 'common' | 'rare' = 'common'): GridItem => ({ uid, item, x: 0, y: 0, rotated: false, roll: { rarity, bonuses: [] } });
const plain = (uid: string, item: string, x = 0, y = 0): GridItem => ({ uid, item, x, y, rotated: false });
const wallet = (patch: Partial<Wallet> = {}): Wallet => ({ gold: 0, stash: [], bag: [], equipment: {}, market: freshMarket(0), ...patch });

describe('M16 traders', () => {
  it('each trader buys only its kinds; worthless items never sell', () => {
    expect(traderBuys('weaponsmith', gear('a', 'battleAxe'))).toBe(true);
    expect(traderBuys('weaponsmith', gear('a', 'buckler'))).toBe(true);
    expect(traderBuys('weaponsmith', gear('a', 'chainmail'))).toBe(false);
    expect(traderBuys('armourer', gear('a', 'leatherBoots'))).toBe(true);
    expect(traderBuys('jeweller', gear('a', 'copperRing'))).toBe(true);
    expect(traderBuys('jeweller', plain('a', 'ruby'))).toBe(true);
    expect(traderBuys('jeweller', plain('a', 'heartOfMaze'))).toBe(true);
    expect(traderBuys('jeweller', plain('a', 'ironScrap'))).toBe(false);
    expect(traderBuys('quartermaster', plain('a', 'ironScrap'))).toBe(true);
    expect(traderBuys('quartermaster', plain('a', 'hardtack'))).toBe(true);
    expect(traderBuys('weaponsmith', gear('a', 'rustySword'))).toBe(false);
    expect(sellPrice(gear('a', 'chainmail', 'rare'))).toBe(210);
    expect(buyPrice(gear('a', 'chainmail', 'rare'))).toBe(315);
  });

  it('stock is seeded per refresh, of the trader kinds, valid in its grid; the market refreshes after a run', () => {
    expect(rollStock('weaponsmith', 4)).toEqual(rollStock('weaponsmith', 4));
    expect(rollStock('weaponsmith', 4)).not.toEqual(rollStock('weaponsmith', 5));
    for (let refresh = 0; refresh < 30; refresh++) for (const trader of TRADERS) {
      const stock = rollStock(trader.id, refresh);
      expect(stock.length).toBeGreaterThan(0);
      for (const entry of stock) {
        expect(trader.id === 'quartermaster' ? entry.item === 'threadSpool' : traderBuys(trader.id, entry)).toBe(true);
        expect(['epic', 'legendary']).not.toContain(entry.roll?.rarity);
      }
    }
    const market = freshMarket(3);
    expect(marketFor(market, 3)).toBe(market);
    expect(marketFor(market, 4).refresh).toBe(4);
    expect(marketFor(null, 0).refresh).toBe(0);
  });

  it('selling pays the value; buying costs 1.5×, needs gold and stash room, and leaves the stock', () => {
    let w = wallet({ bag: [plain('r', 'ruby')], stash: [gear('m', 'mace')], equipment: { chest: gear('c', 'chainmail') } });
    expect(sellTo(w, 'weaponsmith', { grid: 'bag', uid: 'r' })).toBeNull();
    w = sellTo(w, 'jeweller', { grid: 'bag', uid: 'r' })!;
    expect(w).toMatchObject({ gold: 65, bag: [] });
    w = sellTo(w, 'armourer', { grid: 'equipment', slot: 'chest' })!;
    expect(w.gold).toBe(135);
    expect(w.equipment).toEqual({});
    w = sellTo(w, 'weaponsmith', { grid: 'stash', uid: 'm' })!;
    expect(w).toMatchObject({ gold: 185, stash: [] });
    const item = w.market.stock.weaponsmith.find((entry) => buyPrice(entry) <= 185)!;
    const bought = buyFrom(w, 'weaponsmith', item.uid)!;
    expect(bought.gold).toBe(185 - buyPrice(item));
    expect(bought.stash.map((entry) => entry.uid)).toEqual([item.uid]);
    expect(bought.stash[0].roll).toEqual(item.roll);
    expect(bought.market.stock.weaponsmith.some((entry) => entry.uid === item.uid)).toBe(false);
    expect(buyFrom(bought, 'weaponsmith', item.uid)).toBeNull();
    expect(buyFrom(wallet({ gold: 0 }), 'weaponsmith', item.uid)).toBeNull();
    // A full stash refuses.
    const full: GridItem[] = [];
    for (let y = 0; y < STASH_SIZE.height; y++) for (let x = 0; x < STASH_SIZE.width; x++) full.push(plain(`f${x}.${y}`, 'ruby', x, y));
    expect(gridValid(full, STASH_SIZE)).toBe(true);
    expect(buyFrom(wallet({ gold: 9999, stash: full }), 'weaponsmith', item.uid)).toBeNull();
  });

  it('gold is conserved over random trading', () => {
    let w = wallet({ gold: 500, stash: [gear('a', 'shortsword'), plain('b', 'ruby', 1, 0), plain('c', 'ironScrap', 2, 0), gear('d', 'gauntlets')].map((e, i) => ({ ...e, x: i * 2 })) });
    let seed = 5;
    const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const worth = (x: Wallet) => x.gold + x.stash.reduce((sum, e) => sum + itemValue(e), 0);
    for (let i = 0; i < 400; i++) {
      const trader = TRADERS[Math.floor(random() * 4)].id as TraderId;
      if (random() < 0.5 && w.stash.length) {
        const entry = w.stash[Math.floor(random() * w.stash.length)];
        const next = sellTo(w, trader, { grid: 'stash', uid: entry.uid });
        if (next) { expect(next.gold - w.gold).toBe(itemValue(entry)); w = next; }
      } else {
        const stock = w.market.stock[trader];
        if (!stock.length) continue;
        const entry = stock[Math.floor(random() * stock.length)];
        const before = worth(w);
        const next = buyFrom(w, trader, entry.uid);
        if (next) { expect(before - worth(next)).toBe(buyPrice(entry) - itemValue(entry)); w = next; }
      }
      expect(w.gold).toBeGreaterThanOrEqual(0);
      expect(gridValid(w.stash, STASH_SIZE)).toBe(true);
    }
    expect(itemDef('ruby').value).toBe(65);
  });

  it('saves keep gold and market; older saves start with 0 gold', () => {
    const profile = { ...emptyProfile(), gold: 340, market: freshMarket(2) };
    expect(parseProfile(JSON.stringify(profile)).profile).toEqual(profile);
    expect(parseProfile(JSON.stringify({ format: 3, runs: 1, bag: [], stash: [], inRun: false, traces: [], equipment: {} })).profile).toMatchObject({ gold: 0, market: null });
    expect(parseProfile(JSON.stringify({ ...profile, gold: -5 })).notice).toContain('damaged');
  });
});
