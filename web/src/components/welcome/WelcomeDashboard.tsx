'use client';

import { WelcomeTourProvider } from '@/components/onboarding/WelcomeTour';
import { AuthMotionBackground } from '@/components/auth/AuthMotionBackground';
import { GreetingBlock } from './GreetingBlock';
import { DesktopGetCard } from './DesktopGetCard';
import { InstallSteps } from './InstallSteps';
import { AccountLinksRow } from './AccountLinksRow';
import { CapabilitiesPanel } from './CapabilitiesPanel';

/**
 * Authenticated landing surface at `/`. Replaces the prompt UI for
 * signed-in users — the actual generator lives in the desktop app.
 *
 * Layout: greeting → desktop download CTA → install steps →
 * account links → capabilities preview. The WelcomeTour is opt-in —
 * the GreetingBlock surfaces a "Take a quick tour" link that calls
 * useWelcomeTour().open(). We do NOT auto-open: a centered callout
 * over a layout this dense ends up covering the greeting and the
 * very card it's trying to point at.
 *
 * Section ordering matches the user's task flow:
 *   1. Identify (greeting tells them they're signed in)
 *   2. Acquire (download the build for their OS)
 *   3. Set up (3-step install summary, link to long-form guide)
 *   4. Discover (capability cards — what's waiting inside the app)
 *   5. Account (profile / keys / sign-out, away from the hot path)
 */
export function WelcomeDashboard() {
  return (
    <WelcomeTourProvider autoStart={false}>
      <div className="flex w-full flex-col">
        {/* Cinematic hero — the same live engine that runs behind login and
            the anon home, now greeting the signed-in user. data-theme="dark"
            flips the semantic tokens for THIS subtree only, so GreetingBlock's
            text + accent render correctly on the dark stage while the content
            below keeps the visitor's chosen theme. The greeting block is
            centered (mx-auto) so it stays clear of the stage's side hero
            silhouettes, which alternate left/right per scene. */}
        <section
          data-theme="dark"
          aria-label="Welcome"
          className="relative isolate flex min-h-[68svh] items-center overflow-hidden bg-[#0e1014]"
        >
          <AuthMotionBackground />
          <div className="relative z-10 mx-auto w-full max-w-2xl px-4 sm:px-6">
            <GreetingBlock />
          </div>
        </section>

        {/* Content — download CTA, install steps, capabilities, account links. */}
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
          <DesktopGetCard />
          <InstallSteps />
          <CapabilitiesPanel />
          <AccountLinksRow />
        </div>
      </div>
    </WelcomeTourProvider>
  );
}
