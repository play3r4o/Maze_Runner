import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installBrowserClock, freezeBrowserClock, clickWithBrowserFrames } from './clock';
import { generateMaze } from '../../src/simulation/mazeGenerator';
import { buildGeneratedWorld, createGeneratedRun } from '../../src/game/generatedRun';
import type { GeneratedRun } from '../../src/game/generatedRun';
import { ALL_RULES_ON } from '../../src/game/pressure';
import { createRunReport } from '../../src/game/runReport';

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
const world = buildGeneratedWorld(generateMaze(41));

test('the map shows the new threats; a mimic chest bites when opened and wakes', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const mimic = world.monsters.find((m) => m.kind === 'mimic')!;
  const chest = world.containers.find((c) => c.id === mimic.container)!;
  const base = createGeneratedRun(world, { ...ALL_RULES_ON, traps: false });
  // Only the mimic is awake in this report (the rest lie dead), so nothing else interferes.
  const run: GeneratedRun = { ...base, status: 'out', leftSanctuary: true, player: { x: chest.x + 1, z: chest.z, yaw: Math.PI / 2 },
    monsters: base.monsters.map((m) => (m.kind === 'mimic' ? m : { ...m, mode: 'dead' as const })) };
  await installBrowserClock(page);
  await page.goto(`/?seed=41&off=traps#repro=${encodeURIComponent(JSON.stringify(createRunReport(world, run)))}`);
  await expect(page.locator('[data-message]')).toContainText('Gate state matches the report exactly.');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  for (const kind of ['spitter', 'brute', 'ram', 'mimic']) await expect(page.locator(`[data-testid="debug-monster"][data-kind="${kind}"]`).first()).toBeAttached();
  await expect(page.locator('[data-testid="debug-monster"][data-kind="mimic"]')).toHaveAttribute('data-mode', 'dormant');
  await clickWithBrowserFrames(page, page.getByRole('button', { name: 'Start exploring' }));
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('scene');
  await freezeBrowserClock(page);
  await expect(page.getByTestId('interact-target')).toHaveText('chest');
  await page.keyboard.press('KeyE'); await page.clock.runFor(300);
  await expect(page.getByTestId('inventory')).toBeHidden();
  await expect(page.getByTestId('health')).not.toHaveText('100');
  await expect(page.locator('[data-testid="debug-monster"][data-kind="mimic"]')).toHaveAttribute('data-mode', 'chase');
  await page.keyboard.press('Escape'); await page.clock.runFor(200);
  const details = page.locator('.debug-events');
  if (!(await details.evaluate((node) => (node as HTMLDetailsElement).open))) await page.locator('.debug-events summary').click();
  await expect(page.getByTestId('debug-events')).toContainText(`${mimic.id} mimic woke`);
  await expect(page.getByTestId('debug-events')).toContainText('mimic -25');
  expect(errors).toEqual([]);
});
