'use client';

import { useRouter } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { TrustStrip } from './TrustStrip';
import { SampleRunDemo } from './sample-run/SampleRunDemo';

/**
 * Anonymous landing surface at `/`. Hero copy, cinematic sample-run
 * demo of the prompt → generate loop, and a single trust strip below.
 *
 * The headline KPI strip ("20 min / 1 day / 90% / ∞") was removed —
 * the product is meant to read as a tool, not an agency pitch. The
 * sample-run demo IS the demonstration; the numbers were redundant.
 *
 * The Generate button on the public surface intentionally doesn't
 * exist — anonymous visitors only see the value-prop + sign-up CTA.
 * The sample-run demo's click-shield routes any click into /signup.
 */
export function MarketingHome() {
  const router = useRouter();

  return (
    <div className="relative flex w-full flex-col gap-8 bg-hero-grid px-4 pt-6 pb-12 sm:px-6 sm:pt-8 sm:pb-16 lg:pt-10">
      <div className="mx-auto w-full max-w-3xl flex flex-col items-center gap-6 text-center">
        <h1 className="h-display">
          Brand-grade motion design,
          <br className="hidden sm:inline" />
          in twenty minutes.
        </h1>
        <p className="max-w-[36rem] text-lg leading-[1.55] text-text-secondary sm:text-xl">
          Marketing, product, and creative teams turn a brief into a
          finished animated explainer the same day &mdash; without an
          agency timeline or an agency invoice.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/signup')}
            className="btn-accent group mt-1 px-8 py-3.5 text-base"
            data-testid="hero-signup"
          >
            Get started — it&apos;s free
            <ArrowRight
              className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5"
              aria-hidden
            />
          </button>
          <button
            type="button"
            onClick={() => router.push('/login')}
            className="btn-ghost mt-1 px-6 py-3.5 text-base"
            data-testid="hero-signin"
          >
            Sign in
          </button>
        </div>
      </div>

      <SampleRunDemo />

      <TrustStrip />
    </div>
  );
}
