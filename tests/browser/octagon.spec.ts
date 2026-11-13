import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { installBrowserClock, freezeBrowserClock, clickWithBrowserFrames } from './clock';

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  return errors;
}

test('M18: the Octagon is the default; the lobby gate opens on E, you walk into the outer ring and back home to extract', async ({ page }) => {
  test.setTimeout(400_000);
  const errors = watchErrors(page);
  await installBrowserClock(page); await page.goto('/?seed=41&off=monsters,traps');
  await expect(page).toHaveTitle('Shifting Labyrinth · M18');
  await expect(page.getByText('DEVELOPMENT BUILD / M18 · THE OCTAGON')).toBeVisible();
  await clickWithBrowserFrames(page, page.getByRole('button', { name: 'Start exploring' }));
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('scene');
  await freezeBrowserClock(page);
  await expect(page.getByTestId('hud-ring')).toHaveText('Sanctuary');
  await expect(page.getByTestId('run-objective')).toContainText('press E to open your gate');
  // The gate is shut: walking north stays in the lobby.
  await page.keyboard.down('KeyW'); await page.clock.runFor(3000); await page.keyboard.up('KeyW');
  await page.clock.runFor(200);
  await expect(page.getByTestId('hud-ring')).toHaveText('Sanctuary');
  await page.keyboard.press('KeyE'); await page.clock.runFor(300);
  await expect(page.getByTestId('run-objective')).toContainText('Your gate opens in');
  await page.clock.runFor(4500);
  // Through the open gate into the hub room of the outer ring.
  await page.keyboard.down('KeyW'); await page.clock.runFor(4500); await page.keyboard.up('KeyW');
  await page.clock.runFor(200);
  await expect(page.getByTestId('hud-ring')).toHaveText('Outer ring');
  // Back south into the lobby: extracted, the gate shuts behind you.
  await page.keyboard.down('KeyS'); await page.clock.runFor(6000); await page.keyboard.up('KeyS');
  await page.clock.runFor(300);
  await expect(page.locator('#hud')).toHaveAttribute('data-result', 'extracted');
  expect(errors).toEqual([]);
});
