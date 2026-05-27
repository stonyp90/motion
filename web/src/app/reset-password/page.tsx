import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm';

export const metadata: Metadata = {
  title: 'Set a new password',
  description: 'Choose a new password for your ControlCraft account.',
  robots: { index: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const sp = await searchParams;
  const token = sp.token ?? '';

  // Soft client-side gate: if the link is missing the token entirely,
  // show the same expired-state copy. Server still re-validates.
  if (!token) {
    return (
      <AuthSplitLayout eyebrow="Reset password">
        <div className="animate-reveal-up rounded-2xl border border-border-light bg-bg-primary p-8 shadow-card sm:p-10">
          <div className="flex flex-col items-center gap-5 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-secondary-50 text-secondary-700">
              <AlertTriangle className="h-7 w-7" aria-hidden />
            </span>
            <h1 className="text-[26px] font-bold tracking-tight text-text-primary">
              Reset link missing or invalid.
            </h1>
            <p className="text-sm leading-relaxed text-text-secondary">
              Request a fresh one and we&apos;ll send it right over.
            </p>
            <Link
              href={"/forgot-password" as never}
              className="btn-accent mt-3 w-full justify-center px-5 py-3 text-base"
            >
              Request a new link
            </Link>
          </div>
        </div>
      </AuthSplitLayout>
    );
  }

  return (
    <AuthSplitLayout eyebrow="Reset password">
      <ResetPasswordForm token={token} />
    </AuthSplitLayout>
  );
}
