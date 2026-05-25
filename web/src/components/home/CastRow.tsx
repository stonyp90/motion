'use client';

/**
 * Chip row that sits above the home-page prompt. Each chip is one
 * active cast member (a character / integration the LLM may reference
 * by name from the prompt). Click `+` to open the
 * `CastDrawer`; click the X on a chip to remove that actor.
 *
 * The component is intentionally controlled — state lives wherever
 * the parent puts it (a zustand store, a useState hook, etc.). This
 * keeps it composable with W4's brief intake and W3's voice button
 * once those land.
 */

import { Plus, X } from 'lucide-react';
import type { CastEntry } from '@/lib/characters/manifest';

export interface CastRowProps {
  cast?: CastEntry[];
  onChange?: (cast: CastEntry[]) => void;
  onOpenDrawer?: () => void;
  /** Optional label rendered before the chips. Defaults to "Cast". */
  label?: string;
  /** Maximum chips kept in the cast. Default 8. */
  maxChips?: number;
}

export function CastRow({
  cast = [],
  onChange = () => undefined,
  onOpenDrawer = () => undefined,
  label = 'Cast',
  maxChips = 8,
}: CastRowProps) {
  const remove = (id: string) => onChange(cast.filter((c) => c.id !== id));
  const atLimit = cast.length >= maxChips;

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      aria-label="Active cast"
      data-testid="cast-row"
    >
      <span className="text-2xs uppercase tracking-wide text-text-tertiary">
        {label}
      </span>

      {cast.map((entry) => (
        <CastChip key={entry.id} entry={entry} onRemove={() => remove(entry.id)} />
      ))}

      <button
        type="button"
        onClick={onOpenDrawer}
        disabled={atLimit}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-border bg-bg-secondary px-3 py-1 text-xs font-medium text-text-secondary transition hover:border-accent-500 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={atLimit ? `Cast at limit (${maxChips})` : 'Add character to cast'}
        data-testid="cast-row-add"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden />
        {cast.length === 0 ? 'Add character' : 'Add'}
      </button>
    </div>
  );
}

/** Single coloured chip. Brand-coloured if the entry carries an
 *  `accent_hex`, neutral otherwise. */
function CastChip({
  entry,
  onRemove,
}: {
  entry: CastEntry;
  onRemove: () => void;
}) {
  // Use the accent_hex as the chip's left "swatch" + outline so the
  // chip stays readable against the page background regardless of
  // the brand colour. Avoids hardcoded per-character styles.
  const accent = entry.accent_hex ?? 'var(--color-accent-500)';
  return (
    <span
      className="group inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-primary pl-1 pr-1.5 py-1 text-xs font-medium text-text-primary shadow-soft"
      style={{ boxShadow: `inset 3px 0 0 0 ${accent}` }}
      data-testid={`cast-chip-${entry.id}`}
    >
      <span
        aria-hidden
        className="grid h-5 w-5 place-items-center rounded-full text-3xs font-bold text-white"
        style={{ backgroundColor: accent }}
      >
        {initials(entry.name)}
      </span>
      <span>{entry.name}</span>
      <span className="text-2xs uppercase tracking-wider text-text-tertiary">
        {entry.source === 'integrations' ? 'tool' : 'cast'}
      </span>
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 grid h-4 w-4 place-items-center rounded-full text-text-tertiary opacity-60 transition hover:bg-bg-secondary hover:text-text-primary hover:opacity-100"
        aria-label={`Remove ${entry.name}`}
      >
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}

function initials(name: string): string {
  const parts = name
    .replace(/[^a-zA-Z0-9 \-]/g, '')
    .split(/[ \-]+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length === 0) return '?';
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('');
}

export default CastRow;
