/**
 * 08 — Accessibility: zero serious axe violations on key surfaces.
 *
 * Disabled rules are documented inline so future regressions can revisit.
 */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockCastLibrary } from './helpers/mock-engine';

const SERIOUS_OR_WORSE = ['serious', 'critical'] as const;

async function runAxe(page: import('@playwright/test').Page, scopeSelector?: string) {
  let builder = new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // `color-contrast` is finicky on dynamic themes; we cover it in 06-theme separately.
    .disableRules(['color-contrast']);
  if (scopeSelector) builder = builder.include(scopeSelector);
  return builder.analyze();
}

function serious(results: { violations: Array<{ impact?: string | null; id: string; nodes: unknown[] }> }) {
  return results.violations.filter((v) =>
    SERIOUS_OR_WORSE.includes((v.impact ?? 'minor') as (typeof SERIOUS_OR_WORSE)[number])
  );
}

test.describe('a11y', () => {
  test('home page has no serious violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('prompt-textarea')).toBeVisible();
    const results = await runAxe(page);
    const blocking = serious(results);
    expect.soft(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test('cast drawer has no serious violations', async ({ page }) => {
    await mockCastLibrary(page);
    await page.goto('/');
    await page.getByTestId('cast-drawer-toggle').click();
    await expect(page.getByTestId('cast-drawer')).toHaveAttribute('data-open', 'true');
    const results = await runAxe(page, '[data-testid="cast-drawer"]');
    const blocking = serious(results);
    expect.soft(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });

  test('sign-in page has no serious violations', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.getByTestId('signin-button')).toBeVisible();
    const results = await runAxe(page);
    const blocking = serious(results);
    expect.soft(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
    await ctx.close();
  });

  test('keyboard reaches all primary actions', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('prompt-textarea')).toBeVisible();
    const reachable: string[] = [];
    // Tab through and collect any testids we land on. Bounded.
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '');
      if (id) reachable.push(id);
    }
    for (const required of ['prompt-textarea', 'mic-button', 'generate-button', 'cast-drawer-toggle']) {
      expect.soft(reachable, `not reachable via keyboard: ${required}`).toContain(required);
    }
  });
});
