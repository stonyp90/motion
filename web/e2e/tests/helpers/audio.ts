/**
 * Audio injection helper for the voice-prompt test.
 *
 * The real flow:
 *   Mic → AudioWorklet (PCM 16k mono) → WebSocket /v1/stt/stream → partials → final.
 *
 * We can't actually feed mic data in a browser, so we install a hook on
 * `window.__MF_E2E__` that the web app reads when `NEXT_PUBLIC_E2E=1`. The
 * app's STT module checks for this hook before opening the real MediaStream
 * and instead pumps the canned PCM through the AudioWorklet shim.
 */
import { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const FIXTURE = path.join(__dirname, '..', '..', 'fixtures', 'canned-audio.pcm');

/**
 * Install an in-page hook BEFORE the app loads its STT module. Uses
 * addInitScript so it runs on every page in the context.
 *
 * The web app must check:
 *   if (window.__MF_E2E__?.fakeAudio) {
 *     stream = window.__MF_E2E__.fakeAudio();
 *   } else {
 *     stream = await navigator.mediaDevices.getUserMedia({ audio: true });
 *   }
 */
export async function installFakeAudio(page: Page) {
  // Read the PCM into a base64 string we can serialize into the init script.
  const pcm = fs.readFileSync(FIXTURE);
  const b64 = pcm.toString('base64');

  await page.addInitScript((audioB64) => {
    // Decode base64 in the page context.
    const bin = atob(audioB64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const samples = new Int16Array(bytes.buffer);

    // Convert to float32 [-1, 1] as AudioWorklet expects.
    const float = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) float[i] = samples[i] / 32768;

    // Expose the hook.
    (window as unknown as { __MF_E2E__: Record<string, unknown> }).__MF_E2E__ = {
      ...(window as unknown as { __MF_E2E__?: Record<string, unknown> }).__MF_E2E__,
      fakeAudio: () => {
        // Mimic a MediaStream by replaying the canned PCM in 20ms chunks
        // (320 samples @ 16 kHz). The app's AudioWorklet shim should pull
        // from this iterator instead of mic samples.
        const CHUNK = 320;
        let offset = 0;
        return {
          read(): Float32Array | null {
            if (offset >= float.length) return null;
            const slice = float.subarray(offset, Math.min(offset + CHUNK, float.length));
            offset += CHUNK;
            return slice;
          },
          // Canned final transcript the app should commit once `read()` drains.
          finalTranscript: 'Make a thirty second product reel for our new espresso machine',
          // Partial fragments the app should surface as the chunks stream.
          partials: [
            'Make',
            'Make a',
            'Make a thirty',
            'Make a thirty second',
            'Make a thirty second product reel',
            'Make a thirty second product reel for our new espresso machine',
          ],
        };
      },
    };
  }, b64);
}
