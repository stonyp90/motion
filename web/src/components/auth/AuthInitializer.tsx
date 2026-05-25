'use client';

import { useEffect } from 'react';
import { startAuthRefresh, useAuthStore } from '@/stores/auth-store';
import { installDesktopOverride } from '@/lib/runtime-config';

/**
 * Mount-once shim that:
 *   1. Hydrates the auth store from localStorage.
 *   2. Applies the desktop `?engine=…&token=…` URL params (no-op for
 *      hosted-web users — only the Tauri shell ever sets them).
 *   3. Starts the proactive refresh interval.
 *
 * Render this inside the root layout, above any consumer of
 * `useAuthStore`.
 */
export function AuthInitializer() {
  useEffect(() => {
    // Order matters: hydrate first so the override doesn't race a
    // partial restore from localStorage; install the override second
    // so its token wins for the current session.
    useAuthStore.getState().hydrate();
    installDesktopOverride();
    const stop = startAuthRefresh();
    return stop;
  }, []);
  return null;
}
