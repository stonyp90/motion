'use client';

import { useCallback, useState } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { ArrowRight } from 'lucide-react';
import {
  clone,
  downloadJson,
  type LottieJson,
} from '@/lib/lottie/transform';
import { uploadFiles } from '@/lib/uploads';
import { PromptInput } from './PromptInput';
import { PreviewFrame, type ExportKind } from './PreviewFrame';
import { ControlsDrawer, type ControlsValue } from './ControlsDrawer';
import { ExamplePromptChips } from './ExamplePromptChips';
import CastRow from './CastRow';
import VoiceButton from './VoiceButton';
import { KPIStrip } from './KPIStrip';
import { ProcessDemo } from './ProcessDemo';
import {
  AttachButton,
  AttachmentChips,
  classifyToPending,
  type PendingFile,
} from './AttachButton';
import { ModelPicker, type ModelChoice } from './ModelPicker';

interface HomeAppProps {
  /**
   * Server-supplied auth state. When false, the whole product surface
   * (prompt input, cast, voice, controls, preview frame) is replaced
   * by the hero motion demo + KPI strip. Anonymous visitors only see
   * the brand, the looping live preview, and the numbers. The prompt
   * and generator are gated behind sign-in — no draft input visible
   * until the user has an account.
   */
  isAuthenticated?: boolean;
}

/**
 * Endpoints on the engine. NEXT_PUBLIC_ENGINE_BASE_URL points the
 * client at the right origin (e.g. http://127.0.0.1:7700 for local
 * dev, or motion-forge-api.azurewebsites.net in prod). Same-origin
 * is the fallback so a Vercel rewrite still works.
 */
const ENGINE_BASE =
  process.env.NEXT_PUBLIC_ENGINE_BASE_URL ?? '';
const GENERATE_ENDPOINT = `${ENGINE_BASE}/v1/generate`;
const ITERATE_ENDPOINT = `${ENGINE_BASE}/v1/iterate`;

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
  const [attachments, setAttachments] = useState<PendingFile[]>([]);
  const [model, setModel] = useState<ModelChoice>('ollama/llava');
  // NextAuth session — gives us the Keycloak access token to attach
  // as a Bearer on every engine call.
  const { data: session } = useSession();
  const bearer = (session as unknown as { accessToken?: string } | null)?.accessToken;

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
    // Anonymous Generate clicks hand off to Keycloak with the draft
    // preserved as a callbackUrl param.
    if (!isAuthenticated) {
      const callbackUrl = `/?prompt=${encodeURIComponent(prompt)}`;
      signIn('keycloak', { callbackUrl });
      return;
    }
    setIsGenerating(true);
    setError(null);
    const auth = bearer ? { Authorization: `Bearer ${bearer}` } : undefined;

    try {
      // 1. If the user attached any files that haven't been pushed
      //    yet, upload them first so the engine has server-side paths.
      let referenceVideo: string | undefined;
      let referenceImages: string[] = [];
      const pending = attachments.filter((a) => !a.serverPath && !a.error);
      if (pending.length > 0) {
        const resp = await uploadFiles(
          pending.map((a) => a.file),
          bearer,
        );
        // mirror back the server paths into the attachments state
        setAttachments((prev) =>
          prev.map((a) => {
            const idx = pending.findIndex((p) => p.id === a.id);
            if (idx < 0) return a;
            const f = resp.files[idx];
            return { ...a, serverPath: f?.path };
          }),
        );
        for (const f of resp.files) {
          if (f.kind === 'video' && !referenceVideo) referenceVideo = f.path;
          else if (f.kind === 'image') referenceImages.push(f.path);
        }
      }
      // Pull already-uploaded paths in (e.g. user uploaded earlier,
      // regenerates without dropping new files).
      for (const a of attachments) {
        if (!a.serverPath) continue;
        if (a.kind === 'video' && !referenceVideo) referenceVideo = a.serverPath;
        if (a.kind === 'image') referenceImages.push(a.serverPath);
      }

      // 2. Pick the right endpoint:
      //    - If there's a reference video → /v1/generate (full pipeline)
      //    - Otherwise → /v1/iterate (prompt-only, faster)
      let response: Response;
      if (referenceVideo) {
        response = await fetch(GENERATE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(auth ?? {}) },
          body: JSON.stringify({
            reference_video: referenceVideo,
            reference_images: referenceImages,
            prompt,
            theme: controls.preset,
            duration_seconds: controls.duration,
            model,
          }),
        });
      } else {
        response = await fetch(ITERATE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(auth ?? {}) },
          body: JSON.stringify({
            prompt,
            duration: controls.duration,
            preset: controls.preset,
            model,
            reference_images: referenceImages,
          }),
        });
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = (await response.json()) as LottieJson;
      if (!Array.isArray(json.layers)) throw new Error('not a lottie document');
      setAnimation(json);
    } catch (e) {
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
  }, [
    prompt,
    isGenerating,
    controls.duration,
    controls.preset,
    loadFallback,
    isAuthenticated,
    attachments,
    model,
    bearer,
  ]);

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

  if (!isAuthenticated) {
    // Anonymous surface — hero + hero-motion + numbers. NO prompt,
    // NO Generate, NO compute calls. Sign-in is the only CTA.
    //
    // Vertical rhythm: H1 + sub + CTA stack tight (gap-5), then a
    // shorter gap to the ProcessDemo so the lottie reads as the
    // hero visual — not as a separate section below the fold.
    return (
      <div className="relative flex w-full flex-col gap-8 bg-hero-grid px-4 pt-6 pb-12 sm:px-6 sm:pt-8 sm:pb-16 lg:pt-10">
        <div className="mx-auto w-full max-w-3xl flex flex-col items-center gap-6 text-center">
          <h1 className="h-display">
            Motion graphics from a prompt.
          </h1>
          <p className="max-w-[36rem] text-lg leading-[1.55] text-text-secondary sm:text-xl">
            Type a brief, cast your characters, ship a 60-second explainer
            in 20 minutes — at one-tenth the cost.
          </p>
          <button
            type="button"
            onClick={() => signIn('keycloak', { callbackUrl: '/' })}
            className="btn-accent group mt-1 px-8 py-3.5 text-base"
            data-testid="hero-signin"
          >
            Sign in to start
            <ArrowRight
              className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
              aria-hidden
            />
          </button>
          <p className="text-[13px] tracking-wide text-text-tertiary">
            SSO · seat-based · enterprise on request
          </p>
        </div>

        <ProcessDemo />

        <KPIStrip />
      </div>
    );
  }

  // Authenticated surface — the real product.
  return (
    <div className="flex w-full flex-col gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
      <div className="mx-auto w-full max-w-3xl flex flex-col gap-8">
        <h1 className="h-display text-center">
          What motion graphic do you want to make?
        </h1>

        <PromptInput
          value={prompt}
          onChange={setPrompt}
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
          onAttach={(files) =>
            setAttachments((p) => [...p, ...classifyToPending(files)])
          }
          attachmentChips={
            <AttachmentChips
              files={attachments}
              onRemove={(id) =>
                setAttachments((p) => p.filter((a) => a.id !== id))
              }
              disabled={isGenerating}
            />
          }
          attachSlot={
            <AttachButton
              onPick={(files) =>
                setAttachments((p) => [...p, ...classifyToPending(files)])
              }
              disabled={isGenerating}
            />
          }
          castSlot={<CastRow />}
          voiceSlot={<VoiceButton />}
          controlsSlot={
            <div className="flex items-center gap-2">
              <ModelPicker value={model} onChange={setModel} />
              <ControlsDrawer value={controls} onChange={setControls} />
            </div>
          }
        />

        {!prompt && <ExamplePromptChips onPick={setPrompt} />}

        {error && (
          <p
            role="status"
            className="mx-auto max-w-prose rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-2 text-center text-xs text-text-secondary"
          >
            {error}
          </p>
        )}

        <PreviewFrame
          animation={animation}
          onExport={handleExport}
          onRegenerate={handleGenerate}
        />
      </div>

      <KPIStrip />
    </div>
  );
}
