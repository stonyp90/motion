'use client';

import { WelcomeTourProvider } from '@/components/onboarding/WelcomeTour';
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
 * account links → capabilities preview. WelcomeTour overlays on the
 * first visit (localStorage `mf-welcome-tour-seen`).
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
    <WelcomeTourProvider>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
        <GreetingBlock />
        <DesktopGetCard />
        <InstallSteps />
        <CapabilitiesPanel />
        <AccountLinksRow />
      </div>
    </WelcomeTourProvider>
  );
}
