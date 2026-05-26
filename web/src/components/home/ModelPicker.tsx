'use client';

import { useState } from 'react';
import { Bot, Brain, Cloud, Cpu, ChevronDown, Eye } from 'lucide-react';

// Open-source model selection sourced from the Hugging Face Open LLM
// Leaderboard, the Open VLM Leaderboard, and the Ollama community's
// structured-output shortlist (Nov 2025). We prefer models that:
//   - have open weights (Apache-2.0 / Llama Community License / equivalent)
//   - reliably emit valid JSON under constrained prompts
//   - run on a single mid-tier GPU or Apple silicon laptop
//   - have a current Ollama tag (so the desktop sidecar can pull them)
//
// Vision-capable models are flagged separately so the UI can prefer
// them when the user has attached reference images.

export type ModelChoice =
  // Local · vision-capable (recommended when reference images attached)
  | 'ollama/llama3.2-vision:11b'
  | 'ollama/qwen2-vl:7b'
  | 'ollama/llava-llama3:8b'
  // Local · text-only (script_synth, prompt-only generates)
  | 'ollama/qwen2.5:7b'
  | 'ollama/gemma2:9b'
  | 'ollama/deepseek-r1:8b'
  // Cloud · best-in-class
  | 'openai/gpt-4o'
  | 'openai/gpt-4o-mini'
  | 'anthropic/claude-sonnet-4'
  | 'azure/openai-gpt-4o';

type Vendor = 'ollama' | 'openai' | 'anthropic' | 'azure';
type Capability = 'vision' | 'text';

export interface ModelOption {
  id: ModelChoice;
  label: string;
  vendor: Vendor;
  capability: Capability;
  /** Short note on cost / latency / locality. */
  hint: string;
  /** Approx download size (local) or per-spot cost (cloud). */
  meta: string;
  icon: typeof Cpu;
}

export const MODELS: ModelOption[] = [
  // ── Local · vision ──────────────────────────────────────────────
  {
    id: 'ollama/llama3.2-vision:11b',
    label: 'Llama 3.2 Vision 11B',
    vendor: 'ollama',
    capability: 'vision',
    hint: 'Default · Meta · top open vision model · strong JSON',
    meta: '~7.9 GB · local',
    icon: Eye,
  },
  {
    id: 'ollama/qwen2-vl:7b',
    label: 'Qwen2-VL 7B',
    vendor: 'ollama',
    capability: 'vision',
    hint: 'Alibaba · top of Open VLM leaderboard · faster',
    meta: '~4.4 GB · local',
    icon: Eye,
  },
  {
    id: 'ollama/llava-llama3:8b',
    label: 'LLaVA · Llama 3 8B',
    vendor: 'ollama',
    capability: 'vision',
    hint: 'Llama-3-based LLaVA · proven baseline',
    meta: '~4.7 GB · local',
    icon: Eye,
  },
  // ── Local · text-only ───────────────────────────────────────────
  {
    id: 'ollama/qwen2.5:7b',
    label: 'Qwen 2.5 7B',
    vendor: 'ollama',
    capability: 'text',
    hint: 'Alibaba · best size-to-quality · clean JSON',
    meta: '~4.7 GB · local',
    icon: Cpu,
  },
  {
    id: 'ollama/gemma2:9b',
    label: 'Gemma 2 9B',
    vendor: 'ollama',
    capability: 'text',
    hint: 'Google · open weights · strong reasoning',
    meta: '~5.4 GB · local',
    icon: Cpu,
  },
  {
    id: 'ollama/deepseek-r1:8b',
    label: 'DeepSeek R1 8B',
    vendor: 'ollama',
    capability: 'text',
    hint: 'Reasoning-tuned · best for layered briefs',
    meta: '~4.9 GB · local',
    icon: Brain,
  },
  // ── Cloud ───────────────────────────────────────────────────────
  {
    id: 'openai/gpt-4o',
    label: 'GPT-4o',
    vendor: 'openai',
    capability: 'vision',
    hint: 'OpenAI · highest quality · supports images',
    meta: '~$3 / spot · cloud',
    icon: Cloud,
  },
  {
    id: 'openai/gpt-4o-mini',
    label: 'GPT-4o mini',
    vendor: 'openai',
    capability: 'vision',
    hint: 'OpenAI · fast iterate · cheap',
    meta: '~$0.18 / spot · cloud',
    icon: Cloud,
  },
  {
    id: 'anthropic/claude-sonnet-4',
    label: 'Claude Sonnet 4',
    vendor: 'anthropic',
    capability: 'vision',
    hint: 'Anthropic · best storyboard structuring',
    meta: 'cloud',
    icon: Brain,
  },
  {
    id: 'azure/openai-gpt-4o',
    label: 'Azure OpenAI GPT-4o',
    vendor: 'azure',
    capability: 'vision',
    hint: 'Azure · EU data residency · enterprise',
    meta: 'cloud',
    icon: Bot,
  },
];

interface Props {
  value: ModelChoice;
  onChange: (m: ModelChoice) => void;
}

const VENDOR_LABEL: Record<Vendor, string> = {
  ollama: 'Local (Ollama)',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  azure: 'Azure',
};

/**
 * Compact model picker. Click the chip → popover with grouped options.
 *
 * Local models are listed first (privacy-first default), and within
 * "Local" we sub-group by capability so a user with an attached image
 * can see the vision-capable options at a glance.
 */
export function ModelPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const active = MODELS.find((m) => m.id === value) ?? MODELS[0];
  const ActiveIcon = active.icon;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex items-center gap-1.5 rounded-full border border-border-light bg-bg-primary px-2.5 py-1 text-2xs font-medium text-text-secondary transition hover:border-accent-300 hover:text-text-primary"
        data-testid="model-picker"
      >
        <ActiveIcon className="h-3 w-3" />
        <span className="font-mono">{active.label}</span>
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {open && (
        <>
          {/* click-outside scrim */}
          <button
            type="button"
            aria-label="Close model picker"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            role="listbox"
            aria-label="LLM backend"
            className="absolute right-0 z-20 mt-2 max-h-[28rem] w-80 overflow-y-auto rounded-xl border border-border-light bg-bg-primary p-1 shadow-lift"
          >
            {(['ollama', 'openai', 'anthropic', 'azure'] as const).map((vendor) => {
              const group = MODELS.filter((m) => m.vendor === vendor);
              if (group.length === 0) return null;

              // For local models, sub-group vision-capable above text-only
              // so a user with an attached image sees the right defaults.
              const sorted =
                vendor === 'ollama'
                  ? [...group].sort((a, b) => {
                      if (a.capability === b.capability) return 0;
                      return a.capability === 'vision' ? -1 : 1;
                    })
                  : group;

              let lastCap: Capability | null = null;
              return (
                <div key={vendor} className="px-1 py-1.5">
                  <p className="px-2 pb-1 font-mono text-2xs uppercase tracking-wider text-text-tertiary">
                    {VENDOR_LABEL[vendor]}
                  </p>
                  {sorted.map((m) => {
                    const Icon = m.icon;
                    const isActive = m.id === value;
                    const showCapHeading =
                      vendor === 'ollama' && m.capability !== lastCap;
                    lastCap = m.capability;
                    return (
                      <div key={m.id}>
                        {showCapHeading && (
                          <p className="mt-1 px-2 pb-0.5 font-mono text-[10px] uppercase tracking-wider text-text-tertiary/70">
                            {m.capability === 'vision' ? 'Vision' : 'Text-only'}
                          </p>
                        )}
                        <button
                          type="button"
                          role="option"
                          aria-selected={isActive}
                          onClick={() => {
                            onChange(m.id);
                            setOpen(false);
                          }}
                          className={[
                            'flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left text-xs transition',
                            isActive
                              ? 'bg-accent-50 text-accent-800'
                              : 'text-text-secondary hover:bg-bg-secondary hover:text-text-primary',
                          ].join(' ')}
                        >
                          <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="flex flex-1 flex-col gap-0.5">
                            <span className="flex items-center justify-between gap-2">
                              <span className="font-medium">{m.label}</span>
                              <span className="font-mono text-[10px] text-text-tertiary">
                                {m.meta}
                              </span>
                            </span>
                            <span className="text-2xs text-text-tertiary">{m.hint}</span>
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
