'use client';

import { ProfileCard } from './ProfileCard';
import { SecurityCard } from './SecurityCard';
import { PreferencesCard } from './PreferencesCard';
import { DangerZone } from './DangerZone';

/**
 * /account layout — single column on mobile, stacked cards. Each card
 * is independently saveable so the user can update one section without
 * the others. Anchored sections: profile (name), security (password),
 * preferences (theme + digest), danger zone (disable).
 */
export function ProfileLayout() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-12 sm:px-6 sm:py-16">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-text-accent">
          Account · Settings
        </p>
        <h1 className="text-[36px] font-bold leading-[1.1] tracking-tight text-text-primary sm:text-[44px]">
          Your account.
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-text-secondary sm:text-base">
          Manage how you sign in, how the app looks, and what we email you.
        </p>
      </header>
      <ProfileCard />
      <SecurityCard />
      <PreferencesCard />
      <DangerZone />
    </div>
  );
}
