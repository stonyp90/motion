'use client';

import { useState, type CSSProperties, type FormEvent } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { Field } from '@/components/auth/_shared/Field';
import {
  PasswordStrengthBar,
  passwordHint,
  scorePassword,
} from '@/components/auth/_shared/PasswordStrengthBar';

/**
 * Change-password card — three fields (current / new / confirm),
 * mirrored validation with /reset-password. Server enforces the same
 * minimum length plus re-verifies the current password via
 * `passwordLogin()` before rotating.
 */
export function SecurityCard() {
  const bearer = useAuthStore((s) => s.accessToken);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedNonce, setSavedNonce] = useState(0);

  const score = scorePassword(next);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saving || !bearer) return;
    if (next.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (next !== confirm) {
      setError('New passwords do not match.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/auth/password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (!r.ok) {
        const data = (await r.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'Could not change password.');
        return;
      }
      setCurrent('');
      setNext('');
      setConfirm('');
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
      style={{ '--i': 1 } as CSSProperties}
    >
      <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-text-primary">
        <ShieldCheck className="h-4 w-4 text-accent-700" aria-hidden />
        Security
      </h2>
      <p className="mt-1 text-xs text-text-tertiary">
        Change your password. We&apos;ll re-verify your current one before saving.
      </p>
      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
        <Field
          id="current-password"
          label="Current password"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={setCurrent}
        />
        <Field
          id="new-password"
          label="New password"
          type="password"
          autoComplete="new-password"
          required
          value={next}
          onChange={setNext}
          hint={passwordHint(next.length, score)}
        />
        {next.length > 0 && <PasswordStrengthBar score={score} />}
        <Field
          id="confirm-password"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={setConfirm}
        />
        {error && (
          <p role="alert" className="animate-shake text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
        {savedNonce > 0 && !error && (
          <p key={`saved-${savedNonce}`} role="status" className="animate-toast-in text-xs text-text-accent">
            Password updated.
          </p>
        )}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!current || !next || !confirm || saving}
            className="btn-accent px-5 py-2.5 text-sm disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
            {saving ? 'Saving' : 'Change password'}
          </button>
        </div>
      </form>
    </section>
  );
}
