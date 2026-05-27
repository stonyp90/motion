'use client';

import { Gauge, Sparkles, Zap } from 'lucide-react';
import type { ModelChoice } from './ModelPicker';

/**
 * Quality preset — a three-state segmented control that maps to a
 * (model, temperature, max_tokens) tuple sent to the engine.
 *
 * The control is the *only* thing the user sees; the underlying tuple
 * is documented here and forwarded verbatim to /v1/generate and
 * /v1/iterate via the optional `temperature` + `max_tokens` request
 * fields (back-compat: engine defaults win when omitted).
 *
 * Defaults to "quality" — the spec is explicit that this product
 * trades cost for output fidelity ("enterprise-grade motion
 * graphics, focus on quality not cost").
 *
 * Mapping (Jan 2026)
 * ──────────────────
 *   quality   → qwen2.5vl:7b    · temp 0.15 · max_tokens 6144
 *               (Apple-Silicon-friendly top-of-class vision model;
 *                tightest sampler we can run before the model starts
 *                repeating exact layouts; generous token budget so
 *                long briefs don't truncate mid-JSON.)
 *
 *   balanced  → qwen2.5vl:7b    · temp 0.25 · max_tokens 4096
 *               (Same model — keeping it constant means iteration
 *                feels consistent. Slightly looser temperature for a
 *                bit more variety; default 4 k tokens.)
 *
 *   fast      → qwen2-vl:7b     · temp 0.45 · max_tokens 2048
 *               (Falls back to the older Qwen2-VL 7B which loads
 *                faster on cold-start and tolerates higher
 *                temperatures without schema drift. Smaller token
 *                cap caps iteration latency.)
 *
 * Note: the model field is still surfaced separately via ModelPicker
 * for power users who want to pin a specific backend (e.g. a cloud
 * model). When ModelPicker overrides this preset's model, the
 * preset still controls temperature + max_tokens — those have no
 * sensible default in the picker UI.
 */

export type QualityLevel = 'quality' | 'balanced' | 'fast';

export interface QualityProfile {
  level: QualityLevel;
  /** Local Ollama model id this preset prefers. */
  model: ModelChoice;
  /** Sampler temperature [0, 1]. Lower = more deterministic. */
  temperature: number;
  /** `num_predict` / `max_tokens` cap forwarded to the LLM backend. */
  maxTokens: number;
}

export const QUALITY_PROFILES: Record<QualityLevel, QualityProfile> = {
  quality: {
    level: 'quality',
    model: 'ollama/qwen2.5vl:7b',
    temperature: 0.15,
    maxTokens: 6144,
  },
  balanced: {
    level: 'balanced',
    model: 'ollama/qwen2.5vl:7b',
    temperature: 0.25,
    maxTokens: 4096,
  },
  fast: {
    level: 'fast',
    model: 'ollama/qwen2-vl:7b',
    temperature: 0.45,
    maxTokens: 2048,
  },
};

export const DEFAULT_QUALITY: QualityLevel = 'quality';

interface Option {
  id: QualityLevel;
  label: string;
  hint: string;
  icon: typeof Sparkles;
}

const OPTIONS: Option[] = [
  {
    id: 'quality',
    label: 'Quality',
    hint: 'Most deterministic · best fidelity',
    icon: Sparkles,
  },
  {
    id: 'balanced',
    label: 'Balanced',
    hint: 'Quality model · faster iteration',
    icon: Gauge,
  },
  {
    id: 'fast',
    label: 'Fast',
    hint: 'Lighter model · cap latency',
    icon: Zap,
  },
];

interface Props {
  value: QualityLevel;
  onChange: (level: QualityLevel) => void;
}

/**
 * Segmented three-state control. Click a segment to swap the active
 * preset; the parent reads the resolved (model, temp, max_tokens)
 * from `QUALITY_PROFILES[value]` and forwards it on /v1/generate.
 */
export function QualityPreset({ value, onChange }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Quality preset"
      className="inline-flex items-center gap-0.5 rounded-full border border-border-light bg-bg-primary p-0.5"
      data-testid="quality-preset"
    >
      {OPTIONS.map((opt) => {
        const Icon = opt.icon;
        const isActive = opt.id === value;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(opt.id)}
            title={opt.hint}
            className={[
              'flex items-center gap-1 rounded-full px-2.5 py-1 text-2xs font-medium transition',
              isActive
                ? 'bg-accent-50 text-accent-800 shadow-sm'
                : 'text-text-secondary hover:bg-bg-secondary hover:text-text-primary',
            ].join(' ')}
            data-testid={`quality-preset-${opt.id}`}
          >
            <Icon className="h-3 w-3" />
            <span className="font-mono">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
