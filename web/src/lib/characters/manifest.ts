/**
 * Character / integration manifest types + loader.
 *
 * The engine ships hand-authored sprites under `engine/themes/`. A
 * `prebuild` script copies that tree into `web/public/themes/` so
 * the manifests can be fetched as static JSON from the browser at
 * runtime. The shape here mirrors `motion_forge_prompt_orchestrator::
 * characters::CharacterManifestEntry` in the Rust engine.
 */

export type CharacterArchetype =
  | 'Person'
  | 'Mascot'
  | 'Logo'
  | 'ProductIcon'
  | 'Icon'
  | 'Abstract';

export type CharacterFormat = 'lottie' | 'svg' | 'generative';

/** Optional staging hints. Mirrors the Rust `BehavioralDefaults`. */
export interface CharacterDefaults {
  enter_from?: 'left' | 'right' | 'top' | 'bottom' | 'center';
  scale?: number;
  speaks?: boolean;
}

/** Single entry in a manifest file. `file` is resolved against the
 *  manifest's own URL (so `themes/characters/manifest.json` →
 *  `themes/characters/alex.json`). */
export interface CharacterManifestEntry {
  id: string;
  name: string;
  archetype: CharacterArchetype;
  file: string;
  format: CharacterFormat;
  defaults?: CharacterDefaults;
  accent_hex?: string;
  tags?: string[];
}

export interface CharacterManifest {
  characters: CharacterManifestEntry[];
}

/** "Source" tag used by the UI to render different chips / labels
 *  for the character library vs the third-party-tool library. */
export type CharacterSource = 'characters' | 'integrations';

export interface CharacterEntry extends CharacterManifestEntry {
  /** Where this entry lives — drives chip styling / drawer tab. */
  source: CharacterSource;
  /** Fully-resolved URL for the asset (lottie JSON or svg markup). */
  assetUrl: string;
}

export interface CastEntry {
  /** Stable id matching `CharacterEntry.id`. */
  id: string;
  /** Display name copied at the moment the entry was added; lets the
   *  chip render without re-fetching the manifest. */
  name: string;
  /** Source tag — used for chip styling. */
  source: CharacterSource;
  /** Optional brand accent for the chip. */
  accent_hex?: string;
  /** Optional named pose for the future pose library. */
  pose?: string;
}

/** Default manifest URLs. Overridable by tests / Storybook. */
export const DEFAULT_MANIFEST_URLS = {
  characters: '/themes/characters/manifest.json',
  integrations: '/themes/integrations/manifest.json',
} as const;

/** Fetch one manifest + resolve every entry's `file` to a full URL. */
async function fetchOne(
  url: string,
  source: CharacterSource,
  fetcher: typeof fetch = fetch,
): Promise<CharacterEntry[]> {
  const res = await fetcher(url, { cache: 'force-cache' });
  if (!res.ok) {
    throw new Error(`character manifest ${url} failed: ${res.status}`);
  }
  const body = (await res.json()) as CharacterManifest;
  if (!Array.isArray(body.characters)) {
    throw new Error(`character manifest ${url} missing "characters" array`);
  }
  // Resolve `file` against the manifest's own directory.
  const base = url.replace(/manifest\.json$/, '');
  return body.characters.map((entry) => ({
    ...entry,
    source,
    assetUrl: entry.format === 'generative' ? '' : `${base}${entry.file}`,
  }));
}

/** Load both shipped manifests (characters + integrations) and merge.
 *  Returns an empty array on failure so the chip-row can still mount
 *  even if a manifest is missing (e.g. dev server without prebuild
 *  run). The error is logged once. */
export async function loadCharacterLibrary(
  opts: { fetcher?: typeof fetch; urls?: typeof DEFAULT_MANIFEST_URLS } = {},
): Promise<CharacterEntry[]> {
  const urls = opts.urls ?? DEFAULT_MANIFEST_URLS;
  const fetcher = opts.fetcher ?? fetch;
  try {
    const [chars, integrations] = await Promise.all([
      fetchOne(urls.characters, 'characters', fetcher),
      fetchOne(urls.integrations, 'integrations', fetcher),
    ]);
    return [...chars, ...integrations];
  } catch (err) {
    // Surface to the console exactly once; UI degrades gracefully.
    // eslint-disable-next-line no-console
    console.warn('[characters] failed to load manifests', err);
    return [];
  }
}

/** Match an entry against a free-text query (name, id, tag). Used by
 *  the drawer search box. */
export function matchesQuery(entry: CharacterEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (entry.id.toLowerCase().includes(q)) return true;
  if (entry.name.toLowerCase().includes(q)) return true;
  if (entry.tags?.some((tag) => tag.toLowerCase().includes(q))) return true;
  return false;
}

/** Project a `CharacterEntry` down to a `CastEntry` for the chip row. */
export function toCastEntry(entry: CharacterEntry): CastEntry {
  return {
    id: entry.id,
    name: entry.name,
    source: entry.source,
    accent_hex: entry.accent_hex,
  };
}
