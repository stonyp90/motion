/**
 * 02 — Prompt flow: type prompt → Generate → preview appears → Export.
 *
 * Engine response mocked for determinism. Real network/auth still exercised.
 */
import { test, expect } from '@playwright/test';
import { mockGenerate, mockExport, mockThemes } from './helpers/mock-engine';

test.describe('prompt flow', () => {
  test.beforeEach(async ({ page }) => {
    await mockThemes(page);
    await mockGenerate(page);
    await mockExport(page);
  });

  test('types prompt, generates, preview renders', async ({ page }) => {
    await page.goto('/');

    const textarea = page.getByTestId('prompt-textarea');
    await expect(textarea).toBeVisible();
    await textarea.fill('Make a 5 second logo reveal for Acme Corp');

    // Generate button should enable once prompt has content.
    const generate = page.getByTestId('generate-button');
    await expect(generate).toBeEnabled();
    await generate.click();

    // Preview region appears with a canvas / video element.
    const preview = page.getByTestId('preview-stage');
    await expect(preview).toBeVisible({ timeout: 15_000 });
    await expect(preview.locator('canvas, video')).toBeVisible();

    // Scene count chip reflects mocked single scene.
    await expect(page.getByTestId('scene-count')).toHaveText('1');
  });

  test('disables Generate when prompt empty', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('generate-button')).toBeDisabled();
    await page.getByTestId('prompt-textarea').fill('a');
    await expect(page.getByTestId('generate-button')).toBeEnabled();
    await page.getByTestId('prompt-textarea').fill('');
    await expect(page.getByTestId('generate-button')).toBeDisabled();
  });

  test('surfaces engine error without crashing', async ({ page }) => {
    // Override the global mock with a 500.
    await page.route('**/v1/generate', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom"}' })
    );
    await page.goto('/');
    await page.getByTestId('prompt-textarea').fill('test');
    await page.getByTestId('generate-button').click();
    await expect(page.getByTestId('error-banner')).toBeVisible();
    await expect(page.getByTestId('error-banner')).toContainText(/error|failed/i);
  });

  test('export button enabled after generate, disabled before', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('export-button')).toBeDisabled();
    await page.getByTestId('prompt-textarea').fill('test');
    await page.getByTestId('generate-button').click();
    await expect(page.getByTestId('preview-stage')).toBeVisible();
    await expect(page.getByTestId('export-button')).toBeEnabled();
  });
});
