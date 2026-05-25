/**
 * 05 — Brief paste: Chrono 21-scene script, structured mode detected, 21 previews.
 *
 * The fixture lives in fixtures/chrono-brief.txt and is loaded once per
 * spec to keep tests independent.
 */
import { test, expect } from '@playwright/test';
import { mockBriefParse, mockGenerate } from './helpers/mock-engine';
import fs from 'node:fs';
import path from 'node:path';

const BRIEF = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'chrono-brief.txt'), 'utf8');
const SCENE_COUNT = (BRIEF.match(/^SCENE\s+\d+/gm) ?? []).length;

test.describe('brief paste', () => {
  test.beforeEach(async ({ page }) => {
    await mockBriefParse(page, SCENE_COUNT);
    await mockGenerate(page, { scenes: Array.from({ length: SCENE_COUNT }, (_, i) => ({
      id: `scn_${String(i + 1).padStart(3, '0')}`,
      duration_ms: 2000,
      layers: [],
    })) });
  });

  test('pasting a structured script switches to structured mode', async ({ page }) => {
    await page.goto('/');
    const textarea = page.getByTestId('prompt-textarea');
    await textarea.click();

    // Use the clipboard API path the app likely uses for paste events.
    await page.evaluate(async (text) => {
      const ta = document.querySelector<HTMLTextAreaElement>('[data-testid="prompt-textarea"]')!;
      ta.focus();
      ta.value = text;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      // Fire a paste event so any paste-detection heuristic also runs.
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    }, BRIEF);

    // Mode indicator flips to "structured script".
    await expect(page.getByTestId('input-mode-badge')).toHaveText(/structured script/i, {
      timeout: 10_000,
    });

    // Scene count chip should reflect detected count from /v1/brief/parse mock.
    await expect(page.getByTestId('detected-scene-count')).toHaveText(String(SCENE_COUNT));
  });

  test('generate from structured brief produces N preview scenes', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async (text) => {
      const ta = document.querySelector<HTMLTextAreaElement>('[data-testid="prompt-textarea"]')!;
      ta.focus();
      ta.value = text;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }, BRIEF);

    await expect(page.getByTestId('input-mode-badge')).toHaveText(/structured script/i);
    await page.getByTestId('generate-button').click();

    const thumbs = page.getByTestId('scene-thumbnail');
    await expect(thumbs).toHaveCount(SCENE_COUNT, { timeout: 20_000 });

    // Each thumb is keyboard-focusable.
    await thumbs.first().focus();
    await expect(thumbs.first()).toBeFocused();
  });

  test('short prompt stays in freeform mode', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('prompt-textarea').fill('A quick promo for our launch');
    await expect(page.getByTestId('input-mode-badge')).toHaveText(/freeform|prompt/i);
  });
});
