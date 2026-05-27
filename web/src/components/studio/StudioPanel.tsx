'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  CheckCircle2,
  Loader2,
  Monitor,
  Pause,
  Play,
  RotateCcw,
  Smartphone,
  Square,
  Upload,
  X,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { getEngineBase } from '@/lib/runtime-config';
import {
  applyRecolor,
  applyRetime,
  clone,
  detectAccentColor,
  detectBackgroundColor,
  durationSeconds,
  hexToRgb,
  rgbToHex,
  type LottieJson,
} from '@/lib/lottie/transform';
import { STUDIO_PRESET_COLORS } from '@/lib/studio/palette';
import { ExportMenu, type ExportFormatSlug, EXPORT_FORMATS } from './ExportMenu';

const Lottie = dynamic(() => import('lottie-react').then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-text-tertiary">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  ),
});

/**
 * Preset Lotties shipped with the web app. Same three the engine's
 * generator emits as scaffolds — the studio just loads them direct so
 * the user can iterate without burning a generate call.
 */
const PRESETS = [
  { slug: 'corporate', label: 'Corporate', tone: 'calm + decelerated', path: '/lottie/corporate.json' },
  { slug: 'playful', label: 'Playful', tone: 'bouncy + vivid', path: '/lottie/playful.json' },
  { slug: 'minimalist', label: 'Minimalist', tone: 'type-led + slow', path: '/lottie/minimalist.json' },
] as const;

type PresetSlug = (typeof PRESETS)[number]['slug'];

/**
 * Output dimension presets. The labels follow the platform-first naming
 * we already use on the home page so the same mental model carries over.
 * Each row also passes through to the export endpoint's `?w=&h=` so the
 * rasterizer renders at the chosen resolution instead of the engine's
 * 1920×1080 default.
 */
const DIMENSIONS = [
  { slug: 'fhd-16x9',  label: '1080p',    sub: '1920 × 1080', w: 1920, h: 1080, icon: Monitor },
  { slug: 'hd-16x9',   label: '720p',     sub: '1280 × 720',  w: 1280, h: 720,  icon: Monitor },
  { slug: 'uhd-16x9',  label: '4K',       sub: '3840 × 2160', w: 3840, h: 2160, icon: Monitor },
  { slug: 'sq-1x1',    label: 'Square',   sub: '1080 × 1080', w: 1080, h: 1080, icon: Square },
  { slug: 'story-9x16',label: 'Story',    sub: '1080 × 1920', w: 1080, h: 1920, icon: Smartphone },
] as const;

type DimensionSlug = (typeof DIMENSIONS)[number]['slug'];

const FPS_CHOICES = [24, 30, 60] as const;
type Fps = (typeof FPS_CHOICES)[number];

/**
 * Per-format median render time on a current Apple-silicon machine with
 * the homebrew ffmpeg + python-lottie stack, measured against the bundled
 * presets at 1920×1080×30. Used to seed the progress overlay's countdown
 * so the spinner doesn't feel like it's stuck.
 */
const APPROX_RENDER_SECONDS: Record<ExportFormatSlug, number> = {
  mp4: 7,
  mov: 12,
  webm: 8,
  'webm-av1': 9,
  gif: 3,
  apng: 10,
  webp: 8,
  lottie: 0.2,
  dotlottie: 0.3,
  svg: 0.4,
};

type Toast =
  | { kind: 'success'; id: number; filename: string; size: number; elapsed: number }
  | { kind: 'error'; id: number; message: string; retry?: () => void };

// Distributive Omit — required so each variant of the discriminated
// union keeps its own keys. Plain `Omit<Toast, "id">` collapses to
// `{ kind }` because TS only takes keys common to every variant.
type ToastInput = Toast extends infer T
  ? T extends Toast
    ? Omit<T, 'id'>
    : never
  : never;

/**
 * Direct-edit Studio surface — load a Lottie (preset or upload), tweak
 * colour + timing + dimensions locally, then export to any of 10 engine
 * formats. The chat-driven generation pipeline lives on the home page;
 * this is the surface for "I already have a Lottie, just render it".
 */
export function StudioPanel() {
  const bearer = useAuthStore((s) => s.accessToken) ?? undefined;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [presetSlug, setPresetSlug] = useState<PresetSlug>('corporate');
  const [base, setBase] = useState<LottieJson | null>(null);
  const [baseDuration, setBaseDuration] = useState(8);
  const [sourceLabel, setSourceLabel] = useState<string>('Corporate preset');
  const [sourceKey, setSourceKey] = useState<string>('corporate');
  const [loadError, setLoadError] = useState<string | null>(null);

  const [accent, setAccent] = useState('#10b981');
  const [background, setBackground] = useState('#0b1437');
  const [baseAccent, setBaseAccent] = useState('#10b981');
  const [baseBackground, setBaseBackground] = useState('#0b1437');
  const [duration, setDuration] = useState(8);
  const [dimensionSlug, setDimensionSlug] = useState<DimensionSlug>('fhd-16x9');
  const [fps, setFps] = useState<Fps>(30);
  const [isPlaying, setIsPlaying] = useState(true);

  const [pending, setPending] = useState<ExportFormatSlug | null>(null);
  const [exportElapsed, setExportElapsed] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Load the active preset when the slug changes (and on mount).
  useEffect(() => {
    let cancelled = false;
    const preset = PRESETS.find((p) => p.slug === presetSlug);
    if (!preset) return;
    setLoadError(null);
    fetch(preset.path, { cache: 'force-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${preset.path}`);
        return r.json();
      })
      .then((json: LottieJson) => {
        if (cancelled) return;
        const a = rgbToHex(detectAccentColor(json));
        const bg = rgbToHex(detectBackgroundColor(json));
        const d = durationSeconds(json);
        setBase(json);
        setBaseDuration(d);
        setDuration(d);
        setBaseAccent(a);
        setBaseBackground(bg);
        setAccent(a);
        setBackground(bg);
        setSourceLabel(`${preset.label} preset`);
        setSourceKey(preset.slug);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [presetSlug]);

  // Derived: the working Lottie with the current edits applied.
  const working = useMemo<LottieJson | null>(() => {
    if (!base) return null;
    const next = clone(base);
    applyRecolor(next, {
      accent: hexToRgb(accent),
      background: hexToRgb(background),
    });
    if (duration > 0 && Math.abs(duration - baseDuration) > 0.01) {
      applyRetime(next, { durationSeconds: duration });
    }
    return next;
  }, [base, accent, background, duration, baseDuration]);

  // True when any edit diverges from the source's detected defaults.
  const isEdited =
    accent.toLowerCase() !== baseAccent.toLowerCase() ||
    background.toLowerCase() !== baseBackground.toLowerCase() ||
    Math.abs(duration - baseDuration) > 0.01;

  // Tick the elapsed counter only while an export is in flight. Keeps
  // the overlay's countdown smooth without burning a 30fps timer when
  // idle.
  useEffect(() => {
    if (!pending) {
      setExportElapsed(0);
      return;
    }
    const start = performance.now();
    const id = window.setInterval(() => {
      setExportElapsed((performance.now() - start) / 1000);
    }, 100);
    return () => window.clearInterval(id);
  }, [pending]);

  const pushToast = useCallback((toast: ToastInput) => {
    const id = Date.now() + Math.random();
    const full = { ...toast, id } as Toast;
    setToasts((prev) => [...prev, full]);
    // Success auto-dismisses after 6s; errors stick until user dismisses.
    if (toast.kind === 'success') {
      window.setTimeout(
        () => setToasts((prev) => prev.filter((t) => t.id !== id)),
        6000,
      );
    }
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleUpload = useCallback((file: File) => {
    setLoadError(null);
    file
      .text()
      .then((text) => JSON.parse(text) as LottieJson)
      .then((json) => {
        if (!Array.isArray(json.layers)) {
          throw new Error('not a lottie JSON (missing `layers`)');
        }
        const a = rgbToHex(detectAccentColor(json));
        const bg = rgbToHex(detectBackgroundColor(json));
        const d = durationSeconds(json);
        setBase(json);
        setBaseDuration(d);
        setDuration(d);
        setBaseAccent(a);
        setBaseBackground(bg);
        setAccent(a);
        setBackground(bg);
        setSourceLabel(file.name);
        // Use a sanitised stem of the filename for smart export naming.
        const stem = file.name.replace(/\.json$/i, '').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
        setSourceKey(stem || 'upload');
      })
      .catch((e) => setLoadError(`Couldn't read ${file.name}: ${String(e)}`));
  }, []);

  const handleReset = useCallback(() => {
    if (!base) return;
    setAccent(baseAccent);
    setBackground(baseBackground);
    setDuration(baseDuration);
  }, [base, baseAccent, baseBackground, baseDuration]);

  const dimension = DIMENSIONS.find((d) => d.slug === dimensionSlug) ?? DIMENSIONS[0];

  const handleExport = useCallback(
    async (slug: ExportFormatSlug) => {
      if (!working || pending) return;
      const format = EXPORT_FORMATS.find((f) => f.slug === slug);
      if (!format) return;
      const isZeroRender = slug === 'lottie' || slug === 'dotlottie' || slug === 'svg';
      const params = new URLSearchParams();
      if (!isZeroRender) {
        params.set('w', String(dimension.w));
        params.set('h', String(dimension.h));
        params.set('fps', String(fps));
      }
      const qs = params.toString();
      const url = `${getEngineBase()}/v1/export/${slug}${qs ? `?${qs}` : ''}`;

      const filename = smartFilename({
        sourceKey,
        accent,
        dimension: isZeroRender ? null : dimension.slug,
        format: slug,
      });

      const start = performance.now();
      setPending(slug);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          },
          body: JSON.stringify(working),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ''}`);
        }
        const blob = await res.blob();
        const elapsed = (performance.now() - start) / 1000;
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
        pushToast({ kind: 'success', filename, size: blob.size, elapsed });
      } catch (e) {
        const message = String(e instanceof Error ? e.message : e);
        pushToast({
          kind: 'error',
          message: `${format.label} export failed: ${message}`,
          retry: () => {
            void handleExport(slug);
          },
        });
      } finally {
        setPending(null);
      }
    },
    [working, bearer, pending, dimension, fps, accent, sourceKey, pushToast],
  );

  const eta = pending ? APPROX_RENDER_SECONDS[pending] ?? 6 : 0;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:py-14">
      <header className="mb-8 flex flex-col gap-2">
        <h1 className="h-display">Studio</h1>
        <p className="max-w-2xl text-sm text-text-secondary">
          Load a preset or your own Lottie, recolour and retime it in the browser,
          then render to any of 10 formats — locally, on your engine. MP4 is the
          default; the chevron next to <em>Export MP4</em> lists the rest.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr,360px]">
        {/* Stage */}
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-2xl border border-border-light bg-bg-secondary shadow-card">
            <div className="relative aspect-video w-full bg-primary-900">
              {working ? (
                <Lottie
                  animationData={working}
                  loop
                  autoplay={isPlaying}
                  rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
                  style={{ width: '100%', height: '100%' }}
                />
              ) : (
                <div className="grid h-full w-full place-items-center px-6 text-center text-sm text-text-tertiary">
                  {loadError ? (
                    <div className="max-w-md text-sm">{loadError}</div>
                  ) : (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  )}
                </div>
              )}

              {/* Export-in-flight overlay */}
              {pending && (
                <div
                  role="status"
                  aria-live="polite"
                  className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-primary-900/85 backdrop-blur-sm"
                >
                  <div className="grid h-14 w-14 place-items-center rounded-full bg-accent-500/15 text-accent-300">
                    <Loader2 className="h-7 w-7 animate-spin" />
                  </div>
                  <div className="text-center">
                    <div className="text-base font-semibold text-white">
                      Rendering {EXPORT_FORMATS.find((f) => f.slug === pending)?.label}
                    </div>
                    <div className="mt-1 font-mono text-xs text-white/70">
                      {exportElapsed.toFixed(1)}s elapsed · usually ~{eta.toFixed(0)}s on this preset
                    </div>
                  </div>
                  <div className="h-1.5 w-56 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-accent-400 transition-[width] duration-200"
                      style={{
                        width: `${Math.min(100, (exportElapsed / Math.max(eta, 0.1)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Transport bar */}
            <div className="flex flex-wrap items-center gap-3 border-t border-border-light bg-bg-primary px-4 py-2.5">
              <button
                type="button"
                onClick={() => setIsPlaying((p) => !p)}
                disabled={!working || pending !== null}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="grid h-8 w-8 place-items-center rounded-full bg-accent-500 text-white transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                {isPlaying ? (
                  <Pause className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5 translate-x-0.5" />
                )}
              </button>
              <div className="flex flex-1 flex-wrap items-center gap-2 font-mono text-xs text-text-tertiary">
                {working ? (
                  <>
                    <span className="text-text-secondary">{duration.toFixed(1)}s</span>
                    <Sep />
                    <span>{fps}fps</span>
                    <Sep />
                    <span>
                      {dimension.w}×{dimension.h}
                    </span>
                    <Sep />
                    <span>{sourceLabel}</span>
                    {isEdited && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-accent-300 bg-accent-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-700 dark:bg-accent-950">
                        edited
                      </span>
                    )}
                  </>
                ) : (
                  <span>idle</span>
                )}
              </div>
              <button
                type="button"
                onClick={handleReset}
                disabled={!working || !isEdited || pending !== null}
                className="inline-flex items-center gap-1.5 rounded-full border border-border-light px-3 py-1 text-xs text-text-secondary transition hover:border-accent-300 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </button>
              <ExportMenu
                onExport={handleExport}
                disabled={!working}
                pending={pending}
              />
            </div>
          </div>
        </div>

        {/* Edit panel */}
        <aside className="flex flex-col gap-6 rounded-2xl border border-border-light bg-bg-primary p-5 shadow-soft">
          {/* Source */}
          <section className="flex flex-col gap-3">
            <Label>Source</Label>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.slug}
                  type="button"
                  onClick={() => setPresetSlug(p.slug)}
                  aria-pressed={p.slug === presetSlug && sourceLabel.endsWith('preset')}
                  className={`flex flex-col items-start gap-0.5 rounded-lg border px-2.5 py-2 text-left transition ${
                    p.slug === presetSlug && sourceLabel.endsWith('preset')
                      ? 'border-accent-400 bg-accent-50 shadow-soft'
                      : 'border-border-light bg-bg-secondary hover:border-accent-300'
                  }`}
                >
                  <span className="text-xs font-semibold text-text-primary">{p.label}</span>
                  <span className="text-2xs text-text-tertiary">{p.tone}</span>
                </button>
              ))}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border-light bg-bg-secondary px-3 py-2 text-xs text-text-secondary transition hover:border-accent-300 hover:text-text-primary"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload your own .json
            </button>
          </section>

          {/* Palette */}
          <section className="flex flex-col gap-3">
            <Label>Palette</Label>
            <ColorRow
              label="Accent"
              value={accent}
              baseline={baseAccent}
              onChange={setAccent}
              swatches={STUDIO_PRESET_COLORS.map((s) => s.hex)}
            />
            <ColorRow
              label="Background"
              value={background}
              baseline={baseBackground}
              onChange={setBackground}
              swatches={['#0b1437', '#0f172a', '#1e293b', '#ffffff', '#f8fafc']}
            />
          </section>

          {/* Timing */}
          <section className="flex flex-col gap-3">
            <Label>Timing</Label>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-primary">Duration</span>
              <span className="font-mono text-xs text-text-secondary">
                {duration.toFixed(1)}s
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={60}
              step={0.5}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full accent-accent-500"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-primary">Frame rate</span>
              <div className="flex gap-1">
                {FPS_CHOICES.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFps(value)}
                    aria-pressed={value === fps}
                    className={`rounded-md border px-2 py-0.5 font-mono text-2xs transition ${
                      value === fps
                        ? 'border-accent-400 bg-accent-50 text-accent-800 shadow-soft dark:bg-accent-950'
                        : 'border-border-light bg-bg-secondary text-text-secondary hover:border-accent-300'
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Output dimensions */}
          <section className="flex flex-col gap-3">
            <Label>Output</Label>
            <div className="grid grid-cols-2 gap-2">
              {DIMENSIONS.map((d) => {
                const Icon = d.icon;
                const active = d.slug === dimensionSlug;
                return (
                  <button
                    key={d.slug}
                    type="button"
                    onClick={() => setDimensionSlug(d.slug)}
                    aria-pressed={active}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition ${
                      active
                        ? 'border-accent-400 bg-accent-50 shadow-soft'
                        : 'border-border-light bg-bg-secondary hover:border-accent-300'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 text-text-tertiary" />
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold text-text-primary">{d.label}</span>
                      <span className="font-mono text-2xs text-text-tertiary">{d.sub}</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-2xs text-text-tertiary">
              Applied to video + raster formats only; lottie / svg / .lottie are
              vector and ignore output dimensions.
            </p>
          </section>
        </aside>
      </div>

      {/* Toast deck — fixed bottom-right */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-6 right-6 z-50 flex w-full max-w-sm flex-col gap-2"
      >
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />
        ))}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-2xs uppercase tracking-[0.16em] text-text-tertiary">
      {children}
    </span>
  );
}

function Sep() {
  return <span className="text-text-tertiary">·</span>;
}

function ColorRow({
  label,
  value,
  baseline,
  onChange,
  swatches,
}: {
  label: string;
  value: string;
  baseline: string;
  onChange: (next: string) => void;
  swatches: readonly string[];
}) {
  const dirty = value.toLowerCase() !== baseline.toLowerCase();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text-primary">
          {label}
          {dirty && (
            <span
              className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent-500"
              aria-label="edited"
            />
          )}
        </span>
        <span className="font-mono text-2xs uppercase text-text-tertiary">{value}</span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-12 cursor-pointer rounded border border-border-light bg-bg-secondary"
          aria-label={`${label} colour picker`}
        />
        <div className="flex flex-1 flex-wrap gap-1">
          {swatches.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange(s)}
              aria-label={`Use ${s}`}
              title={s}
              className={`h-6 w-6 rounded-full border transition hover:scale-110 ${
                s.toLowerCase() === value.toLowerCase()
                  ? 'border-accent-500 ring-2 ring-accent-200'
                  : 'border-border-light'
              }`}
              style={{ background: s }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ToastView({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  if (toast.kind === 'success') {
    return (
      <div
        role="status"
        className="pointer-events-auto flex items-start gap-3 rounded-xl border border-accent-200 bg-bg-primary p-3 shadow-lift"
      >
        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent-600" />
        <div className="flex-1 text-xs">
          <div className="font-semibold text-text-primary">Exported</div>
          <div className="mt-0.5 truncate font-mono text-2xs text-text-secondary" title={toast.filename}>
            {toast.filename}
          </div>
          <div className="mt-0.5 font-mono text-2xs text-text-tertiary">
            {formatBytes(toast.size)} · rendered in {toast.elapsed.toFixed(1)}s
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="text-text-tertiary transition hover:text-text-primary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }
  return (
    <div
      role="alert"
      className="pointer-events-auto flex items-start gap-3 rounded-xl border border-secondary-300 bg-bg-primary p-3 shadow-lift"
    >
      <div className="mt-0.5 grid h-4 w-4 flex-shrink-0 place-items-center rounded-full bg-secondary-100 text-secondary-700 text-[10px] font-bold">
        !
      </div>
      <div className="flex-1 text-xs">
        <div className="font-semibold text-text-primary">Export failed</div>
        <div className="mt-0.5 text-text-secondary">{toast.message}</div>
        {toast.retry && (
          <button
            type="button"
            onClick={toast.retry}
            className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-border-light px-2 py-0.5 text-2xs font-medium text-text-secondary transition hover:border-accent-300 hover:text-text-primary"
          >
            Retry
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-text-tertiary transition hover:text-text-primary"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * Build a filename that survives a Downloads-folder full of past
 * exports. Carries: source identity (preset slug or uploaded stem),
 * accent (so a recolour series stays distinguishable), output dims (so
 * 1080p vs 4K renders don't collide), timestamp, and the file extension.
 * Example: `controlcraft-corporate-10b981-fhd-16x9-1748333423.mp4`.
 */
function smartFilename({
  sourceKey,
  accent,
  dimension,
  format,
}: {
  sourceKey: string;
  accent: string;
  dimension: string | null;
  format: ExportFormatSlug;
}): string {
  const ts = Math.floor(Date.now() / 1000);
  const cleanAccent = accent.replace('#', '').toLowerCase();
  const parts = ['controlcraft', sourceKey, cleanAccent];
  if (dimension) parts.push(dimension);
  parts.push(String(ts));
  return `${parts.join('-')}.${extForSlug(format)}`;
}

function extForSlug(slug: ExportFormatSlug): string {
  switch (slug) {
    case 'mp4':
      return 'mp4';
    case 'mov':
      return 'mov';
    case 'webm':
    case 'webm-av1':
      return 'webm';
    case 'gif':
      return 'gif';
    case 'apng':
      return 'apng';
    case 'webp':
      return 'webp';
    case 'lottie':
      return 'json';
    case 'dotlottie':
      return 'lottie';
    case 'svg':
      return 'svg';
  }
}
