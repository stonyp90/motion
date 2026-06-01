'use client';

import { use, useEffect, useState, type FormEvent, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { selectIsAuthenticated, useAuthStore } from '@/stores/auth-store';
import { Field } from './_shared/Field';

interface Props {
  searchParamsPromise: Promise<{ next?: string; reason?: string }>;
}

/**
 * Sign-in form — branded, talks to /api/auth/login. On success the
 * zustand store gets populated and the page redirects to either
 * `?next=` (if present and same-origin) or `/`.
 *
 * Branches:
 *   - 200 → setTokens + redirect
 *   - 403 + `error: email_not_verified` → /verify-email?email=…
 *   - other 4xx → inline error (shaken)
 *
 * If a signed-in user hits this page we redirect them away — the
 * /login URL is itself a stale link in that case.
 *
 * The form intentionally avoids dual-CTA chrome (no "sign in with
 * Google" buttons) — the realm only exposes password auth today.
 * SSO buttons land here when the realm enables them.
 */
export function LoginForm({ searchParamsPromise }: Props) {
  const sp = use(searchParamsPromise);
  const router = useRouter();
  const setTokens = useAuthStore((s) => s.setTokens);
  const hydrated = useAuthStore((s) => s.hydrated);
  const isAuthed = useAuthStore(selectIsAuthenticated);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorPulse, setErrorPulse] = useState(0);

  const reason = sp.reason;
  const next = isSafeNext(sp.next) ? sp.next! : '/';

  useEffect(() => {
    if (hydrated && isAuthed) {
      router.replace((next as never));
    }
  }, [hydrated, isAuthed, next, router]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = (await r.json()) as
        | {
            access_token: string;
            refresh_token: string;
            expires_in: number;
            expires_at: number;
          }
        | { error: string; email?: string };

      if (r.status === 403 && 'error' in data && data.error === 'email_not_verified') {
        const params = new URLSearchParams({ email: data.email ?? email.trim() });
        if (sp.next && isSafeNext(sp.next)) params.set('next', sp.next);
        router.push(`/verify-email?${params.toString()}` as never);
        return;
      }
      if (!r.ok || !('access_token' in data)) {
        const msg = 'error' in data ? data.error : `HTTP ${r.status}`;
        setError(humaniseError(msg));
        setErrorPulse((p) => p + 1);
        return;
      }
      setTokens(data);
      router.push(next as never);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'sign-in failed');
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
        <h1 className="text-[28px] font-bold tracking-tight text-text-primary">
          Welcome back.
        </h1>
        <p className="text-sm text-text-secondary">
          Sign in to keep generating.
        </p>
      </div>

      {reason === 'expired' && (
        <p
          role="status"
          className="animate-reveal-up stagger-child mt-5 rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-2 text-xs text-text-secondary"
          style={{ '--i': 1 } as CSSProperties}
        >
          Your session expired. Sign in again to pick up where you left off.
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4">
        <div className="animate-reveal-up stagger-child" style={{ '--i': 1 } as CSSProperties}>
          <Field
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={setEmail}
          />
        </div>
        <div className="animate-reveal-up stagger-child" style={{ '--i': 2 } as CSSProperties}>
          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={setPassword}
          />
        </div>
        <div
          className="animate-reveal-up stagger-child -mt-1 text-right"
          style={{ '--i': 3 } as CSSProperties}
        >
          <Link
            href={"/forgot-password" as never}
            className="text-[12px] font-medium text-text-accent underline-offset-2 hover:underline"
          >
            Forgot password?
          </Link>
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
          disabled={submitting || !email || !password}
          className="btn-accent animate-reveal-up stagger-child mt-1 px-5 py-3 text-base disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none"
          style={{ '--i': 4 } as CSSProperties}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <ArrowRight className="h-4 w-4" aria-hidden />
          )}
          {submitting ? 'Signing in' : 'Sign in'}
        </button>
      </form>

      <p
        className="animate-reveal-up stagger-child mt-6 text-center text-sm text-text-secondary"
        style={{ '--i': 5 } as CSSProperties}
      >
        New to ControlCraft?{' '}
        <Link
          href={(`/signup${sp.next ? `?next=${encodeURIComponent(sp.next)}` : ''}`) as never}
          className="font-medium text-text-accent underline-offset-2 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}

/** Only allow relative `next` paths so a malicious link can't redirect off-site. */
function isSafeNext(next: string | undefined): next is string {
  if (!next) return false;
  return next.startsWith('/') && !next.startsWith('//');
}

function humaniseError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('invalid') && lower.includes('cred')) return 'Wrong email or password.';
  if (lower.includes('invalid_grant')) return 'Wrong email or password.';
  if (lower.includes('account is not fully set up')) {
    return 'Account exists but is incomplete. Contact an admin.';
  }
  if (lower.includes('account disabled')) return 'Account is disabled.';
  return raw || 'Sign-in failed.';
}
