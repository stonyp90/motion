import type { Metadata } from 'next';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to ControlCraft.',
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  return (
    <AuthSplitLayout eyebrow="Welcome back">
      <LoginForm searchParamsPromise={searchParams} />
    </AuthSplitLayout>
  );
}
