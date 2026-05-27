'use client';

import { useCallback, useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import {
  clone,
  downloadJson,
  type LottieJson,
} from '@/lib/lottie/transform';
import { uploadFiles } from '@/lib/uploads';
import { PromptInput } from './PromptInput';
import { PreviewFrame, type ExportKind } from './PreviewFrame';
import { ControlsDrawer, type ControlsValue } from './ControlsDrawer';
import CastRow from './CastRow';
import VoiceButton from './VoiceButton';
import {
  AttachButton,
  AttachmentChips,
  classifyToPending,
  type PendingFile,
} from './AttachButton';
import { ModelPicker, type ModelChoice } from './ModelPicker';
import {
  QualityPreset,
  QUALITY_PROFILES,
  DEFAULT_QUALITY,
  type QualityLevel,
} from './QualityPreset';
import { TokenUsageChip, type TokenUsage } from './TokenUsageChip';
import { LocalMetricsChip } from './LocalMetricsChip';
import { FormatRow } from './FormatRow';
import { IterationRail, type IterationEntry } from './IterationRail';
import { getEngineBase } from '@/lib/runtime-config';

/**
 * Studio surface — the actual prompt → generate → preview workflow.
 *
 * Rendered when the user is authenticated AND on the desktop shell
 * (Tauri `?engine=…&token=…` override active, or `window.__TAURI__`
 * exposed). Hosted-web visitors never reach this — the web home
 * routes them to `<WelcomeDashboard />` instead, which sells the
 * desktop binary.
 *
 * The desktop's `MOTION_FORGE_AUTH_FALLBACK_KEY` token already lives
 * in the auth store thanks to `installDesktopOverride()`, so the
 * fetches below attach it as a Bearer transparently.
 */

const generateEndpoint = () => `${getEngineBase()}/v1/generate`;
const iterateEndpoint = () => `${getEngineBase()}/v1/iterate`;

const FALLBACK_PRESETS: Record<ControlsValue['preset'], string> = {
  corporate: '/lottie/corporate.json',
  playful: '/lottie/playful.json',
  minimalist: '/lottie/minimalist.json',
};

const DEFAULT_CONTROLS: ControlsValue = {
  duration: 30,
  preset: 'corporate',
  aspect: '16:9',
};

interface GenerateResponse {
  work_dir: string;
  output_lottie: string;
  output_video?: string;
  backend_name: string;
  shots: number;
  duration_seconds: number;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    model_max?: number;
    cost_usd?: number;
  };
}

export function StudioApp() {
  const bearer = useAuthStore((s) => s.accessToken) ?? undefined;

  const [prompt, setPrompt] = useState('');
  const [controls, setControls] = useState<ControlsValue>(DEFAULT_CONTROLS);
  const [isGenerating, setIsGenerating] = useState(false);
  const [animation, setAnimation] = useState<LottieJson | null>(null);
  const [iterations, setIterations] = useState<IterationEntry[]>([]);
  const [activeIterationId, setActiveIterationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<PendingFile[]>([]);
  // Quality preset is the source of truth for the (model, temperature,
  // max_tokens) tuple; ModelPicker can still override the model
  // independently for users who want a specific cloud backend.
  const [quality, setQuality] = useState<QualityLevel>(DEFAULT_QUALITY);
  const [modelOverride, setModelOverride] = useState<ModelChoice | null>(null);
  const model: ModelChoice = modelOverride ?? QUALITY_PROFILES[quality].model;
  const [workDir, setWorkDir] = useState<string | null>(null);
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
    setIsGenerating(true);
    setError(null);
    const auth = bearer ? { Authorization: `Bearer ${bearer}` } : undefined;

    try {
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
      for (const a of attachments) {
        if (!a.serverPath) continue;
        if (a.kind === 'video' && !referenceVideo) referenceVideo = a.serverPath;
      }
      const referenceImages: string[] = [];
      const referenceDocuments: string[] = [];
      for (const a of attachments) {
        if (!a.serverPath) continue;
        if (a.kind === 'image') referenceImages.push(a.serverPath);
        else if (a.kind === 'pdf') referenceDocuments.push(a.serverPath);
      }

      // Resolve the active (model, temperature, max_tokens) tuple from
      // the Quality preset, with the user's optional model override
      // winning over the preset's model only. Temperature + max_tokens
      // stay tied to the preset — those have no first-class UI control.
      const profile = QUALITY_PROFILES[quality];
      const llmKnobs = {
        model,
        temperature: profile.temperature,
        max_tokens: profile.maxTokens,
      };

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
            ...llmKnobs,
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
            ...llmKnobs,
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

      if (result.usage) {
        setUsage((prev) => ({
          used: prev.used + (result.usage?.total_tokens ?? 0),
          max: result.usage?.model_max ?? prev.max,
          costUsd: (prev.costUsd ?? 0) + (result.usage?.cost_usd ?? 0),
        }));
      }

      const lottieResp = await fetch(
        `/api/engine/file?path=${encodeURIComponent(result.output_lottie)}`,
      );
      if (!lottieResp.ok) {
        throw new Error(`could not read output_lottie: HTTP ${lottieResp.status}`);
      }
      const json = (await lottieResp.json()) as LottieJson;
      if (!Array.isArray(json.layers)) throw new Error('not a lottie document');
      setAnimation(json);
      const entry: IterationEntry = {
        id: crypto.randomUUID(),
        prompt,
        animation: json,
        ts: Date.now(),
      };
      setIterations((prev) => [...prev, entry]);
      setActiveIterationId(entry.id);
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
    attachments,
    workDir,
    model,
    quality,
    bearer,
  ]);

  const [isExporting, setIsExporting] = useState<ExportKind | null>(null);

  const handleExport = useCallback(
    async (kind: ExportKind) => {
      if (!animation || isExporting) return;
      if (kind === 'lottie') {
        downloadJson(clone(animation), `controlcraft-${Date.now()}.lottie.json`);
        return;
      }
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

  return (
    <div className="flex w-full flex-col gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
      <div className="mx-auto w-full max-w-3xl flex flex-col gap-8">
        <h1 className="h-display text-center">Let&rsquo;s build.</h1>

        <FormatRow value={controls} onChange={setControls} />

        <PromptInput
          value={prompt}
          onChange={setPrompt}
          onGenerate={handleGenerate}
          isGenerating={isGenerating}
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
              <QualityPreset value={quality} onChange={setQuality} />
              <ModelPicker value={model} onChange={(m) => setModelOverride(m)} />
              <ControlsDrawer value={controls} onChange={setControls} />
            </div>
          }
        />

        <div className="-mt-3 flex items-center justify-end gap-2 px-1">
          <span className="text-2xs uppercase tracking-[0.14em] text-text-tertiary">
            Session
          </span>
          <TokenUsageChip model={model} usage={usage} />
          <LocalMetricsChip model={model} bearer={bearer} />
        </div>

        {error && (
          <p
            role="status"
            className="mx-auto max-w-prose rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-2 text-center text-xs text-text-secondary"
          >
            {error}
          </p>
        )}

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
            const file = new File([blob], filename, { type: 'image/png' });
            setAttachments((p) => [...p, ...classifyToPending([file])]);
          }}
        />
      </div>
    </div>
  );
}
