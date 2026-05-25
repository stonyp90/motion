'use client';

import { Github, ArrowRight, LogOut, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from './ThemeToggle';
import { MotionLogo } from './MotionLogo';
import { selectIsAuthenticated, useAuthStore } from '@/stores/auth-store';

/**
 * Slim app header: logo + GitHub link + Sign in / account control.
 *
 * The single-screen app does not have marketing nav — the page itself
 * IS the call to action. We keep just enough chrome to identify the
 * product and give a user a way back into their account. When signed
 * in, the Sign-in pill flips to a Sign-out pill with the user initial.
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
          <a
            href="https://github.com/stonyp90/motion"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
            aria-label="GitHub repository"
          >
            <Github className="h-4 w-4" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <div className="mx-1 h-5 w-px bg-border-light" aria-hidden />
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
