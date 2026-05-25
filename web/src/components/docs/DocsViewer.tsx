'use client';

import { ApiReferenceReact } from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';

/**
 * Client-side Scalar reference. Wrapped in our chrome so the header
 * + footer stay branded and the viewer fills the remaining height
 * without overflow oddities.
 *
 * Why Scalar over Redoc / Swagger UI:
 *   - Native dark/light theme via CSS vars, matches our token system
 *   - First-party "try it" panel without a separate proxy
 *   - Smaller bundle than Swagger UI's monaco dep
 */
export function DocsViewer({
  specUrl,
  engineBase,
}: {
  specUrl: string;
  engineBase: string;
}) {
  return (
    <section className="relative flex-1 bg-bg-primary">
      <ApiReferenceReact
        configuration={{
          spec: { url: specUrl },
          theme: 'default',
          layout: 'modern',
          hideDownloadButton: false,
          hideTestRequestButton: false,
          servers: [
            {
              url: engineBase,
              description: 'motion-forge engine (local dev)',
            },
            {
              url: 'https://api.motion-forge.io',
              description: 'motion-forge engine (production)',
            },
          ],
        }}
      />
    </section>
  );
}
