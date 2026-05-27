import type { Metadata } from 'next';
import { AuthSplitLayout } from '@/components/auth/AuthSplitLayout';
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm';

export const metadata: Metadata = {
  title: 'Reset your password',
  description: 'Request a password reset link for your ControlCraft account.',
  robots: { index: false },
};

export default function ForgotPasswordPage() {
  return (
    <AuthSplitLayout eyebrow="Reset password">
      <ForgotPasswordForm />
    </AuthSplitLayout>
  );
}
