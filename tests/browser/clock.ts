import type { Locator, Page } from '@playwright/test';

// Install before navigation, then freeze after pointer lock is acquired. Timed
// scenarios explicitly run every animation frame rather than jumping the clock
// (fastForward would skip simulation ticks). Game state is never set by tests.
export async function installBrowserClock(page: Page) {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
}

export async function freezeBrowserClock(page: Page) {
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'));
  await page.clock.runFor(120);
}

// Stationary menu actions can need fresh frames for Playwright's native
// visibility/stability checks. Keep one real click pending while advancing a
// bounded amount of controlled time; never force a click or set game state.
export async function clickWithBrowserFrames(page: Page, target: Locator) {
  let settled = false;
  let clickError: unknown;
  const click = target.click()
    .catch(error => { clickError = error; })
    .finally(() => { settled = true; });
  for (let i = 0; i < 10 && !settled; i++) await page.clock.runFor(100);
  await click;
  if (clickError) throw clickError;
}
