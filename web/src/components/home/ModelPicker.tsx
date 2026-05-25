'use client';

import { useState } from 'react';
import { Bot, Brain, Cloud, Cpu, ChevronDown } from 'lucide-react';

export type ModelChoice =
  | 'ollama/llava'
  | 'ollama/qwen2.5-vl'
  | 'openai/gpt-4o'
  | 'openai/gpt-4o-mini'
  | 'anthropic/claude-sonnet-4'
  | 'azure/openai-gpt-4o';

export interface ModelOption {
  id: ModelChoice;
  label: string;
  vendor: 'ollama' | 'openai' | 'anthropic' | 'azure';
  /** Short note on cost / latency / locality. */
  hint: string;
  icon: typeof Cpu;
}

export const MODELS: ModelOption[] = [
  {
    id: 'ollama/llava',
    label: 'llava (local)',
    vendor: 'ollama',
    hint: 'free · runs on your machine · multimodal',
    icon: Cpu,
  },
  {
    id: 'ollama/qwen2.5-vl',
    label: 'qwen2.5-vl (local)',
    vendor: 'ollama',
    hint: 'free · vision-language · stronger reasoning',
    icon: Cpu,
  },
  {
    id: 'openai/gpt-4o',
    label: 'gpt-4o',
    vendor: 'openai',
    hint: 'cloud · ~$3 / spot · highest quality',
    icon: Cloud,
  },
  {
    id: 'openai/gpt-4o-mini',
    label: 'gpt-4o-mini',
    vendor: 'openai',
    hint: 'cloud · ~$0.18 / spot · fast iterate',
    icon: Cloud,
  },
  {
    id: 'anthropic/claude-sonnet-4',
    label: 'claude sonnet 4',
    vendor: 'anthropic',
    hint: 'cloud · strong storyboard structuring',
    icon: Brain,
  },
  {
    id: 'azure/openai-gpt-4o',
    label: 'azure openai · gpt-4o',
    vendor: 'azure',
    hint: 'cloud · enterprise data-residency',
    icon: Bot,
  },
];

interface Props {
  value: ModelChoice;
  onChange: (m: ModelChoice) => void;
}

/**
 * Compact model picker. Click the chip → popover with grouped options.
 * Selection is purely advisory in the UI today — the engine reads
 * `MOTION_FORGE_LLM_BACKEND` env to pick the actual backend. Once the
 * engine grows a `model` field on `/v1/generate`, this just forwards
 * the user's pick.
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
            className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-border-light bg-bg-primary p-1 shadow-lift"
          >
            {(['ollama', 'openai', 'anthropic', 'azure'] as const).map((vendor) => {
              const group = MODELS.filter((m) => m.vendor === vendor);
              if (group.length === 0) return null;
              return (
                <div key={vendor} className="px-1 py-1.5">
                  <p className="px-2 pb-1 font-mono text-2xs uppercase tracking-wider text-text-tertiary">
                    {vendor}
                  </p>
                  {group.map((m) => {
                    const Icon = m.icon;
                    const isActive = m.id === value;
                    return (
                      <button
                        key={m.id}
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
                        <span className="flex flex-col gap-0.5">
                          <span className="font-medium">{m.label}</span>
                          <span className="text-2xs text-text-tertiary">{m.hint}</span>
                        </span>
                      </button>
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
