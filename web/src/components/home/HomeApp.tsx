'use client';

import { useCallback, useState } from 'react';
import {
  clone,
  downloadJson,
  type LottieJson,
} from '@/lib/lottie/transform';
import { PromptInput } from './PromptInput';
import { PreviewFrame, type ExportKind } from './PreviewFrame';
import { ControlsDrawer, type ControlsValue } from './ControlsDrawer';
import { ExamplePromptChips } from './ExamplePromptChips';
import CastRow from './CastRow';
import VoiceButton from './VoiceButton';
import { KPIStrip } from './KPIStrip';
import { SignInGate } from './SignInGate';
import { ProcessDemo } from './ProcessDemo';

interface HomeAppProps {
  /**
   * Server-supplied auth state. When false, the prompt input + cast +
   * voice + Generate are replaced by `<SignInGate />`; the KPI strip,
   * header, and footer stay public so anonymous visitors still see the
   * value proposition.
   */
  isAuthenticated?: boolean;
}

/**
 * Endpoint to POST the prompt to. Falls back to a same-origin path so
 * the deployed Vercel site can rewrite it to the Azure backend, and
 * local dev can serve a stub at the same URL.
 */
const ITERATE_ENDPOINT = '/v1/iterate';

/**
 * If `/v1/iterate` fails (no backend, network error, schema mismatch)
 * we fall back to one of these so the preview still has something to
 * show during development.
 */
const FALLBACK_PRESETS: Record<ControlsValue['preset'], string> = {
  corporate: '/lottie/corporate.json',
  playful: '/lottie/playful.json',
  minimalist: '/lottie/minimalist.json',
};

const DEFAULT_CONTROLS: ControlsValue = {
  duration: 20,
  preset: 'corporate',
  aspect: '16:9',
};

/**
 * Top-level composition for the single-screen app. Owns all the
 * useState needed to drive the prompt → preview loop:
 *
 *   - `prompt`       — the textarea value
 *   - `controls`     — duration / preset / aspect choices
 *   - `isGenerating` — disables the button + swaps the icon
 *   - `animation`    — the LottieJson currently shown in the preview
 *   - `error`        — last failure surfaced (small inline note)
 *
 * State stays in plain useState; zustand was overkill for this surface.
 */
export function HomeApp({ isAuthenticated = false }: HomeAppProps = {}) {
  const [prompt, setPrompt] = useState('');
  const [controls, setControls] = useState<ControlsValue>(DEFAULT_CONTROLS);
  const [isGenerating, setIsGenerating] = useState(false);
  const [animation, setAnimation] = useState<LottieJson | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadFallback = useCallback(async (): Promise<LottieJson | null> => {
    try {
      const r = await fetch(FALLBACK_PRESETS[controls.preset], { cache: 'force-cache' });
      if (!r.ok) return null;
      return (await r.json()) as LottieJson;
    } catch {
      return null;
    }
  }, [controls.preset]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;
    // Defense in depth: even though the server-side gate hides this
    // button for anonymous users, refuse to fire the request if the
    // gate was somehow bypassed (e.g. devtools-injected click).
    if (!isAuthenticated) {
      setError('Sign in to generate.');
      return;
    }
    setIsGenerating(true);
    setError(null);
    try {
      const r = await fetch(ITERATE_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          duration: controls.duration,
          preset: controls.preset,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = (await r.json()) as LottieJson;
      // crude sanity check that the response is a Lottie doc
      if (!Array.isArray(json.layers)) throw new Error('not a lottie document');
      setAnimation(json);
    } catch (e) {
      // Always fall back to a preset so the preview is never empty
      // after the first Generate — pivotal for the screenshot demo.
      const fb = await loadFallback();
      if (fb) {
        setAnimation(fb);
        setError(`Using ${controls.preset} preset (backend unavailable: ${String(e)})`);
      } else {
        setError(`Generate failed: ${String(e)}`);
      }
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, isGenerating, controls.duration, controls.preset, loadFallback, isAuthenticated]);

  const handleExport = useCallback(
    (kind: ExportKind) => {
      if (!animation) return;
      if (kind === 'lottie') {
        // Local download — no backend required.
        downloadJson(clone(animation), `motion-forge-${Date.now()}.lottie.json`);
        return;
      }
      // MP4 + pack go through the backend (stubbed for now).
      // TODO: POST to /v1/render and /v1/pack respectively; here we
      // just surface a friendly placeholder so the buttons aren't dead.
      setError(
        kind === 'mp4'
          ? 'MP4 render needs the backend — wire /v1/render on the API to enable.'
          : 'Pack export needs the backend — wire /v1/pack on the API to enable.',
      );
    },
    [animation],
  );

  return (
    <div className="flex w-full flex-col gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
      <div className="mx-auto w-full max-w-3xl flex flex-col gap-8">
        <h1 className="h-display text-center">
          What motion graphic do you want to make?
        </h1>

        {isAuthenticated ? (
          <>
            <PromptInput
              value={prompt}
              onChange={setPrompt}
              onGenerate={handleGenerate}
              isGenerating={isGenerating}
              castSlot={<CastRow />}
              voiceSlot={<VoiceButton />}
              controlsSlot={<ControlsDrawer value={controls} onChange={setControls} />}
            />

            {!prompt && <ExamplePromptChips onPick={setPrompt} />}
          </>
        ) : (
          <>
            <SignInGate />
            <div className="flex flex-col items-center gap-2 pt-4">
              <p className="font-mono text-2xs uppercase tracking-wider text-text-tertiary">
                How it works · 16 second loop
              </p>
            </div>
            <ProcessDemo />
          </>
        )}

        {error && (
          <p
            role="status"
            className="mx-auto max-w-prose rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-2 text-center text-xs text-text-secondary"
          >
            {error}
          </p>
        )}

        {isAuthenticated && (
          <PreviewFrame
            animation={animation}
            onExport={handleExport}
            onRegenerate={handleGenerate}
          />
        )}
      </div>

      <KPIStrip />
    </div>
  );
}
