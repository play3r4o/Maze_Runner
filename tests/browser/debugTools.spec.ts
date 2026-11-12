import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installBrowserClock, freezeBrowserClock, clickWithBrowserFrames } from './clock';
import { generateMaze, layoutFingerprint } from '../../src/simulation/mazeGenerator';
import { REPORT_FORMAT } from '../../src/game/runReport';

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}
async function startRunning(page: Page, name: 'Start exploring' | 'Resume exploring') {
  await clickWithBrowserFrames(page, page.getByRole('button', { name }));
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('scene');
}
async function pause(page: Page) {
  await page.keyboard.press('Escape'); await page.clock.runFor(200);
  await expect(page.getByTestId('hud')).toHaveAttribute('data-state', 'paused');
}

test('freeze holds a shift in place, teleport moves rings, and events record both', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const maze = generateMaze(41);
  await installBrowserClock(page); await page.goto('/?seed=41&off=monsters');
  await expect(page).toHaveTitle('Shifting Labyrinth · M16');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await startRunning(page, 'Start exploring');
  await freezeBrowserClock(page);
  await page.keyboard.press('KeyG'); await page.clock.runFor(500);
  await expect(page.getByTestId('debug-phase')).toHaveText('warning');
  await pause(page);
  await page.getByTestId('debug-freeze').click(); await page.clock.runFor(200);
  await expect(page.getByTestId('debug-freeze')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: `→ ${maze.landmarks[2].name.split(' ')[0]}` }).click();
  await expect(page.getByTestId('debug-tool-status')).toContainText(`Teleported to ${maze.landmarks[2].cell} (outer)`);
  await startRunning(page, 'Resume exploring');
  await page.clock.runFor(4000);
  // Frozen: still warning after far longer than the 2 s warning; walking state continues.
  await expect(page.getByTestId('debug-phase')).toHaveText('warning');
  await expect(page.getByTestId('shift-phase')).toContainText('frozen (debug)');
  await expect(page.getByTestId('hud-ring')).toHaveText('Outer ring');
  await pause(page);
  await page.getByTestId('debug-freeze').click(); await page.clock.runFor(200);
  await expect(page.getByTestId('debug-freeze')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('.debug-events summary').click(); await page.clock.runFor(200);
  const events = page.getByTestId('debug-events');
  for (const text of ['shift: debug accepted', 'freeze: shift timers frozen', `teleport: to ${maze.landmarks[2].cell} (outer)`,
    'visit: rose', 'freeze: shift timers resumed']) await expect(events).toContainText(text);
  // Clicking a room on the map teleports too.
  await page.locator(`[data-testid="debug-room"][data-cell-id="${maze.start}"]`).click();
  await expect(page.getByTestId('debug-tool-status')).toContainText(`Teleported to ${maze.start} (sanctuary)`);
  await expect(page.getByTestId('debug-errors')).toHaveText('0');
  expect(errors).toEqual([]);
});

test('a copied report reloads its seed and reproduces gate state and position exactly', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await installBrowserClock(page); await page.goto('/?seed=41&off=monsters');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await startRunning(page, 'Start exploring');
  await freezeBrowserClock(page);
  await page.keyboard.down('KeyW'); await page.clock.runFor(1500); await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyG');
  await page.clock.runFor(5250); // Mid-closing: 2 s warning + 1.25 s opening + ~2 s closing.
  await pause(page);
  await page.getByRole('button', { name: 'Copy report' }).click();
  const text = await page.getByTestId('report-text').inputValue();
  const report = JSON.parse(text);
  expect(report).toMatchObject({ seed: 41, requests: 1, expect: { phase: 'closing', revision: 2 } });
  const before = { revision: await page.getByTestId('debug-revision').textContent(),
    x: await page.getByTestId('debug-player').getAttribute('data-x'), z: await page.getByTestId('debug-player').getAttribute('data-z'),
    g7: await page.getByTestId('debug-gate-g7').getAttribute('data-openness') };
  expect(Number(before.g7)).toBeGreaterThan(0); expect(Number(before.g7)).toBeLessThan(1);

  // Load it from a different seed: the page reloads seed 41 and replays the report.
  await page.goto('/?seed=1');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await page.locator('.debug-report summary').click();
  await page.getByTestId('report-text').fill(text);
  await page.getByRole('button', { name: 'Load report' }).click();
  await expect(page).toHaveURL(/[?&]seed=41(&|$)/);
  await expect(page.locator('[data-message]')).toContainText('Gate state matches the report exactly.');
  expect(new URL(page.url()).hash).toBe('');
  await page.getByRole('button', { name: 'F2 · Debug map' }).click();
  await page.clock.runFor(200);
  await expect(page.getByTestId('debug-revision')).toHaveText(before.revision!);
  await expect(page.getByTestId('debug-gate-g7')).toHaveAttribute('data-openness', before.g7!);
  await expect(page.getByTestId('debug-player')).toHaveAttribute('data-x', before.x!);
  await expect(page.getByTestId('debug-player')).toHaveAttribute('data-z', before.z!);
  await expect(page.getByTestId('debug-phase')).toHaveText('closing');

  // Malformed and wrong-version reports are refused with a reason.
  await page.locator('.debug-report summary').click();
  await page.getByTestId('report-text').fill(JSON.stringify({ format: REPORT_FORMAT, version: 'm4.1' }));
  await page.getByRole('button', { name: 'Load report' }).click();
  await expect(page.getByTestId('debug-tool-status')).toContainText('Report not loaded: Report is from generator m4.1');
  expect(errors).toEqual([]);
});

test('repeated regeneration: ten seeds in a row rebuild correctly without page errors', async ({ page }) => {
  test.setTimeout(150_000);
  const errors = watchErrors(page);
  await page.goto('/?seed=5');
  for (let i = 0; i < 10; i++) {
    await page.getByRole('button', { name: 'F2 · Debug map' }).click();
    await page.getByRole('button', { name: 'Random' }).click();
    await page.waitForURL((url) => url.searchParams.get('seed') !== null);
    const seed = Number(new URL(page.url()).searchParams.get('seed'));
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.mazeFingerprint))
      .toBe(layoutFingerprint(generateMaze(seed)));
    await expect(page.getByTestId('hud-seed')).toHaveText(`seed ${seed}`);
  }
  expect(errors).toEqual([]);
});
