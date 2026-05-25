import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { SignupForm } from '@/components/auth/SignupForm';

export const metadata: Metadata = {
  title: 'Create account',
  description: 'Create your motion-forge account.',
};

export default function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  return (
    <main className="flex min-h-screen flex-col bg-bg-primary">
      <Header />
      <section className="relative flex flex-1 items-center justify-center bg-hero-grid px-4 py-16">
        <SignupForm searchParamsPromise={searchParams} />
      </section>
      <Footer />
    </main>
  );
}
