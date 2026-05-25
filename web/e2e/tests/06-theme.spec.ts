/**
 * 06 — Theme toggle: data-theme flips, computed background changes, persists on reload.
 */
import { test, expect } from '@playwright/test';

test.describe('theme', () => {
  test('toggles between light and dark and persists', async ({ page }) => {
    await page.goto('/');

    const html = page.locator('html');
    const initialTheme = await html.getAttribute('data-theme');
    expect(['light', 'dark']).toContain(initialTheme);

    const bgBefore = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor
    );

    await page.getByTestId('theme-toggle').click();

    // data-theme flips.
    const newTheme = initialTheme === 'light' ? 'dark' : 'light';
    await expect(html).toHaveAttribute('data-theme', newTheme);

    // Computed background actually changed — proves CSS variables are wired.
    const bgAfter = await page.evaluate(
      () => getComputedStyle(document.body).backgroundColor
    );
    expect(bgAfter).not.toBe(bgBefore);

    // Reload and confirm persistence.
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', newTheme);
  });

  test('respects prefers-color-scheme on first visit', async ({ browser }) => {
    // Fresh context with no localStorage, dark color scheme.
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      colorScheme: 'dark',
    });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await ctx.close();
  });

  test('theme toggle has accessible label', async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByTestId('theme-toggle');
    const label = await toggle.getAttribute('aria-label');
    expect(label).toMatch(/theme|dark|light/i);
  });
});
