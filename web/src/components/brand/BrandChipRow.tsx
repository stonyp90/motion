"use client";

import { useMemo } from "react";
import type { BrandIdentity } from "./types";

/**
 * A compact at-a-glance summary of the active brand identity.
 * Renders 4 color dots, the font family, and the primary logo
 * thumbnail. Clicking anywhere opens the BrandIdentityPanel drawer.
 *
 * Slot this between the home <h1> and PromptInput so users see
 * which brand they're generating against before they type.
 *
 * Styling: 100% token-driven. No hex literals in this file.
 * Tokens consumed (defined in app/globals.css):
 *   --color-surface, --color-surface-muted, --color-border,
 *   --color-text, --color-text-muted, --radius-pill, --radius-sm,
 *   --space-1, --space-2, --space-3, --shadow-1
 */
export interface BrandChipRowProps {
  identity?: BrandIdentity | null;
  /** Called when the user clicks the chip — host opens the drawer. */
  onOpen: () => void;
  /** Optional className escape hatch for layout. */
  className?: string;
}

export function BrandChipRow({ identity, onOpen, className }: BrandChipRowProps) {
  const dots = useMemo(() => (identity?.palette ?? []).slice(0, 4), [identity]);
  const primaryLogo = useMemo(
    () =>
      identity?.logos.find(l => l.role === "primary-logo") ??
      identity?.logos[0] ??
      null,
    [identity],
  );

  if (!identity || identity.palette.length === 0) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className={`mf-brand-chip mf-brand-chip--empty ${className ?? ""}`}
        aria-label="Set up brand identity"
      >
        <span className="mf-brand-chip__plus" aria-hidden>+</span>
        <span className="mf-brand-chip__label">Add brand identity</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`mf-brand-chip ${className ?? ""}`}
      aria-label={`Brand: ${identity.name}. Click to edit.`}
    >
      {primaryLogo ? (
        <img
          src={primaryLogo.file_url}
          alt=""
          className="mf-brand-chip__logo"
          loading="lazy"
        />
      ) : (
        <span className="mf-brand-chip__logo mf-brand-chip__logo--ghost" aria-hidden />
      )}

      <span className="mf-brand-chip__name">{identity.name || "Untitled brand"}</span>

      <span className="mf-brand-chip__dots" aria-hidden>
        {dots.map((c, i) => (
          <span
            key={`${c.role}-${i}`}
            className="mf-brand-chip__dot"
            style={{ background: c.hex }}
            title={`${c.role}: ${c.hex}`}
          />
        ))}
      </span>

      <span className="mf-brand-chip__divider" aria-hidden />

      <span className="mf-brand-chip__font" style={{ fontFamily: identity.font.family }}>
        {identity.font.family}
      </span>

      {identity.syncedAt ? null : (
        <span
          className="mf-brand-chip__badge"
          title="Saved locally — will sync when online"
        >
          local
        </span>
      )}
    </button>
  );
}

/**
 * Companion stylesheet. Import once at the app root (or inline in
 * globals.css). Kept here so this component is drop-in.
 *
 * NOTE: All colors reference tokens. The dot backgrounds are the
 * only inline style because they're inherently dynamic (per-brand).
 */
export const BRAND_CHIP_CSS = `
.mf-brand-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-pill);
  color: var(--color-text);
  font: inherit;
  cursor: pointer;
  box-shadow: var(--shadow-1);
  transition: background 120ms ease, border-color 120ms ease;
}
.mf-brand-chip:hover { background: var(--color-surface-muted); }
.mf-brand-chip:focus-visible {
  outline: 2px solid var(--color-focus);
  outline-offset: 2px;
}
.mf-brand-chip--empty { color: var(--color-text-muted); }
.mf-brand-chip__plus { font-size: 1.1em; line-height: 1; }
.mf-brand-chip__logo {
  width: 20px; height: 20px;
  border-radius: var(--radius-sm);
  object-fit: contain;
  background: var(--color-surface-muted);
}
.mf-brand-chip__logo--ghost { background: var(--color-surface-muted); }
.mf-brand-chip__name { font-weight: 500; }
.mf-brand-chip__dots { display: inline-flex; gap: 2px; }
.mf-brand-chip__dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  border: 1px solid var(--color-border);
}
.mf-brand-chip__divider {
  width: 1px; height: 14px;
  background: var(--color-border);
}
.mf-brand-chip__font { color: var(--color-text-muted); font-size: 0.875em; }
.mf-brand-chip__badge {
  font-size: 0.7em;
  padding: 0 var(--space-1);
  border-radius: var(--radius-sm);
  background: var(--color-surface-muted);
  color: var(--color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
`;
