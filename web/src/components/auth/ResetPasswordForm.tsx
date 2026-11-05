'use client';

import { useState, type FormEvent, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Field } from './_shared/Field';
import {
  PasswordStrengthBar,
  passwordHint,
  scorePassword,
} from './_shared/PasswordStrengthBar';

interface Props {
  token: string;
}

/**
 * Set-new-password form. The token is the signed HMAC from
 * /api/auth/forgot-password; the server validates expiry, purpose,
 * and the bind claim. On success → /reset-password/success.
 *
 * Invalid / expired tokens get a single inline error and a re-request link.
 */
export function ResetPasswordForm({ token }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorPulse, setErrorPulse] = useState(0);

  const score = scorePassword(password);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      setErrorPulse((p) => p + 1);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      setErrorPulse((p) => p + 1);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (r.ok) {
        router.push('/reset-password/success' as never);
        return;
      }
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? 'Could not reset password. Try requesting a new link.');
      setErrorPulse((p) => p + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'reset failed');
      setErrorPulse((p) => p + 1);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="animate-reveal-up rounded-2xl border border-border-light bg-bg-secondary p-8 shadow-card sm:p-10">
      <div
        className="animate-reveal-up stagger-child flex flex-col gap-1.5"
        style={{ '--i': 0 } as CSSProperties}
      >
        <h1 className="text-[26px] font-bold tracking-tight text-text-primary">
          Set a new password.
        </h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          Pick something strong. You&apos;ll sign in with it once it&apos;s saved.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4">
        <div className="animate-reveal-up stagger-child" style={{ '--i': 1 } as CSSProperties}>
          <Field
            id="password"
            label="New password"
            type="password"
            autoComplete="new-password"
            required
            autoFocus
            value={password}
            onChange={setPassword}
            hint={passwordHint(password.length, score)}
          />
        </div>
        {password.length > 0 && <PasswordStrengthBar score={score} />}
        <div className="animate-reveal-up stagger-child" style={{ '--i': 2 } as CSSProperties}>
          <Field
            id="confirm"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={setConfirm}
          />
        </div>
        {error && (
          <p
            key={errorPulse}
            role="alert"
            className="animate-shake text-sm text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting || !password || !confirm}
          className="btn-accent animate-reveal-up stagger-child mt-1 px-5 py-3 text-base"
          style={{ '--i': 3 } as CSSProperties}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <ArrowRight className="h-4 w-4" aria-hidden />
          )}
          {submitting ? 'Saving' : 'Save new password'}
        </button>
      </form>
      <p
        className="animate-reveal-up stagger-child mt-6 text-center text-sm text-text-secondary"
        style={{ '--i': 4 } as CSSProperties}
      >
        Link expired?{' '}
        <Link
          href={"/forgot-password" as never}
          className="font-medium text-text-accent underline-offset-2 hover:underline"
        >
          Request a new one
        </Link>
      </p>
    </div>
  );
}
