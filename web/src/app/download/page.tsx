import type { Metadata } from 'next';
import { AuthGate } from '@/components/AuthGate';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { DownloadHero } from '@/components/download/DownloadHero';

export const metadata: Metadata = {
  title: 'Download ControlCraft · Desktop',
  description:
    'ControlCraft Desktop runs the prompt-to-motion-graphic pipeline locally. No cloud round-trip, no rate limits. macOS, Windows, Linux.',
};

/**
 * Customer download surface for the ControlCraft desktop app.
 *
 * The desktop binary is a customer artifact, not marketing material —
 * we don't expose it to anonymous visitors. The `AuthGate` wrapper
 * redirects un-signed-in users to `/login?next=/download` so they
 * land back here after authenticating. Server-side, the actual
 * binary endpoint (`/api/download/<os>`) is the second gate;
 * scripting around the UI still has to clear that.
 *
 * Inside the gate: a client component (`DownloadHero`) hits the
 * release manifest at first paint to surface the freshest
 * `desktop-v*` build for each platform. If the manifest is unreachable
 * the component falls back to a stable releases link so the page
 * never reads as broken.
 */
export default function DownloadPage() {
  return (
    <main className="flex min-h-screen flex-col bg-bg-primary">
      <Header />
      <div className="flex-1">
        <AuthGate>
          <DownloadHero />
        </AuthGate>
      </div>
      <Footer />
    </main>
  );
}
