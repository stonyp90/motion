'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Download, Play, Pause, RotateCw, Zap, Film, Loader2, Sparkles } from 'lucide-react';
import {
  applyRecolor,
  applyRetime,
  clone,
  detectAccentColor,
  detectBackgroundColor,
  downloadJson,
  durationSeconds,
  hexToRgb,
  rgbToHex,
  type LottieJson,
} from '@/lib/lottie/transform';

const Lottie = dynamic(() => import('lottie-react').then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-text-tertiary">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  ),
});

const PRESETS = [
  { slug: 'corporate', label: 'Corporate', path: '/lottie/corporate.json', tone: 'calm + decelerated' },
  { slug: 'playful', label: 'Playful', path: '/lottie/playful.json', tone: 'bouncy + vivid' },
  { slug: 'minimalist', label: 'Minimalist', path: '/lottie/minimalist.json', tone: 'type-led + slow' },
] as const;

type PresetSlug = (typeof PRESETS)[number]['slug'];

export function StudioClient() {
  const [presetSlug, setPresetSlug] = useState<PresetSlug>('corporate');
  const [base, setBase] = useState<LottieJson | null>(null);
  const [accent, setAccent] = useState<string>('#10b981');
  const [background, setBackground] = useState<string>('#0b1437');
  const [duration, setDuration] = useState<number>(8);
  const [originalDuration, setOriginalDuration] = useState<number>(8);
  const [isPlaying, setIsPlaying] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editCount, setEditCount] = useState(0);
  const editTimestamps = useRef<number[]>([]);
  const [editsPerMinute, setEditsPerMinute] = useState(0);
  const lottieRef = useRef<unknown>(null);

  // Load the chosen preset whenever it changes.
  useEffect(() => {
    let cancelled = false;
    const preset = PRESETS.find((p) => p.slug === presetSlug)!;
    setLoadError(null);
    fetch(preset.path, { cache: 'force-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} fetching ${preset.path}`);
        return r.json();
      })
      .then((json: LottieJson) => {
        if (cancelled) return;
        setBase(json);
        setOriginalDuration(durationSeconds(json));
        setDuration(durationSeconds(json));
        setAccent(rgbToHex(detectAccentColor(json)));
        setBackground(rgbToHex(detectBackgroundColor(json)));
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [presetSlug]);

  // Track edit-rate so we can show the "edits per minute" stat.
  const trackEdit = useCallback(() => {
    const now = performance.now();
    editTimestamps.current = editTimestamps.current.filter((t) => now - t < 60_000);
    editTimestamps.current.push(now);
    setEditCount((c) => c + 1);
    setEditsPerMinute(editTimestamps.current.length);
  }, []);

  // Compute the live (re-colored + re-timed) Lottie JSON every render.
  const animationData = useMemo(() => {
    if (!base) return null;
    const draft = clone(base);
    applyRecolor(draft, { accent: hexToRgb(accent), background: hexToRgb(background) });
    if (Math.abs(duration - originalDuration) > 0.01) {
      applyRetime(draft, { durationSeconds: duration });
    }
    return draft;
  }, [base, accent, background, duration, originalDuration]);

  const handleColorChange =
    (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setter(e.target.value);
      trackEdit();
    };

  const handleDuration = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDuration(Number(e.target.value));
    trackEdit();
  };

  const handleDownload = () => {
    if (!animationData) return;
    downloadJson(animationData, `motion-forge-${presetSlug}-${Date.now()}.lottie.json`);
  };

  const handleRender = () => {
    alert(
      'Render to MP4 is the only operation that needs a server round-trip — it shells the\nlottie Python renderer in the Azure render-job. From here this stub posts the current\nJSON to /v1/render and returns a presigned MP4 URL once the job is done.',
    );
  };

  const togglePlay = () => {
    setIsPlaying((p) => !p);
    const inst = lottieRef.current as { play?: () => void; pause?: () => void } | null;
    if (!inst) return;
    if (isPlaying) inst.pause?.();
    else inst.play?.();
  };

  return (
    <div className="relative grid min-h-[calc(100vh-4rem)] grid-cols-1 gap-0 lg:grid-cols-[1fr_360px]">
      {/* Stage */}
      <div className="relative bg-neutral-100">
        <div className="absolute left-4 top-4 z-10 flex flex-col gap-2">
          <span className="chip border-accent-200 bg-accent-50 text-accent-700">
            <Zap className="h-3 w-3" /> Editing locally · zero server round-trips
          </span>
          <span className="chip text-text-tertiary">
            preset: <span className="font-semibold text-text-primary">{presetSlug}</span> ·{' '}
            {editCount} edits · {editsPerMinute}/min
          </span>
        </div>

        <div className="absolute right-4 top-4 z-10 flex gap-2">
          <button onClick={handleDownload} className="btn-ghost py-2 text-xs">
            <Download className="h-4 w-4" />
            Download .lottie.json
          </button>
          <button onClick={handleRender} className="btn-accent py-2 text-xs">
            <Film className="h-4 w-4" />
            Render MP4
          </button>
        </div>

        <div className="grid h-full place-items-center p-4 sm:p-10">
          {loadError ? (
            <div className="rounded-2xl border border-border bg-bg-primary p-8 text-center text-sm text-text-secondary shadow-card">
              <p className="font-semibold text-text-primary">Couldn&apos;t load preset.</p>
              <p className="mt-2 font-mono text-xs text-text-tertiary">{loadError}</p>
            </div>
          ) : (
            <div className="relative w-full max-w-[940px] overflow-hidden rounded-2xl bg-primary-900 shadow-lift">
              <div
                className="aspect-video w-full"
                style={{ background: background }}
              >
                {animationData && (
                  <Lottie
                    // The `key` change forces a clean remount when we switch presets,
                    // so the player resets rather than awkwardly cross-fading.
                    key={presetSlug}
                    animationData={animationData}
                    loop
                    autoplay={isPlaying}
                    lottieRef={lottieRef as never}
                    rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
                    style={{ width: '100%', height: '100%' }}
                  />
                )}
              </div>

              {/* Bottom transport bar */}
              <div className="flex items-center gap-3 bg-bg-inverse/95 px-4 py-3 text-text-inverse">
                <button
                  onClick={togglePlay}
                  className="grid h-9 w-9 place-items-center rounded-full bg-accent-500 text-white transition hover:bg-accent-400"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 translate-x-0.5" />}
                </button>
                <div className="flex-1 text-xs text-primary-200">
                  <span className="font-mono">{duration.toFixed(1)}s</span> ·{' '}
                  <span className="font-mono">
                    {animationData?.fr ?? 30}fps
                  </span>{' '}
                  ·{' '}
                  <span className="font-mono">
                    {animationData?.w ?? 0}×{animationData?.h ?? 0}
                  </span>
                </div>
                <span className="font-mono text-xs text-accent-300">edge-rendered</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Control panel */}
      <aside className="border-t border-border-light bg-bg-primary lg:border-l lg:border-t-0">
        <div className="flex flex-col gap-6 p-6">
          <header>
            <p className="eyebrow">Studio</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-text-primary">
              Edit on the edge
            </h1>
            <p className="mt-2 text-sm text-text-secondary">
              Every change below mutates the Lottie JSON in the browser and
              re-renders the canvas in &lt;5 ms. No network round trips until
              you hit <em>Render MP4</em>.
            </p>
          </header>

          {/* Preset picker */}
          <section className="flex flex-col gap-2">
            <Label>Preset</Label>
            <div className="grid grid-cols-3 gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.slug}
                  onClick={() => setPresetSlug(p.slug)}
                  className={`rounded-xl border px-3 py-2.5 text-left text-xs transition ${
                    p.slug === presetSlug
                      ? 'border-accent-400 bg-accent-50 shadow-soft'
                      : 'border-border-light bg-bg-secondary hover:border-border'
                  }`}
                >
                  <div className="text-sm font-semibold text-text-primary">{p.label}</div>
                  <div className="mt-0.5 text-[10px] text-text-tertiary">{p.tone}</div>
                </button>
              ))}
            </div>
          </section>

          {/* Colors */}
          <section className="flex flex-col gap-3">
            <Label>Palette</Label>
            <ColorRow
              label="Accent"
              value={accent}
              onChange={handleColorChange(setAccent)}
              helper="Recolors every fill in every shape layer."
            />
            <ColorRow
              label="Background"
              value={background}
              onChange={handleColorChange(setBackground)}
              helper="Recolors the layer named &ldquo;background&rdquo; (and the stage)."
            />
            <div className="flex flex-wrap gap-1.5 pt-1">
              {['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'].map(
                (sw) => (
                  <button
                    key={sw}
                    onClick={() => {
                      setAccent(sw);
                      trackEdit();
                    }}
                    className="h-7 w-7 rounded-full border border-border-light shadow-soft transition hover:scale-110"
                    style={{ background: sw }}
                    aria-label={`Set accent to ${sw}`}
                  />
                ),
              )}
            </div>
          </section>

          {/* Duration */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>Duration</Label>
              <span className="font-mono text-sm text-text-secondary">{duration.toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min="2"
              max="30"
              step="0.5"
              value={duration}
              onChange={handleDuration}
              className="w-full accent-accent-500"
            />
            <p className="text-xs text-text-tertiary">
              Scales every keyframe and layer in/out time proportionally.
            </p>
          </section>

          {/* Tech callout */}
          <section className="rounded-2xl border border-border-light bg-bg-secondary p-4">
            <div className="flex items-start gap-2 text-text-secondary">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-accent-600" />
              <div className="text-xs leading-relaxed">
                <p className="font-semibold text-text-primary">Why &ldquo;on the edge&rdquo;?</p>
                <p className="mt-1">
                  Lottie JSON is small (~30 KB here). The whole document is loaded
                  once from Front Door CDN, then every edit re-mutates it in JS and
                  re-renders via <code className="font-mono">lottie-web</code>.
                  Latency = your CPU + 1 paint frame.
                </p>
              </div>
            </div>
          </section>

          <button
            onClick={() => {
              if (!base) return;
              setAccent(rgbToHex(detectAccentColor(base)));
              setBackground(rgbToHex(detectBackgroundColor(base)));
              setDuration(originalDuration);
              trackEdit();
            }}
            className="btn-ghost text-xs"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Reset preset
          </button>
        </div>
      </aside>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-text-tertiary">
      {children}
    </span>
  );
}

function ColorRow({
  label,
  value,
  onChange,
  helper,
}: {
  label: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  helper?: string;
}) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-border-light bg-bg-secondary p-2 pr-3">
      <input
        type="color"
        value={value}
        onChange={onChange}
        className="h-10 w-10 cursor-pointer rounded-lg border-0 bg-transparent p-0"
      />
      <div className="flex-1">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-text-primary">{label}</span>
          <span className="font-mono text-xs text-text-tertiary">{value.toUpperCase()}</span>
        </div>
        {helper && <p className="text-[11px] leading-snug text-text-tertiary">{helper}</p>}
      </div>
    </label>
  );
}
