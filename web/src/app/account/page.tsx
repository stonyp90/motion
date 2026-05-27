import type { Metadata } from 'next';
import { AuthGate } from '@/components/AuthGate';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { ProfileLayout } from '@/components/account/ProfileLayout';

export const metadata: Metadata = {
  title: 'Account · ControlCraft',
  description: 'Manage your ControlCraft profile, password, and preferences.',
  robots: { index: false },
};

export default function AccountPage() {
  return (
    <main className="flex min-h-screen flex-col bg-bg-primary">
      <Header />
      <div className="flex-1">
        <AuthGate>
          <ProfileLayout />
        </AuthGate>
      </div>
      <Footer />
    </main>
  );
}
