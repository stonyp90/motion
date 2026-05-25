'use client';

import { use, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';

interface Props {
  searchParamsPromise: Promise<{ next?: string }>;
}

/**
 * Sign-up form — branded, talks to /api/auth/register. The server
 * route creates the Keycloak user via the admin REST API and then
 * issues a password-grant login so the response carries tokens.
 * Email verification is off at the realm level, so the form is one
 * step: submit → logged in → redirect.
 */
export function SignupForm({ searchParamsPromise }: Props) {
  const sp = use(searchParamsPromise);
  const router = useRouter();
  const setTokens = useAuthStore((s) => s.setTokens);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = isSafeNext(sp.next) ? sp.next! : '/';
  const passwordStrength = scorePassword(password);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
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
        | {
            access_token: string;
            refresh_token: string;
            expires_in: number;
            expires_at: number;
          }
        | { error: string };
      if (!r.ok || !('access_token' in data)) {
        const msg = 'error' in data ? data.error : `HTTP ${r.status}`;
        setError(humaniseError(msg, r.status));
        return;
      }
      setTokens(data);
      router.push(next as never);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'sign-up failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative z-10 mx-auto w-full max-w-md">
      <div className="rounded-2xl border border-border-light bg-bg-primary p-8 shadow-card sm:p-10">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[28px] font-bold tracking-tight text-text-primary">
            Create your account.
          </h1>
          <p className="text-sm text-text-secondary">
            Free during the open beta. No card.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-7 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
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
          <Field
            id="email"
            label="Work email"
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
            autoComplete="new-password"
            required
            value={password}
            onChange={setPassword}
            hint={passwordHint(password.length, passwordStrength)}
          />
          {password.length > 0 && (
            <PasswordStrengthBar score={passwordStrength} />
          )}
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
            {submitting ? 'Creating' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-text-secondary">
          Already have an account?{' '}
          <Link
            href={(`/login${sp.next ? `?next=${encodeURIComponent(sp.next)}` : ''}`) as never}
            className="font-medium text-text-accent underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </p>
        <p className="mt-3 text-center text-[11px] text-text-tertiary">
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
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  hint?: string;
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
      {hint && <span className="text-[11px] text-text-tertiary">{hint}</span>}
    </label>
  );
}

/* ------------------------------------------------------- password helpers */

function scorePassword(p: string): 0 | 1 | 2 | 3 | 4 {
  // Very small heuristic — Tablix-style five-level meter. Don't gate
  // submit on this; the server is the authority.
  if (p.length === 0) return 0;
  let score = 0;
  if (p.length >= 8) score += 1;
  if (p.length >= 12) score += 1;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score += 1;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) score += 1;
  return Math.min(4, score) as 0 | 1 | 2 | 3 | 4;
}

function passwordHint(len: number, score: 0 | 1 | 2 | 3 | 4): string | undefined {
  if (len === 0) return 'At least 8 characters.';
  if (len < 8) return `${8 - len} more character${8 - len === 1 ? '' : 's'}.`;
  if (score <= 1) return 'Add a mix of cases, numbers, and symbols for a stronger password.';
  return undefined;
}

function PasswordStrengthBar({ score }: { score: 0 | 1 | 2 | 3 | 4 }) {
  const labels = ['Too short', 'Weak', 'OK', 'Good', 'Strong'] as const;
  const colors = [
    'bg-red-400',
    'bg-orange-400',
    'bg-yellow-400',
    'bg-accent-400',
    'bg-accent-600',
  ];
  return (
    <div className="-mt-2 flex items-center gap-2 text-[11px] text-text-tertiary">
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full ${
              i < score ? colors[score] : 'bg-border-light'
            }`}
          />
        ))}
      </div>
      <span className="min-w-[5ch] text-right">{labels[score]}</span>
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
