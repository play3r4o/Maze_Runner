import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installBrowserClock, freezeBrowserClock, clickWithBrowserFrames } from './clock';
import { cellPosition, edgeId } from '../../src/simulation/maze';
import { generateMaze } from '../../src/simulation/mazeGenerator';
import { buildGeneratedWorld, createGeneratedRun } from '../../src/game/generatedRun';
import type { GeneratedRun } from '../../src/game/generatedRun';
import { ALL_RULES_ON } from '../../src/game/pressure';
import { createRunReport } from '../../src/game/runReport';
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
const world = buildGeneratedWorld(generateMaze(41));
const common = { rarity: 'common' as const, bonuses: [] };
const slotItem = (page: Page, slot: string) => page.locator(`[data-testid="slot-${slot}"] [data-testid="inv-item"]`);
const stat = (page: Page, name: string) => page.locator(`[data-testid="character-stats"] dd[data-stat="${name}"]`);

test('equip by dragging and right-click, stats update, and an axe cuts down a husk', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  // A corridor: the player at one end facing a husk 1.8 m away; an axe and chainmail in the bag.
  const { maze } = world;
  const pair = maze.cells.flatMap((a) => maze.cells.filter((b) => b.column === a.column + 1 && b.row === a.row
    && maze.rings[a.id] !== 'sanctuary' && maze.rings[b.id] !== 'sanctuary' && maze.edges.some((e) => e.id === edgeId(a.id, b.id) && !e.gate)).map((b) => [a, b]))[0];
  const from = cellPosition(pair[0], maze);
  const base = createGeneratedRun(world, { ...ALL_RULES_ON, traps: false }, { starterKit: true });
  const husk = base.monsters.findIndex((m) => m.kind === 'husk');
  const run: GeneratedRun = { ...base, status: 'out', leftSanctuary: true, player: { ...from, yaw: -Math.PI / 2 },
    bag: [{ uid: 't.axe', item: 'battleAxe', x: 0, y: 0, rotated: false, roll: common }, { uid: 't.mail', item: 'chainmail', x: 2, y: 0, rotated: false, roll: common }],
    monsters: base.monsters.map((m, i) => (i === husk ? { ...m, x: from.x + 1.8, z: from.z, mode: 'chase' as const, path: [], goal: null } : { ...m, mode: 'dead' as const })) };
  await installBrowserClock(page);
  await page.goto(`/?seed=41&off=traps#repro=${encodeURIComponent(JSON.stringify(createRunReport(world, run)))}`);
  await expect(page.locator('[data-message]')).toContainText('Gate state matches the report exactly.');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await startRunning(page, 'Start exploring');
  await freezeBrowserClock(page);
  await expect(page.getByTestId('bolts')).toHaveText('Rusty Shortsword');
  // Tab: the character panel shows the starter sword. Drag the axe onto the main hand.
  await page.keyboard.press('Tab'); await page.clock.runFor(200);
  await expect(slotItem(page, 'mainHand')).toHaveAttribute('data-item', 'rustySword');
  const axe = (await page.locator('[data-testid="grid-bag"] [data-uid="t.axe"]').boundingBox())!;
  const main = (await page.getByTestId('slot-mainHand').boundingBox())!;
  await page.mouse.move(axe.x + 10, axe.y + 10); await page.mouse.down();
  await page.mouse.move(main.x + 40, main.y + 40, { steps: 5 }); await page.mouse.up();
  await page.clock.runFor(200);
  await expect(slotItem(page, 'mainHand')).toHaveAttribute('data-item', 'battleAxe');
  await expect(page.locator('[data-testid="grid-bag"] [data-item="rustySword"]')).toHaveCount(1);
  await expect(page.getByTestId('slot-offHand')).toHaveAttribute('data-blocked', 'true');
  await expect(stat(page, 'Weapon')).toHaveText('Battle Axe · 48 dmg');
  // Right-click the chainmail: worn, armour and speed change.
  await page.locator('[data-testid="grid-bag"] [data-uid="t.mail"]').click({ button: 'right' }); await page.clock.runFor(200);
  await expect(slotItem(page, 'chest')).toHaveAttribute('data-item', 'chainmail');
  await expect(stat(page, 'Armour')).toHaveText('35 (−26% damage)');
  await expect(stat(page, 'Move speed')).toHaveText('-4%');
  // Hover shows the rolled stats.
  await slotItem(page, 'chest').hover();
  await expect(page.getByTestId('inventory-tooltip')).toContainText('Armour +35');
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('scene');
  // Two swings.
  for (let n = 0; n < 2; n++) { await page.mouse.down(); await page.mouse.up(); await page.clock.runFor(1300); }
  await expect(page.locator('[data-testid="debug-monster"][data-kind="husk"][data-mode="dead"]')).toHaveCount(world.monsters.filter((m) => m.kind === 'husk').length);
  await page.keyboard.press('Escape'); await page.clock.runFor(200);
  const details = page.locator('.debug-events');
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open))) await page.locator('.debug-events summary').click();
  await expect(page.getByTestId('debug-events')).toContainText(`m${husk + 1} husk killed by melee`);
  expect(errors).toEqual([]);
});

test('at the base, gear from the stash is worn and stays worn after a reload', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.addInitScript(([key, value]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(key, value); sessionStorage.setItem('seeded', '1'); } },
    [SAVE_KEY, JSON.stringify({ format: 3, runs: 1, bag: [], inRun: false, traces: [], equipment: {},
      stash: [{ uid: 's.boots', item: 'leatherBoots', x: 0, y: 0, rotated: false, roll: { rarity: 'rare', bonuses: [{ stat: 'maxHealth', value: 12 }, { stat: 'stealth', value: 8 }] } }] })]);
  await installBrowserClock(page);
  await page.goto('/?seed=41&off=monsters,traps');
  await startRunning(page, 'Start exploring');
  await page.keyboard.press('Tab'); await page.clock.runFor(200);
  await expect(page.getByTestId('inventory-left-title')).toHaveText('Stash');
  const boots = page.locator('[data-grid="left"] [data-uid="s.boots"]');
  await expect(boots).toHaveAttribute('data-rarity', 'rare');
  // Drag from the stash straight onto the boots slot.
  const box = (await boots.boundingBox())!, slot = (await page.getByTestId('slot-boots').boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down();
  await page.mouse.move(slot.x + 40, slot.y + 40, { steps: 5 }); await page.mouse.up(); await page.clock.runFor(200);
  await expect(slotItem(page, 'boots')).toHaveAttribute('data-uid', 's.boots');
  await expect(stat(page, 'Max health')).toHaveText('112');
  await expect(stat(page, 'Stealth')).toHaveText('+8%');
  await page.keyboard.press('Tab'); await page.clock.runFor(200);
  await page.clock.resume();
  await page.goto('/?seed=41&off=monsters,traps&visit=2');
  await startRunning(page, 'Start exploring');
  await page.keyboard.press('Tab'); await page.clock.runFor(300);
  await expect(slotItem(page, 'boots')).toHaveAttribute('data-uid', 's.boots');
  await expect(page.locator('[data-grid="left"] [data-uid="s.boots"]')).toHaveCount(0);
  await expect(page.getByTestId('health')).toHaveText('112');
  expect(errors).toEqual([]);
});
