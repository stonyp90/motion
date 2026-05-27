'use client';

import { useMemo } from 'react';
import { Cpu, Cloud, Brain, Bot } from 'lucide-react';
import type { ModelChoice } from './ModelPicker';

export interface TokenUsage {
  /** Total tokens consumed in the current session (prompt + completion). */
  used: number;
  /** Model's context-window maximum, used as the progress denominator. */
  max: number;
  /** Estimated USD cost for the session, optional. */
  costUsd?: number;
}

/**
 * Per-model context-window + per-1k pricing. These are headline
 * numbers used only for the chip display; the engine does its own
 * accounting on the wire when the orchestrator captures real usage.
 */
const MODEL_INFO: Record<ModelChoice, { max: number; perMTok: number; vendor: string; icon: typeof Cpu }> = {
  // Local · vision-capable (quality-tier defaults handled by QualityPreset)
  'ollama/qwen2.5vl:32b': { max: 128_000, perMTok: 0, vendor: 'local', icon: Cpu },
  'ollama/qwen2.5vl:7b': { max: 128_000, perMTok: 0, vendor: 'local', icon: Cpu },
  'ollama/llama3.2-vision:11b': { max: 128_000, perMTok: 0, vendor: 'local', icon: Cpu },
  'ollama/qwen2-vl:7b': { max: 32_768, perMTok: 0, vendor: 'local', icon: Cpu },
  'ollama/llava-llama3:8b': { max: 8192, perMTok: 0, vendor: 'local', icon: Cpu },
  // Local · text-only
  'ollama/qwen2.5:7b': { max: 32_768, perMTok: 0, vendor: 'local', icon: Cpu },
  'ollama/gemma2:9b': { max: 8192, perMTok: 0, vendor: 'local', icon: Cpu },
  'ollama/deepseek-r1:8b': { max: 128_000, perMTok: 0, vendor: 'local', icon: Cpu },
  // Cloud
  'openai/gpt-4o': { max: 128_000, perMTok: 2.5, vendor: 'cloud', icon: Cloud },
  'openai/gpt-4o-mini': { max: 128_000, perMTok: 0.15, vendor: 'cloud', icon: Cloud },
  'anthropic/claude-sonnet-4': { max: 200_000, perMTok: 3.0, vendor: 'cloud', icon: Brain },
  'azure/openai-gpt-4o': { max: 128_000, perMTok: 2.5, vendor: 'cloud', icon: Bot },
};

interface Props {
  model: ModelChoice;
  /** Engine-reported usage (preferred). When absent we render the
   *  static model metadata so the chip is never empty. */
  usage?: TokenUsage;
}

/**
 * Compact chip rendered next to the prompt's controls row, mirroring
 * Cursor / Claude Desktop's "tokens used / context max" indicator.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  ⚡ llava (local) · 1,234 / 4,096 · ────────  │
 *   └──────────────────────────────────────────────┘
 *
 * Color: emerald accent while < 80% of context, amber 80-95%, red >
 * 95% (so the user sees the wall coming before it hits them).
 */
export function TokenUsageChip({ model, usage }: Props) {
  const info = MODEL_INFO[model];
  const Icon = info.icon;

  const { used, max, pct, costStr, barClass, label } = useMemo(() => {
    const max = usage?.max ?? info.max;
    const used = usage?.used ?? 0;
    const pct = Math.min(100, Math.round((used / max) * 100));
    const cost = usage?.costUsd ?? (info.perMTok ? (used / 1_000_000) * info.perMTok : 0);
    const costStr =
      info.vendor === 'local'
        ? 'free'
        : cost < 0.01
          ? '<$0.01'
          : `$${cost.toFixed(2)}`;
    const bar =
      pct < 80
        ? 'bg-accent-500'
        : pct < 95
          ? 'bg-secondary-500'
          : 'bg-red-500';
    const label = model.split('/')[1] ?? model;
    return { used, max, pct, costStr, barClass: bar, label };
  }, [model, usage, info]);

  return (
    <div
      className="flex items-center gap-2 rounded-full border border-border-light bg-bg-secondary px-2.5 py-1 font-mono text-2xs text-text-secondary"
      title={`${label} · ${used.toLocaleString()} of ${max.toLocaleString()} tokens · ${costStr}`}
      data-testid="token-usage-chip"
    >
      <Icon className="h-3 w-3 text-text-tertiary" aria-hidden />
      <span className="font-medium text-text-primary">{label}</span>
      <span className="text-text-tertiary">·</span>
      <span>
        {used.toLocaleString()}
        <span className="text-text-tertiary"> / </span>
        {compact(max)}
      </span>
      <div
        className="h-1 w-12 overflow-hidden rounded-full bg-border-light"
        aria-label={`${pct}% of context used`}
      >
        <div
          className={`h-full transition-all duration-300 ${barClass}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-text-tertiary">{costStr}</span>
    </div>
  );
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return `${n}`;
}
