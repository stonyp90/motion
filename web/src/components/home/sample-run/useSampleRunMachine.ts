'use client';

import { useEffect, useRef, useState } from 'react';
import type { LottieJson } from '@/lib/lottie/transform';
import { track } from '@/lib/analytics/track';

/**
 * Single-clock state machine for the anonymous sample-run demo.
 *
 * The demo plays back a **real** /v1/brief/generate run that was
 * captured by `web/scripts/capture-sample-run.mjs` and frozen to
 * `web/public/sample-run/run.json` + `.../animation.json`. Stage
 * timings, scene count, cast, and the Lottie itself all come from
 * that cached run — so anonymous visitors see authentic pipeline
 * output without burning engine compute per pageview. If the cache
 * is missing (script never ran), the machine falls back to the
 * existing `/lottie/*.json` presets with hand-tuned timings so the
 * surface stays useful in a fresh checkout.
 *
 * All output is derived from `elapsed % LOOP_MS` so the loop is
 * exactly periodic and tab-throttling can't drift the playhead. The
 * hook owns one `setInterval(80ms)` and dedups every setState by
 * reference equality so React skips no-op renders.
 *
 * Visibility + scroll:
 *   - `IntersectionObserver` pauses when the demo scrolls off-screen
 *   - `document.visibilitychange` pauses on hidden tabs
 * Resume continues from the paused playhead, NOT t=0.
 *
 * Reduced motion:
 *   - `prefers-reduced-motion: reduce` snaps to `done` and stops.
 */

export type SampleState =
  | 'idle'
  | 'typing-prompt'
  | 'picking-format'
  | 'picking-length'
  | 'adding-cast'
  | 'pulse-generate'
  | 'running'
  | 'rendering'
  | 'done'
  | 'looping-back';

export type SampleAspect = '16:9' | '9:16' | '1:1' | '4:5';

export interface SampleCast {
  id: string;
  name: string;
  /** Hex accent applied to the chip outline. */
  accent_hex: string;
}

export interface SampleRunStage {
  id: 'brief' | 'cast' | 'compose' | 'render';
  label: string;
  ms: number;
}

export interface SampleRunMeta {
  /** True when the cache hit and the demo is playing a real engine run. */
  isReal: boolean;
  /** ISO timestamp the capture script wrote (real runs only). */
  generated_at?: string;
  /** Shots in the real timeline (real runs only). */
  scenes?: number;
  /** Image-gen backend that produced the assets (real runs only). */
  asset_provider?: string;
  /** Per-shot illustration cost in USD (real runs only). */
  asset_cost_usd?: number;
  /** Wall-clock the real /v1/brief/generate took (real runs only). */
  total_ms?: number;
}

export interface SampleRunOutput {
  state: SampleState;
  prompt: string;
  aspect: SampleAspect;
  length: number;
  cast: SampleCast[];
  isGenerating: boolean;
  /** Becomes non-null in `rendering`; cleared on `looping-back`. */
  animation: LottieJson | null;
  /** True when the loop's clock is paused (offscreen / hidden tab). */
  isPaused: boolean;
  pausedReason: 'offscreen' | 'hidden' | null;
  /** The current generate stage label, when state === 'running'. */
  stageLabel: string;
  /** Provenance + metadata about the cached real run, if any. */
  meta: SampleRunMeta;
}

interface UseSampleRunOptions {
  containerRef: React.RefObject<HTMLElement | null>;
  /** Override the default brief — typewriter still types it in. */
  prompt?: string;
}

const FALLBACK_PROMPT =
  'Animate our Q3 earnings: $2.4M revenue, 18% growth, three customer logos.';

const FALLBACK_CAST: SampleCast = {
  id: 'alex',
  name: 'Alex · Founder',
  accent_hex: '#10b981',
};

const FALLBACK_LOTTIE_PATHS = [
  '/lottie/corporate.json',
  '/lottie/playful.json',
  '/lottie/minimalist.json',
];

const FALLBACK_FIRST_LOTTIE = '/lottie/corporate.json';

const CACHE_RUN_PATH = '/sample-run/run.json';

/** Stages that drive the "running" phase progress display. */
const FALLBACK_STAGES: SampleRunStage[] = [
  { id: 'brief', label: 'Reading the brief', ms: 1000 },
  { id: 'cast', label: 'Casting characters', ms: 700 },
  { id: 'compose', label: 'Composing scenes', ms: 5300 },
  { id: 'render', label: 'Polishing motion', ms: 1000 },
];

/**
 * Cap the `running` phase to this budget for playback. Real engine
 * runs can take 30s-2min; nobody waits that long on a marketing
 * demo. We preserve the *proportions* between brief/cast/compose/
 * render and surface the real wall-clock in the provenance strip.
 */
const PLAYBACK_RUNNING_BUDGET_MS = 12_000;

const ASPECT_CYCLE: SampleAspect[] = ['16:9', '9:16', '1:1', '16:9'];

const TICK_MS = 80;
const TYPING_CHAR_MS = 40;

/**
 * Wall-clock budget for the non-running phases of the loop. The
 * `running` phase length is *not* in here — it comes from
 * `sum(stages[].ms)` so the loop reflects the real engine time.
 */
const PRE_RUNNING_MS = {
  idle: 200,
  typing: 4000,   // ~100 chars at 40ms each
  format: 2000,
  length: 800,
  cast: 1500,
  pulseGenerate: 1000,
};

const POST_RUNNING_MS = {
  rendering: 1500,
  done: 3000,
  loop: 300,
};

interface ResolvedSampleConfig {
  prompt: string;
  aspect: SampleAspect;
  duration: number;
  cast: SampleCast[];
  stages: SampleRunStage[];
  totalRunningMs: number;
  animation: LottieJson | null;
  /** When the real cache misses, we rotate through preset Lotties. */
  rotatingPaths: string[];
  meta: SampleRunMeta;
}

interface CachedRunJson {
  version?: number;
  generated_at?: string;
  request?: {
    prompt?: string;
    duration_seconds?: number;
    scene_count?: number;
    aspect?: SampleAspect;
  };
  response?: {
    shots?: number;
    duration_seconds?: number;
    assets_generated?: number;
    assets_failed?: number;
    asset_cost_micros?: number;
    asset_provider?: string;
  };
  stages?: SampleRunStage[];
  total_ms?: number;
  cast?: SampleCast[];
  animation_path?: string;
}

/**
 * Try to load the cached real run. Resolves with a fully-populated
 * config when the cache is present and well-formed, or `null` when
 * we should fall back to the preset path.
 */
async function tryLoadCachedRun(): Promise<ResolvedSampleConfig | null> {
  try {
    // run.json is tiny + we want it fresh after each capture, so we
    // let the HTTP cache revalidate normally instead of forcing the
    // stale-cache path. The Lottie is heavier and never changes
    // without a corresponding run.json bump, so we still force-cache
    // it for repeat visits.
    const r = await fetch(CACHE_RUN_PATH);
    if (!r.ok) return null;
    const meta = (await r.json()) as CachedRunJson;
    if (!meta || meta.version !== 1) return null;

    const animPath = meta.animation_path ?? '/sample-run/animation.json';
    const ar = await fetch(animPath, { cache: 'force-cache' });
    if (!ar.ok) return null;
    const animation = (await ar.json()) as LottieJson;

    const rawStages =
      Array.isArray(meta.stages) && meta.stages.length > 0
        ? meta.stages
        : FALLBACK_STAGES;
    const rawTotal = rawStages.reduce((acc, s) => acc + (s.ms ?? 0), 0);
    // Scale to the playback budget while preserving proportions, so
    // a 90 s real run feels like a 12 s loop. The real wall-clock
    // still lands in the provenance strip below the preview.
    const scale =
      rawTotal > PLAYBACK_RUNNING_BUDGET_MS
        ? PLAYBACK_RUNNING_BUDGET_MS / rawTotal
        : 1;
    const stages = rawStages.map((s) => ({
      ...s,
      ms: Math.max(1, Math.round(s.ms * scale)),
    }));
    const totalRunningMs = stages.reduce((acc, s) => acc + (s.ms ?? 0), 0);

    return {
      prompt: meta.request?.prompt ?? FALLBACK_PROMPT,
      aspect: meta.request?.aspect ?? '16:9',
      duration: meta.request?.duration_seconds ?? 30,
      cast: Array.isArray(meta.cast) && meta.cast.length > 0 ? meta.cast : [FALLBACK_CAST],
      stages,
      totalRunningMs,
      animation,
      rotatingPaths: [],
      meta: {
        isReal: true,
        generated_at: meta.generated_at,
        scenes: meta.response?.shots,
        asset_provider: meta.response?.asset_provider,
        asset_cost_usd:
          typeof meta.response?.asset_cost_micros === 'number'
            ? meta.response.asset_cost_micros / 1e6
            : undefined,
        total_ms: meta.total_ms,
      },
    };
  } catch {
    return null;
  }
}

async function loadFallbackConfig(prompt: string): Promise<ResolvedSampleConfig> {
  let animation: LottieJson | null = null;
  try {
    const r = await fetch(FALLBACK_FIRST_LOTTIE, { cache: 'force-cache' });
    if (r.ok) animation = (await r.json()) as LottieJson;
  } catch {
    /* leave animation null — preview will render a skeleton */
  }
  const totalRunningMs = FALLBACK_STAGES.reduce((acc, s) => acc + s.ms, 0);
  return {
    prompt,
    aspect: '16:9',
    duration: 30,
    cast: [FALLBACK_CAST],
    stages: FALLBACK_STAGES,
    totalRunningMs,
    animation,
    rotatingPaths: FALLBACK_LOTTIE_PATHS,
    meta: { isReal: false },
  };
}

interface TimelineBands {
  idle: [number, number];
  typing: [number, number];
  format: [number, number];
  length: [number, number];
  cast: [number, number];
  pulseGenerate: [number, number];
  running: [number, number];
  rendering: [number, number];
  done: [number, number];
  loop: [number, number];
  /** Per-stage [start, end] inside the `running` window. */
  stageBands: Array<[number, number]>;
}

function buildTimeline(config: ResolvedSampleConfig): TimelineBands {
  let cursor = 0;
  const idle: [number, number] = [cursor, cursor + PRE_RUNNING_MS.idle];
  cursor = idle[1];
  const typing: [number, number] = [cursor, cursor + PRE_RUNNING_MS.typing];
  cursor = typing[1];
  const format: [number, number] = [cursor, cursor + PRE_RUNNING_MS.format];
  cursor = format[1];
  const length: [number, number] = [cursor, cursor + PRE_RUNNING_MS.length];
  cursor = length[1];
  const cast: [number, number] = [cursor, cursor + PRE_RUNNING_MS.cast];
  cursor = cast[1];
  const pulseGenerate: [number, number] = [
    cursor,
    cursor + PRE_RUNNING_MS.pulseGenerate,
  ];
  cursor = pulseGenerate[1];
  const runningStart = cursor;
  const stageBands: Array<[number, number]> = [];
  for (const stage of config.stages) {
    stageBands.push([cursor, cursor + stage.ms]);
    cursor += stage.ms;
  }
  const running: [number, number] = [runningStart, cursor];
  const rendering: [number, number] = [cursor, cursor + POST_RUNNING_MS.rendering];
  cursor = rendering[1];
  const done: [number, number] = [cursor, cursor + POST_RUNNING_MS.done];
  cursor = done[1];
  const loop: [number, number] = [cursor, cursor + POST_RUNNING_MS.loop];

  return {
    idle,
    typing,
    format,
    length,
    cast,
    pulseGenerate,
    running,
    rendering,
    done,
    loop,
    stageBands,
  };
}

interface DerivedCore {
  state: SampleState;
  prompt: string;
  aspect: SampleAspect;
  length: number;
  cast: SampleCast[];
  isGenerating: boolean;
  animation: LottieJson | null;
  stageLabel: string;
}

function deriveOutput(
  elapsed: number,
  config: ResolvedSampleConfig,
  timeline: TimelineBands,
  animation: LottieJson | null,
): DerivedCore {
  // Map elapsed → state + per-state outputs.
  if (elapsed < timeline.idle[1]) {
    return {
      state: 'idle',
      prompt: '',
      aspect: '16:9',
      length: config.duration,
      cast: [],
      isGenerating: false,
      animation: null,
      stageLabel: '',
    };
  }
  if (elapsed < timeline.typing[1]) {
    const chars = Math.max(
      0,
      Math.floor((elapsed - timeline.idle[1]) / TYPING_CHAR_MS),
    );
    return {
      state: 'typing-prompt',
      prompt: config.prompt.slice(0, chars),
      aspect: '16:9',
      length: config.duration,
      cast: [],
      isGenerating: false,
      animation: null,
      stageLabel: '',
    };
  }
  if (elapsed < timeline.format[1]) {
    const phase =
      (elapsed - timeline.format[0]) /
      Math.max(1, timeline.format[1] - timeline.format[0]);
    const idx = Math.min(
      ASPECT_CYCLE.length - 1,
      Math.floor(phase * ASPECT_CYCLE.length),
    );
    return {
      state: 'picking-format',
      prompt: config.prompt,
      aspect: ASPECT_CYCLE[idx]!,
      length: config.duration,
      cast: [],
      isGenerating: false,
      animation: null,
      stageLabel: '',
    };
  }
  if (elapsed < timeline.length[1]) {
    return {
      state: 'picking-length',
      prompt: config.prompt,
      aspect: config.aspect,
      length: config.duration,
      cast: [],
      isGenerating: false,
      animation: null,
      stageLabel: '',
    };
  }
  if (elapsed < timeline.cast[1]) {
    return {
      state: 'adding-cast',
      prompt: config.prompt,
      aspect: config.aspect,
      length: config.duration,
      cast: config.cast,
      isGenerating: false,
      animation: null,
      stageLabel: '',
    };
  }
  if (elapsed < timeline.pulseGenerate[1]) {
    return {
      state: 'pulse-generate',
      prompt: config.prompt,
      aspect: config.aspect,
      length: config.duration,
      cast: config.cast,
      isGenerating: false,
      animation: null,
      stageLabel: '',
    };
  }
  if (elapsed < timeline.running[1]) {
    // Find which stage we're inside.
    let stageLabel = config.stages[0]?.label ?? '';
    for (let i = 0; i < timeline.stageBands.length; i++) {
      const [s, e] = timeline.stageBands[i]!;
      if (elapsed >= s && elapsed < e) {
        const stage = config.stages[i];
        if (stage?.id === 'compose' && config.meta.scenes) {
          // Show "Composing scene k / N" by interpolating across the
          // band — gives the same authentic feel the studio UI has.
          const progress = (elapsed - s) / Math.max(1, e - s);
          const sceneIdx = Math.min(
            config.meta.scenes,
            Math.max(1, Math.floor(progress * config.meta.scenes) + 1),
          );
          stageLabel = `Composing scene ${sceneIdx} / ${config.meta.scenes}`;
        } else if (stage) {
          stageLabel = stage.label;
        }
        break;
      }
    }
    return {
      state: 'running',
      prompt: config.prompt,
      aspect: config.aspect,
      length: config.duration,
      cast: config.cast,
      isGenerating: true,
      animation: null,
      stageLabel,
    };
  }
  if (elapsed < timeline.rendering[1]) {
    return {
      state: 'rendering',
      prompt: config.prompt,
      aspect: config.aspect,
      length: config.duration,
      cast: config.cast,
      isGenerating: false,
      animation,
      stageLabel: '',
    };
  }
  if (elapsed < timeline.done[1]) {
    return {
      state: 'done',
      prompt: config.prompt,
      aspect: config.aspect,
      length: config.duration,
      cast: config.cast,
      isGenerating: false,
      animation,
      stageLabel: '',
    };
  }
  return {
    state: 'looping-back',
    prompt: config.prompt,
    aspect: config.aspect,
    length: config.duration,
    cast: config.cast,
    isGenerating: false,
    animation,
    stageLabel: '',
  };
}

export function useSampleRunMachine({
  containerRef,
  prompt: promptOverride,
}: UseSampleRunOptions): SampleRunOutput {
  const [output, setOutput] = useState<SampleRunOutput>({
    state: 'idle',
    prompt: '',
    aspect: '16:9',
    length: 30,
    cast: [],
    isGenerating: false,
    animation: null,
    isPaused: false,
    pausedReason: null,
    stageLabel: '',
    meta: { isReal: false },
  });
  // The resolved config + timeline don't change after first load, so
  // we keep them in refs and recompute deriveOutput against the same
  // objects each tick.
  const configRef = useRef<ResolvedSampleConfig | null>(null);
  const timelineRef = useRef<TimelineBands | null>(null);
  const animationRef = useRef<LottieJson | null>(null);
  const loopCountRef = useRef(0);
  const completedFiredRef = useRef(false);
  // Wall-clock start, offset by accumulated pause time.
  const startRef = useRef<number>(Date.now());
  const pausedAtRef = useRef<number | null>(null);
  const reducedMotionRef = useRef(false);

  // Resolve the run config (real cache or fallback) once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cached = await tryLoadCachedRun();
      const config = cached ?? (await loadFallbackConfig(promptOverride ?? FALLBACK_PROMPT));
      if (cancelled) return;
      // Honor the prompt override if the caller passed one (useful for tests).
      if (promptOverride) {
        config.prompt = promptOverride;
      }
      configRef.current = config;
      timelineRef.current = buildTimeline(config);
      animationRef.current = config.animation;
      // Reset the clock so the freshly-resolved config gets a clean run.
      startRef.current = Date.now();
      loopCountRef.current = 0;
      completedFiredRef.current = false;
      // If reduced motion is active, snap to done immediately.
      if (reducedMotionRef.current) {
        setOutput((prev) => ({
          ...prev,
          state: 'done',
          prompt: config.prompt,
          aspect: config.aspect,
          length: config.duration,
          cast: config.cast,
          animation: config.animation,
          meta: config.meta,
        }));
        return;
      }
      setOutput((prev) => ({
        ...prev,
        prompt: '',
        meta: config.meta,
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [promptOverride]);

  // Detect reduced motion once on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    reducedMotionRef.current = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    if (reducedMotionRef.current && configRef.current) {
      const c = configRef.current;
      setOutput((prev) => ({
        ...prev,
        state: 'done',
        prompt: c.prompt,
        aspect: c.aspect,
        length: c.duration,
        cast: c.cast,
        animation: c.animation,
        meta: c.meta,
      }));
    }
  }, []);

  // Visibility observers.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (reducedMotionRef.current) return;

    const setPaused = (reason: 'offscreen' | 'hidden' | null) => {
      if (reason === null) {
        if (pausedAtRef.current != null) {
          const pausedFor = Date.now() - pausedAtRef.current;
          startRef.current += pausedFor;
          pausedAtRef.current = null;
        }
        setOutput((p) =>
          p.isPaused ? { ...p, isPaused: false, pausedReason: null } : p,
        );
      } else {
        if (pausedAtRef.current == null) pausedAtRef.current = Date.now();
        setOutput((p) =>
          p.pausedReason === reason
            ? p
            : { ...p, isPaused: true, pausedReason: reason },
        );
      }
    };

    const onVisChange = () => {
      if (document.hidden) setPaused('hidden');
      else if (pausedAtRef.current && output.pausedReason === 'hidden') setPaused(null);
    };
    document.addEventListener('visibilitychange', onVisChange);

    const el = containerRef.current;
    let io: IntersectionObserver | null = null;
    if (el && 'IntersectionObserver' in window) {
      io = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.target !== el) continue;
            if (entry.isIntersecting) {
              if (output.pausedReason === 'offscreen') setPaused(null);
            } else {
              setPaused('offscreen');
            }
          }
        },
        { threshold: 0.2 },
      );
      io.observe(el);
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisChange);
      io?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);

  // The clock.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (reducedMotionRef.current) return;

    const tick = () => {
      if (pausedAtRef.current != null) return;
      const config = configRef.current;
      const timeline = timelineRef.current;
      if (!config || !timeline) return;

      const loopMs = timeline.loop[1];
      const elapsedTotal = Date.now() - startRef.current;
      const loopIndex = Math.floor(elapsedTotal / loopMs);
      const elapsed = elapsedTotal % loopMs;

      if (loopIndex !== loopCountRef.current) {
        loopCountRef.current = loopIndex;
        // When we're on the fallback path (no cached real run), rotate
        // across the preset Lotties for variety. Real-run mode locks
        // the real Lottie because that's the authentic artifact.
        if (!config.meta.isReal && config.rotatingPaths.length > 0) {
          const nextPath =
            config.rotatingPaths[loopIndex % config.rotatingPaths.length]!;
          void fetch(nextPath, { cache: 'force-cache' })
            .then((r) => (r.ok ? r.json() : null))
            .then((j: LottieJson | null) => {
              if (j) animationRef.current = j;
            })
            .catch(() => {});
        }
      }

      const derived = deriveOutput(elapsed, config, timeline, animationRef.current);

      if (derived.state === 'done' && !completedFiredRef.current) {
        completedFiredRef.current = true;
        track('sample_run_completed', {
          loop_index: loopIndex,
          duration_ms: loopMs,
          is_real: config.meta.isReal,
        });
      }

      setOutput((prev) => {
        // Reference-equality dedup on the heavy fields.
        if (
          prev.state === derived.state &&
          prev.prompt === derived.prompt &&
          prev.aspect === derived.aspect &&
          prev.length === derived.length &&
          prev.cast === derived.cast &&
          prev.isGenerating === derived.isGenerating &&
          prev.animation === derived.animation &&
          prev.stageLabel === derived.stageLabel
        ) {
          return prev;
        }
        return { ...prev, ...derived, meta: config.meta };
      });
    };

    tick();
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  return output;
}
