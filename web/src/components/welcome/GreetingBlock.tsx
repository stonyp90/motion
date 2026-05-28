'use client';

import type { CSSProperties } from 'react';
import { Compass } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { useWelcomeTourOptional } from '@/components/onboarding/WelcomeTour';

/**
 * Animated greeting at the top of the welcome dashboard. Mostly
 * cosmetic, but pulls the firstName / email-local-part fallback so the
 * surface reads as personally addressed instead of "Hi user".
 */
export function GreetingBlock() {
  const user = useAuthStore((s) => s.user);
  const firstName = user?.firstName ?? (user?.email ? user.email.split('@')[0] : 'there');
  const lastLogin = user?.lastLoginAt ?? null;
  const tour = useWelcomeTourOptional();

  const subtitle = (() => {
    if (!lastLogin) return 'Your account is ready. The desktop app is next.';
    const hoursAgo = (Date.now() - lastLogin) / 3_600_000;
    if (hoursAgo < 1) return 'Welcome back — picked up where you left off.';
    if (hoursAgo < 24) return 'Welcome back. Pick up where you left off.';
    const daysAgo = Math.floor(hoursAgo / 24);
    if (daysAgo < 14) return `Welcome back. ${daysAgo} day${daysAgo === 1 ? '' : 's'} since you last signed in.`;
    return 'Welcome back. Long time, no see.';
  })();

  return (
    <header className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <p
          className="animate-reveal-up stagger-child font-mono text-xs font-medium uppercase tracking-[0.18em] text-text-accent"
          style={{ '--i': 0 } as CSSProperties}
        >
          ControlCraft · Welcome
        </p>
        {tour && (
          <button
            type="button"
            onClick={tour.open}
            className="animate-reveal-up stagger-child inline-flex items-center gap-1.5 rounded-full border border-border-light px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
            style={{ '--i': 0 } as CSSProperties}
            data-testid="mf-welcome-tour-trigger"
          >
            <Compass className="h-3.5 w-3.5" aria-hidden />
            Take the tour
          </button>
        )}
      </div>
      <h1
        className="animate-reveal-up stagger-child text-[40px] font-bold leading-[1.05] tracking-tight text-text-primary sm:text-[52px]"
        style={{ '--i': 1 } as CSSProperties}
      >
        Welcome,{' '}
        <span className="text-text-accent">{firstName}</span>.
      </h1>
      <p
        className="animate-reveal-up stagger-child max-w-2xl text-base leading-[1.55] text-text-secondary sm:text-lg"
        style={{ '--i': 2 } as CSSProperties}
      >
        {subtitle} ControlCraft Desktop runs the engine locally — no cloud
        round-trip, no rate limits. Grab the build for your machine and
        you&apos;re generating in minutes.
      </p>
    </header>
  );
}
