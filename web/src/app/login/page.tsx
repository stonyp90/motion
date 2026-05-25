import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to motion-forge.',
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  return (
    <main className="flex min-h-screen flex-col bg-bg-primary">
      <Header />
      <section className="relative flex flex-1 items-center justify-center bg-hero-grid px-4 py-16">
        <LoginForm searchParamsPromise={searchParams} />
      </section>
      <Footer />
    </main>
  );
}
