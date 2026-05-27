/**
 * Runtime config helpers.
 *
 * The web app normally reads `NEXT_PUBLIC_ENGINE_BASE_URL` at build
 * time, but the Tauri desktop shell needs to point the app at a
 * per-launch local engine port. So at first paint the desktop shell
 * appends `?engine=<url>&token=<secret>` to the window URL and we
 * persist both values to localStorage; subsequent fetches read the
 * override from there.
 *
 * Browsers (web users) never set the localStorage key — `getEngineBase`
 * falls through to the build-time env var unchanged.
 */

import { useAuthStore } from '@/stores/auth-store';

const STORAGE_ENGINE_KEY = 'mf_local_engine_base';
const STORAGE_TOKEN_KEY = 'mf_local_engine_token';

/** Build-time fallback (Vercel / Azure web tier hostnames). */
const BUILD_DEFAULT =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_ENGINE_BASE_URL) ||
  '';

/**
 * Resolve the engine base URL at call time. Order:
 *   1. localStorage override (set by the desktop boot flow)
 *   2. NEXT_PUBLIC_ENGINE_BASE_URL build var
 *   3. empty string (same-origin)
 */
export function getEngineBase(): string {
  if (typeof window === 'undefined') return BUILD_DEFAULT;
  try {
    const override = window.localStorage.getItem(STORAGE_ENGINE_KEY);
    if (override && /^https?:\/\//.test(override)) return override;
  } catch {
    /* ignore — quota / private mode */
  }
  return BUILD_DEFAULT;
}

/**
 * One-shot boot. Called from `<AuthInitializer/>` on every mount; the
 * `?engine=` + `?token=` query params are stripped from the URL after
 * reading so a refresh doesn't re-apply stale values.
 *
 * The token is loaded into the auth store with a synthetic 24 h expiry
 * so the existing isAuthenticated selector + refresh timer treat the
 * desktop session like any other logged-in session.
 */
export function installDesktopOverride(): void {
  if (typeof window === 'undefined') return;
  let mutated = false;
  try {
    const sp = new URLSearchParams(window.location.search);
    const engine = sp.get('engine');
    const token = sp.get('token');
    if (engine && /^https?:\/\//.test(engine)) {
      window.localStorage.setItem(STORAGE_ENGINE_KEY, engine);
      sp.delete('engine');
      mutated = true;
    }
    if (token) {
      window.localStorage.setItem(STORAGE_TOKEN_KEY, token);
      // Inject the token into the auth store so generate / iterate
      // calls attach an Authorization header. 24 h expiry mirrors
      // the engine's fallback-key contract (no real expiry — the
      // store just needs a future timestamp to think we're signed in).
      const oneDay = 24 * 60 * 60 * 1000;
      useAuthStore.getState().setTokens({
        access_token: token,
        refresh_token: token,
        expires_at: Date.now() + oneDay,
      });
      sp.delete('token');
      mutated = true;
    }
    if (mutated) {
      const newSearch = sp.toString();
      const newUrl =
        window.location.pathname + (newSearch ? `?${newSearch}` : '') +
        window.location.hash;
      window.history.replaceState(null, '', newUrl);
    }
  } catch {
    /* ignore — best effort */
  }
}

/**
 * Hint for downstream UI (so we can label the engine row as "local"
 * when the override is active).
 */
export function isLocalEngineOverride(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return !!window.localStorage.getItem(STORAGE_ENGINE_KEY);
  } catch {
    return false;
  }
}

/**
 * Are we running inside the Tauri desktop shell?
 *
 * Two reliable signals:
 *   1. `window.__TAURI__` — exposed by Tauri's JS bridge as soon as
 *      the webview boots, before our own JS runs.
 *   2. `mf_local_engine_base` in localStorage — set by `installDesktopOverride()`
 *      on first paint and persisted afterwards.
 *
 * We OR them so the detection survives a page navigation where the
 * URL params have already been stripped (after install) AND works on
 * very-first-paint before localStorage is populated (via __TAURI__).
 *
 * SSR-safe — always returns false on the server (no `window`).
 */
export function isDesktopMode(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { __TAURI__?: unknown };
  if (w.__TAURI__) return true;
  return isLocalEngineOverride();
}
