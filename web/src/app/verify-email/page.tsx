import type { Metadata } from 'next';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import { VerifyEmailPending } from '@/components/auth/VerifyEmailPending';

export const metadata: Metadata = {
  title: 'Confirm your email',
  description: 'Click the link in your inbox to finish setting up your ControlCraft account.',
  robots: { index: false },
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; next?: string }>;
}) {
  const sp = await searchParams;
  return (
    <AuthSplitLayout eyebrow="Verify your email">
      <VerifyEmailPending email={sp.email ?? ''} />
    </AuthSplitLayout>
  );
}
