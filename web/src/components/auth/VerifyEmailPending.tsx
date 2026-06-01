'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { Loader2, Mail, Inbox } from 'lucide-react';

interface Props {
  email: string;
}

/**
 * Pending-state surface after signup or after a 403 email_not_verified
 * branch from login. Tells the user to check their inbox and offers a
 * resend with a 60s cooldown to keep accidental double-clicks from
 * burning the rate-limit bucket.
 *
 * Privacy: the resend button always shows "Email sent." even if the
 * server skipped (account verified or not found). The server endpoint
 * is deliberately 200-always, so any client-side claim about the
 * outcome would lie. We surface success-y copy without claiming
 * anything we can't prove.
 */
export function VerifyEmailPending({ email }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sentNonce, setSentNonce] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => window.clearInterval(t);
  }, [cooldown]);

  const handleResend = async () => {
    if (submitting || cooldown > 0) return;
    setSubmitting(true);
    try {
      await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }).catch(() => {});
      setSentNonce((n) => n + 1);
      setCooldown(60);
    } finally {
      setSubmitting(false);
    }
  };

  const displayEmail = email || 'your inbox';

  return (
    <div className="animate-reveal-up rounded-2xl border border-border-light bg-bg-secondary p-8 shadow-card sm:p-10">
      <div
        className="animate-reveal-up stagger-child flex items-center justify-center"
        style={{ '--i': 0 } as CSSProperties}
      >
        <span className="grid h-14 w-14 place-items-center rounded-full bg-accent-50 text-accent-700">
          <Inbox className="h-6 w-6" aria-hidden />
        </span>
      </div>
      <div
        className="animate-reveal-up stagger-child mt-6 flex flex-col gap-2 text-center"
        style={{ '--i': 1 } as CSSProperties}
      >
        <h1 className="text-[26px] font-bold tracking-tight text-text-primary">
          Check your inbox.
        </h1>
        <p className="text-sm leading-relaxed text-text-secondary">
          We just sent a confirmation link to{' '}
          <span className="font-medium text-text-primary">{displayEmail}</span>.
          Click it and you&apos;re in. The link expires in 24 hours.
        </p>
      </div>

      <button
        type="button"
        onClick={handleResend}
        disabled={submitting || cooldown > 0}
        className="btn-ghost animate-reveal-up stagger-child mt-6 w-full justify-center px-5 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-60"
        style={{ '--i': 2 } as CSSProperties}
      >
        {submitting ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Mail className="h-4 w-4" aria-hidden />
        )}
        {cooldown > 0
          ? `Resend available in ${cooldown}s`
          : submitting
            ? 'Resending'
            : 'Resend the link'}
      </button>

      {sentNonce > 0 && cooldown > 0 && (
        <p
          key={sentNonce}
          role="status"
          className="animate-toast-in mt-4 text-center text-xs text-text-tertiary"
        >
          If we have your address on file, the link is on its way.
        </p>
      )}

      <p
        className="animate-reveal-up stagger-child mt-6 text-center text-xs text-text-tertiary"
        style={{ '--i': 3 } as CSSProperties}
      >
        Already verified?{' '}
        <Link
          href={"/login" as never}
          className="font-medium text-text-accent underline-offset-2 hover:underline"
        >
          Sign in
        </Link>
        {' · '}
        Wrong email?{' '}
        <Link
          href={"/signup" as never}
          className="font-medium text-text-accent underline-offset-2 hover:underline"
        >
          Start over
        </Link>
      </p>
    </div>
  );
}
