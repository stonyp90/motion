'use client';

import { signIn } from 'next-auth/react';
import { Lock, Sparkles } from 'lucide-react';

/**
 * Replaces the prompt input + cast + voice + generate for anonymous
 * visitors. The KPI strip + header + footer stay public so the value
 * proposition is visible without sign-in — only the active generator
 * surface (and therefore engine credits) is gated.
 *
 * Clicking the CTA hands off to NextAuth's Keycloak flow.
 */
export function SignInGate() {
  return (
    <section
      aria-labelledby="signin-gate-heading"
      className="rounded-2xl border border-border-light bg-bg-secondary p-8 sm:p-10 shadow-card"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <span
          aria-hidden
          className="grid h-10 w-10 place-items-center rounded-full bg-accent-50 text-accent-700"
        >
          <Lock className="h-5 w-5" />
        </span>

        <h2
          id="signin-gate-heading"
          className="text-xl font-semibold tracking-tight text-text-primary sm:text-2xl"
        >
          Sign in to start generating
        </h2>

        <p className="max-w-prose text-sm text-text-secondary">
          The motion-forge generator runs on per-account compute credits.
          Sign in with your Keycloak account to type a brief, cast your
          characters, and ship a finished spot.
        </p>

        <button
          type="button"
          onClick={() => signIn('keycloak', { callbackUrl: '/' })}
          className="inline-flex items-center gap-2 rounded-full bg-accent-700 px-5 py-2.5 text-sm font-semibold text-white shadow-card transition hover:bg-accent-800 hover:shadow-glow"
          data-testid="signin-gate-cta"
        >
          <Sparkles className="h-4 w-4" />
          Sign in with Keycloak
        </button>

        <p className="text-xs text-text-tertiary">
          No password? Ask your workspace admin to invite you.
        </p>
      </div>
    </section>
  );
}
