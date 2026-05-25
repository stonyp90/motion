/**
 * Brand Identity types — the contract a B2B tenant uses to feed
 * motion-forge their brand. Mirrors the StyleCard struct on the
 * engine side (engine/crates/style-extract/src/lib.rs) so the
 * adapter layer can map 1:1.
 */

export type ColorRoleName =
  | "primary"
  | "accent"
  | "neutral-text"
  | "neutral-bg"
  | "emphasis";

export interface ColorRole {
  /** Semantic role this color plays in the brand system. */
  role: ColorRoleName;
  /** Hex value, lowercased, with leading '#'. e.g. "#10b981". */
  hex: string;
  /**
   * Visual weight (0–100). Chrono's "16.6%" model: three emphasis
   * colors that should each occupy ~16.6% of any composition.
   * Optional — only required for role === "emphasis".
   */
  weight?: number;
  /** Human label shown in the chip / picker. Optional. */
  label?: string;
  /**
   * If true, this color came from a trademarked logo asset
   * (Slack, Teams, Excel, Salesforce, etc.) and motion-forge
   * MUST NOT recolor it. Used by the orchestrator's clamp pass.
   */
  locked?: boolean;
}

export type FontSource = "system" | "google" | "adobe" | "upload";

export interface FontChoice {
  /** Family name as it appears in CSS (e.g. "Gotham", "Inter"). */
  family: string;
  /** Where the family is hosted. */
  source: FontSource;
  /**
   * For source === "google": the Google Fonts URL slug.
   * For source === "upload": the uploaded .woff2 asset URL.
   * For source === "adobe": the Adobe Fonts kit ID.
   * For source === "system": undefined.
   */
  href?: string;
  /** Optional fallback stack. e.g. "sans-serif". */
  fallback?: string;
}

export type LogoRole =
  | "primary-logo"
  | "mascot"
  | "product-icon"
  | "other";

export interface LogoAsset {
  id: string;
  name: string;
  /**
   * Stable URL — when offline this is a blob: URL from URL.createObjectURL;
   * after sync it's the engine's CDN URL.
   */
  file_url: string;
  role: LogoRole;
  /** Original mime type, used to decide if we can recolor. */
  mime?: string;
  /**
   * If true, this is a third-party trademarked logo and the
   * engine renderer must use it as-is (no recolor / no clip).
   */
  locked?: boolean;
}

export interface BrandVoice {
  /** Tone adjectives (e.g. ["calm", "technical", "efficient"]). 3–5 chips. */
  adjectives: string[];
  /** Tones to avoid (e.g. ["playful", "loud"]). 3–5 chips. */
  avoid: string[];
}

export interface BrandIdentity {
  /** Owning project / tenant id — used as the localStorage key suffix. */
  projectId: string;
  /** Display name (e.g. "Chrono Innovation"). */
  name: string;
  palette: ColorRole[];
  font: FontChoice;
  logos: LogoAsset[];
  voice: BrandVoice;
  /** ISO timestamp of the last local edit. */
  updatedAt: string;
  /** ISO timestamp of the last successful POST to /v1/brand. */
  syncedAt?: string;
}

/** Empty starter used when the user opens the panel for the first time. */
export const EMPTY_BRAND_IDENTITY = (projectId: string): BrandIdentity => ({
  projectId,
  name: "",
  palette: [
    { role: "primary", hex: "#000000" },
    { role: "neutral-bg", hex: "#ffffff" },
    { role: "emphasis", hex: "#2563eb", weight: 16.6 },
    { role: "emphasis", hex: "#facc15", weight: 16.6 },
    { role: "emphasis", hex: "#dc2626", weight: 16.6 },
  ],
  font: { family: "Inter", source: "system", fallback: "sans-serif" },
  logos: [],
  voice: { adjectives: [], avoid: [] },
  updatedAt: new Date(0).toISOString(),
});

/**
 * Storage key used by the panel. Kept here so the engine adapter
 * and any debug tooling can find it without re-deriving the format.
 */
export const brandStorageKey = (projectId: string) => `mf-brand-${projectId}`;
