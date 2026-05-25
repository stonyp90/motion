'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * Controls available to the user from the prompt bar:
 *   - duration (seconds, integer)
 *   - preset slug (visual tone)
 *   - aspect ratio
 *
 * Kept loose-typed so W2/W4 can extend without breaking us.
 */
export interface ControlsValue {
  duration: number;
  preset: 'corporate' | 'playful' | 'minimalist';
  aspect: '16:9' | '9:16' | '1:1' | '4:5';
}

interface Props {
  value: ControlsValue;
  onChange: (next: ControlsValue) => void;
}

const PRESETS = [
  { slug: 'corporate' as const, label: 'Corporate', tone: 'calm + decelerated' },
  { slug: 'playful' as const, label: 'Playful', tone: 'bouncy + vivid' },
  { slug: 'minimalist' as const, label: 'Minimalist', tone: 'type-led + slow' },
];

const ASPECTS: ControlsValue['aspect'][] = ['16:9', '9:16', '1:1', '4:5'];

/**
 * Collapsed chevron-trigger inline with the prompt's bottom controls
 * row. Click to expand into a small popover with the three pickers.
 *
 * The trigger label always shows the current duration so the user
 * sees "20s" without opening anything — the chevron is just a hint
 * that more controls live behind it.
 */
export function ControlsDrawer({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-xs text-text-secondary transition hover:bg-bg-tertiary hover:text-text-primary"
      >
        {value.duration}s
        <span className="text-text-tertiary">·</span>
        {value.preset}
        <span className="text-text-tertiary">·</span>
        {value.aspect}
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <>
          {/* click-outside backdrop */}
          <button
            type="button"
            aria-label="Close controls"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="Generation controls"
            className="absolute bottom-full right-0 z-20 mb-2 w-72 rounded-2xl border border-border-light bg-bg-primary p-4 shadow-lift"
          >
            {/* Duration slider */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label htmlFor="duration-input" className="text-xs font-semibold text-text-primary">
                  Duration
                </label>
                <span className="font-mono text-xs text-text-secondary">{value.duration}s</span>
              </div>
              <input
                id="duration-input"
                type="range"
                min={5}
                max={60}
                step={1}
                value={value.duration}
                onChange={(e) =>
                  onChange({ ...value, duration: Number(e.target.value) })
                }
                className="w-full accent-accent-500"
              />
            </div>

            {/* Preset picker */}
            <div className="mt-4 flex flex-col gap-2">
              <span className="text-xs font-semibold text-text-primary">Preset</span>
              <div className="grid grid-cols-3 gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.slug}
                    type="button"
                    onClick={() => onChange({ ...value, preset: p.slug })}
                    aria-pressed={p.slug === value.preset}
                    className={`rounded-lg border px-2 py-1.5 text-left text-2xs transition ${
                      p.slug === value.preset
                        ? 'border-accent-400 bg-accent-50 text-text-primary shadow-soft'
                        : 'border-border-light bg-bg-secondary text-text-secondary hover:border-border'
                    }`}
                  >
                    <div className="text-xs font-semibold">{p.label}</div>
                    <div className="text-text-tertiary">{p.tone}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Aspect picker */}
            <div className="mt-4 flex flex-col gap-2">
              <span className="text-xs font-semibold text-text-primary">Aspect</span>
              <div className="grid grid-cols-4 gap-1.5">
                {ASPECTS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => onChange({ ...value, aspect: a })}
                    aria-pressed={a === value.aspect}
                    className={`rounded-lg border px-2 py-1.5 text-center font-mono text-xs transition ${
                      a === value.aspect
                        ? 'border-accent-400 bg-accent-50 text-text-primary shadow-soft'
                        : 'border-border-light bg-bg-secondary text-text-secondary hover:border-border'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
