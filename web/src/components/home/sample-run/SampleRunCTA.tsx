'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

interface Props {
  /**
   * Carries the currently-typed brief through to the signup form so
   * the user lands primed. Even though the demo is auto-typed, we
   * pass whatever's visible at the click moment.
   */
  prompt: string;
}

/**
 * Persistent sign-up affordance for the sample-run demo. Renders two
 * surfaces:
 *   - A floating top-right pill anchored to the demo card.
 *   - A sticky bottom-center pair (only on lg+ where viewport height
 *     is enough that the bottom doesn't crowd the preview).
 *
 * Both surfaces sit above the click-shield (z-30) so they remain
 * tappable.
 */
export function SampleRunCTA({ prompt }: Props) {
  const next = `/?prompt=${encodeURIComponent(prompt)}`;
  const signupHref = `/signup?next=${encodeURIComponent(next)}`;
  const loginHref = `/login?next=${encodeURIComponent(next)}`;

  return (
    <>
      <div className="pointer-events-none absolute right-3 top-3 z-30 sm:right-5 sm:top-5">
        <Link
          href={signupHref as never}
          className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-bg-primary/90 px-3 py-1.5 text-xs font-semibold text-text-accent shadow-card backdrop-blur-md hover:bg-bg-primary hover:shadow-glow"
        >
          Sign up free
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      <div className="pointer-events-none sticky bottom-4 z-30 mt-6 hidden justify-center lg:flex">
        <div className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border-light bg-bg-primary/95 px-2 py-2 shadow-lift backdrop-blur-md">
          <Link
            href={signupHref as never}
            className="btn-accent px-5 py-2 text-sm"
          >
            Sign up free
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
          <Link
            href={loginHref as never}
            className="rounded-full px-3 py-1.5 text-sm font-medium text-text-primary transition-colors hover:bg-bg-tertiary"
          >
            Sign in
          </Link>
        </div>
      </div>
    </>
  );
}
