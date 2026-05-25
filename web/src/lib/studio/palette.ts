/**
 * Studio quick-pick swatch palette.
 *
 * NOTE: these are NOT brand tokens. They're the colors a user can
 * tap to recolor their Lottie's `accent`. Brand colors live in
 * `src/app/globals.css` and `tailwind.config.ts`. Adding or
 * removing entries here only changes the studio's color picker; it
 * does not affect the marketing palette.
 *
 * The set is intentionally a vibrant rainbow + an off-white so the
 * picker covers the most common "I just want one color" cases.
 */

export interface StudioSwatch {
  /** sRGB hex, used directly by `<button style={{ background }}>`. */
  hex: string;
  /** Human label for aria + tooltip. */
  label: string;
}

export const STUDIO_PRESET_COLORS: readonly StudioSwatch[] = [
  { hex: '#10b981', label: 'Emerald' },
  { hex: '#3b82f6', label: 'Blue' },
  { hex: '#f59e0b', label: 'Amber' },
  { hex: '#ef4444', label: 'Red' },
  { hex: '#8b5cf6', label: 'Violet' },
  { hex: '#06b6d4', label: 'Cyan' },
  { hex: '#ec4899', label: 'Pink' },
  { hex: '#e2e8f0', label: 'Slate' },
] as const;

/**
 * Resolve a CSS custom property by name on the document root.
 * Used so the studio's initial accent/background match the live
 * theme tokens rather than hard-coded hexes. Returns `fallback` if
 * the property is missing or we're on the server.
 */
export function readCssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined' || !document?.documentElement) {
    return fallback;
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}
