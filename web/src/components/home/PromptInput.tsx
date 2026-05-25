'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Loader2, Sparkles } from 'lucide-react';

interface Props {
  value: string;
  onChange: (next: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  /**
   * Slot for W2's cast / characters surface (e.g. CastRow). Rendered
   * in the bottom-left of the prompt control row. The home only
   * passes a stub today; W2 swaps in the real component by editing
   * `home/CastRow.tsx`.
   */
  castSlot?: ReactNode;
  /**
   * Slot for W3's mic / voice button (e.g. VoiceButton). Rendered
   * next to the cast slot.
   */
  voiceSlot?: ReactNode;
  /**
   * Slot for the duration / preset / aspect chevron-drawer. Rendered
   * in the bottom-right of the prompt control row.
   */
  controlsSlot?: ReactNode;
}

const MIN_HEIGHT = 96; // px — about 4 lines

/**
 * Autoresize textarea with an embedded control row and a Generate
 * button on its right. The component is the centerpiece of the home
 * screen.
 *
 * The autoresize is implemented the boring way: set height to 'auto'
 * before reading scrollHeight, then set height to that scrollHeight.
 * Works because <textarea>'s scrollHeight reflects content height
 * regardless of its current height.
 */
export function PromptInput({
  value,
  onChange,
  onGenerate,
  isGenerating,
  castSlot,
  voiceSlot,
  controlsSlot,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(MIN_HEIGHT, el.scrollHeight)}px`;
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ⌘/Ctrl+Enter submits — matches every "AI prompt box" the user
    // has muscle memory for.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (value.trim() && !isGenerating) onGenerate();
    }
  };

  return (
    <div className="rounded-2xl border border-border-light bg-bg-primary shadow-card transition focus-within:border-accent-300 focus-within:shadow-glow">
      <label htmlFor="prompt-textarea" className="sr-only">
        Describe the motion graphic you want
      </label>
      <textarea
        id="prompt-textarea"
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe the motion graphic you want — a launch teaser, a pricing explainer, a quarterly recap…"
        rows={4}
        className="block w-full resize-none border-0 bg-transparent px-5 py-4 font-sans text-base leading-relaxed text-text-primary placeholder:font-mono placeholder:text-sm placeholder:text-text-tertiary focus:outline-none"
        style={{ minHeight: MIN_HEIGHT }}
      />

      <div className="flex items-center justify-between gap-3 border-t border-border-light px-4 py-2.5">
        <div className="flex items-center gap-3">
          {castSlot}
          {voiceSlot}
        </div>
        <div className="flex items-center gap-2">
          {controlsSlot}
          <button
            type="button"
            onClick={onGenerate}
            disabled={!value.trim() || isGenerating}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-white shadow-card transition hover:bg-accent-800 hover:shadow-glow disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none"
            aria-label="Generate motion graphic"
          >
            {isGenerating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isGenerating ? 'Generating' : 'Generate'}
          </button>
        </div>
      </div>
    </div>
  );
}
