'use client';

import { useEffect } from 'react';
import { startAuthRefresh, useAuthStore } from '@/stores/auth-store';

/**
 * Mount-once shim that hydrates the auth store from localStorage and
 * starts the proactive refresh interval. Render this inside the root
 * layout, above any consumer of `useAuthStore`.
 */
export function AuthInitializer() {
  useEffect(() => {
    useAuthStore.getState().hydrate();
    const stop = startAuthRefresh();
    return stop;
  }, []);
  return null;
}
