/**
 * 09 — Export: generate → export Lottie (valid JSON) → export MP4 (video/mp4 ct).
 *
 * We capture the actual response Playwright sees rather than only watching
 * the download — the engine returns the file in-band for Lottie and
 * proxies the MP4 stream. Validates both the contract and the wiring.
 */
import { test, expect } from '@playwright/test';
import { mockGenerate, mockExport, mockThemes } from './helpers/mock-engine';

test.describe('export', () => {
  test.beforeEach(async ({ page }) => {
    await mockThemes(page);
    await mockGenerate(page);
    await mockExport(page);

    await page.goto('/');
    await page.getByTestId('prompt-textarea').fill('Test export reel');
    await page.getByTestId('generate-button').click();
    await expect(page.getByTestId('preview-stage')).toBeVisible();
  });

  test('Lottie export returns valid JSON', async ({ page }) => {
    await page.getByTestId('export-button').click();
    await page.getByTestId('export-format-lottie').click();

    // Intercept the response before the download trigger.
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/v1/export/lottie') && r.status() === 200, {
        timeout: 15_000,
      }),
      page.getByTestId('export-confirm').click(),
    ]);

    expect(resp.headers()['content-type']).toMatch(/application\/json/);
    const body = await resp.json();
    // Lottie schema sanity check.
    expect(body).toMatchObject({ v: expect.any(String), w: expect.any(Number), h: expect.any(Number) });
    expect(Array.isArray(body.layers)).toBe(true);

    // UI confirms success.
    await expect(page.getByTestId('export-success-toast')).toBeVisible();
  });

  test('MP4 export returns video/mp4', async ({ page }) => {
    await page.getByTestId('export-button').click();
    await page.getByTestId('export-format-mp4').click();

    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/v1/export/mp4') && r.status() === 200, {
        timeout: 15_000,
      }),
      page.getByTestId('export-confirm').click(),
    ]);

    expect(resp.headers()['content-type']).toBe('video/mp4');
    const buf = await resp.body();
    // ftyp box at bytes 4-8.
    expect(buf.slice(4, 8).toString('ascii')).toBe('ftyp');
  });

  test('export disabled until generate completes', async ({ page }) => {
    // Already generated in beforeEach — start a fresh nav to verify the gate.
    await page.goto('/');
    await expect(page.getByTestId('export-button')).toBeDisabled();
  });

  test('export error surfaces to user without losing preview', async ({ page }) => {
    await page.route('**/v1/export/lottie', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"fail"}' })
    );
    await page.getByTestId('export-button').click();
    await page.getByTestId('export-format-lottie').click();
    await page.getByTestId('export-confirm').click();
    await expect(page.getByTestId('error-banner')).toBeVisible();
    // Preview still there.
    await expect(page.getByTestId('preview-stage')).toBeVisible();
  });
});
