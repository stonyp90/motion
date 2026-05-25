/**
 * 07 — i18n: EN ↔ FR toggle, key strings update, html lang attribute follows.
 *
 * We assert on the hero CTA + nav strings which are stable copy points.
 */
import { test, expect } from '@playwright/test';

const STRINGS = {
  en: { generate: /generate/i, signOut: /sign out/i, cast: /cast/i },
  fr: { generate: /générer/i, signOut: /se déconnecter|déconnexion/i, cast: /distribution|équipe/i },
};

test.describe('i18n', () => {
  test('switches EN → FR and back', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');

    // Default is EN.
    await expect(html).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('generate-button')).toHaveText(STRINGS.en.generate);

    // Switch to FR via toggle.
    await page.getByTestId('lang-toggle').click();
    await page.getByTestId('lang-option-fr').click();

    await expect(html).toHaveAttribute('lang', 'fr');
    await expect(page.getByTestId('generate-button')).toHaveText(STRINGS.fr.generate);

    // Cast drawer button label too.
    await expect(page.getByTestId('cast-drawer-toggle')).toContainText(STRINGS.fr.cast);

    // Switch back.
    await page.getByTestId('lang-toggle').click();
    await page.getByTestId('lang-option-en').click();
    await expect(html).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('generate-button')).toHaveText(STRINGS.en.generate);
  });

  test('FR persists across reload', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('lang-toggle').click();
    await page.getByTestId('lang-option-fr').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page.getByTestId('generate-button')).toHaveText(STRINGS.fr.generate);
  });

  test('respects Accept-Language on first visit', async ({ browser }) => {
    const ctx = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      locale: 'fr-CA',
    });
    const page = await ctx.newPage();
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await ctx.close();
  });
});
