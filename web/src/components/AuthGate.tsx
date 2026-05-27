'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { selectIsAuthenticated, useAuthStore } from '@/stores/auth-store';

/**
 * Client-side auth gate. Redirects to `/login?next=<current_path>`
 * when the auth store has hydrated and reports a signed-out user,
 * and renders nothing in the meantime so protected content never
 * paints before the redirect fires.
 *
 * Use on any route that should not be reachable to anonymous
 * visitors (download surfaces, dashboards, account pages). The
 * `next` query string lets `/login` bounce the user back to where
 * they were trying to go after they sign in.
 *
 * Defense-in-depth: this is the *UX* gate. The actual binary
 * download endpoint (`/api/download/<os>`) is the server-side gate
 * — anyone who scripts a direct fetch still has to clear that.
 *
 * SSR safety: the auth store starts un-hydrated, so the server pass
 * always reports `signed out` and we render nothing. Hydration on
 * the client either flips us to "signed in → render children" or
 * triggers the redirect. No FOUC of protected content.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const hydrated = useAuthStore((s) => s.hydrated);
  const isAuthed = useAuthStore(selectIsAuthenticated);

  useEffect(() => {
    if (!hydrated) return;
    if (!isAuthed) {
      const next = encodeURIComponent(pathname || '/');
      router.replace((`/login?next=${next}`) as never);
    }
  }, [hydrated, isAuthed, pathname, router]);

  if (!hydrated || !isAuthed) {
    // Render the same nothing on both server and client so the
    // hydration diff is clean.
    return null;
  }
  return <>{children}</>;
}
