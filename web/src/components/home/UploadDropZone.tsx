'use client';

import { useCallback, useRef, useState } from 'react';
import { Film, Image as ImageIcon, FileText, Music, Paperclip, X } from 'lucide-react';
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
  text: FileText,
  binary: Paperclip,
};

/** Accepted MIME spec for the file picker. Drag-drop / paste accept the
 *  same set; the engine classifier (`classifyFile`) is the source of truth. */
export const ATTACH_ACCEPT = 'video/*,image/*,audio/*,text/*,.txt,.md,.json,.csv';

/**
 * Turn a raw File[] (from picker, drop, or clipboard paste) into the
 * PendingFile shape the engine flow expects. IDs are scoped to the
 * batch so dropping the same file twice still produces unique chips.
 */
export function toPendingFiles(files: File[]): PendingFile[] {
  return files.map((f, i) => ({
    id: `${Date.now()}-${i}-${f.name}`,
    file: f,
    kind: classifyFile(f),
  }));
}

/* ============================================================ inline UI */

/**
 * Paperclip trigger — sits in PromptInput's control row alongside
 * Cast / Voice. Opens the OS file picker; selected files are handed
 * back via `onPick` as plain File[] so HomeApp can run them through
 * `toPendingFiles` and append to its state.
 */
export function AttachButton({
  onPick,
  disabled,
}: {
  onPick: (files: File[]) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ATTACH_ACCEPT}
        className="sr-only"
        onChange={(e) => {
          const files = e.target.files;
          if (files && files.length > 0) onPick(Array.from(files));
          // Reset so re-picking the same file still triggers change.
          e.target.value = '';
        }}
        disabled={disabled}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Attach a reference video, image, audio, or brief"
      >
        <Paperclip className="h-4 w-4" aria-hidden />
        <span className="hidden sm:inline">Attach</span>
      </button>
    </>
  );
}

/**
 * Chip strip — rendered above the textarea inside PromptInput. One
 * chip per PendingFile, with a thumbnail (image / video poster) or
 * kind icon, name, size, upload status, and a remove (×) button.
 */
export function AttachmentChips({
  files,
  onRemove,
  disabled,
}: {
  files: PendingFile[];
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  if (files.length === 0) return null;

  return (
    <ul
      aria-label="Attached references"
      className="flex flex-wrap gap-2 border-b border-border-light px-4 py-3"
    >
      {files.map((f) => (
        <li key={f.id}>
          <Chip file={f} onRemove={() => onRemove(f.id)} disabled={disabled} />
        </li>
      ))}
    </ul>
  );
}

function Chip({
  file,
  onRemove,
  disabled,
}: {
  file: PendingFile;
  onRemove: () => void;
  disabled?: boolean;
}) {
  const Icon = ICONS[file.kind];
  const uploaded = !!file.serverPath;
  const hasError = !!file.error;

  return (
    <div
      title={file.error ?? file.serverPath ?? 'Pending upload'}
      className={[
        'flex items-center gap-2 rounded-lg border py-1 pl-1 pr-2 text-xs transition-colors',
        hasError
          ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300'
          : uploaded
            ? 'border-accent-300 bg-accent-50 text-accent-800 dark:border-accent-700 dark:bg-accent-900/40 dark:text-accent-200'
            : 'border-border-light bg-bg-secondary text-text-secondary hover:border-border',
      ].join(' ')}
    >
      <Thumb file={file} />
      <div className="flex min-w-0 flex-col">
        <span className="max-w-[10rem] truncate font-medium text-text-primary">
          {file.file.name}
        </span>
        <span className="text-[11px] text-text-tertiary">
          {humanBytes(file.file.size)}
        </span>
      </div>
      {/* Status icon — shows only when there's something to communicate. */}
      {!hasError && !uploaded && (
        <span className="ml-0.5 text-[10px] uppercase tracking-wider opacity-70">
          ready
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="ml-1 rounded p-0.5 text-text-tertiary transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:opacity-50"
        aria-label={`Remove ${file.file.name}`}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
      {/* Hidden span; lets screen readers announce the kind. */}
      <span className="sr-only">{file.kind}</span>
      {/* Icon next to the thumb is implicit via Thumb; we still mount the
          icon for fallback styling when thumb is text/binary. */}
      <Icon className="sr-only" aria-hidden />
    </div>
  );
}

function Thumb({ file }: { file: PendingFile }) {
  const wrap =
    'grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-md bg-bg-tertiary text-text-tertiary';

  if (file.kind === 'image') {
    return (
      <span className={wrap}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={URL.createObjectURL(file.file)}
          alt=""
          loading="lazy"
          className="h-full w-full object-cover"
          onLoad={(e) => {
            // Revoke the URL after the browser has painted it. The
            // object stays usable for the lifetime of the page, but
            // we don't leak memory if many chips mount/unmount.
            const src = (e.currentTarget as HTMLImageElement).src;
            queueMicrotask(() => URL.revokeObjectURL(src));
          }}
        />
      </span>
    );
  }
  const Icon = ICONS[file.kind];
  return (
    <span className={wrap}>
      <Icon className="h-4 w-4" aria-hidden />
    </span>
  );
}

/* ============================================================ standalone */

interface DropZoneProps {
  files: PendingFile[];
  onAdd: (added: PendingFile[]) => void;
  onRemove: (id: string) => void;
  /** disables the input while a generate is in flight */
  disabled?: boolean;
}

/**
 * Standalone drop-zone — dashed bordered card the user can click or
 * drag onto. Kept for callers that want a visible, separate upload
 * surface. The home now prefers the *inline* integration:
 * `<AttachButton>` in the prompt's control row + `<AttachmentChips>`
 * above the textarea + drag-drop / paste handled inside PromptInput.
 */
export function UploadDropZone({ files, onAdd, onRemove, disabled }: DropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const onPick = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const added: PendingFile[] = [];
      for (let i = 0; i < list.length; i++) {
        const f = list.item(i);
        if (!f) continue;
        added.push({
          id: `${Date.now()}-${i}-${f.name}`,
          file: f,
          kind: classifyFile(f),
        });
      }
      onAdd(added);
    },
    [onAdd],
  );

  return (
    <div className="flex flex-col gap-2">
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload reference video, image, audio, or brief"
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) onPick(e.dataTransfer.files);
        }}
        className={[
          'flex items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-3 text-xs transition cursor-pointer',
          disabled ? 'opacity-50 cursor-not-allowed' : '',
          dragging
            ? 'border-accent-500 bg-accent-50 text-accent-700'
            : 'border-border-default bg-bg-secondary text-text-secondary hover:border-accent-400 hover:bg-accent-50/40',
        ].join(' ')}
        data-testid="upload-dropzone"
      >
        <Paperclip className="h-3.5 w-3.5" />
        <span>
          Drop a <span className="font-medium text-text-primary">reference video</span>,{' '}
          <span className="font-medium text-text-primary">images</span>,{' '}
          <span className="font-medium text-text-primary">audio</span>, or a{' '}
          <span className="font-medium text-text-primary">brief</span> — or click to pick
        </span>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ATTACH_ACCEPT}
          className="sr-only"
          onChange={(e) => {
            onPick(e.target.files);
            // reset so re-picking the same file fires onChange again
            e.target.value = '';
          }}
          disabled={disabled}
        />
      </div>

      <AttachmentChips files={files} onRemove={onRemove} disabled={disabled} />
    </div>
  );
}
