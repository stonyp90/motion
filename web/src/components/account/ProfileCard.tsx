'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { Check, Loader2, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { Field } from '@/components/auth/_shared/Field';

interface Profile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  emailVerified: boolean;
  enabled: boolean;
  createdTimestamp: number | null;
}

/**
 * Profile card — large avatar, inline-editable name, read-only email,
 * verification badge, account-created date. Saves on submit (not on
 * blur) so unintentional taps don't trigger admin REST calls.
 */
export function ProfileCard() {
  const bearer = useAuthStore((s) => s.accessToken);
  const storeUser = useAuthStore((s) => s.user);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNonce, setSavedNonce] = useState(0);

  useEffect(() => {
    if (!bearer) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('/api/auth/profile', {
          headers: { Authorization: `Bearer ${bearer}` },
        });
        if (!r.ok) return;
        const data = (await r.json()) as Profile;
        if (cancelled) return;
        setProfile(data);
        setFirstName(data.firstName);
        setLastName(data.lastName);
      } catch {
        /* ignore — fall back to JWT-only display */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bearer]);

  const initial =
    (firstName?.[0] ?? storeUser?.firstName?.[0] ?? storeUser?.email?.[0] ?? '?').toUpperCase();
  const email = profile?.email ?? storeUser?.email ?? '';
  const verified = profile?.emailVerified ?? storeUser?.emailVerified ?? false;
  const createdAt = profile?.createdTimestamp
    ? new Date(profile.createdTimestamp).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

  const dirty =
    !!profile && (firstName.trim() !== profile.firstName || lastName.trim() !== profile.lastName);

  const handleSave = async () => {
    if (!bearer || saving || !dirty) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({ firstName: firstName.trim(), lastName: lastName.trim() }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'Could not save changes.');
        return;
      }
      const fresh = (await r.json()) as Profile;
      setProfile(fresh);
      setSavedNonce((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      className="animate-reveal-up stagger-child rounded-2xl border border-border-light bg-bg-primary p-6 shadow-card sm:p-8"
      style={{ '--i': 0 } as CSSProperties}
    >
      <h2 className="text-base font-bold tracking-tight text-text-primary">
        Profile
      </h2>
      <div className="mt-5 flex flex-col gap-6 sm:flex-row sm:items-start">
        <div className="flex flex-col items-center gap-2">
          <span className="grid h-20 w-20 place-items-center rounded-full bg-accent-700 text-3xl font-bold text-white">
            {initial}
          </span>
          {verified ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-50 px-2 py-0.5 text-2xs font-medium text-accent-700">
              <ShieldCheck className="h-3 w-3" aria-hidden /> Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary-50 px-2 py-0.5 text-2xs font-medium text-secondary-700">
              <ShieldAlert className="h-3 w-3" aria-hidden /> Not verified
            </span>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
          className="flex flex-1 flex-col gap-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field
              id="profile-first-name"
              label="First name"
              autoComplete="given-name"
              value={firstName}
              onChange={setFirstName}
            />
            <Field
              id="profile-last-name"
              label="Last name"
              autoComplete="family-name"
              value={lastName}
              onChange={setLastName}
            />
          </div>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-text-primary">Email</span>
            <span className="flex items-center gap-2 rounded-lg border border-border-light bg-bg-tertiary px-3 py-2.5 text-base text-text-secondary">
              {email}
            </span>
            <span className="text-[11px] text-text-tertiary">
              Email changes are coming soon — for now contact support to update.
            </span>
          </label>
          {createdAt && (
            <p className="text-xs text-text-tertiary">Account created {createdAt}</p>
          )}
          {error && (
            <p key={savedNonce} role="alert" className="animate-shake text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          {savedNonce > 0 && !error && (
            <p key={`saved-${savedNonce}`} role="status" className="animate-toast-in inline-flex items-center gap-1 text-xs text-text-accent">
              <Check className="h-3 w-3" aria-hidden /> Saved
            </p>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!dirty || saving}
              className="btn-accent px-5 py-2.5 text-sm disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {saving ? 'Saving' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
