'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { Minimize2, Pause, Play, X } from 'lucide-react';
import type { LottieJson } from '@/lib/lottie/transform';
import { durationSeconds } from '@/lib/lottie/transform';

/**
 * Fullscreen preview overlay. The Lottie renders at the composition's
 * native aspect (1920×1080 typical) centred in a true viewport overlay,
 * letterboxed on the off-axis. Mirrors the Krea / Runway / Midjourney
 * pattern where clicking the canvas (or the Maximize icon) drops you
 * into a focused player.
 *
 * Shortcuts active while open:
 *   - Esc       → close
 *   - F         → close (toggle off)
 *   - Space     → play / pause
 *
 * No transport scrubber yet — lottie-react's `goToAndStop(frame)` is
 * trivial to wire when we want it; for now the play/pause + the
 * autoplay loop is the v0 transport.
 */

const Lottie = dynamic(() => import('lottie-react').then((m) => m.default), {
  ssr: false,
  loading: () => null,
});

interface Props {
  open: boolean;
  onClose: () => void;
  animation: LottieJson | null;
}

export function PreviewFullscreen({ open, onClose, animation }: Props) {
  const [isPlaying, setIsPlaying] = useState(true);
  const lottieRef = useRef<unknown>(null);

  // ESC + F to close; Space toggles transport. Scoped to the doc only
  // while the modal is open so we don't trample the rest of the app.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when the user is typing somewhere.
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (e.key === 'Escape' || e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        onClose();
      } else if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
    };
    document.addEventListener('keydown', handler);
    // Prevent body scroll behind the overlay.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open || !animation) return null;

  const togglePlay = () => {
    setIsPlaying((p) => !p);
    const inst = lottieRef.current as { play?: () => void; pause?: () => void } | null;
    if (!inst) return;
    if (isPlaying) inst.pause?.();
    else inst.play?.();
  };

  const duration = durationSeconds(animation);
  const fps = (animation.fr as number | undefined) ?? 30;
  const width = (animation.w as number | undefined) ?? 1920;
  const height = (animation.h as number | undefined) ?? 1080;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Animation preview, fullscreen"
      data-testid="preview-fullscreen"
      className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur-sm"
    >
      {/* Top bar — title + close. Auto-hides could come later. */}
      <div className="flex items-center justify-between border-b border-white/5 px-5 py-3">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-white/50">
          Fullscreen preview
        </p>
        <div className="flex items-center gap-2 font-mono text-2xs text-white/40">
          <span>Esc</span>
          <span>·</span>
          <span>F</span>
          <span className="ml-3">to close</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close fullscreen"
            className="ml-3 grid h-8 w-8 place-items-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Stage — centres the Lottie at its native aspect, letterboxed. */}
      <div className="flex flex-1 items-center justify-center overflow-hidden p-6">
        <div
          className="relative h-full w-full"
          style={{ aspectRatio: `${width} / ${height}` }}
        >
          <Lottie
            animationData={animation}
            loop
            autoplay={isPlaying}
            lottieRef={lottieRef as never}
            rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </div>

      {/* Transport — play/pause + metadata + minimize. */}
      <div className="flex items-center justify-between gap-4 border-t border-white/5 px-5 py-3">
        <button
          type="button"
          onClick={togglePlay}
          className="grid h-10 w-10 place-items-center rounded-full bg-accent-500 text-white transition hover:bg-accent-600"
          aria-label={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        >
          {isPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4 translate-x-0.5" />
          )}
        </button>

        <div className="flex-1 font-mono text-xs text-white/50">
          <span className="text-white/80">{duration.toFixed(1)}s</span>
          <span className="mx-2">·</span>
          <span>{fps} fps</span>
          <span className="mx-2">·</span>
          <span>
            {width} × {height}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-white/70 transition hover:border-white/30 hover:bg-white/5 hover:text-white"
        >
          <Minimize2 className="h-3.5 w-3.5" />
          Exit fullscreen
          <span className="ml-1 hidden font-mono text-2xs text-white/40 sm:inline">Esc</span>
        </button>
      </div>
    </div>
  );
}
