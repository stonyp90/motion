'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Loader2, Sparkles } from 'lucide-react';

interface Props {
  value: string;
  onChange: (next: string) => void;
  onGenerate: () => void;
  isGenerating: boolean;
  /**
   * When true the textarea defaults to a smaller height (2 lines
   * instead of 4) so the preview below gets more of the viewport.
   * Toggle this from the parent once an animation exists — the user
   * is now iterating, not drafting a fresh brief.
   */
  compact?: boolean;
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
   * Slot for the attach / upload button (paperclip). Sits left of
   * `castSlot` in the bottom control row.
   */
  attachSlot?: ReactNode;
  /**
   * Slot for the attached-file chip strip. Rendered above the
   * textarea so chips read as "context I'm bringing in" rather than
   * "controls I'm choosing".
   */
  attachmentChips?: ReactNode;
  /**
   * Called when the user drops files onto the textarea container or
   * pastes media from the clipboard. The parent validates + appends
   * to its own attachments state.
   */
  onAttach?: (files: File[]) => void;
  /**
   * Slot for the duration / preset / aspect chevron-drawer. Rendered
   * in the bottom-right of the prompt control row.
   */
  controlsSlot?: ReactNode;
  /**
   * When true, the textarea becomes read-only and the Generate button
   * is rendered as a styled-but-unclickable presentational element.
   * Used by the anonymous sample-run demo to play the prompt UI as a
   * cinematic without giving the product away.
   */
  readOnly?: boolean;
}

const MIN_HEIGHT_FULL = 96; // px — about 4 lines (initial draft state)
const MIN_HEIGHT_COMPACT = 56; // px — about 2 lines (iteration state, animation already exists)
const MAX_HEIGHT = 360; // px — cap on autoresize before scroll kicks in

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
  compact = false,
  castSlot,
  voiceSlot,
  attachSlot,
  attachmentChips,
  onAttach,
  controlsSlot,
  readOnly = false,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  // dragenter/leave fire for every nested element; we track a depth
  // counter and only treat the surface as "dragging" while > 0.
  const dragDepth = useRef(0);

  const minHeight = compact ? MIN_HEIGHT_COMPACT : MIN_HEIGHT_FULL;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Reset to auto so scrollHeight reflects content, not previous size.
    // Empty textarea: clamp to minHeight instead of letting it grow to
    // some quirky scrollHeight default. Filled: grow to fit, cap at MAX.
    el.style.height = 'auto';
    if (!value.trim()) {
      el.style.height = `${minHeight}px`;
      return;
    }
    const next = Math.min(MAX_HEIGHT, Math.max(minHeight, el.scrollHeight));
    el.style.height = `${next}px`;
  }, [value, minHeight]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ⌘/Ctrl+Enter submits — matches every "AI prompt box" the user
    // has muscle memory for.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (value.trim() && !isGenerating) onGenerate();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!onAttach) return;
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) return;
    e.preventDefault();
    onAttach(files);
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onAttach || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragOver(true);
  };
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onAttach || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onAttach) return;
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    if (!onAttach) return;
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) onAttach(files);
  };

  return (
    <div
      className={`relative rounded-2xl border bg-bg-primary shadow-card transition focus-within:border-accent-300 focus-within:shadow-glow ${
        isDragOver ? 'border-accent-500 shadow-glow' : 'border-border-light'
      }`}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {attachmentChips}
      <label htmlFor="prompt-textarea" className="sr-only">
        Describe the motion graphic you want
      </label>
      <textarea
        id="prompt-textarea"
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        readOnly={readOnly}
        tabIndex={readOnly ? -1 : undefined}
        aria-readonly={readOnly || undefined}
        placeholder={
          compact
            ? 'Refine the animation — change the tagline, swap a scene, retime…'
            : 'Describe what you want to show — a launch teaser, a pricing explainer, a quarterly recap…'
        }
        rows={compact ? 2 : 4}
        className="block w-full resize-none overflow-y-auto border-0 bg-transparent px-5 py-3 font-sans text-base leading-relaxed text-text-primary placeholder:font-mono placeholder:text-sm placeholder:text-text-tertiary focus:outline-none"
        style={{ minHeight, maxHeight: MAX_HEIGHT }}
      />

      <div className="flex items-center justify-between gap-3 border-t border-border-light px-4 py-2.5">
        <div className="flex items-center gap-2">
          {attachSlot}
          {castSlot}
          {voiceSlot}
        </div>
        <div className="flex items-center gap-3">
          {controlsSlot}
          {/* Generate — primary action. Bigger, brighter, hints at the
              shortcut when active and at the missing-prompt blocker
              when disabled. Mirrors Cursor / Lovable / v0's "main
              CTA" pattern where the button is loud enough to read
              across the room. */}
          {readOnly ? (
            // Sample-run mode: render the Generate button as a styled
            // presentational div so clicks fall through to the demo's
            // click-shield (which routes to /signup).
            <div
              aria-hidden
              className={`group inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold text-white shadow-card ${
                isGenerating
                  ? 'bg-accent-700'
                  : 'bg-accent-700 animate-pulse-accent'
              }`}
              data-testid="generate-button"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              <span>{isGenerating ? 'Generating' : 'Generate'}</span>
            </div>
          ) : (
            <button
              type="button"
              onClick={onGenerate}
              disabled={!value.trim() || isGenerating}
              title={
                !value.trim()
                  ? 'Write a brief above to generate'
                  : isGenerating
                    ? 'Generating…'
                    : 'Generate (⌘ Enter)'
              }
              className="group inline-flex items-center gap-2 rounded-full bg-accent-700 px-5 py-2 text-sm font-semibold text-white shadow-card transition-all hover:-translate-y-px hover:bg-accent-800 hover:shadow-glow disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none disabled:hover:translate-y-0"
              aria-label="Generate motion graphic"
              data-testid="generate-button"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 transition-transform group-hover:scale-110" />
              )}
              <span>{isGenerating ? 'Generating' : 'Generate'}</span>
              {!isGenerating && value.trim() && (
                <span className="hidden font-mono text-2xs opacity-70 sm:inline">⌘⏎</span>
              )}
            </button>
          )}
        </div>
      </div>

      {isDragOver && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-accent-50/90 text-sm font-medium text-accent-800 backdrop-blur-[2px] dark:bg-accent-900/50 dark:text-accent-200"
        >
          Drop to attach as context
        </div>
      )}
    </div>
  );
}
