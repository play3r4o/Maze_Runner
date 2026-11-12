import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installBrowserClock, freezeBrowserClock, clickWithBrowserFrames } from './clock';
import { generateMaze } from '../../src/simulation/mazeGenerator';
import { buildGeneratedWorld } from '../../src/game/generatedRun';
import { itemDef } from '../../src/game/items';
import { SAVE_KEY } from '../../src/storage/save';

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
async function pause(page: Page) { await page.keyboard.press('Escape'); await page.clock.runFor(200); }
async function teleport(page: Page, cell: string) {
  await pause(page);
  await page.locator(`[data-testid="debug-room"][data-cell-id="${cell}"]`).click();
  await startRunning(page, 'Resume exploring');
  await page.clock.runFor(300);
}
const CELL = 46;
const world = buildGeneratedWorld(generateMaze(41));
const chest = world.containers.find((container) => container.kind === 'chest' && container.items.length >= 3)!;
const bagItems = (page: Page) => page.locator('[data-testid="grid-bag"] [data-testid="inv-item"]');

test('loot a chest by dragging and right-click, drop into a sack, extract, stash, and keep it all after a reload', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = watchErrors(page);
  await installBrowserClock(page);
  await page.goto('/?seed=41&off=monsters,traps');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await expect(page.locator('[data-testid="debug-container"][data-kind="chest"]')).toHaveCount(world.containers.filter((c) => c.kind === 'chest').length);
  await startRunning(page, 'Start exploring');
  await freezeBrowserClock(page);
  await teleport(page, chest.cell);
  await expect(page.getByTestId('interact-target')).toHaveText('chest');
  await page.keyboard.press('KeyE'); await page.clock.runFor(300);
  await expect(page.getByTestId('inventory-left-title')).toHaveText('Chest');
  const inChest = page.locator('[data-grid="left"] [data-testid="inv-item"]');
  await expect(inChest).toHaveCount(chest.items.length);

  // Drag the first item by its top-left cell onto bag cell (3, 1).
  const first = inChest.first();
  const uid = await first.getAttribute('data-uid');
  const from = (await first.boundingBox())!, bag = (await page.getByTestId('grid-bag').boundingBox())!;
  await page.mouse.move(from.x + 10, from.y + 10);
  await page.mouse.down();
  await page.mouse.move(bag.x + 3 * CELL + 10, bag.y + CELL + 10, { steps: 5 });
  await page.mouse.up();
  await page.clock.runFor(200);
  const dragged = page.locator(`[data-testid="grid-bag"] [data-uid="${uid}"]`);
  await expect(dragged).toHaveCount(1);
  await expect(dragged).toHaveCSS('left', `${3 * CELL}px`);
  await expect(dragged).toHaveCSS('top', `${CELL}px`);
  // Right-click the rest into the bag.
  for (let n = 1; n < chest.items.length; n++) { await inChest.first().click({ button: 'right' }); await page.clock.runFor(100); }
  await expect(inChest).toHaveCount(0);
  // The bag also holds the free thread spool (starter kit).
  await expect(bagItems(page)).toHaveCount(chest.items.length + 1);
  // Hover shows the item's details.
  await dragged.hover();
  await expect(page.getByTestId('inventory-tooltip')).toContainText('gold');
  // Drag one bag item to the drop zone: it goes into a sack at the player's feet.
  const drop = (await page.getByTestId('inventory-drop').boundingBox())!;
  const box = (await dragged.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down();
  await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height / 2, { steps: 5 }); await page.mouse.up();
  await page.clock.runFor(200);
  await expect(bagItems(page)).toHaveCount(chest.items.length);
  await expect(page.locator('[data-testid="debug-container"][data-kind="sack"]')).toHaveCount(1);
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('scene');
  await expect(page.getByTestId('bag-summary')).toContainText(`bag ${chest.items.length} item`);

  // Home: stepping into Sanctuary extracts with the bag.
  await pause(page);
  await page.locator(`[data-testid="debug-room"][data-cell-id="${world.maze.start}"]`).click();
  await clickWithBrowserFrames(page, page.getByRole('button', { name: 'Resume exploring' }));
  await page.clock.runFor(300);
  await expect(page.locator('#panel-title')).toHaveText(/Loot secured|The Heart is yours/);
  await expect(page.locator('.panel-description')).toContainText(`carrying ${chest.items.length} item`);

  // Retry: in Sanctuary, Tab opens the bag beside the stash. Move one item to the stash.
  await startRunning(page, 'Retry this seed');
  await page.keyboard.press('Tab'); await page.clock.runFor(200);
  await expect(page.getByTestId('inventory-left-title')).toHaveText('Stash');
  await expect(bagItems(page)).toHaveCount(chest.items.length);
  // Stash something other than the spool (a missing spool is replaced by the starter kit).
  const loot = page.locator('[data-testid="grid-bag"] [data-testid="inv-item"]:not([data-item="threadSpool"])').first();
  const stashed = await loot.getAttribute('data-uid');
  await loot.click({ button: 'right' }); await page.clock.runFor(200);
  await expect(page.locator(`[data-grid="left"] [data-uid="${stashed}"]`)).toHaveCount(1);
  await page.keyboard.press('Tab'); await page.clock.runFor(200);

  // Reload: bag and stash come back from the save.
  await page.clock.resume();
  await page.goto('/?seed=41&off=monsters,traps&visit=2');
  await startRunning(page, 'Start exploring');
  await page.keyboard.press('Tab'); await page.clock.runFor(300);
  await expect(page.locator(`[data-grid="left"] [data-uid="${stashed}"]`)).toHaveCount(1);
  await expect(bagItems(page)).toHaveCount(chest.items.length - 1);
  expect(errors).toEqual([]);
});

test('death loses the bag; closing the page mid-run counts as abandoning it', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  const ruby = { uid: 'r9.test.1', item: 'ruby', x: 0, y: 0, rotated: false };
  // A profile that already carries a ruby (as after an earlier extraction).
  await page.addInitScript(([key, value]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(key, value); sessionStorage.setItem('seeded', '1'); } },
    [SAVE_KEY, JSON.stringify({ format: 1, runs: 9, bag: [ruby], stash: [], inRun: false })]);
  await installBrowserClock(page);
  await page.goto('/?seed=41&off=monsters');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await expect(page.getByTestId('bag-summary')).toContainText(`bag 2 items · ${itemDef('ruby').value + 2}g`);
  await startRunning(page, 'Start exploring');
  await freezeBrowserClock(page);
  const pit = world.traps.find((trap) => trap.kind === 'pit')!;
  await teleport(page, pit.cell);
  await page.clock.runFor(1500);
  await expect(page.locator('#panel-title')).toHaveText('You died.');
  await expect(page.locator('.panel-description')).toContainText(`Lost: 2 items worth ${itemDef('ruby').value + 2} gold`);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), SAVE_KEY);
  expect(saved).toMatchObject({ bag: [], inRun: false, runs: 10 });

  // Mid-run reload: put a ruby back in the save, leave Sanctuary, reload.
  await page.evaluate(([key, value]) => localStorage.setItem(key, value), [SAVE_KEY, JSON.stringify({ format: 1, runs: 10, bag: [ruby], stash: [], inRun: false })]);
  await page.clock.resume();
  await page.goto('/?seed=41&off=monsters,traps&visit=2');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await startRunning(page, 'Start exploring');
  await teleport(page, chest.cell);
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).inRun, SAVE_KEY)).toBe(true);
  await page.goto('/?seed=41&off=monsters,traps&visit=3');
  await expect(page.locator('[data-message]')).toContainText('never finished');
  // The ruby is gone; only a fresh starter spool is in the bag.
  await expect(page.getByTestId('bag-summary')).toHaveText('bag 1 item · 2g');
  expect(errors).toEqual([]);
});
