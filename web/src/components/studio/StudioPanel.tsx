'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2, Pause, Play, RotateCcw, Upload } from 'lucide-react';
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
 * Direct-edit Studio surface — load a Lottie (preset or upload), tweak
 * colour + timing locally, then export to any of the 10 engine formats.
 *
 * The chat-driven generation pipeline lives on the home page. This is
 * the surface for users who already have a Lottie and just want to
 * recolour / retime / render it.
 */
export function StudioPanel() {
  const bearer = useAuthStore((s) => s.accessToken) ?? undefined;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [presetSlug, setPresetSlug] = useState<PresetSlug>('corporate');
  const [base, setBase] = useState<LottieJson | null>(null);
  const [baseDuration, setBaseDuration] = useState(8);
  const [sourceLabel, setSourceLabel] = useState<string>('Corporate preset');
  const [loadError, setLoadError] = useState<string | null>(null);

  const [accent, setAccent] = useState('#10b981');
  const [background, setBackground] = useState('#0b1437');
  const [duration, setDuration] = useState(8);
  const [isPlaying, setIsPlaying] = useState(true);

  const [pending, setPending] = useState<ExportFormatSlug | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

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
        setBase(json);
        const d = durationSeconds(json);
        setBaseDuration(d);
        setDuration(d);
        setAccent(rgbToHex(detectAccentColor(json)));
        setBackground(rgbToHex(detectBackgroundColor(json)));
        setSourceLabel(`${preset.label} preset`);
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [presetSlug]);

  // Derived: the working Lottie with the current edits applied. Memoised
  // on the inputs so the preview only rebuilds when something actually
  // changed. Each render starts from a structured clone so the original
  // `base` stays pristine for resets.
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

  const handleUpload = useCallback((file: File) => {
    setLoadError(null);
    file
      .text()
      .then((text) => JSON.parse(text) as LottieJson)
      .then((json) => {
        if (!Array.isArray(json.layers)) {
          throw new Error('not a lottie JSON (missing `layers`)');
        }
        setBase(json);
        const d = durationSeconds(json);
        setBaseDuration(d);
        setDuration(d);
        setAccent(rgbToHex(detectAccentColor(json)));
        setBackground(rgbToHex(detectBackgroundColor(json)));
        setSourceLabel(file.name);
      })
      .catch((e) => setLoadError(`Couldn't read ${file.name}: ${String(e)}`));
  }, []);

  const handleReset = useCallback(() => {
    if (!base) return;
    setAccent(rgbToHex(detectAccentColor(base)));
    setBackground(rgbToHex(detectBackgroundColor(base)));
    setDuration(baseDuration);
  }, [base, baseDuration]);

  const handleExport = useCallback(
    async (slug: ExportFormatSlug) => {
      if (!working || pending) return;
      const format = EXPORT_FORMATS.find((f) => f.slug === slug);
      if (!format) return;
      const url = `${getEngineBase()}/v1/export/${slug}`;
      setPending(slug);
      setExportError(null);
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
          throw new Error(`HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ''}`);
        }
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const ext = extForSlug(slug);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = `controlcraft-${Date.now()}.${ext}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objectUrl);
      } catch (e) {
        setExportError(`Export ${slug}: ${String(e)}`);
      } finally {
        setPending(null);
      }
    },
    [working, bearer, pending],
  );

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:py-14">
      <header className="mb-8 flex flex-col gap-2">
        <h1 className="h-display">Studio</h1>
        <p className="max-w-2xl text-sm text-text-secondary">
          Load a preset or your own Lottie, recolour and retime it in the browser,
          then render it to any of 10 formats — all on your local engine. MP4 is
          the default; the chevron next to <em>Export MP4</em> lists the rest.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr,360px]">
        {/* Stage + transport */}
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
                <div className="grid h-full w-full place-items-center text-text-tertiary">
                  {loadError ? (
                    <div className="max-w-md text-center text-sm">{loadError}</div>
                  ) : (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 border-t border-border-light bg-bg-primary px-4 py-2.5">
              <button
                type="button"
                onClick={() => setIsPlaying((p) => !p)}
                disabled={!working}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="grid h-8 w-8 place-items-center rounded-full bg-accent-500 text-white transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:bg-neutral-300"
              >
                {isPlaying ? (
                  <Pause className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5 translate-x-0.5" />
                )}
              </button>
              <div className="flex-1 font-mono text-xs text-text-tertiary">
                {working ? (
                  <>
                    <span className="text-text-secondary">{duration.toFixed(1)}s</span>
                    <span className="mx-2">·</span>
                    <span>{(working.fr as number | undefined) ?? 30}fps</span>
                    <span className="mx-2">·</span>
                    <span>
                      {(working.w as number | undefined) ?? 0}×{(working.h as number | undefined) ?? 0}
                    </span>
                    <span className="mx-2">·</span>
                    <span>{sourceLabel}</span>
                  </>
                ) : (
                  <span>idle</span>
                )}
              </div>
              <button
                type="button"
                onClick={handleReset}
                disabled={!working}
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
          {exportError && (
            <p
              role="status"
              className="rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-2 text-xs text-text-secondary"
            >
              {exportError}
            </p>
          )}
        </div>

        {/* Edit panel */}
        <aside className="flex flex-col gap-6 rounded-2xl border border-border-light bg-bg-primary p-5 shadow-soft">
          {/* Source picker */}
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
                  <span className="text-xs font-semibold text-text-primary">
                    {p.label}
                  </span>
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
              onChange={setAccent}
              swatches={STUDIO_PRESET_COLORS.map((s) => s.hex)}
            />
            <ColorRow
              label="Background"
              value={background}
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
            <p className="text-2xs text-text-tertiary">
              Scales every keyframe in proportion; original is {baseDuration.toFixed(1)}s.
            </p>
          </section>
        </aside>
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

function ColorRow({
  label,
  value,
  onChange,
  swatches,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  swatches: readonly string[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-text-primary">{label}</span>
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
