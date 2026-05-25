'use client';

import { useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Camera,
  Download,
  FileJson,
  Loader2,
  Package,
  Pause,
  Play,
} from 'lucide-react';
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
  /**
   * Capture-the-current-frame handoff. When set, the preview surfaces
   * a "Capture frame" button next to play/pause. Clicking it pauses
   * the animation, rasterises the current SVG to a PNG blob, and
   * hands the blob back so HomeApp can append it as a context image
   * for the next generate / iterate call.
   */
  onCaptureFrame?: (blob: Blob, filename: string) => void;
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
export function PreviewFrame({
  animation,
  onExport,
  onRegenerate,
  onCaptureFrame,
}: Props) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const lottieRef = useRef<unknown>(null);

  const togglePlay = () => {
    setIsPlaying((p) => !p);
    const inst = lottieRef.current as { play?: () => void; pause?: () => void } | null;
    if (!inst) return;
    if (isPlaying) inst.pause?.();
    else inst.play?.();
  };

  const handleCapture = async () => {
    if (!animation || !stageRef.current || !onCaptureFrame || isCapturing) return;
    setIsCapturing(true);
    try {
      // Pause first so the user grabs the exact frame they're looking at.
      const inst = lottieRef.current as { pause?: () => void } | null;
      inst?.pause?.();
      setIsPlaying(false);

      const svg = stageRef.current.querySelector('svg');
      if (!svg) throw new Error('no svg to capture');
      const blob = await rasteriseSvgToPng(svg, width || 1920, height || 1080);
      const filename = `frame-${Date.now()}.png`;
      onCaptureFrame(blob, filename);
    } catch (e) {
      console.error('frame capture failed', e);
    } finally {
      setIsCapturing(false);
    }
  };

  const duration = animation ? durationSeconds(animation) : 0;
  const fps = (animation?.fr as number | undefined) ?? 30;
  const width = (animation?.w as number | undefined) ?? 0;
  const height = (animation?.h as number | undefined) ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-2xl border border-border-light bg-bg-secondary shadow-card">
        <div ref={stageRef} className="relative aspect-video w-full bg-primary-900">
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
          {onCaptureFrame && (
            <button
              type="button"
              onClick={handleCapture}
              disabled={!animation || isCapturing}
              className="inline-flex items-center gap-1.5 rounded-full border border-border-light px-3 py-1 text-xs font-medium text-text-secondary transition hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
              title="Pause + snapshot this exact frame as context for your next prompt"
              data-testid="capture-frame"
            >
              {isCapturing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Camera className="h-3.5 w-3.5" />
              )}
              Capture frame
            </button>
          )}
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

/**
 * Serialise an inline <svg> and draw it to a <canvas>, then export a
 * PNG blob. Native-only — no html2canvas, no upload to a server.
 *
 * Pinned `width`/`height` so the rasterised pixel buffer matches the
 * Lottie composition dimensions, not the on-screen letterboxed size.
 * That keeps the captured frame at brand resolution (1920×1080
 * typical) so when it's re-attached as context the LLM sees real
 * detail, not the 480px-wide thumbnail.
 */
async function rasteriseSvgToPng(
  svg: SVGElement,
  width: number,
  height: number,
): Promise<Blob> {
  // Clone + inject explicit width/height/viewBox so the standalone
  // SVG renders at full composition size in the off-screen <img>.
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  if (!clone.getAttribute('viewBox')) {
    clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  const xml = new XMLSerializer().serializeToString(clone);
  const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('svg load failed'));
    el.src = dataUrl;
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  // Black background to match the preview stage (Lottie bg is part
  // of the composition, but the SVG itself may be transparent).
  ctx.fillStyle = '#0b1437';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob null'))),
      'image/png',
      0.95,
    );
  });
}
