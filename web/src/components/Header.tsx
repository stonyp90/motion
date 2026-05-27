'use client';

import { useEffect, useState } from 'react';
import { Download, ArrowRight, LogOut, Sparkles, User } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';
import { MotionLogo } from './MotionLogo';
import { selectIsAuthenticated, useAuthStore } from '@/stores/auth-store';
import { isDesktopMode } from '@/lib/runtime-config';

/**
 * Slim app header: logo + (auth-gated) Download link + Sign in / account control.
 *
 * The single-screen app does not have marketing nav — the page itself
 * IS the call to action. We keep just enough chrome to identify the
 * product, point signed-in users at the desktop download, and give
 * everyone a way back into their account. When signed in, the Sign-in
 * pill flips to a Sign-out pill with the user initial.
 *
 * The Download link is **only rendered when the user is authenticated**
 * — the desktop app is a customer artifact, not marketing material, so
 * the public site stays free of distributable binaries until the
 * visitor has signed in. The route `/download` enforces the same gate
 * server-side (a direct visit while signed out redirects to /login).
 *
 * The repo is private; we don't link out to GitHub. Source access is
 * granted per-account by IT, never via a public URL on the site.
 *
 * Auth state comes from `useAuthStore` (zustand), populated by
 * `/login` and `/signup` via `/api/auth/*`. The store hydrates from
 * localStorage on mount, so we render a stable "signed out" header
 * for the SSR pass and update post-hydration to avoid a flash.
 */
export function Header() {
  const router = useRouter();
  const hydrated = useAuthStore((s) => s.hydrated);
  const isAuthenticated = useAuthStore(selectIsAuthenticated);
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const initial = user?.initial ?? '';

  // Hide the Download pill inside the desktop shell — the user is
  // already in the app, so the link reads as a self-referential nag.
  // SSR paints `false` to match the server output; the effect flips
  // it to `true` post-hydration when running under Tauri.
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    setDesktop(isDesktopMode());
  }, [hydrated]);

  const handleSignOut = () => {
    clear();
    router.push('/');
    router.refresh();
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border-light bg-bg-primary/85 backdrop-blur-md">
      <div className="container flex h-16 items-center justify-between">
        <MotionLogo size="md" />

        <div className="flex items-center gap-1">
          <ThemeToggle />
          {hydrated && isAuthenticated && (
            <>
              <Link
                href={"/studio" as never}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                aria-label="Open Studio — direct-edit + multi-format export"
              >
                <Sparkles className="h-4 w-4" />
                <span className="hidden sm:inline">Studio</span>
              </Link>
              {!desktop && (
                <Link
                  href={"/download" as never}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                  aria-label="Download ControlCraft desktop"
                >
                  <Download className="h-4 w-4" />
                  <span className="hidden sm:inline">Download</span>
                </Link>
              )}
              <div className="mx-1 h-5 w-px bg-border-light" aria-hidden />
            </>
          )}
          {hydrated && isAuthenticated ? (
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-bg-primary px-3 py-1 text-sm font-medium text-text-primary transition-colors hover:bg-bg-tertiary"
              aria-label="Sign out"
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-700 text-xs font-semibold text-white">
                {initial || <User className="h-3 w-3" aria-hidden />}
              </span>
              <span className="hidden sm:inline">Sign out</span>
              <LogOut className="h-3.5 w-3.5 text-text-tertiary" aria-hidden />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => router.push('/login')}
              data-testid="header-signin"
              className="inline-flex items-center gap-1.5 rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-white shadow-card transition-all duration-200 hover:-translate-y-px hover:bg-accent-800 hover:shadow-glow active:translate-y-0 active:shadow-card"
            >
              Sign in
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
