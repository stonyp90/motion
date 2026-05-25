"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  EMPTY_BRAND_IDENTITY,
  brandStorageKey,
  type BrandIdentity,
  type ColorRole,
  type ColorRoleName,
  type FontChoice,
  type FontSource,
  type LogoAsset,
  type LogoRole,
} from "./types";
import { extractPalette } from "./extractPalette";

/**
 * Slide-over panel where a tenant feeds their brand into motion-forge.
 * Mirrors the ControlsDrawer pattern (right-aligned, focus-trapped,
 * Esc closes, click-outside closes).
 *
 * Save flow:
 *   1. Always writes localStorage (`mf-brand-{projectId}`) — offline-first.
 *   2. Then POSTs to /v1/brand. If POST fails, the local copy stays
 *      and a "local" badge appears on BrandChipRow.
 *
 * Trademark guard:
 *   The Logos tab exposes a "Locked (trademarked)" checkbox per asset.
 *   When checked, that logo and any palette color sampled from it carry
 *   `locked: true` so the orchestrator's clamp pass refuses to recolor.
 */

export interface BrandIdentityPanelProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** Initial value — typically loaded from localStorage at app boot. */
  initial?: BrandIdentity | null;
  /** Called after save (both local and POST). */
  onSaved?: (identity: BrandIdentity) => void;
  /**
   * Optional override of the POST endpoint. Defaults to "/v1/brand".
   * Useful for tests or staging.
   */
  endpoint?: string;
}

type Tab = "palette" | "typography" | "logos" | "voice";

const TABS: { id: Tab; label: string }[] = [
  { id: "palette", label: "Palette" },
  { id: "typography", label: "Typography" },
  { id: "logos", label: "Logos" },
  { id: "voice", label: "Voice" },
];

/** Top-50 Google Fonts shortlist — keeps the typography picker fast. */
const GOOGLE_FONTS_TOP = [
  "Inter", "Roboto", "Open Sans", "Lato", "Montserrat", "Poppins",
  "Source Sans 3", "Raleway", "Nunito", "Playfair Display", "Merriweather",
  "PT Sans", "Ubuntu", "Mulish", "Work Sans", "Rubik", "DM Sans", "IBM Plex Sans",
  "Manrope", "Karla", "Fira Sans", "Space Grotesk", "Bebas Neue", "Oswald",
  "Quicksand", "Noto Sans", "Cabin", "Crimson Text", "Lora", "Libre Franklin",
  "Archivo", "Barlow", "Hind", "Heebo", "Asap", "PT Serif", "Josefin Sans",
  "Dosis", "Anton", "Titillium Web", "Exo 2", "Fjalla One", "Yanone Kaffeesatz",
  "Pacifico", "Comfortaa", "Vollkorn", "Catamaran", "Sora", "Plus Jakarta Sans",
  "Outfit",
];

const ADOBE_FONTS_SAFE = [
  "Proxima Nova", "Brandon Grotesque", "Adelle", "Freight Sans", "Acumin Pro",
  "Aktiv Grotesk", "Bree", "Korolev",
];

export function BrandIdentityPanel({
  open,
  onClose,
  projectId,
  initial,
  onSaved,
  endpoint = "/v1/brand",
}: BrandIdentityPanelProps) {
  const [tab, setTab] = useState<Tab>("palette");
  const [identity, setIdentity] = useState<BrandIdentity>(
    () => initial ?? EMPTY_BRAND_IDENTITY(projectId),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const headingId = useId();

  // Re-seed if projectId changes
  useEffect(() => {
    setIdentity(initial ?? EMPTY_BRAND_IDENTITY(projectId));
  }, [projectId, initial]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const patch = useCallback((p: Partial<BrandIdentity>) => {
    setIdentity(prev => ({ ...prev, ...p, updatedAt: new Date().toISOString() }));
  }, []);

  const onSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    const toSave: BrandIdentity = {
      ...identity,
      updatedAt: new Date().toISOString(),
    };
    // 1. localStorage first — offline-safe
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(
          brandStorageKey(projectId),
          JSON.stringify(toSave),
        );
      }
    } catch (err) {
      // Quota or private-mode — surface but don't abort sync
      console.warn("[BrandIdentityPanel] localStorage failed:", err);
    }
    // 2. Sync to engine
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSave),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toSave.syncedAt = new Date().toISOString();
      try {
        window.localStorage.setItem(
          brandStorageKey(projectId),
          JSON.stringify(toSave),
        );
      } catch {/* noop */}
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? `Saved locally. Sync failed: ${err.message}`
          : "Saved locally. Sync failed.",
      );
    }
    setIdentity(toSave);
    onSaved?.(toSave);
    setSaving(false);
  }, [identity, projectId, endpoint, onSaved]);

  if (!open) return null;

  return (
    <div
      className="mf-brand-overlay"
      role="presentation"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={drawerRef}
        className="mf-brand-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
      >
        <header className="mf-brand-drawer__header">
          <h2 id={headingId} className="mf-brand-drawer__title">
            Brand identity
          </h2>
          <input
            className="mf-brand-drawer__name"
            type="text"
            placeholder="Brand name (e.g. Chrono Innovation)"
            value={identity.name}
            onChange={e => patch({ name: e.target.value })}
            aria-label="Brand name"
          />
          <button
            type="button"
            className="mf-brand-drawer__close"
            onClick={onClose}
            aria-label="Close brand panel"
          >
            ×
          </button>
        </header>

        <nav className="mf-brand-tabs" role="tablist">
          {TABS.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`mf-brand-tab ${tab === t.id ? "is-active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="mf-brand-body">
          {tab === "palette" && (
            <PaletteTab
              palette={identity.palette}
              logos={identity.logos}
              onChange={palette => patch({ palette })}
            />
          )}
          {tab === "typography" && (
            <TypographyTab
              font={identity.font}
              onChange={font => patch({ font })}
            />
          )}
          {tab === "logos" && (
            <LogosTab
              logos={identity.logos}
              onChange={logos => patch({ logos })}
            />
          )}
          {tab === "voice" && (
            <VoiceTab
              voice={identity.voice}
              onChange={voice => patch({ voice })}
            />
          )}
        </div>

        <footer className="mf-brand-drawer__footer">
          {saveError && <span className="mf-brand-error">{saveError}</span>}
          {identity.syncedAt && !saveError && (
            <span className="mf-brand-status">
              Synced {new Date(identity.syncedAt).toLocaleTimeString()}
            </span>
          )}
          <button
            type="button"
            className="mf-btn mf-btn--ghost"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="mf-btn mf-btn--primary"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save brand"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Palette tab                                                         */
/* ------------------------------------------------------------------ */

const ROLE_LABELS: Record<ColorRoleName, string> = {
  primary: "Primary",
  accent: "Accent",
  "neutral-text": "Text",
  "neutral-bg": "Background",
  emphasis: "Emphasis",
};

function PaletteTab({
  palette,
  logos,
  onChange,
}: {
  palette: ColorRole[];
  logos: LogoAsset[];
  onChange: (next: ColorRole[]) => void;
}) {
  const [extracting, setExtracting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const update = (i: number, p: Partial<ColorRole>) => {
    onChange(palette.map((c, idx) => (idx === i ? { ...c, ...p } : c)));
  };

  const onExtractClick = () => {
    // Prefer the primary logo if uploaded; otherwise prompt for a file.
    const primary = logos.find(l => l.role === "primary-logo") ?? logos[0];
    if (primary && primary.file_url.startsWith("blob:")) {
      // We don't have a File handle from a blob URL after the fact —
      // ask the user to re-pick. The host can wire a more sophisticated
      // path that keeps the File around.
      fileInputRef.current?.click();
    } else {
      fileInputRef.current?.click();
    }
  };

  const onExtractFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setExtracting(true);
    try {
      const hexes = await extractPalette(file, 5);
      if (hexes.length === 0) return;
      // Map dominant colors onto the existing role slots in order.
      const next = palette.map((row, i) =>
        hexes[i] ? { ...row, hex: hexes[i] } : row,
      );
      onChange(next);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="mf-brand-tabpanel" role="tabpanel">
      <div className="mf-brand-tabpanel__head">
        <p className="mf-brand-help">
          Five role slots. Emphasis colors use the 16.6% weight model:
          each occupies roughly one-sixth of any composition.
        </p>
        <button
          type="button"
          className="mf-btn mf-btn--ghost"
          onClick={onExtractClick}
          disabled={extracting}
        >
          {extracting ? "Extracting…" : "Extract from logo"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={onExtractFile}
        />
      </div>

      <ul className="mf-brand-palette">
        {palette.map((c, i) => (
          <li key={`${c.role}-${i}`} className="mf-brand-palette__row">
            <span className="mf-brand-palette__role">{ROLE_LABELS[c.role]}</span>
            <input
              type="color"
              className="mf-brand-palette__picker"
              value={c.hex}
              onChange={e => update(i, { hex: e.target.value })}
              aria-label={`${ROLE_LABELS[c.role]} color picker`}
            />
            <input
              type="text"
              className="mf-brand-palette__hex"
              value={c.hex}
              onChange={e => update(i, { hex: e.target.value })}
              maxLength={7}
              pattern="^#[0-9a-fA-F]{6}$"
              aria-label={`${ROLE_LABELS[c.role]} hex value`}
            />
            {c.role === "emphasis" && (
              <label className="mf-brand-palette__weight">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={0.1}
                  value={c.weight ?? 16.6}
                  onChange={e =>
                    update(i, { weight: Number(e.target.value) })
                  }
                  aria-label={`${ROLE_LABELS[c.role]} weight percent`}
                />
                <span>{(c.weight ?? 16.6).toFixed(1)}%</span>
              </label>
            )}
            <label className="mf-brand-palette__lock">
              <input
                type="checkbox"
                checked={!!c.locked}
                onChange={e => update(i, { locked: e.target.checked })}
              />
              <span>Locked</span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Typography tab                                                      */
/* ------------------------------------------------------------------ */

function TypographyTab({
  font,
  onChange,
}: {
  font: FontChoice;
  onChange: (next: FontChoice) => void;
}) {
  const [query, setQuery] = useState("");

  const allFonts = useMemo(
    () => [
      ...GOOGLE_FONTS_TOP.map(f => ({ family: f, source: "google" as const })),
      ...ADOBE_FONTS_SAFE.map(f => ({ family: f, source: "adobe" as const })),
    ],
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allFonts.slice(0, 20);
    return allFonts.filter(f => f.family.toLowerCase().includes(q)).slice(0, 30);
  }, [allFonts, query]);

  const setSource = (source: FontSource) => {
    onChange({ ...font, source });
  };

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    onChange({
      family: file.name.replace(/\.(woff2?|ttf|otf)$/i, ""),
      source: "upload",
      href: url,
      fallback: font.fallback ?? "sans-serif",
    });
  };

  return (
    <div className="mf-brand-tabpanel" role="tabpanel">
      <fieldset className="mf-brand-radio-row">
        <legend className="mf-brand-help">Source</legend>
        {(["system", "google", "adobe", "upload"] as FontSource[]).map(s => (
          <label key={s} className="mf-brand-radio">
            <input
              type="radio"
              name="font-source"
              checked={font.source === s}
              onChange={() => setSource(s)}
            />
            <span>{s}</span>
          </label>
        ))}
      </fieldset>

      {font.source === "upload" ? (
        <label className="mf-brand-upload">
          Upload .woff2
          <input
            type="file"
            accept=".woff2,.woff,.ttf,.otf"
            onChange={onUpload}
          />
          {font.family && <span>Active: {font.family}</span>}
        </label>
      ) : font.source === "system" ? (
        <input
          type="text"
          className="mf-brand-input"
          placeholder="System family (e.g. -apple-system, Segoe UI)"
          value={font.family}
          onChange={e => onChange({ ...font, family: e.target.value })}
        />
      ) : (
        <>
          <input
            type="search"
            className="mf-brand-input"
            placeholder="Search fonts…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <ul className="mf-brand-fontlist">
            {filtered.map(f => (
              <li key={`${f.source}-${f.family}`}>
                <button
                  type="button"
                  className={`mf-brand-fontitem ${font.family === f.family ? "is-active" : ""}`}
                  style={{ fontFamily: f.family }}
                  onClick={() =>
                    onChange({
                      family: f.family,
                      source: f.source,
                      href:
                        f.source === "google"
                          ? `https://fonts.googleapis.com/css2?family=${encodeURIComponent(f.family)}&display=swap`
                          : undefined,
                      fallback: font.fallback ?? "sans-serif",
                    })
                  }
                >
                  {f.family}
                  <span className="mf-brand-fontitem__source">{f.source}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <label className="mf-brand-field">
        Fallback stack
        <input
          type="text"
          className="mf-brand-input"
          value={font.fallback ?? ""}
          onChange={e => onChange({ ...font, fallback: e.target.value })}
          placeholder="Inter, system-ui, sans-serif"
        />
      </label>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Logos tab                                                           */
/* ------------------------------------------------------------------ */

const LOGO_ROLES: LogoRole[] = ["primary-logo", "mascot", "product-icon", "other"];

function LogosTab({
  logos,
  onChange,
}: {
  logos: LogoAsset[];
  onChange: (next: LogoAsset[]) => void;
}) {
  const [dragOver, setDragOver] = useState(false);

  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next: LogoAsset[] = [...logos];
    for (const file of Array.from(files)) {
      next.push({
        id: `logo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        file_url: URL.createObjectURL(file),
        role: next.length === 0 ? "primary-logo" : "other",
        mime: file.type,
        locked: false,
      });
    }
    onChange(next);
  };

  const update = (i: number, p: Partial<LogoAsset>) =>
    onChange(logos.map((l, idx) => (idx === i ? { ...l, ...p } : l)));

  const remove = (i: number) =>
    onChange(logos.filter((_, idx) => idx !== i));

  return (
    <div className="mf-brand-tabpanel" role="tabpanel">
      <div
        className={`mf-brand-dropzone ${dragOver ? "is-over" : ""}`}
        onDragOver={e => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <p>Drag logos here, or</p>
        <label className="mf-btn mf-btn--ghost">
          Choose files
          <input
            type="file"
            accept="image/*,.svg"
            multiple
            hidden
            onChange={e => addFiles(e.target.files)}
          />
        </label>
      </div>

      <ul className="mf-brand-logos">
        {logos.map((l, i) => (
          <li key={l.id} className="mf-brand-logos__row">
            <img src={l.file_url} alt={l.name} className="mf-brand-logos__thumb" />
            <input
              type="text"
              className="mf-brand-input"
              value={l.name}
              onChange={e => update(i, { name: e.target.value })}
            />
            <select
              className="mf-brand-input"
              value={l.role}
              onChange={e => update(i, { role: e.target.value as LogoRole })}
            >
              {LOGO_ROLES.map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <label className="mf-brand-palette__lock">
              <input
                type="checkbox"
                checked={!!l.locked}
                onChange={e => update(i, { locked: e.target.checked })}
              />
              <span>Trademarked</span>
            </label>
            <button
              type="button"
              className="mf-btn mf-btn--ghost"
              onClick={() => remove(i)}
              aria-label={`Remove ${l.name}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Voice tab                                                           */
/* ------------------------------------------------------------------ */

function VoiceTab({
  voice,
  onChange,
}: {
  voice: { adjectives: string[]; avoid: string[] };
  onChange: (next: { adjectives: string[]; avoid: string[] }) => void;
}) {
  return (
    <div className="mf-brand-tabpanel" role="tabpanel">
      <ChipInput
        label="Tone adjectives (3–5)"
        help="Words that describe the brand. e.g. calm, technical, efficient."
        values={voice.adjectives}
        onChange={adjectives => onChange({ ...voice, adjectives })}
        max={5}
      />
      <ChipInput
        label="Avoid (3–5)"
        help="Tones to steer clear of. e.g. playful, loud, casual."
        values={voice.avoid}
        onChange={avoid => onChange({ ...voice, avoid })}
        max={5}
      />
    </div>
  );
}

function ChipInput({
  label,
  help,
  values,
  onChange,
  max,
}: {
  label: string;
  help?: string;
  values: string[];
  onChange: (next: string[]) => void;
  max: number;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const v = draft.trim();
    if (!v || values.includes(v) || values.length >= max) return;
    onChange([...values, v]);
    setDraft("");
  };

  return (
    <div className="mf-brand-field">
      <label>{label}</label>
      {help && <p className="mf-brand-help">{help}</p>}
      <div className="mf-brand-chiplist">
        {values.map(v => (
          <span key={v} className="mf-brand-pill">
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter(x => x !== v))}
            >
              ×
            </button>
          </span>
        ))}
        {values.length < max && (
          <input
            type="text"
            className="mf-brand-input mf-brand-input--inline"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                commit();
              } else if (e.key === "Backspace" && !draft && values.length) {
                onChange(values.slice(0, -1));
              }
            }}
            onBlur={commit}
            placeholder="Type and press Enter"
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Companion CSS — import once at the app root.                        */
/* ------------------------------------------------------------------ */

export const BRAND_PANEL_CSS = `
.mf-brand-overlay {
  position: fixed; inset: 0;
  background: var(--color-overlay, rgba(0,0,0,0.45));
  display: flex; justify-content: flex-end;
  z-index: 60;
}
.mf-brand-drawer {
  width: min(540px, 100%);
  height: 100%;
  background: var(--color-surface);
  color: var(--color-text);
  display: flex; flex-direction: column;
  box-shadow: var(--shadow-3);
  border-left: 1px solid var(--color-border);
}
.mf-brand-drawer__header {
  display: flex; align-items: center; gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--color-border);
}
.mf-brand-drawer__title { font-size: 1.125rem; font-weight: 600; margin: 0; flex-shrink: 0; }
.mf-brand-drawer__name {
  flex: 1;
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
  color: inherit;
}
.mf-brand-drawer__close {
  background: transparent; border: none; color: var(--color-text-muted);
  font-size: 1.5rem; line-height: 1; cursor: pointer; padding: 0 var(--space-1);
}
.mf-brand-tabs {
  display: flex; gap: var(--space-1);
  padding: var(--space-2) var(--space-4) 0;
  border-bottom: 1px solid var(--color-border);
}
.mf-brand-tab {
  background: transparent; border: none;
  padding: var(--space-2) var(--space-3);
  color: var(--color-text-muted); cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.mf-brand-tab.is-active {
  color: var(--color-text);
  border-bottom-color: var(--color-accent, var(--color-text));
}
.mf-brand-body { flex: 1; overflow-y: auto; padding: var(--space-4); }
.mf-brand-tabpanel { display: flex; flex-direction: column; gap: var(--space-3); }
.mf-brand-tabpanel__head { display: flex; gap: var(--space-2); align-items: center; }
.mf-brand-help { color: var(--color-text-muted); font-size: 0.875rem; margin: 0; flex: 1; }

.mf-brand-palette { list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: var(--space-2); }
.mf-brand-palette__row {
  display: grid;
  grid-template-columns: 90px 36px 100px 1fr auto;
  align-items: center; gap: var(--space-2);
}
.mf-brand-palette__role { color: var(--color-text-muted); font-size: 0.875rem; }
.mf-brand-palette__picker {
  width: 36px; height: 36px; padding: 0; border: 1px solid var(--color-border);
  border-radius: var(--radius-sm); background: transparent; cursor: pointer;
}
.mf-brand-palette__hex {
  font-family: var(--font-mono, ui-monospace, monospace);
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border); border-radius: var(--radius-sm);
  background: var(--color-surface-muted); color: inherit;
}
.mf-brand-palette__weight {
  display: flex; align-items: center; gap: var(--space-1);
  color: var(--color-text-muted); font-size: 0.875rem;
}
.mf-brand-palette__weight input { flex: 1; }
.mf-brand-palette__lock {
  display: inline-flex; align-items: center; gap: 4px;
  color: var(--color-text-muted); font-size: 0.75rem;
}

.mf-brand-radio-row {
  border: 0; padding: 0; margin: 0;
  display: flex; gap: var(--space-3); align-items: center;
}
.mf-brand-radio { display: inline-flex; align-items: center; gap: 4px; text-transform: capitalize; }
.mf-brand-input {
  width: 100%;
  padding: var(--space-1) var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
  color: inherit;
}
.mf-brand-input--inline { width: auto; min-width: 120px; flex: 1; }
.mf-brand-field { display: flex; flex-direction: column; gap: 4px; }
.mf-brand-upload { display: flex; flex-direction: column; gap: 4px; color: var(--color-text-muted); }
.mf-brand-fontlist {
  list-style: none; padding: 0; margin: 0;
  max-height: 260px; overflow-y: auto;
  border: 1px solid var(--color-border); border-radius: var(--radius-sm);
}
.mf-brand-fontitem {
  display: flex; justify-content: space-between; align-items: center;
  width: 100%; padding: var(--space-2) var(--space-3);
  background: transparent; border: 0; border-bottom: 1px solid var(--color-border);
  cursor: pointer; color: inherit; text-align: left;
}
.mf-brand-fontitem:last-child { border-bottom: 0; }
.mf-brand-fontitem.is-active { background: var(--color-surface-muted); }
.mf-brand-fontitem__source { color: var(--color-text-muted); font-size: 0.75rem; text-transform: uppercase; }

.mf-brand-dropzone {
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  text-align: center; color: var(--color-text-muted);
  display: flex; flex-direction: column; gap: var(--space-2); align-items: center;
}
.mf-brand-dropzone.is-over { border-color: var(--color-accent, var(--color-text)); }
.mf-brand-logos { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }
.mf-brand-logos__row {
  display: grid;
  grid-template-columns: 48px 1fr 150px auto auto;
  align-items: center; gap: var(--space-2);
}
.mf-brand-logos__thumb {
  width: 48px; height: 48px; object-fit: contain;
  border-radius: var(--radius-sm); background: var(--color-surface-muted);
}

.mf-brand-chiplist { display: flex; flex-wrap: wrap; gap: var(--space-1); align-items: center; }
.mf-brand-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px var(--space-2);
  background: var(--color-surface-muted);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  font-size: 0.875rem;
}
.mf-brand-pill button {
  background: transparent; border: 0; cursor: pointer; color: var(--color-text-muted);
  font-size: 1rem; line-height: 1;
}

.mf-brand-drawer__footer {
  display: flex; gap: var(--space-2); justify-content: flex-end; align-items: center;
  padding: var(--space-3) var(--space-4);
  border-top: 1px solid var(--color-border);
}
.mf-brand-error { color: var(--color-danger, var(--color-text)); font-size: 0.875rem; margin-right: auto; }
.mf-brand-status { color: var(--color-text-muted); font-size: 0.75rem; margin-right: auto; }

.mf-btn {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-sm);
  border: 1px solid var(--color-border);
  cursor: pointer;
  background: var(--color-surface);
  color: inherit;
}
.mf-btn--primary {
  background: var(--color-accent, var(--color-text));
  color: var(--color-on-accent, var(--color-surface));
  border-color: transparent;
}
.mf-btn--primary:disabled { opacity: 0.6; cursor: not-allowed; }
.mf-btn--ghost { background: transparent; }
`;
