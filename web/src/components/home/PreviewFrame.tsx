'use client';

import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Download, FileJson, Package, Pause, Play, Loader2 } from 'lucide-react';
import type { LottieJson } from '@/lib/lottie/transform';
import { durationSeconds } from '@/lib/lottie/transform';

const Lottie = dynamic(() => import('lottie-react').then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center text-text-tertiary">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  ),
});

export type ExportKind = 'mp4' | 'lottie' | 'pack';

interface Props {
  animation?: LottieJson | null;
  /** Called when one of the 3 download buttons is clicked. */
  onExport: (kind: ExportKind) => void;
  /** Optional: parent can clear/regenerate. */
  onRegenerate?: () => void;
}

/**
 * The preview "frame" with three responsibilities:
 *   1. Render the Lottie animation (or an empty-state when none).
 *   2. Show the transport bar (play/pause + frame metadata).
 *   3. Provide the three export buttons.
 *
 * Deliberately a presentation component — the parent owns the
 * animation state and the export logic. We just dispatch.
 */
export function PreviewFrame({ animation, onExport, onRegenerate }: Props) {
  const [isPlaying, setIsPlaying] = useState(true);
  const lottieRef = useRef<unknown>(null);

  const togglePlay = () => {
    setIsPlaying((p) => !p);
    const inst = lottieRef.current as { play?: () => void; pause?: () => void } | null;
    if (!inst) return;
    if (isPlaying) inst.pause?.();
    else inst.play?.();
  };

  const duration = animation ? durationSeconds(animation) : 0;
  const fps = (animation?.fr as number | undefined) ?? 30;
  const width = (animation?.w as number | undefined) ?? 0;
  const height = (animation?.h as number | undefined) ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-2xl border border-border-light bg-bg-secondary shadow-card">
        <div className="relative aspect-video w-full bg-primary-900">
          {animation ? (
            <Lottie
              animationData={animation}
              loop
              autoplay={isPlaying}
              lottieRef={lottieRef as never}
              rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
              style={{ width: '100%', height: '100%' }}
            />
          ) : (
            <div className="grid h-full w-full place-items-center text-text-inverse/40">
              <p className="text-sm">Your motion graphic will appear here</p>
            </div>
          )}
        </div>

        {/* Transport bar */}
        <div className="flex items-center gap-3 border-t border-border-light bg-bg-primary px-4 py-2.5">
          <button
            type="button"
            onClick={togglePlay}
            disabled={!animation}
            className="grid h-8 w-8 place-items-center rounded-full bg-accent-500 text-white transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:bg-neutral-300"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5 translate-x-0.5" />
            )}
          </button>
          <div className="flex-1 font-mono text-xs text-text-tertiary">
            {animation ? (
              <>
                <span className="text-text-secondary">{duration.toFixed(1)}s</span>
                <span className="mx-2">·</span>
                <span>{fps}fps</span>
                <span className="mx-2">·</span>
                <span>
                  {width}×{height}
                </span>
              </>
            ) : (
              <span>idle</span>
            )}
          </div>
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={!animation}
              className="rounded-full px-3 py-1 text-xs text-text-secondary transition hover:bg-bg-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Regenerate
            </button>
          )}
        </div>
      </div>

      {/* Export row — three side-by-side buttons */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <ExportButton
          onClick={() => onExport('mp4')}
          disabled={!animation}
          icon={<Download className="h-3.5 w-3.5" />}
          label="MP4"
        />
        <ExportButton
          onClick={() => onExport('lottie')}
          disabled={!animation}
          icon={<FileJson className="h-3.5 w-3.5" />}
          label=".lottie"
        />
        <ExportButton
          onClick={() => onExport('pack')}
          disabled={!animation}
          icon={<Package className="h-3.5 w-3.5" />}
          label="pack"
        />
      </div>
    </div>
  );
}

function ExportButton({
  onClick,
  disabled,
  icon,
  label,
}: {
  onClick: () => void;
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-full border border-border-light bg-bg-primary px-3.5 py-1.5 text-xs font-medium text-text-secondary transition hover:border-accent-300 hover:bg-accent-50 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  );
}
