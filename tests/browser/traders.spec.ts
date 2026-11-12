import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installBrowserClock, clickWithBrowserFrames } from './clock';
import { SAVE_KEY } from '../../src/storage/save';
import { buyPrice, rollStock } from '../../src/game/traders';
import { itemValue } from '../../src/game/items';

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
async function startRunning(page: Page, name: string) {
  await clickWithBrowserFrames(page, page.getByRole('button', { name }));
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('scene');
}
const mail = { uid: 's.mail', item: 'chainmail', x: 0, y: 0, rotated: false, roll: { rarity: 'rare' as const, bonuses: [] } };
const ruby = { uid: 's.ruby', item: 'ruby', x: 3, y: 0, rotated: false };
const scrap = { uid: 's.scrap', item: 'ironScrap', x: 4, y: 0, rotated: false };

test('sell to the right traders, buy from one, and keep gold and stock after a reload', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.addInitScript(([key, value]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(key, value); sessionStorage.setItem('seeded', '1'); } },
    [SAVE_KEY, JSON.stringify({ format: 4, runs: 2, bag: [], inRun: false, traces: [], equipment: {}, gold: 0, market: null, stash: [mail, ruby, scrap] })]);
  await installBrowserClock(page);
  await page.goto('/?seed=41&off=monsters,traps');
  await startRunning(page, 'Start exploring');
  await page.keyboard.press('Tab'); await page.clock.runFor(200);
  await expect(page.getByTestId('gold')).toHaveText('0 gold');
  // The Armourer buys the chainmail (right-click), but not the ruby.
  await page.getByTestId('tab-armourer').click(); await page.clock.runFor(100);
  await expect(page.getByTestId('inventory-left-title')).toHaveText('Armourer');
  const stash = (uid: string) => page.locator(`[data-grid="second"] [data-uid="${uid}"]`);
  await stash('s.ruby').click({ button: 'right' }); await page.clock.runFor(100);
  await expect(stash('s.ruby')).toHaveCount(1);
  await stash('s.mail').click({ button: 'right' }); await page.clock.runFor(100);
  await expect(stash('s.mail')).toHaveCount(0);
  await expect(page.getByTestId('gold')).toHaveText(`${itemValue(mail)} gold`);
  // The Jeweller: drag the ruby onto the trader to sell it.
  await page.getByTestId('tab-jeweller').click(); await page.clock.runFor(100);
  const from = (await stash('s.ruby').boundingBox())!, to = (await page.locator('[data-grid="left"]').boundingBox())!;
  await page.mouse.move(from.x + 10, from.y + 10); await page.mouse.down();
  await page.mouse.move(to.x + 60, to.y + 60, { steps: 5 }); await page.mouse.up(); await page.clock.runFor(100);
  const gold = itemValue(mail) + itemValue(ruby);
  await expect(page.getByTestId('gold')).toHaveText(`${gold} gold`);
  // The Weaponsmith: buy the cheapest stocked item by right-click; it lands in the stash.
  await page.getByTestId('tab-weaponsmith').click(); await page.clock.runFor(100);
  const stock = rollStock('weaponsmith', 2);
  const cheapest = [...stock].sort((a, b) => buyPrice(a) - buyPrice(b))[0];
  expect(buyPrice(cheapest)).toBeLessThanOrEqual(gold);
  const item = page.locator(`[data-grid="left"] [data-uid="${cheapest.uid}"]`);
  await expect(item.getByTestId('price')).toHaveText(`${buyPrice(cheapest)}g`);
  await item.click({ button: 'right' }); await page.clock.runFor(100);
  await expect(item).toHaveCount(0);
  await expect(stash(cheapest.uid)).toHaveCount(1);
  await expect(page.getByTestId('gold')).toHaveText(`${gold - buyPrice(cheapest)} gold`);
  // Reload: gold, purchase and stock survive.
  await page.keyboard.press('Tab'); await page.clock.runFor(100);
  await page.clock.resume();
  await page.goto('/?seed=41&off=monsters,traps&visit=2');
  await startRunning(page, 'Start exploring');
  await page.keyboard.press('Tab'); await page.clock.runFor(200);
  await expect(page.getByTestId('gold')).toHaveText(`${gold - buyPrice(cheapest)} gold`);
  await page.getByTestId('tab-weaponsmith').click(); await page.clock.runFor(100);
  await expect(page.locator(`[data-grid="left"] [data-uid="${cheapest.uid}"]`)).toHaveCount(0);
  await expect(stash(cheapest.uid)).toHaveCount(1);
  await expect(stash('s.scrap')).toHaveCount(1);
  expect(errors).toEqual([]);
});
