/**
 * robots.ts — Next.js Metadata API robots file.
 *
 * Tells crawlers what's public-facing and where the sitemap lives.
 * Private surfaces (API routes, authenticated dashboard, internal
 * preview/test pages) are explicitly disallowed.
 */

import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/'],
        disallow: [
          '/api/',
          '/dashboard/',
          '/preview-demo/',
          '/studio/',
        ],
      },
    ],
    sitemap: 'https://controlcraft.io/sitemap.xml',
    host: 'https://controlcraft.io',
  };
}
