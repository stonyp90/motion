'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { selectIsAuthenticated, useAuthStore } from '@/stores/auth-store';
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
import { TokenUsageChip, type TokenUsage } from './TokenUsageChip';
import { LocalMetricsChip } from './LocalMetricsChip';

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
/**
 * Engine response shape — paths to files on the engine host, not the
 * Lottie body. We follow up with `/api/engine/file?path=...` to load
 * the actual JSON into the preview (see [api/engine/file/route.ts]).
 */
interface GenerateResponse {
  work_dir: string;
  output_lottie: string;
  output_video?: string;
  backend_name: string;
  shots: number;
  duration_seconds: number;
  /** Engine-reported LLM token usage for this call (additive). */
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    model_max?: number;
    cost_usd?: number;
  };
}

export function HomeApp({ isAuthenticated: _ssrAuth = false }: HomeAppProps = {}) {
  const router = useRouter();
  // Trust the client store once it has hydrated. `_ssrAuth` is kept on
  // the prop signature for callers that still server-side resolve, but
  // the source of truth is the zustand state populated by /login + /signup.
  const hydrated = useAuthStore((s) => s.hydrated);
  const storeAuth = useAuthStore(selectIsAuthenticated);
  const bearer = useAuthStore((s) => s.accessToken) ?? undefined;
  const isAuthenticated = hydrated ? storeAuth : _ssrAuth;

  const [prompt, setPrompt] = useState('');
  const [controls, setControls] = useState<ControlsValue>(DEFAULT_CONTROLS);
  const [isGenerating, setIsGenerating] = useState(false);
  const [animation, setAnimation] = useState<LottieJson | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<PendingFile[]>([]);
  const [model, setModel] = useState<ModelChoice>('ollama/llava');
  // Session work-dir, surfaced by `/v1/uploads` and by every
  // successful generate. Iterate REQUIRES this to refine an existing
  // animation, so we keep it across re-renders and only clear it
  // when the user removes all attachments + presses "new session".
  const [workDir, setWorkDir] = useState<string | null>(null);
  // Accumulated LLM usage across the session — bumped on every
  // generate / iterate that comes back with a usage block.
  const [usage, setUsage] = useState<TokenUsage>({ used: 0, max: 4096 });

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
    // Anonymous Generate clicks bounce to /login with the draft
    // preserved as a `next` param so the page re-opens primed.
    if (!isAuthenticated) {
      const next = `/?prompt=${encodeURIComponent(prompt)}`;
      router.push(`/login?next=${encodeURIComponent(next)}`);
      return;
    }
    setIsGenerating(true);
    setError(null);
    const auth = bearer ? { Authorization: `Bearer ${bearer}` } : undefined;

    try {
      // 1. Push any pending attachments through `/v1/uploads` so the
      //    engine has server-side paths to consume. The endpoint also
      //    hands back the session `work_dir`, which iterate later
      //    needs to refine the same generation.
      let referenceVideo: string | undefined;
      let nextWorkDir = workDir;
      const pending = attachments.filter((a) => !a.serverPath && !a.error);
      if (pending.length > 0) {
        const resp = await uploadFiles(
          pending.map((a) => a.file),
          bearer,
        );
        nextWorkDir = resp.work_dir;
        setWorkDir(resp.work_dir);
        // Mirror server paths back into the attachment chips so the
        // user sees "uploaded" affordance and we can skip re-upload.
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
        }
      }
      // Pull already-uploaded paths in (e.g. user uploaded earlier,
      // regenerates without dropping new files).
      for (const a of attachments) {
        if (!a.serverPath) continue;
        if (a.kind === 'video' && !referenceVideo) referenceVideo = a.serverPath;
      }

      // 2. Pick the right engine endpoint per the schema in
      //    engine/crates/http/src/lib.rs:
      //      - generate REQUIRES `reference_video` (full pipeline,
      //        produces a fresh style.json in the work-dir).
      //      - iterate REQUIRES `work_dir` from a prior generate.
      //    First-time prompts without a reference video have nowhere
      //    to land — surface that explicitly rather than 500'ing.
      let response: Response;
      if (referenceVideo) {
        response = await fetch(GENERATE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(auth ?? {}) },
          body: JSON.stringify({
            work_dir: nextWorkDir ?? undefined,
            reference_video: referenceVideo,
            prompt,
            theme: controls.preset,
            duration_seconds: controls.duration,
          }),
        });
      } else if (nextWorkDir) {
        response = await fetch(ITERATE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(auth ?? {}) },
          body: JSON.stringify({
            work_dir: nextWorkDir,
            prompt,
            theme: controls.preset,
            duration_seconds: controls.duration,
          }),
        });
      } else {
        throw new Error(
          'attach a reference video (or any media) to start — iterate refines an existing session',
        );
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
      }
      const result = (await response.json()) as GenerateResponse;
      setWorkDir(result.work_dir);

      // Fold the call's usage into the running session total. The
      // engine's MODEL_INFO max wins if it's set; otherwise we keep
      // the chip's last known cap.
      if (result.usage) {
        setUsage((prev) => ({
          used: prev.used + (result.usage?.total_tokens ?? 0),
          max: result.usage?.model_max ?? prev.max,
          costUsd: (prev.costUsd ?? 0) + (result.usage?.cost_usd ?? 0),
        }));
      }

      // 3. Engine returns *paths*; fetch the Lottie body via the
      //    Next.js proxy route so the browser can render it.
      const lottieResp = await fetch(
        `/api/engine/file?path=${encodeURIComponent(result.output_lottie)}`,
      );
      if (!lottieResp.ok) {
        throw new Error(`could not read output_lottie: HTTP ${lottieResp.status}`);
      }
      const json = (await lottieResp.json()) as LottieJson;
      if (!Array.isArray(json.layers)) throw new Error('not a lottie document');
      setAnimation(json);
      void model; // model is captured for future engine support; engine ignores it today
    } catch (e) {
      const fb = await loadFallback();
      if (fb) {
        setAnimation(fb);
        setError(`Using ${controls.preset} preset (engine: ${String(e)})`);
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
    workDir,
    model,
    bearer,
  ]);

  const [isExporting, setIsExporting] = useState<ExportKind | null>(null);

  const handleExport = useCallback(
    async (kind: ExportKind) => {
      if (!animation || isExporting) return;
      if (kind === 'lottie') {
        // Local download — no backend required, no auth.
        downloadJson(clone(animation), `motion-forge-${Date.now()}.lottie.json`);
        return;
      }
      // MP4 (and future pack-zip) go through the engine's binary
      // export endpoint which runs the python lottie sidecar + ffmpeg.
      const format = kind === 'mp4' ? 'mp4' : 'dotlottie';
      const ext = kind === 'mp4' ? 'mp4' : 'lottie';
      const url = `${ENGINE_BASE}/v1/export/${format}`;
      setIsExporting(kind);
      setError(null);
      try {
        const r = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          },
          body: JSON.stringify(animation),
        });
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          throw new Error(`HTTP ${r.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
        }
        const blob = await r.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = `motion-forge-${Date.now()}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
      } catch (e) {
        setError(`Export ${kind} failed: ${String(e)}`);
      } finally {
        setIsExporting(null);
      }
    },
    [animation, bearer, isExporting],
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
            onClick={() => router.push('/login')}
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

        {/* Meta strip — running session token / context / cost. Sits
            between the prompt and the example chips so it reads as
            "for this session" rather than as a per-call indicator. */}
        <div className="-mt-3 flex items-center justify-end gap-2 px-1">
          <span className="text-2xs uppercase tracking-[0.14em] text-text-tertiary">
            Session
          </span>
          <TokenUsageChip model={model} usage={usage} />
          <LocalMetricsChip model={model} bearer={bearer} />
        </div>

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
          onCaptureFrame={(blob, filename) => {
            // Wrap the PNG blob in a File so the rest of the
            // attachment plumbing (chip, upload, classification)
            // treats it identically to a user-picked image. The
            // sanitised filename lands in the upload session and
            // the chip shows it with the image icon + size.
            const file = new File([blob], filename, { type: 'image/png' });
            setAttachments((p) => [...p, ...classifyToPending([file])]);
          }}
        />
      </div>

      <KPIStrip />
    </div>
  );
}
