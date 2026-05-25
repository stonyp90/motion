'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
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
}

const MIN_HEIGHT = 96; // px — about 4 lines
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
  castSlot,
  voiceSlot,
  attachSlot,
  attachmentChips,
  onAttach,
  controlsSlot,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  // dragenter/leave fire for every nested element; we track a depth
  // counter and only treat the surface as "dragging" while > 0.
  const dragDepth = useRef(0);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Reset to auto so scrollHeight reflects content, not previous size.
    // Empty textarea: clamp to MIN_HEIGHT instead of letting it grow to
    // some quirky scrollHeight default. Filled: grow to fit, cap at MAX.
    el.style.height = 'auto';
    if (!value.trim()) {
      el.style.height = `${MIN_HEIGHT}px`;
      return;
    }
    const next = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, el.scrollHeight));
    el.style.height = `${next}px`;
  }, [value]);

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
        placeholder="Describe the motion graphic you want — a launch teaser, a pricing explainer, a quarterly recap…"
        rows={4}
        className="block w-full resize-none overflow-y-auto border-0 bg-transparent px-5 py-4 font-sans text-base leading-relaxed text-text-primary placeholder:font-mono placeholder:text-sm placeholder:text-text-tertiary focus:outline-none"
        style={{ minHeight: MIN_HEIGHT, maxHeight: MAX_HEIGHT }}
      />

      <div className="flex items-center justify-between gap-3 border-t border-border-light px-4 py-2.5">
        <div className="flex items-center gap-2">
          {attachSlot}
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
