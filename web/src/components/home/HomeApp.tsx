'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, PlayCircle } from 'lucide-react';
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
import { BrandMotionShowcase } from './BrandMotionShowcase';
import { FormatShowcase } from './FormatShowcase';
import { ProcessRow } from './ProcessRow';
import { LogoMarquee } from './LogoMarquee';
import { TrustStrip } from './TrustStrip';
import {
  AttachButton,
  AttachmentChips,
  classifyToPending,
  type PendingFile,
} from './AttachButton';
import { ModelPicker, type ModelChoice } from './ModelPicker';
import { TokenUsageChip, type TokenUsage } from './TokenUsageChip';
import { LocalMetricsChip } from './LocalMetricsChip';
import { FormatRow } from './FormatRow';
import { IterationRail, type IterationEntry } from './IterationRail';

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
 * Engine endpoints — resolved via runtime-config so the desktop
 * shell's per-launch `?engine=…` override wins over the build-time
 * `NEXT_PUBLIC_ENGINE_BASE_URL`. See `lib/runtime-config.ts`.
 */
import { getEngineBase } from '@/lib/runtime-config';

const generateEndpoint = () => `${getEngineBase()}/v1/generate`;
const iterateEndpoint = () => `${getEngineBase()}/v1/iterate`;

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
  // 30s + Wide 16:9 matches the FormatRow's "Wide" default mapping,
  // so the LENGTH row lands on the "30s · standard" preset chip
  // instead of falling through to "20s · custom" on first paint.
  duration: 30,
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
  // Per-session generation history. Newest entries are appended;
  // IterationRail reverses for display so latest reads left-to-right.
  // Cleared only by reloading the page — we treat the session as the
  // unit of work, not the individual generation.
  const [iterations, setIterations] = useState<IterationEntry[]>([]);
  // Tracks which iteration is on stage so the rail can ring it.
  // Initially null; bumped when a new generate lands or the user
  // clicks a thumbnail.
  const [activeIterationId, setActiveIterationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<PendingFile[]>([]);
  const [model, setModel] = useState<ModelChoice>('ollama/llama3.2-vision:11b');
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
      // Bundle the rest of the attachments by kind so the engine can
      // attach images to the vision LLM call + extract text from PDFs.
      // Every image/pdf attachment with a serverPath gets forwarded —
      // a fresh upload (above) just set serverPath in setAttachments(),
      // so it lands here too.
      const referenceImages: string[] = [];
      const referenceDocuments: string[] = [];
      for (const a of attachments) {
        if (!a.serverPath) continue;
        if (a.kind === 'image') referenceImages.push(a.serverPath);
        else if (a.kind === 'pdf') referenceDocuments.push(a.serverPath);
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
        response = await fetch(generateEndpoint(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(auth ?? {}) },
          body: JSON.stringify({
            work_dir: nextWorkDir ?? undefined,
            reference_video: referenceVideo,
            reference_images: referenceImages,
            reference_documents: referenceDocuments,
            prompt,
            theme: controls.preset,
            duration_seconds: controls.duration,
          }),
        });
      } else if (nextWorkDir) {
        response = await fetch(iterateEndpoint(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(auth ?? {}) },
          body: JSON.stringify({
            work_dir: nextWorkDir,
            prompt,
            reference_images: referenceImages,
            reference_documents: referenceDocuments,
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
      // Append to the iteration rail so the user can rewind to this
      // exact generation later. `crypto.randomUUID()` is available in
      // every browser we ship to (Safari ≥15.4, Chrome ≥92, FF ≥95).
      const entry: IterationEntry = {
        id: crypto.randomUUID(),
        prompt,
        animation: json,
        ts: Date.now(),
      };
      setIterations((prev) => [...prev, entry]);
      setActiveIterationId(entry.id);
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
        downloadJson(clone(animation), `controlcraft-${Date.now()}.lottie.json`);
        return;
      }
      // MP4 (and future pack-zip) go through the engine's binary
      // export endpoint which runs the python lottie sidecar + ffmpeg.
      const format = kind === 'mp4' ? 'mp4' : 'dotlottie';
      const ext = kind === 'mp4' ? 'mp4' : 'lottie';
      const url = `${getEngineBase()}/v1/export/${format}`;
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
        a.download = `controlcraft-${Date.now()}.${ext}`;
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
    // Anonymous surface — agency-grade reel hero. The hero band is a
    // cinematic stage (ambient emerald glow + faint grid) carrying an
    // outsized two-line headline; below it sits the {@link
    // BrandMotionShowcase} framed as a curated reel card with mono
    // film-strip rules above and below.
    //
    // Why BrandMotionShowcase instead of SampleRunDemo: the captured
    // engine Lottie renders as a flat coloured rectangle for most
    // visitors — lottie-web silently drops the engine's shape groups
    // (see BrandMotionShowcase.tsx head comment for the incident
    // history). The CSS-only showcase is the proven-reliable surface,
    // and its scene composition (eyebrow / spring-staggered words /
    // process chips) reads as broadcast-grade in both themes.
    return (
      <div className="relative flex w-full flex-col bg-bg-primary">
        <section
          aria-label="ControlCraft hero"
          className="relative isolate overflow-hidden px-4 pt-10 pb-20 sm:px-6 sm:pt-14 sm:pb-24 lg:pt-20 lg:pb-32"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              backgroundImage:
                'radial-gradient(circle at 18% 12%, color-mix(in srgb, var(--color-accent-500) 14%, transparent), transparent 55%),' +
                'radial-gradient(circle at 88% 92%, color-mix(in srgb, var(--color-secondary-500) 10%, transparent), transparent 60%)',
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 opacity-[0.04]"
            style={{
              backgroundImage:
                'linear-gradient(to right, var(--color-text-primary) 1px, transparent 1px), linear-gradient(to bottom, var(--color-text-primary) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
            }}
          />

          <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-7 text-center">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.32em] text-accent-700 dark:text-accent-400">
              ControlCraft  ·  Brand-grade motion, on tap
            </p>
            <h1 className="h-display max-w-4xl">
              From brief to broadcast,
              <br className="hidden sm:inline" />{' '}
              <span className="text-accent-700 dark:text-accent-400">
                in twenty minutes.
              </span>
            </h1>
            <p className="max-w-2xl text-lg leading-[1.55] text-text-secondary sm:text-xl">
              Marketing, product, and creative teams turn a brief into a
              finished animated explainer the same day &mdash; without an
              agency timeline or an agency invoice.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => router.push('/signup')}
                className="btn-accent group px-8 py-3.5 text-base"
                data-testid="hero-signup"
              >
                Get started &mdash; it&apos;s free
                <ArrowRight
                  className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
                  aria-hidden
                />
              </button>
              <a
                href="#reel"
                className="btn-ghost group px-6 py-3.5 text-base"
                data-testid="hero-watch-reel"
              >
                <PlayCircle className="h-5 w-5" aria-hidden />
                Watch the reel
              </a>
            </div>
          </div>
        </section>

        <section
          id="reel"
          aria-label="ControlCraft sample reel"
          className="relative mx-auto -mt-8 w-full max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24"
        >
          <ReelHeader />

          <div className="group relative">
            <div className="relative aspect-video w-full overflow-hidden rounded-3xl border border-white/10 bg-[#0e1014] shadow-lift">
              <BrandMotionShowcase />

              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent"
              />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/40 to-transparent"
              />
              {/* SVG-noise film grain — adds the cinematic flicker that
                  separates a finished broadcast deliverable from a UI
                  preview. Mix-blend-overlay keeps it visible on the
                  dark surface without crushing the scene content. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 opacity-[0.18] mix-blend-overlay"
                style={{
                  backgroundImage:
                    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.55 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
                  backgroundSize: '160px 160px',
                }}
              />

              <Link
                href="/signup"
                aria-label="Sign up to start a reel"
                className="absolute inset-0 z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
              />

              <div className="pointer-events-none absolute right-3 top-3 z-20 sm:right-5 sm:top-5">
                <Link
                  href="/signup"
                  className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white shadow-card backdrop-blur-md transition-colors hover:bg-white/20"
                >
                  Sign up free
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            </div>

            <ReelFooter />
          </div>
        </section>

        <FormatShowcase />

        <ProcessRow />

        <LogoMarquee />

        <TrustStrip />

        <KPIStrip />
      </div>
    );
  }

  // Authenticated surface — the real product.
  return (
    <div className="flex w-full flex-col gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
      <div className="mx-auto w-full max-w-3xl flex flex-col gap-8">
        <h1 className="h-display text-center">
          Let&rsquo;s build.
        </h1>

        {/* Format row — platform-named aspect + length quick-picks.
            Sits above the prompt so the user makes the visual
            decision (where this video is going to live) before
            writing the brief that depends on it. */}
        <FormatRow value={controls} onChange={setControls} />

        <PromptInput
          value={prompt}
          onChange={setPrompt}
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
          // Compact mode kicks in once an animation exists — the user
          // has shifted from "drafting a brief" (where a tall textarea
          // helps you spread out) to "iterating on this one" (where
          // every pixel below should belong to the preview).
          compact={animation !== null}
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

        {/* Meta strip — running session usage + host metrics. The
            model label is already visible in the picker chip inside
            the prompt bar, so this row keeps to numbers only:
            tokens consumed (TokenUsageChip) + machine health
            (LocalMetricsChip, click to expand the drawer). */}
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

        {/* Iteration rail — sits between the prompt and the preview so
            the user can rewind without losing the brief context above.
            Hidden by the component itself when iterations are empty. */}
        <IterationRail
          iterations={iterations}
          activeId={activeIterationId}
          onSelect={(entry) => {
            setAnimation(entry.animation);
            setPrompt(entry.prompt);
            setActiveIterationId(entry.id);
          }}
        />

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

/* ─────────────────────────── reel chrome ─────────────────────────── */

/**
 * Top film-strip header for the anonymous-surface reel card. Three
 * mono labels with a thin accent rule, mirroring the header on a
 * finished broadcast deck so the embedded showcase reads as a
 * deliverable, not a UI demo.
 */
function ReelHeader() {
  return (
    <div className="mb-3 flex items-end justify-between gap-3 px-1 font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary sm:text-[11px]">
      <span className="inline-flex items-center gap-2">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-500" aria-hidden />
        Reel 001  ·  auto-play
      </span>
      <span className="hidden sm:inline">
        4 scenes  ·  17s loop  ·  16:9  ·  H.264
      </span>
      <span>Ctrl 01 / 04</span>
    </div>
  );
}

/**
 * Bottom film-strip footer. Engine-side metadata that frames the
 * speed + brand-fidelity story without crowding the canvas.
 */
function ReelFooter() {
  return (
    <div className="mt-3 grid grid-cols-1 gap-1 px-1 font-mono text-[10px] uppercase tracking-[0.22em] text-text-tertiary sm:grid-cols-3 sm:text-[11px]">
      <span className="inline-flex items-center gap-2">
        <span className="h-px w-6 bg-accent-500/60" aria-hidden />
        Brief  →  Lottie  in 46.4s
      </span>
      <span className="sm:text-center">
        12 characters  ·  ink + emerald  ·  Inter Bold
      </span>
      <span className="sm:text-right">
        Iterate in &lt; 1s  ·  MP4 / .lottie / SVG
      </span>
    </div>
  );
}
