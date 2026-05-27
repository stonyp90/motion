import type { Metadata } from 'next';
import Link from 'next/link';
import { Inbox, ArrowRight } from 'lucide-react';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';

export const metadata: Metadata = {
  title: 'Reset link sent',
  description: 'If we have your address on file, a reset link is on its way.',
  robots: { index: false },
};

export default async function ForgotPasswordSentPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const sp = await searchParams;
  const email = sp.email ?? '';
  return (
    <AuthSplitLayout eyebrow="Check your inbox">
      <div className="animate-reveal-up rounded-2xl border border-border-light bg-bg-primary p-8 shadow-card sm:p-10">
        <div className="flex flex-col items-center gap-5 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-accent-50 text-accent-700">
            <Inbox className="h-7 w-7" aria-hidden />
          </span>
          <div className="flex flex-col gap-2">
            <h1 className="text-[26px] font-bold tracking-tight text-text-primary">
              Check your inbox.
            </h1>
            <p className="text-sm leading-relaxed text-text-secondary">
              If we have an account for{' '}
              <span className="font-medium text-text-primary">
                {email || 'that address'}
              </span>
              , a reset link is on its way. The link expires in one hour.
            </p>
          </div>
          <Link
            href={"/login" as never}
            className="btn-ghost mt-3 w-full justify-center px-5 py-3 text-sm"
          >
            <ArrowRight className="h-4 w-4" aria-hidden />
            Back to sign in
          </Link>
        </div>
      </div>
    </AuthSplitLayout>
  );
}
