import type { Metadata } from 'next';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import { SignupForm } from '@/components/auth/SignupForm';

export const metadata: Metadata = {
  title: 'Create account',
  description: 'Create your ControlCraft account.',
};

export default function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  return (
    <AuthSplitLayout eyebrow="Create your account">
      <SignupForm searchParamsPromise={searchParams} />
    </AuthSplitLayout>
  );
}
