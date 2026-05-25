'use client';

/**
 * Slide-over drawer from the right that lets the user browse the
 * shipped library, pick characters / third-party tool logos, and
 * (in future versions) upload custom assets or AI-generate new ones.
 *
 * MVP: Library and Integrations tabs are functional; Upload and
 * AI Generate render a "coming soon" panel so the IA is in place.
 *
 * Keyboard: `Esc` closes; tab cycle is contained by the dialog (and
 * the underlying page is inert via `aria-hidden` on the overlay).
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Search, Sparkles, Upload, X } from 'lucide-react';
import {
  loadCharacterLibrary,
  matchesQuery,
  toCastEntry,
  type CastEntry,
  type CharacterEntry,
  type CharacterSource,
} from '@/lib/characters/manifest';

type Tab = 'library' | 'integrations' | 'upload' | 'generate';

const TABS: { id: Tab; label: string; icon?: ReactElement }[] = [
  { id: 'library', label: 'Library' },
  { id: 'integrations', label: 'Integrations' },
  {
    id: 'upload',
    label: 'Upload',
    icon: <Upload className="h-3.5 w-3.5" aria-hidden />,
  },
  {
    id: 'generate',
    label: 'AI Generate',
    icon: <Sparkles className="h-3.5 w-3.5" aria-hidden />,
  },
];

export interface CastDrawerProps {
  open: boolean;
  onClose: () => void;
  cast: CastEntry[];
  onChange: (cast: CastEntry[]) => void;
  /** Override for tests / Storybook. */
  loadLibrary?: typeof loadCharacterLibrary;
}

export function CastDrawer({
  open,
  onClose,
  cast,
  onChange,
  loadLibrary = loadCharacterLibrary,
}: CastDrawerProps) {
  const [tab, setTab] = useState<Tab>('library');
  const [query, setQuery] = useState('');
  const [library, setLibrary] = useState<CharacterEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  // Lazy-load the library the first time the drawer opens so we
  // don't add a network request to the initial home-page paint.
  useEffect(() => {
    if (!open || loaded) return;
    let cancelled = false;
    loadLibrary().then((entries) => {
      if (cancelled) return;
      setLibrary(entries);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open, loaded, loadLibrary]);

  // Esc to close. Bound globally because the overlay covers the
  // viewport but the focused element may live anywhere inside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Focus the dialog on open so screen readers + keyboard users
  // land in the panel rather than the page underneath.
  useEffect(() => {
    if (open) {
      dialogRef.current?.focus();
    }
  }, [open]);

  const filtered = useMemo(() => {
    const source: CharacterSource | null =
      tab === 'library' ? 'characters' : tab === 'integrations' ? 'integrations' : null;
    if (!source) return [];
    return library.filter(
      (entry) => entry.source === source && matchesQuery(entry, query),
    );
  }, [library, tab, query]);

  const isCast = (id: string) => cast.some((c) => c.id === id);

  const toggle = (entry: CharacterEntry) => {
    if (isCast(entry.id)) {
      onChange(cast.filter((c) => c.id !== entry.id));
    } else {
      onChange([...cast, toCastEntry(entry)]);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cast-drawer-title"
    >
      {/* Backdrop. */}
      <button
        type="button"
        aria-label="Close cast drawer"
        onClick={onClose}
        className="absolute inset-0 bg-primary-900/40 backdrop-blur-sm"
      />

      {/* Panel. */}
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-border bg-bg-primary shadow-lift outline-none"
      >
        <header className="flex items-center justify-between border-b border-border-light px-5 py-4">
          <div>
            <h2 id="cast-drawer-title" className="text-base font-semibold text-text-primary">
              Cast library
            </h2>
            <p className="text-xs text-text-secondary">
              Add a character, mascot, or tool logo. Reference it from your prompt by name.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-md text-text-secondary transition hover:bg-bg-secondary hover:text-text-primary"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        {/* Tabs. */}
        <div className="flex gap-1 border-b border-border-light px-3" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition ${
                tab === t.id
                  ? 'border-accent-500 text-text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Search + content. Library / Integrations get the grid;
            Upload / Generate show their stub panels. */}
        {tab === 'library' || tab === 'integrations' ? (
          <>
            <div className="border-b border-border-light px-5 py-3">
              <label className="relative block">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
                  aria-hidden
                />
                <input
                  type="search"
                  placeholder={
                    tab === 'library'
                      ? 'Search characters, mascots, icons…'
                      : 'Search tools…'
                  }
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full rounded-md border border-border bg-bg-secondary py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30"
                  aria-label="Filter cast library"
                />
              </label>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {!loaded && (
                <p className="text-sm text-text-tertiary">Loading library…</p>
              )}
              {loaded && filtered.length === 0 && (
                <p className="text-sm text-text-tertiary">
                  Nothing matches “{query}”.
                </p>
              )}
              <ul className="grid grid-cols-2 gap-3">
                {filtered.map((entry) => (
                  <li key={entry.id}>
                    <LibraryCard
                      entry={entry}
                      active={isCast(entry.id)}
                      onToggle={() => toggle(entry)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <ComingSoon kind={tab} />
        )}
      </div>
    </div>
  );
}

function LibraryCard({
  entry,
  active,
  onToggle,
}: {
  entry: CharacterEntry;
  active: boolean;
  onToggle: () => void;
}) {
  const accent = entry.accent_hex ?? 'var(--color-accent-500)';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={`group flex w-full flex-col items-start gap-2 rounded-lg border bg-bg-secondary p-3 text-left transition hover:border-accent-500 ${
        active
          ? 'border-accent-500 ring-2 ring-accent-500/30'
          : 'border-border'
      }`}
      data-testid={`cast-card-${entry.id}`}
    >
      <div
        aria-hidden
        className="grid h-12 w-12 place-items-center rounded-md text-base font-bold text-white"
        style={{ backgroundColor: accent }}
      >
        {entry.name
          .replace(/[^a-zA-Z0-9 \-]/g, '')
          .split(/[ \-]+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((p) => p[0]?.toUpperCase() ?? '')
          .join('')}
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-text-primary">{entry.name}</span>
        <span className="text-2xs uppercase tracking-wider text-text-tertiary">
          {entry.archetype}
        </span>
      </div>
      <span className="mt-auto text-2xs font-semibold uppercase tracking-wide text-accent-600">
        {active ? 'In cast' : 'Add to cast'}
      </span>
    </button>
  );
}

function ComingSoon({ kind }: { kind: 'upload' | 'generate' }) {
  const copy =
    kind === 'upload'
      ? {
          title: 'Upload coming soon',
          body: 'Drag-and-drop a Lottie JSON or SVG to register it as a custom character. Available in the next release.',
          icon: <Upload className="h-6 w-6" aria-hidden />,
        }
      : {
          title: 'AI Generate coming soon',
          body: 'Describe a character in plain English and we will sketch a sprite that matches your brand palette.',
          icon: <Sparkles className="h-6 w-6" aria-hidden />,
        };
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-accent-100 text-accent-700">
        {copy.icon}
      </span>
      <h3 className="text-sm font-semibold text-text-primary">{copy.title}</h3>
      <p className="max-w-xs text-xs text-text-secondary">{copy.body}</p>
    </div>
  );
}
