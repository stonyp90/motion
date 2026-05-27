'use client';

import { useRef } from 'react';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import type { ControlsValue } from '../ControlsDrawer';
import type { CastEntry } from '@/lib/characters/manifest';
import { FormatRow } from '../FormatRow';
import { CastRow } from '../CastRow';
import { PromptInput } from '../PromptInput';
import {
  useSampleRunMachine,
  type SampleRunMeta,
  type SampleState,
} from './useSampleRunMachine';
import { SampleRunOverlay } from './SampleRunOverlay';
import { SampleRunCTA } from './SampleRunCTA';

const Lottie = dynamic(() => import('lottie-react').then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-text-tertiary">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  ),
});

/**
 * Cinematic sample-run demo for anonymous visitors. The captured
 * Lottie plays continuously on the preview canvas; the staged-UI
 * theatre (typing, format pick, cast row, "Generating" pill) layers
 * on top to communicate what would happen in the live app.
 *
 * When `web/public/sample-run/run.json` is present (written by
 * `npm run capture-sample-run`), the machine plays back that real
 * /v1/brief/generate run — same Lottie, same scene count, same
 * stage durations the engine actually took. When the cache is
 * missing, it falls back to the preset Lottie library so a fresh
 * checkout still has a useful surface.
 *
 * Every click inside the demo card routes to `/signup?next=…`
 * carrying the currently-typed brief. The header's Sign in pill and
 * the floating sign-up CTA inside the card remain reachable thanks
 * to z-index layering.
 */
export function SampleRunDemo() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sample = useSampleRunMachine({ containerRef });

  const controls: ControlsValue = {
    duration: sample.length,
    preset: 'corporate',
    aspect: sample.aspect,
  };

  const cast: CastEntry[] = sample.cast.map((c) => ({
    id: c.id,
    name: c.name,
    accent_hex: c.accent_hex,
    source: 'characters' as const,
  }));

  return (
    <section
      ref={containerRef}
      aria-label="Sample motion-graphic generation"
      className="relative mx-auto w-full max-w-4xl"
    >
      <SampleRunOverlay prompt={sample.prompt}>
        <div className="relative overflow-hidden rounded-3xl border border-border-light bg-bg-primary p-5 shadow-card sm:p-7">
          <DemoBadge isReal={sample.meta.isReal} state={sample.state} />

          <div className="mt-12 flex flex-col gap-5">
            <FormatRow value={controls} onChange={() => undefined} />

            {/* No `readOnly` prop on PromptInput — the textarea is
                controlled with a no-op `onChange`, which already
                makes it effectively read-only (React itself flags
                controlled inputs without a writable onChange as
                read-only fields). The SampleRunOverlay click-shield
                above catches taps before they reach the textarea. */}
            <PromptInput
              value={sample.prompt}
              onChange={() => undefined}
              onGenerate={() => undefined}
              isGenerating={sample.isGenerating}
              castSlot={<CastRow cast={cast} />}
            />

            <DemoPreview
              animation={sample.animation}
              state={sample.state}
              isGenerating={sample.isGenerating}
              stageLabel={sample.stageLabel}
              composingScene={sample.composingScene}
              runningProgress={sample.runningProgress}
              meta={sample.meta}
            />
          </div>

          <SampleRunCTA prompt={sample.prompt} />
        </div>
      </SampleRunOverlay>
    </section>
  );
}

/* ---------------------------------------------------------------- */

interface DemoBadgeProps {
  isReal: boolean;
  state: SampleState;
}

/**
 * Top-left pill. Communicates what the visitor is looking at:
 *   - During the running phase, swaps to a "Live generation" label
 *     with a fast-pulsing accent dot to reinforce "something is
 *     happening on the engine right now."
 *   - Otherwise reads "Real generate · cached" (or "Sample · auto-play"
 *     for the fallback path).
 */
function DemoBadge({ isReal, state }: DemoBadgeProps) {
  const isRunning = state === 'running';
  const baseLabel = isReal ? 'Real generate · cached' : 'Sample · auto-play';
  const label = isRunning ? 'Live generation' : baseLabel;

  return (
    <div
      className={`absolute left-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-2xs uppercase tracking-[0.18em] sm:left-5 sm:top-5 ${
        isRunning
          ? 'bg-accent-700 text-white shadow-[0_4px_20px_-6px_rgb(0_0_0_/_0.25)]'
          : 'bg-bg-tertiary text-text-tertiary'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          isRunning ? 'animate-pulse-accent bg-white' : 'animate-pulse-accent bg-accent-500'
        }`}
        aria-hidden
      />
      {label}
    </div>
  );
}

/* ---------------------------------------------------------------- */

interface DemoPreviewProps {
  animation: import('@/lib/lottie/transform').LottieJson | null;
  state: SampleState;
  isGenerating: boolean;
  stageLabel: string;
  composingScene: number;
  runningProgress: number;
  meta: SampleRunMeta;
}

/**
 * Preview canvas with three layered surfaces:
 *
 *   1. The captured Lottie (always playing once loaded).
 *   2. A "Live generation" status overlay along the top edge that
 *      fades in during the running phase — shows the current stage
 *      label, the elapsed scrubber, and an animated dot.
 *   3. A scene-thumbnail strip below the canvas that fills in cells
 *      as `composingScene` advances — gives a visceral sense of
 *      "the engine just composed shot 14 of 30."
 *
 * The provenance strip stays pinned to the bottom-center of the
 * canvas when the machine isn't running, so the real-engine
 * metadata is always visible at rest without crowding the live UI.
 */
function DemoPreview({
  animation,
  state,
  isGenerating,
  stageLabel,
  composingScene,
  runningProgress,
  meta,
}: DemoPreviewProps) {
  const isRunning = state === 'running';
  const isCompose = composingScene > 0;
  const totalScenes = meta.scenes ?? 0;

  return (
    <div className="flex flex-col gap-3" data-testid="sample-preview-shell">
      <div
        className="relative grid h-56 w-full place-items-center overflow-hidden rounded-2xl bg-bg-secondary sm:h-72"
        data-testid="sample-preview"
      >
        {animation ? (
          <Lottie
            animationData={animation}
            loop
            autoplay
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <div className="flex flex-col items-center gap-3 text-text-tertiary">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
            <span className="font-mono text-2xs uppercase tracking-[0.16em]">
              Loading sample run…
            </span>
          </div>
        )}

        {/* Top-edge live-generation status. Fades in only during the
            running phase so the canvas reads as the playback artifact
            the rest of the loop. */}
        {isRunning && (
          <LiveGenStatus
            stageLabel={stageLabel}
            runningProgress={runningProgress}
            composingScene={composingScene}
            totalScenes={totalScenes}
          />
        )}

        <PreviewBadge active={isGenerating} />

        {meta.isReal && !isRunning && <RealRunMetaStrip meta={meta} />}
      </div>

      {/* Inline scene-thumbnail strip — only renders when we know the
          total shot count (real-cache path). Fills cells left→right
          as compose progresses, then stays full until the loop resets. */}
      {totalScenes > 0 && (
        <SceneStrip
          total={totalScenes}
          composedThrough={isCompose ? composingScene : isRunning ? 0 : totalScenes}
          dim={!isRunning && state !== 'rendering' && state !== 'done' && state !== 'looping-back'}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */

interface LiveGenStatusProps {
  stageLabel: string;
  runningProgress: number;
  composingScene: number;
  totalScenes: number;
}

/**
 * Top-edge overlay during the running phase. A small accent badge,
 * the current stage label, and a thin progress bar that tracks the
 * machine's runningProgress in real time. Sits ABOVE the Lottie so
 * the visitor reads it before the playback frame.
 */
function LiveGenStatus({
  stageLabel,
  runningProgress,
  composingScene,
  totalScenes,
}: LiveGenStatusProps) {
  const pct = Math.round(runningProgress * 100);
  const subline =
    composingScene > 0 && totalScenes > 0
      ? `Scene ${composingScene} / ${totalScenes}`
      : `${pct}%`;
  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col gap-1.5 rounded-xl bg-primary-900/85 px-3 py-2 text-white shadow-card backdrop-blur-md sm:inset-x-5 sm:top-5">
      <div className="flex items-center justify-between gap-3 text-xs font-medium">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          <span className="tracking-tight">{stageLabel || 'Generating'}</span>
        </span>
        <span className="font-mono text-2xs uppercase tracking-[0.16em] opacity-80">
          {subline}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-white/15">
        <div
          className="h-full rounded-full bg-accent-400 transition-[width] duration-75 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

interface SceneStripProps {
  total: number;
  composedThrough: number;
  dim: boolean;
}

/**
 * Mini-timeline below the preview. Each cell represents one engine
 * shot. Cells light up sequentially as the demo "composes" through
 * them, mirroring what an actual streaming compose would feel like.
 *
 * Caps the rendered cells to keep the strip compact on small
 * viewports — large shot counts (50+) collapse to a logical 24-cell
 * approximation so the dotted strip never overflows the card.
 */
function SceneStrip({ total, composedThrough, dim }: SceneStripProps) {
  const maxCells = 30;
  const cells = Math.min(total, maxCells);
  // When we have more shots than cells, every cell represents
  // ceil(total / cells) real shots. Scale `composedThrough`
  // accordingly so the strip fill tracks real progress.
  const ratio = total / cells;
  const filled = Math.round(composedThrough / ratio);

  return (
    <div
      className={`flex items-center gap-1.5 rounded-xl border border-border-light bg-bg-secondary/50 px-3 py-2.5 transition-opacity ${
        dim ? 'opacity-40' : 'opacity-100'
      }`}
      aria-label={`Scene timeline: ${composedThrough} of ${total} composed`}
    >
      <span className="font-mono text-2xs uppercase tracking-[0.14em] text-text-tertiary">
        Shots
      </span>
      <div className="flex flex-1 gap-1">
        {Array.from({ length: cells }, (_, i) => {
          const isFilled = i < filled;
          const isCurrent = i === filled && composedThrough < total;
          return (
            <div
              key={i}
              className={`h-2.5 flex-1 rounded-sm transition-colors duration-150 ${
                isFilled
                  ? 'bg-accent-500'
                  : isCurrent
                    ? 'animate-pulse-accent bg-accent-300'
                    : 'bg-border-light'
              }`}
            />
          );
        })}
      </div>
      <span className="font-mono text-2xs tabular-nums text-text-tertiary">
        {composedThrough}/{total}
      </span>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function PreviewBadge({ active }: { active: boolean }) {
  return (
    <span
      className={`absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-bg-primary/90 px-2 py-1 font-mono text-2xs uppercase tracking-[0.14em] backdrop-blur-md ${
        active ? 'text-accent-700' : 'text-text-tertiary'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          active ? 'animate-pulse-accent bg-accent-500' : 'bg-border-default'
        }`}
        aria-hidden
      />
      {active ? 'Live' : 'Idle'}
    </span>
  );
}

/**
 * Bottom strip with provenance from the cached real run — scene count,
 * image-gen provider, generation cost, and the wall-clock the real
 * pipeline took. Hidden during the running phase so the LiveGenStatus
 * overlay isn't competing with metadata; reappears at rest.
 */
function RealRunMetaStrip({ meta }: { meta: SampleRunMeta }) {
  const parts: string[] = [];
  if (typeof meta.scenes === 'number') parts.push(`${meta.scenes} scenes`);
  if (typeof meta.total_ms === 'number') {
    parts.push(`${(meta.total_ms / 1000).toFixed(1)}s engine`);
  }
  if (meta.asset_provider && meta.asset_provider !== 'none') {
    parts.push(meta.asset_provider);
  }
  if (typeof meta.asset_cost_usd === 'number' && meta.asset_cost_usd > 0) {
    parts.push(`$${meta.asset_cost_usd.toFixed(2)}`);
  }
  if (parts.length === 0) return null;

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-bg-primary/90 px-2.5 py-1 font-mono text-2xs uppercase tracking-[0.14em] text-text-tertiary backdrop-blur-md">
      {parts.join(' · ')}
    </div>
  );
}

