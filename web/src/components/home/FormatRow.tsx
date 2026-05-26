'use client';

import { Film, Square, Smartphone, Monitor } from 'lucide-react';
import type { ControlsValue } from './ControlsDrawer';

/**
 * Platform + length quick-picks rendered just above the prompt input.
 *
 * Motion-design tools live or die on aspect ratio — every platform
 * has its own (LinkedIn feed is 1:1, Reels/TikTok/Stories are 9:16,
 * YouTube + Web are 16:9, hero banners are 21:9). Asking the user to
 * remember the ratio is friction; naming the destination instead and
 * setting both ratio + a sensible default length in one click matches
 * how briefs actually arrive in agencies + brand teams.
 *
 * Pattern lifted from Runway's "Studio" surface + Krea's "Aspect"
 * selector + Adobe Express templates page.
 */

interface Props {
  value: ControlsValue;
  onChange: (next: ControlsValue) => void;
}

type AspectPreset = {
  aspect: ControlsValue['aspect'];
  label: string;
  platforms: string;
  icon: React.ReactNode;
  /** Sensible duration when this aspect is picked. */
  defaultDuration: number;
};

const ASPECT_PRESETS: ReadonlyArray<AspectPreset> = [
  {
    aspect: '16:9',
    label: 'Wide',
    platforms: 'YouTube · Web · LinkedIn',
    icon: <Monitor className="h-3.5 w-3.5" />,
    defaultDuration: 30,
  },
  {
    aspect: '9:16',
    label: 'Vertical',
    platforms: 'Reels · TikTok · Stories',
    icon: <Smartphone className="h-3.5 w-3.5" />,
    defaultDuration: 15,
  },
  {
    aspect: '1:1',
    label: 'Square',
    platforms: 'Instagram · LinkedIn feed',
    icon: <Square className="h-3.5 w-3.5" />,
    defaultDuration: 20,
  },
  {
    aspect: '4:5',
    label: 'Portrait',
    platforms: 'Instagram feed',
    icon: <Film className="h-3.5 w-3.5 rotate-90" />,
    defaultDuration: 15,
  },
];

const LENGTHS: ReadonlyArray<{ value: number; label: string; hint?: string }> = [
  { value: 6, label: '6s', hint: 'bumper' },
  { value: 15, label: '15s', hint: 'social' },
  { value: 30, label: '30s', hint: 'standard' },
  { value: 60, label: '60s', hint: 'feature' },
];

export function FormatRow({ value, onChange }: Props) {
  return (
    <div className="flex flex-col gap-3">
      {/* Aspect / platform row — primary visual decision */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-2xs uppercase tracking-[0.16em] text-text-tertiary">
          Format
        </span>
        {ASPECT_PRESETS.map((p) => {
          const active = p.aspect === value.aspect;
          return (
            <button
              key={p.aspect}
              type="button"
              onClick={() =>
                onChange({
                  ...value,
                  aspect: p.aspect,
                  // Only auto-update the duration when the user is on
                  // the default for the OLD aspect — otherwise leave
                  // their custom choice alone.
                  duration:
                    value.duration === defaultForAspect(value.aspect)
                      ? p.defaultDuration
                      : value.duration,
                })
              }
              aria-pressed={active}
              title={p.platforms}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                active
                  ? 'border-accent-400 bg-accent-50 text-accent-800 shadow-soft dark:bg-accent-950'
                  : 'border-border-light bg-bg-primary text-text-secondary hover:border-accent-300 hover:text-text-primary'
              }`}
            >
              {p.icon}
              <span className="font-medium">{p.label}</span>
              <span className="font-mono text-2xs text-text-tertiary">{p.aspect}</span>
            </button>
          );
        })}
      </div>

      {/* Length row — secondary, dropdown chevron handles custom */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-2xs uppercase tracking-[0.16em] text-text-tertiary">
          Length
        </span>
        {LENGTHS.map((l) => {
          const active = l.value === value.duration;
          return (
            <button
              key={l.value}
              type="button"
              onClick={() => onChange({ ...value, duration: l.value })}
              aria-pressed={active}
              title={l.hint}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${
                active
                  ? 'border-accent-400 bg-accent-50 text-accent-800 shadow-soft dark:bg-accent-950'
                  : 'border-border-light bg-bg-primary text-text-secondary hover:border-accent-300 hover:text-text-primary'
              }`}
            >
              <span className="font-mono font-medium">{l.label}</span>
              {l.hint && (
                <span className="text-2xs text-text-tertiary">· {l.hint}</span>
              )}
            </button>
          );
        })}
        {/* Custom-length sentinel — anything not matching the 4 presets
            renders as a clickable readout that hands off to the
            ControlsDrawer for fine-grained slider control. */}
        {!LENGTHS.some((l) => l.value === value.duration) && (
          <span className="inline-flex items-center gap-1 rounded-full border border-accent-300 bg-accent-50 px-2.5 py-1 font-mono text-xs text-accent-800">
            <span className="font-medium">{value.duration}s</span>
            <span className="text-2xs">· custom</span>
          </span>
        )}
      </div>
    </div>
  );
}

function defaultForAspect(aspect: ControlsValue['aspect']): number {
  return ASPECT_PRESETS.find((p) => p.aspect === aspect)?.defaultDuration ?? 20;
}
