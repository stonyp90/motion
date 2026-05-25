'use client';

import { useRef } from 'react';
import { File as FileIcon, FileText, Film, Image as ImageIcon, Music, Paperclip, X } from 'lucide-react';
import { classifyFile, humanBytes, type UploadedKind } from '@/lib/uploads';

export interface PendingFile {
  id: string;
  file: File;
  kind: UploadedKind;
  /** server-side path once uploaded (filled in by parent after /v1/uploads) */
  serverPath?: string;
  /** transient error during upload */
  error?: string;
}

const ICONS: Record<UploadedKind, typeof Film> = {
  video: Film,
  image: ImageIcon,
  audio: Music,
  pdf: FileIcon,
  text: FileText,
  binary: Paperclip,
};

/**
 * Helper: wrap a raw browser File[] into the PendingFile shape the
 * rest of the app passes around.
 */
export function classifyToPending(files: File[]): PendingFile[] {
  return files.map((f, i) => ({
    id: `${Date.now()}-${i}-${f.name}`,
    file: f,
    kind: classifyFile(f),
  }));
}

/* ---------- inline button that lives in PromptInput's `attachSlot` */

interface AttachButtonProps {
  onPick: (files: File[]) => void;
  disabled?: boolean;
}

/**
 * Paperclip button inside the prompt's bottom-left control row.
 * Drag-drop + paste is wired separately on the textarea container
 * itself (PromptInput's onAttach prop) so the user has two muscle
 * memories that both work.
 */
export function AttachButton({ onPick, disabled }: AttachButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => !disabled && inputRef.current?.click()}
        disabled={disabled}
        aria-label="Attach reference video, image, audio, or brief"
        className="grid h-7 w-7 place-items-center rounded-full border border-border-light bg-bg-primary text-text-secondary transition hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="attach-button"
        title="Attach context (video, images, audio, brief)"
      >
        <Paperclip className="h-3.5 w-3.5" />
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="video/*,image/*,audio/*,application/pdf,.pdf,text/*,.txt,.md,.json,.csv"
        className="sr-only"
        onChange={(e) => {
          const list = e.target.files;
          if (list && list.length > 0) onPick(Array.from(list));
          e.target.value = '';
        }}
        disabled={disabled}
      />
    </>
  );
}

/* ---------- chip strip that lives in PromptInput's `attachmentChips` */

interface AttachmentChipsProps {
  files: PendingFile[];
  onRemove: (id: string) => void;
  disabled?: boolean;
}

export function AttachmentChips({ files, onRemove, disabled }: AttachmentChipsProps) {
  if (files.length === 0) return null;
  return (
    <ul
      className="flex flex-wrap gap-2 border-b border-border-light px-4 py-2.5"
      aria-label="Attached references"
    >
      {files.map((f) => {
        const Icon = ICONS[f.kind];
        const uploaded = !!f.serverPath;
        return (
          <li
            key={f.id}
            className={[
              'flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs',
              f.error
                ? 'border-red-300 bg-red-50 text-red-700'
                : uploaded
                  ? 'border-accent-300 bg-accent-50 text-accent-800'
                  : 'border-border-light bg-bg-secondary text-text-secondary',
            ].join(' ')}
            title={f.error ?? f.serverPath ?? 'pending upload'}
          >
            <Icon className="h-3 w-3" />
            <span className="max-w-[180px] truncate font-medium">{f.file.name}</span>
            <span className="font-mono text-2xs opacity-70">
              {humanBytes(f.file.size)}
            </span>
            <button
              type="button"
              onClick={() => onRemove(f.id)}
              aria-label={`Remove ${f.file.name}`}
              className="ml-1 grid h-4 w-4 place-items-center rounded-full hover:bg-bg-tertiary disabled:opacity-50"
              disabled={disabled}
            >
              <X className="h-3 w-3" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
