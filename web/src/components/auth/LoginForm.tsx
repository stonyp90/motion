'use client';

import { use, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';

interface Props {
  searchParamsPromise: Promise<{ next?: string; reason?: string }>;
}

/**
 * Sign-in form — branded, talks to /api/auth/login. On success the
 * zustand store gets populated and the page redirects to either
 * `?next=` (if present and same-origin) or `/`.
 *
 * The form intentionally avoids dual-CTA chrome (no "sign in with
 * Google" buttons) — the realm only exposes password auth today.
 * SSO buttons land here when the realm enables them.
 */
export function LoginForm({ searchParamsPromise }: Props) {
  const sp = use(searchParamsPromise);
  const router = useRouter();
  const setTokens = useAuthStore((s) => s.setTokens);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reason = sp.reason;
  const next = isSafeNext(sp.next) ? sp.next! : '/';

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
        | { error: string };
      if (!r.ok || !('access_token' in data)) {
        const msg = 'error' in data ? data.error : `HTTP ${r.status}`;
        setError(humaniseError(msg));
        return;
      }
      setTokens(data);
      router.push(next as never);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'sign-in failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative z-10 mx-auto w-full max-w-md">
      <div className="rounded-2xl border border-border-light bg-bg-primary p-8 shadow-card sm:p-10">
        <div className="flex flex-col gap-1.5">
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
            className="mt-5 rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-2 text-xs text-text-secondary"
          >
            Your session expired. Sign in again to pick up where you left off.
          </p>
        )}

        <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4">
          <Field
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={setEmail}
          />
          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={setPassword}
          />
          {error && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting || !email || !password}
            className="btn-accent mt-1 px-5 py-3 text-base disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <ArrowRight className="h-4 w-4" aria-hidden />
            )}
            {submitting ? 'Signing in' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-text-secondary">
          New to IMTN?{' '}
          <Link
            href={(`/signup${sp.next ? `?next=${encodeURIComponent(sp.next)}` : ''}`) as never}
            className="font-medium text-text-accent underline-offset-2 hover:underline"
          >
            Create an account
          </Link>
        </p>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  required?: boolean;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-text-primary">{label}</span>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border-light bg-bg-primary px-3 py-2.5 text-base text-text-primary placeholder:text-text-tertiary focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/20"
      />
    </label>
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
