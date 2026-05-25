import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { ApiKeysDashboard } from '@/components/dashboard/ApiKeysDashboard';

export const metadata: Metadata = {
  title: 'API keys · motion-forge',
  description: 'Issue and revoke motion-forge API keys.',
};

export default function ApiKeysPage() {
  return (
    <main className="flex min-h-screen flex-col bg-bg-primary">
      <Header />
      <section className="mx-auto w-full max-w-3xl flex-1 px-4 py-12">
        <ApiKeysDashboard />
      </section>
      <Footer />
    </main>
  );
}
