import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';

export const metadata: Metadata = {
  title: 'Link expired',
  description: 'Your ControlCraft email confirmation link is no longer valid.',
  robots: { index: false },
};

export default function VerifyEmailExpiredPage() {
  return (
    <AuthSplitLayout eyebrow="Link expired">
      <div className="animate-reveal-up rounded-2xl border border-border-light bg-bg-primary p-8 shadow-card sm:p-10">
        <div className="flex flex-col items-center gap-5 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-secondary-50 text-secondary-700">
            <AlertTriangle className="h-7 w-7" aria-hidden />
          </span>
          <div className="flex flex-col gap-2">
            <h1 className="text-[26px] font-bold tracking-tight text-text-primary">
              That link no longer works.
            </h1>
            <p className="text-sm leading-relaxed text-text-secondary">
              Your confirmation link expired or has already been used. Sign
              in to request a fresh one if your email isn&apos;t verified yet.
            </p>
          </div>
          <Link
            href={"/login" as never}
            className="btn-accent mt-3 w-full justify-center px-5 py-3 text-base"
          >
            <ArrowRight className="h-4 w-4" aria-hidden />
            Sign in
          </Link>
          <Link
            href={"/signup" as never}
            className="text-xs text-text-tertiary underline-offset-2 hover:text-text-secondary hover:underline"
          >
            Or start over with a new account
          </Link>
        </div>
      </div>
    </AuthSplitLayout>
  );
}
