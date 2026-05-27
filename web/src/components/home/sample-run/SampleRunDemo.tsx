'use client';

import { useRef, type CSSProperties } from 'react';
import dynamic from 'next/dynamic';
import { Loader2, Sparkles, Play } from 'lucide-react';
import type { ControlsValue } from '../ControlsDrawer';
import type { CastEntry } from '@/lib/characters/manifest';
import { FormatRow } from '../FormatRow';
import { CastRow } from '../CastRow';
import { PromptInput } from '../PromptInput';
import {
  useSampleRunMachine,
  type SampleRunMeta,
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
 * Cinematic sample-run demo for anonymous visitors. Composes the
 * existing prompt UI (in read-only mode), a format row, a cast row,
 * and a minimal preview canvas, all driven by `useSampleRunMachine`.
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
          <div className="absolute left-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-full bg-bg-tertiary px-2.5 py-1 font-mono text-2xs uppercase tracking-[0.18em] text-text-tertiary sm:left-5 sm:top-5">
            <span
              className="h-1.5 w-1.5 animate-pulse-accent rounded-full bg-accent-500"
              aria-hidden
            />
            {sample.meta.isReal ? 'Real generate · cached' : 'Sample · auto-play'}
          </div>

          <div className="mt-12 flex flex-col gap-5">
            <FormatRow value={controls} onChange={() => undefined} />

            <PromptInput
              readOnly
              value={sample.prompt}
              onChange={() => undefined}
              onGenerate={() => undefined}
              isGenerating={sample.isGenerating}
              castSlot={<CastRow cast={cast} />}
            />

            <DemoPreview
              animation={sample.animation}
              showSkeleton={
                sample.state === 'running' ||
                (sample.state === 'pulse-generate' && !sample.animation)
              }
              isGenerating={sample.isGenerating}
              stageLabel={sample.stageLabel}
              meta={sample.meta}
            />
          </div>

          <SampleRunCTA prompt={sample.prompt} />
        </div>
      </SampleRunOverlay>
    </section>
  );
}

interface DemoPreviewProps {
  animation: import('@/lib/lottie/transform').LottieJson | null;
  showSkeleton: boolean;
  isGenerating: boolean;
  stageLabel: string;
  meta: SampleRunMeta;
}

/**
 * Minimal preview canvas — Lottie playback when an animation is loaded,
 * a stage-label skeleton while the machine is in `running`, and an idle
 * placeholder otherwise. Avoids re-importing the full `PreviewFrame`
 * (which carries export buttons + fullscreen handlers we don't need).
 */
function DemoPreview({
  animation,
  showSkeleton,
  isGenerating,
  stageLabel,
  meta,
}: DemoPreviewProps) {
  return (
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
      ) : showSkeleton ? (
        <div className="flex flex-col items-center gap-3 text-text-tertiary">
          {isGenerating ? (
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-6 w-6 animate-pulse-accent" aria-hidden />
          )}
          <span className="font-mono text-2xs uppercase tracking-[0.16em]">
            {isGenerating ? stageLabel || 'Rendering shots' : 'Preparing brief'}
          </span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-text-tertiary">
          <span className="grid h-12 w-12 place-items-center rounded-full bg-bg-tertiary">
            <Play className="h-5 w-5" aria-hidden />
          </span>
          <span className="font-mono text-2xs uppercase tracking-[0.16em]">
            Preview · 1920×1080
          </span>
        </div>
      )}
      <PreviewBadge
        style={{ '--i': 0 } as CSSProperties}
        active={showSkeleton || isGenerating}
      />
      {meta.isReal && (
        <RealRunMetaStrip meta={meta} />
      )}
    </div>
  );
}

function PreviewBadge({
  style,
  active,
}: {
  style?: CSSProperties;
  active: boolean;
}) {
  return (
    <span
      style={style}
      className={`absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-bg-primary/90 px-2 py-1 font-mono text-2xs uppercase tracking-[0.14em] backdrop-blur-md ${
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
 * pipeline took. Only rendered when meta.isReal is true.
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
    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-bg-primary/90 px-2.5 py-1 font-mono text-2xs uppercase tracking-[0.14em] text-text-tertiary backdrop-blur-md">
      {parts.join(' · ')}
    </div>
  );
}
