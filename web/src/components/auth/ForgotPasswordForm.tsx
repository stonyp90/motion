'use client';

import { useState, type FormEvent, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Field } from './_shared/Field';

/**
 * Forgot-password — single-field form. POSTs to /api/auth/forgot-password
 * which is enumeration-safe (always 200). On a 2xx response we route
 * to /forgot-password/sent so the next surface reads as confirmation
 * regardless of whether the email actually exists on file.
 */
export function ForgotPasswordForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorPulse, setErrorPulse] = useState(0);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (r.status === 429) {
        setError('Too many requests. Please wait a few minutes and try again.');
        setErrorPulse((p) => p + 1);
        return;
      }
      router.push(`/forgot-password/sent?email=${encodeURIComponent(email.trim())}` as never);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
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
          Forgot your password?
        </h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          Enter the email on your account. We&apos;ll send a reset link.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4">
        <div className="animate-reveal-up stagger-child" style={{ '--i': 1 } as CSSProperties}>
          <Field
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={setEmail}
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
          disabled={submitting || !email}
          className="btn-accent animate-reveal-up stagger-child mt-1 px-5 py-3 text-base"
          style={{ '--i': 2 } as CSSProperties}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <ArrowRight className="h-4 w-4" aria-hidden />
          )}
          {submitting ? 'Sending' : 'Send reset link'}
        </button>
      </form>
      <p
        className="animate-reveal-up stagger-child mt-6 text-center text-sm text-text-secondary"
        style={{ '--i': 3 } as CSSProperties}
      >
        Remembered it?{' '}
        <Link
          href={"/login" as never}
          className="font-medium text-text-accent underline-offset-2 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
