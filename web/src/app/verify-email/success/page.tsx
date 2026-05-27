import type { Metadata } from 'next';
import Link from 'next/link';
import { CheckCircle2, ArrowRight } from 'lucide-react';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';

export const metadata: Metadata = {
  title: 'Email confirmed',
  description: 'Your ControlCraft email is confirmed. Sign in to continue.',
  robots: { index: false },
};

export default function VerifyEmailSuccessPage() {
  return (
    <AuthSplitLayout eyebrow="You're in">
      <div className="animate-reveal-up rounded-2xl border border-border-light bg-bg-primary p-8 shadow-card sm:p-10">
        <div className="flex flex-col items-center gap-5 text-center">
          <span className="animate-auth-spring-in grid h-14 w-14 place-items-center rounded-full bg-accent-50 text-accent-700">
            <CheckCircle2 className="h-7 w-7" aria-hidden />
          </span>
          <div className="flex flex-col gap-2">
            <h1 className="text-[26px] font-bold tracking-tight text-text-primary">
              Email confirmed.
            </h1>
            <p className="text-sm leading-relaxed text-text-secondary">
              Your account is ready. Sign in to start generating.
            </p>
          </div>
          <Link
            href={"/login" as never}
            className="btn-accent mt-3 w-full justify-center px-5 py-3 text-base"
          >
            <ArrowRight className="h-4 w-4" aria-hidden />
            Sign in
          </Link>
        </div>
      </div>
    </AuthSplitLayout>
  );
}
