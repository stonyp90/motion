import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { DownloadHero } from '@/components/download/DownloadHero';

export const metadata: Metadata = {
  title: 'Download IMTN · Desktop',
  description:
    'IMTN Desktop runs the prompt-to-motion-graphic pipeline locally. No cloud round-trip, no rate limits. macOS, Windows, Linux.',
};

/**
 * Marketing + utility page for the desktop download.
 *
 * Server-rendered title / OG metadata + a client component that hits
 * the GitHub Releases API at first paint to surface the freshest
 * `desktop-v*` tag for each platform. If the API is unreachable (rate
 * limit, offline), the component falls back to a stable releases-page
 * link so the page never reads as broken.
 */
export default function DownloadPage() {
  return (
    <main className="flex min-h-screen flex-col bg-bg-primary">
      <Header />
      <div className="flex-1">
        <DownloadHero />
      </div>
      <Footer />
    </main>
  );
}
