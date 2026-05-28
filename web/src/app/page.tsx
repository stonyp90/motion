'use client';

import { useEffect, useState } from 'react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { AnonHome } from '@/components/home/AnonHome';
import { StudioApp } from '@/components/home/StudioApp';
import { WelcomeDashboard } from '@/components/welcome/WelcomeDashboard';
import { selectIsAuthenticated, useAuthStore } from '@/stores/auth-store';
import { isDesktopMode } from '@/lib/runtime-config';

/**
 * Home dispatcher. Three surfaces, picked by (auth, host):
 *
 *   anon            → <AnonHome />          marketing reel + CTAs
 *   auth + browser  → <WelcomeDashboard />  "go download the desktop app"
 *   auth + desktop  → <StudioApp />         the actual prompt → preview UI
 *
 * The SSR pass returns the anon surface (no `window`, no auth store).
 * After hydrate the client flips to the right surface. This avoids
 * shipping a cookie-derived flag down the tree and keeps the SSR
 * response cacheable for unauthenticated visitors.
 */
export default function Home() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const isAuthed = useAuthStore(selectIsAuthenticated);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setIsDesktop(isDesktopMode());
  }, []);

  const surface = !hydrated || !isAuthed
    ? 'anon'
    : isDesktop
      ? 'studio'
      : 'welcome';

  return (
    <main className="flex min-h-screen flex-col bg-bg-primary">
      <Header />
      <div className="flex-1">
        {surface === 'anon' && <AnonHome />}
        {surface === 'studio' && <StudioApp />}
        {surface === 'welcome' && <WelcomeDashboard />}
      </div>
      <Footer />
    </main>
  );
}
