/**
 * 03 — Voice prompt: mic permission, fake audio injection, partials + final.
 *
 * Determinism comes from `installFakeAudio` which patches `window.__MF_E2E__`
 * so the STT module reads canned PCM instead of the real mic stream.
 *
 * STT WS is also mocked: we intercept the WebSocket upgrade and feed back
 * the same partial/final sequence so we don't depend on a real ASR model.
 */
import { test, expect } from '@playwright/test';
import { installFakeAudio } from './helpers/audio';

const ENGINE_WS = process.env.NEXT_PUBLIC_ENGINE_URL?.replace(/^http/, 'ws') ?? 'ws://localhost:3000';

test.describe('voice prompt', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.grantPermissions(['microphone'], { origin: page.url() === 'about:blank' ? 'http://localhost:3001' : page.url() });
    await installFakeAudio(page);

    // Stub the STT WebSocket — emit partials then final, then close.
    await page.routeWebSocket(`${ENGINE_WS}/v1/stt/stream`, (ws) => {
      const partials = [
        'Make',
        'Make a',
        'Make a thirty',
        'Make a thirty second',
        'Make a thirty second product reel',
        'Make a thirty second product reel for our new espresso machine',
      ];
      // Wait for the client to send its first PCM frame before responding.
      ws.onMessage(() => {
        // Send one partial per inbound chunk; once we've sent them all, send final.
        const next = partials.shift();
        if (next) {
          ws.send(JSON.stringify({ type: 'partial', text: next }));
        } else {
          ws.send(
            JSON.stringify({
              type: 'final',
              text: 'Make a thirty second product reel for our new espresso machine',
            })
          );
          ws.close();
        }
      });
    });
  });

  test('mic button → partials stream → final commits to textarea', async ({ page }) => {
    await page.goto('/');

    const mic = page.getByTestId('mic-button');
    await expect(mic).toBeVisible();
    await mic.click();

    // Mic button visually toggles to recording state.
    await expect(mic).toHaveAttribute('data-recording', 'true');

    // Partial transcript surface (separate from textarea so user sees in-flight text).
    const partial = page.getByTestId('partial-transcript');
    await expect(partial).toBeVisible();
    await expect(partial).toContainText('Make a thirty', { timeout: 10_000 });

    // Final transcript commits into the textarea.
    const textarea = page.getByTestId('prompt-textarea');
    await expect(textarea).toHaveValue(
      /Make a thirty second product reel for our new espresso machine/,
      { timeout: 15_000 }
    );

    // Recording flag clears.
    await expect(mic).toHaveAttribute('data-recording', 'false');
  });

  test('denies mic gracefully when permission revoked', async ({ context, page }) => {
    // Override the beforeEach grant — clear permissions for this test.
    await context.clearPermissions();
    await page.goto('/');
    await page.getByTestId('mic-button').click();
    // We expect a toast / banner pointing at permissions.
    await expect(page.getByTestId('mic-error')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('mic-error')).toContainText(/permission|microphone/i);
  });

  test('clicking mic during recording stops cleanly', async ({ page }) => {
    await page.goto('/');
    const mic = page.getByTestId('mic-button');
    await mic.click();
    await expect(mic).toHaveAttribute('data-recording', 'true');
    await mic.click();
    await expect(mic).toHaveAttribute('data-recording', 'false');
  });
});
