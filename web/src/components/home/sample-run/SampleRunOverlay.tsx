'use client';

import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';

interface Props {
  /** Forwarded with the user to /signup so the form lands primed. */
  prompt: string;
  children: ReactNode;
}

/**
 * Transparent click-shield over the sample-run demo. Every click
 * inside the children's bounding box (that isn't itself elevated to
 * z-20+) routes to /signup with the currently-typed brief as `next`.
 *
 * The shield is z-10 so the persistent `SampleRunCTA` (z-30) and any
 * explicit `z-20` children remain reachable.
 */
export function SampleRunOverlay({ prompt, children }: Props) {
  const router = useRouter();
  const next = `/?prompt=${encodeURIComponent(prompt)}`;
  const signupHref = `/signup?next=${encodeURIComponent(next)}`;

  return (
    <div className="relative">
      {children}
      <button
        type="button"
        aria-label="Sign up to use ControlCraft"
        onClick={() => router.push(signupHref as never)}
        className="absolute inset-0 z-10 cursor-pointer rounded-3xl bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
      />
    </div>
  );
}
