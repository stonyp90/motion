import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { DocsViewer } from '@/components/docs/DocsViewer';

export const metadata: Metadata = {
  title: 'API · IMTN',
  description:
    'OpenAPI 3.1 reference for the IMTN public API — generate, iterate, presets, exports, and API key management.',
};

/**
 * /docs renders the OpenAPI 3.1 spec served at /openapi.json by the
 * engine. We deliberately keep this as a server page so the spec URL
 * is rendered into the initial HTML (Scalar then hydrates client-side
 * to pretty-print + add try-it). Authenticated users see their own
 * API keys threaded through `defaultHeaders` so curl examples copy
 * with the real header pre-populated; anon visitors see the example
 * placeholder.
 *
 * Engine base URL comes from NEXT_PUBLIC_ENGINE_BASE_URL (same env the
 * SDK uses), with a localhost fallback for the open-source dev story.
 */
export default function DocsPage() {
  const engineBase =
    process.env.NEXT_PUBLIC_ENGINE_BASE_URL ?? 'http://127.0.0.1:7700';
  const specUrl = `${engineBase}/openapi.json`;

  return (
    <main className="flex min-h-screen flex-col bg-bg-primary">
      <Header />
      <DocsViewer specUrl={specUrl} engineBase={engineBase} />
      <Footer />
    </main>
  );
}
