'use client';

import { useState, type CSSProperties, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { AlertOctagon, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';
import { Field } from '@/components/auth/_shared/Field';

/**
 * Account disable. v1 calls a soft-disable on the Keycloak user
 * (recoverable by an operator). Requires both a typed confirmation
 * phrase (so a stray click can't fire) and the current password (so a
 * stolen JWT can't disable the account).
 */
export function DangerZone() {
  const router = useRouter();
  const bearer = useAuthStore((s) => s.accessToken);
  const email = useAuthStore((s) => s.user?.email) ?? '';
  const clear = useAuthStore((s) => s.clear);

  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const phrase = `disable ${email}`;
  const phraseOK = confirm.trim().toLowerCase() === phrase.toLowerCase();

  const handleDisable = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!bearer || submitting || !phraseOK || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch('/api/auth/account', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({ password }),
      });
      if (r.status === 204) {
        clear();
        router.push('/');
        router.refresh();
        return;
      }
      const data = (await r.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? 'Could not disable account.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      className="animate-reveal-up stagger-child rounded-2xl border border-red-200 bg-red-50/40 p-6 dark:border-red-900/50 dark:bg-red-950/20 sm:p-8"
      style={{ '--i': 3 } as CSSProperties}
    >
      <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-text-primary">
        <AlertOctagon className="h-4 w-4 text-red-600 dark:text-red-400" aria-hidden />
        Danger zone
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-text-secondary">
        Disable your account. You can&apos;t sign in until an operator re-enables it.
        Your data isn&apos;t deleted — contact support to restore access.
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 inline-flex items-center justify-center gap-2 rounded-full border border-red-300 bg-bg-primary px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-950/40"
        >
          Disable account
        </button>
      ) : (
        <form onSubmit={handleDisable} className="mt-4 flex flex-col gap-3">
          <Field
            id="disable-confirm"
            label={`Type "${phrase}" to confirm`}
            value={confirm}
            onChange={setConfirm}
            autoComplete="off"
          />
          <Field
            id="disable-password"
            label="Your password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={setPassword}
          />
          {error && (
            <p role="alert" className="animate-shake text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setConfirm('');
                setPassword('');
                setError(null);
              }}
              className="btn-ghost px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!phraseOK || !password || submitting}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-200 hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-neutral-300 disabled:shadow-none"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
              {submitting ? 'Disabling' : 'Disable my account'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
