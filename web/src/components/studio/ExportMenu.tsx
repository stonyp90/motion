'use client';

import { useState } from 'react';
import { ChevronDown, Download, Loader2 } from 'lucide-react';

/**
 * Every binary format the engine exposes at `/v1/export/:format`. Order
 * here is the order shown in the dropdown — MP4 stays first because
 * it's the focus, followed by the other video/raster formats grouped
 * by quality, then the zero-render formats.
 *
 * Local note: `webp` requires an ffmpeg build with libwebp; the
 * homebrew default lacks it, so the menu surfaces the caveat instead
 * of pretending it always works.
 */
export const EXPORT_FORMATS = [
  { slug: 'mp4', label: 'MP4', kind: 'video', hint: 'Universal · H.264' },
  { slug: 'mov', label: 'MOV (ProRes)', kind: 'video', hint: 'Editor-quality · large' },
  { slug: 'webm', label: 'WebM (VP9)', kind: 'video', hint: 'Web · smaller than MP4' },
  { slug: 'webm-av1', label: 'WebM (AV1)', kind: 'video', hint: 'Modern · ~30% smaller' },
  { slug: 'gif', label: 'GIF', kind: 'raster', hint: 'Slack · Twitter · docs' },
  { slug: 'apng', label: 'APNG', kind: 'raster', hint: 'Lossless animated PNG' },
  { slug: 'webp', label: 'WebP', kind: 'raster', hint: 'Modern image · needs libwebp' },
  { slug: 'dotlottie', label: '.lottie', kind: 'lottie', hint: 'Compressed Lottie pack' },
  { slug: 'lottie', label: 'Lottie JSON', kind: 'lottie', hint: 'Raw source' },
  { slug: 'svg', label: 'SVG', kind: 'vector', hint: 'Static SMIL fallback' },
] as const;

export type ExportFormatSlug = (typeof EXPORT_FORMATS)[number]['slug'];

interface Props {
  onExport: (slug: ExportFormatSlug) => void | Promise<void>;
  disabled?: boolean;
  /** When non-null, the menu shows a spinner on that row. */
  pending?: ExportFormatSlug | null;
}

export function ExportMenu({ onExport, disabled, pending }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <div className="flex items-stretch overflow-hidden rounded-full border border-accent-300 bg-accent-500 text-white shadow-soft">
        <button
          type="button"
          onClick={() => onExport('mp4')}
          disabled={disabled || pending !== null}
          className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending === 'mp4' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          Export MP4
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label="Pick a different format"
          className="border-l border-white/20 px-2.5 transition hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close export menu"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute bottom-full right-0 z-20 mb-2 w-72 overflow-hidden rounded-2xl border border-border-light bg-bg-primary shadow-lift"
          >
            <div className="border-b border-border-light bg-bg-secondary px-4 py-2 text-2xs uppercase tracking-[0.16em] text-text-tertiary">
              Pick a format
            </div>
            <ul className="max-h-80 overflow-y-auto py-1">
              {EXPORT_FORMATS.map((f) => {
                const isPending = pending === f.slug;
                return (
                  <li key={f.slug}>
                    <button
                      type="button"
                      role="menuitem"
                      disabled={disabled || pending !== null}
                      onClick={async () => {
                        setOpen(false);
                        await onExport(f.slug);
                      }}
                      className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition hover:bg-accent-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium text-text-primary">{f.label}</span>
                        <span className="text-2xs text-text-tertiary">{f.hint}</span>
                      </div>
                      {isPending && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-accent-500" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
