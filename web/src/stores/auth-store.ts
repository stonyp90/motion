'use client';

import { create } from 'zustand';

/**
 * Auth store — owns the Keycloak access / refresh token pair on the
 * client and runs a proactive refresh timer.
 *
 * Why zustand over NextAuth's session: with a custom /login + /signup
 * we never see a NextAuth Session object on the client. The store is
 * deliberately small — token strings, expiry, a derived `isAuthenticated`
 * flag — and persisted to localStorage so a hard reload doesn't kick
 * the user out.
 *
 * Lifecycle:
 *   - setTokens()  — called by the /login + /signup forms on success
 *   - schedule()   — kicks off setInterval; safe to call multiple times
 *   - clear()      — wipes state on Sign out or unrecoverable 401
 *
 * Refresh policy mirrors Tablix's:
 *   - REFRESH_INTERVAL_MS = 4 minutes (cheap setInterval cadence)
 *   - TOKEN_EXPIRY_BUFFER_MS = 5 minutes (refresh once we're inside the
 *     buffer; access tokens last 15 min per realm settings, so this
 *     means at least one refresh per session)
 */

const STORAGE_KEY = 'mf_tokens';
const REFRESH_INTERVAL_MS = 4 * 60 * 1000;
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export interface AuthUser {
  email?: string;
  name?: string;
  /** Given name from the JWT — drives the welcome dashboard greeting. */
  firstName?: string;
  /** Family name from the JWT. */
  lastName?: string;
  /** Initial pulled from the JWT for the header avatar. */
  initial?: string;
  /** Whether Keycloak considers the email verified. */
  emailVerified?: boolean;
  /** Keycloak user id (`sub` claim) — needed for /api/auth/profile calls. */
  sub?: string;
  /** JWT issued-at (ms) — proxy for "last login on this device". */
  lastLoginAt?: number;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  expiresAt: number | null;
  user: AuthUser | null;
  /** Hydration flag — prevents SSR/client header divergence. */
  hydrated: boolean;
}

interface AuthActions {
  setTokens: (t: {
    access_token: string;
    refresh_token: string;
    expires_at: number;
  }) => void;
  clear: () => void;
  hydrate: () => void;
  /** Manually force a refresh; resolves true on success. */
  refresh: () => Promise<boolean>;
}

export type AuthStore = AuthState & AuthActions;

const initialState: AuthState = {
  accessToken: null,
  refreshToken: null,
  expiresAt: null,
  user: null,
  hydrated: false,
};

export const useAuthStore = create<AuthStore>((set, get) => ({
  ...initialState,

  setTokens: ({ access_token, refresh_token, expires_at }) => {
    const user = parseUserFromJwt(access_token);
    set({ accessToken: access_token, refreshToken: refresh_token, expiresAt: expires_at, user });
    persist({ access_token, refresh_token, expires_at });
  },

  clear: () => {
    set({ ...initialState, hydrated: true });
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  },

  hydrate: () => {
    if (get().hydrated) return;
    const saved = readPersisted();
    if (saved) {
      const user = parseUserFromJwt(saved.access_token);
      set({
        accessToken: saved.access_token,
        refreshToken: saved.refresh_token,
        expiresAt: saved.expires_at,
        user,
        hydrated: true,
      });
    } else {
      set({ hydrated: true });
    }
  },

  refresh: async () => {
    const { refreshToken } = get();
    if (!refreshToken) return false;
    try {
      const r = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!r.ok) {
        // Unrecoverable — wipe and let the UI redirect to /login.
        get().clear();
        return false;
      }
      const data = (await r.json()) as {
        access_token: string;
        refresh_token: string;
        expires_at: number;
      };
      get().setTokens(data);
      return true;
    } catch {
      return false;
    }
  },
}));

/**
 * Selector helpers — kept here so consumers don't repeat the
 * `s.accessToken && s.expiresAt > Date.now()` ceremony.
 */
export const selectIsAuthenticated = (s: AuthStore): boolean =>
  !!s.accessToken && !!s.expiresAt && s.expiresAt > Date.now();

/* ------------------------------------------------------------------ utils */

function persist(t: { access_token: string; refresh_token: string; expires_at: number }) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
  } catch {
    /* ignore — quota, private mode, etc. */
  }
}

function readPersisted():
  | { access_token: string; refresh_token: string; expires_at: number }
  | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_at?: unknown;
    };
    if (
      typeof j.access_token !== 'string' ||
      typeof j.refresh_token !== 'string' ||
      typeof j.expires_at !== 'number'
    ) {
      return null;
    }
    return {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at,
    };
  } catch {
    return null;
  }
}

/**
 * Pull a display name + email + initial from the JWT's payload
 * without verifying its signature. The server already validated it
 * during login; the client only needs the cosmetic fields.
 */
function parseUserFromJwt(token: string): AuthUser | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as Record<string, unknown>;
    const email = typeof payload.email === 'string' ? payload.email : undefined;
    const firstName =
      typeof payload.given_name === 'string' ? payload.given_name : undefined;
    const lastName =
      typeof payload.family_name === 'string' ? payload.family_name : undefined;
    const name =
      typeof payload.name === 'string'
        ? payload.name
        : [firstName, lastName].filter(Boolean).join(' ') ||
          (typeof payload.preferred_username === 'string'
            ? payload.preferred_username
            : undefined);
    const emailVerified =
      typeof payload.email_verified === 'boolean' ? payload.email_verified : undefined;
    const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
    const lastLoginAt =
      typeof payload.iat === 'number' ? payload.iat * 1000 : undefined;
    const initial =
      (firstName?.[0] || name?.[0] || email?.[0] || '').toUpperCase() || undefined;
    return { email, name, firstName, lastName, initial, emailVerified, sub, lastLoginAt };
  } catch {
    return null;
  }
}

/* ----------------------------------------------------- auto-refresh timer */

let refreshTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the auto-refresh interval. Idempotent — safe to call from
 * multiple AuthInitializer mounts (React strict-mode double-renders).
 */
export function startAuthRefresh(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (refreshTimer) return () => stopAuthRefresh();

  const tick = async () => {
    const s = useAuthStore.getState();
    if (!s.accessToken || !s.expiresAt) return;
    const msLeft = s.expiresAt - Date.now();
    if (msLeft <= TOKEN_EXPIRY_BUFFER_MS) {
      await s.refresh();
    }
  };

  // Fire once immediately so a hydrated near-expiry session refreshes
  // before the user clicks anything.
  void tick();
  refreshTimer = setInterval(tick, REFRESH_INTERVAL_MS);
  return () => stopAuthRefresh();
}

function stopAuthRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}
