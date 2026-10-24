'use client';

import { use, useEffect, useState, type FormEvent, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { selectIsAuthenticated, useAuthStore } from '@/stores/auth-store';
import { Field } from './_shared/Field';
import {
  PasswordStrengthBar,
  passwordHint,
  scorePassword,
} from './_shared/PasswordStrengthBar';

interface Props {
  searchParamsPromise: Promise<{ next?: string }>;
}

/**
 * Sign-up form — branded, talks to /api/auth/register. The server
 * route creates the Keycloak user (emailVerified:false) and emails a
 * verify-email link via ACS. The form does NOT receive tokens; on a
 * 200 response it routes to /verify-email?email=… where the pending
 * screen tells the user to check their inbox.
 *
 * If a signed-in user lands here we redirect away — no point letting
 * them re-create their own account.
 */
export function SignupForm({ searchParamsPromise }: Props) {
  const sp = use(searchParamsPromise);
  const router = useRouter();
  const hydrated = useAuthStore((s) => s.hydrated);
  const isAuthed = useAuthStore(selectIsAuthenticated);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorPulse, setErrorPulse] = useState(0);

  useEffect(() => {
    if (hydrated && isAuthed) {
      router.replace('/');
    }
  }, [hydrated, isAuthed, router]);

  const passwordStrength = scorePassword(password);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      setErrorPulse((p) => p + 1);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          first_name: firstName.trim() || undefined,
          last_name: lastName.trim() || undefined,
        }),
      });
      const data = (await r.json()) as
        | { ok: true; email: string }
        | { error: string };
      if (!r.ok || !('ok' in data)) {
        const msg = 'error' in data ? data.error : `HTTP ${r.status}`;
        setError(humaniseError(msg, r.status));
        setErrorPulse((p) => p + 1);
        return;
      }
      // Route to the pending screen — no token until the email link is clicked.
      const params = new URLSearchParams({ email: data.email });
      if (sp.next && isSafeNext(sp.next)) params.set('next', sp.next);
      router.push(`/verify-email?${params.toString()}` as never);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'sign-up failed');
      setErrorPulse((p) => p + 1);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="animate-reveal-up rounded-2xl border border-border-light bg-bg-secondary p-7 shadow-lift sm:p-9">
      <div
        className="animate-reveal-up stagger-child flex flex-col gap-2"
        style={{ '--i': 0 } as CSSProperties}
      >
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-accent-700 dark:text-accent-400">
          New seat  ·  free during open beta
        </p>
        <h1 className="text-[28px] font-bold tracking-tight text-text-primary">
          Create your account.
        </h1>
        <p className="text-sm text-text-secondary">
          No card. No agency invoice. First reel in twenty minutes.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4">
        <div
          className="animate-reveal-up stagger-child grid grid-cols-2 gap-3"
          style={{ '--i': 1 } as CSSProperties}
        >
          <Field
            id="first_name"
            label="First name"
            autoComplete="given-name"
            value={firstName}
            onChange={setFirstName}
          />
          <Field
            id="last_name"
            label="Last name"
            autoComplete="family-name"
            value={lastName}
            onChange={setLastName}
          />
        </div>
        <div className="animate-reveal-up stagger-child" style={{ '--i': 2 } as CSSProperties}>
          <Field
            id="email"
            label="Work email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={setEmail}
          />
        </div>
        <div className="animate-reveal-up stagger-child" style={{ '--i': 3 } as CSSProperties}>
          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={setPassword}
            hint={passwordHint(password.length, passwordStrength)}
          />
        </div>
        {password.length > 0 && (
          <PasswordStrengthBar score={passwordStrength} />
        )}
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
          disabled={submitting || !email || !password}
          className="btn-accent animate-reveal-up stagger-child mt-1 px-5 py-3 text-base"
          style={{ '--i': 4 } as CSSProperties}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <ArrowRight className="h-4 w-4" aria-hidden />
          )}
          {submitting ? 'Creating' : 'Create account'}
        </button>
      </form>

      <p
        className="animate-reveal-up stagger-child mt-6 text-center text-sm text-text-secondary"
        style={{ '--i': 5 } as CSSProperties}
      >
        Already have an account?{' '}
        <Link
          href={(`/login${sp.next ? `?next=${encodeURIComponent(sp.next)}` : ''}`) as never}
          className="font-medium text-text-accent underline-offset-2 hover:underline"
        >
          Sign in
        </Link>
      </p>
      <p
        className="animate-reveal-up stagger-child mt-3 text-center text-[11px] text-text-tertiary"
        style={{ '--i': 6 } as CSSProperties}
      >
        By creating an account you agree to our{' '}
        <Link href="/terms" className="underline-offset-2 hover:underline">
          terms
        </Link>{' '}
        and{' '}
        <Link href="/privacy" className="underline-offset-2 hover:underline">
          privacy policy
        </Link>
        .
      </p>
    </div>
  );
}

function isSafeNext(next: string | undefined): next is string {
  if (!next) return false;
  return next.startsWith('/') && !next.startsWith('//');
}

function humaniseError(raw: string, status: number): string {
  if (status === 409) return 'That email is already registered. Try signing in.';
  const lower = raw.toLowerCase();
  if (lower.includes('invalid email')) return 'That email looks off — please double-check.';
  if (lower.includes('password must be at least')) return 'Password must be at least 8 characters.';
  if (lower.includes('admin login failed')) {
    return 'Sign-up is unavailable right now — please try again in a moment.';
  }
  return raw || 'Sign-up failed.';
}
