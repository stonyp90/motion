'use client';

import { SessionProvider } from 'next-auth/react';
import type { ReactNode } from 'react';

/**
 * Tiny client wrapper around NextAuth's `<SessionProvider>` so the
 * server-component root layout can mount it without becoming a
 * client component itself.
 */
export function AuthSessionProvider({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
