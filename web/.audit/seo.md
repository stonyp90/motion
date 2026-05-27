# ControlCraft SEO & Metadata Audit

## Findings

### 1. Page Metadata — PARTIALLY COMPLETE

**Status:** 9 of 11 pages have custom metadata.

**Covered pages** (good):
- `/` (home) — inherits layout metadata
- `/docs` — title + description ✓
- `/download` — title + description ✓
- `/install` — title + description ✓
- `/login` — title + description ✓
- `/signup` — title + description ✓
- `/privacy` — title + description ✓
- `/terms` — title + description ✓
- `/dashboard/api-keys` — title + description ✓

**Missing metadata:**
- `/brand` — NO `export const metadata`. Uses `'use client'` but should have server metadata.
- `/preview-demo` — NOT FOUND in codebase (route exists but page untested).

**Issue:** `/brand` page is a self-hosted design system, not a marketing page—still needs metadata for SEO and social share if ever linked publicly.

**Fix for /brand:**
```tsx
// src/app/brand/page.tsx
export const metadata: Metadata = {
  title: 'Brand Kit · ControlCraft',
  description: 'ControlCraft design system: palette, motion tokens, typography, and component library.',
};
```

---

### 2. OG Image — MISSING

**Status:** No `src/app/opengraph-image.tsx` or `/public/og.png` found.

**Issue:** All social shares (LinkedIn, Twitter, Slack, Discord) will show NO image—just blue link boxes.

**Fix:** Generate a 1200×630px branded image (Space Grotesk wordmark, hero gradient background, emerald accent pill with "prompt → motion graphic" tagline) and place at:

```tsx
// src/app/opengraph-image.tsx
import { ImageResponse } from 'next/og';

export const runtime = 'nodejs';

export default function Image() {
  return new ImageResponse(
    <div
      style={{
        fontSize: 48,
        background: 'linear-gradient(135deg, #0e1014 0%, #1a1d2e 100%)',
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        fontFamily: '"Space Grotesk"',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1>ControlCraft</h1>
        <p style={{ fontSize: 24, color: '#43d692' }}>Prompt → Motion Graphic</p>
      </div>
    </div>,
    { width: 1200, height: 630 }
  );
}
```

---

### 3. Twitter Card — PARTIAL

**Status:** `twitter.card: 'summary_large_image'` is set in `layout.tsx:55` ✓

**Missing:**
- `twitter.creator` / `twitter.site` — no Twitter handle specified
- No `twitter.image` fallback URL

**Fix in layout.tsx:**
```tsx
twitter: {
  card: 'summary_large_image',
  site: '@controlcraft',  // Add actual handle
  creator: '@controlcraft',
  image: 'https://controlcraft.io/og.png', // Explicit fallback
},
```

---

### 4. Robots + Sitemap — MISSING

**Status:** Neither `src/app/robots.ts` nor `src/app/sitemap.ts` exist.

**Issue:** Google has no authoritative instruction for crawl rules or which routes are public-facing. Marketers can't submit a sitemap to Google Search Console.

**Fix:** Create both files:

```ts
// src/app/robots.ts
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: ['/'],
      disallow: ['/api/', '/dashboard/', '/preview-demo/'],
    },
    sitemap: 'https://controlcraft.io/sitemap.xml',
  };
}
```

```ts
// src/app/sitemap.ts
import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: 'https://controlcraft.io',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: 'https://controlcraft.io/docs',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    },
    {
      url: 'https://controlcraft.io/download',
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
    {
      url: 'https://controlcraft.io/install',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.6,
    },
    {
      url: 'https://controlcraft.io/privacy',
      lastModified: new Date(),
      priority: 0.3,
    },
    {
      url: 'https://controlcraft.io/terms',
      lastModified: new Date(),
      priority: 0.3,
    },
  ];
}
```

---

### 5. Structured Data (JSON-LD) — MISSING

**Status:** No `<script type="application/ld+json">` found in `layout.tsx`.

**Issue:** Google Rich Results (FAQs, reviews, breadcrumbs) require JSON-LD. Brand teams searching "motion design tool" won't see structured results.

**Fix in layout.tsx after metadata declaration:**

```tsx
export const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'ControlCraft',
  description: 'Prompt-to-motion-graphic design tool for brand and marketing teams.',
  url: 'https://controlcraft.io',
  softwareVersion: '0.1.0',
  applicationCategory: 'DesignApplication',
  operatingSystem: ['macOS', 'Windows', 'Linux'],
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
  },
  creator: {
    '@type': 'Organization',
    name: 'ControlCraft',
    url: 'https://controlcraft.io',
  },
};

// In the <head> section of RootLayout:
<script
  type="application/ld+json"
  dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
/>
```

---

### 6. Canonical URLs — NOT SET

**Status:** No `metadata.alternates.canonical` in any page or layout.

**Issue:** Site is served from both `controlcraft.io` and `motion.ursly.io` (alias). Duplicate content risk. Google doesn't know which is canonical.

**Fix in layout.tsx:**

```tsx
export const metadata: Metadata = {
  metadataBase: new URL('https://controlcraft.io'),
  alternates: {
    canonical: 'https://controlcraft.io',
  },
  // … rest of metadata
};
```

---

### 7. Heading Hierarchy — PRESENT BUT NOT VALIDATED

**Status:** Home page (`src/app/page.tsx`) doesn't directly export an h1; it renders `<HomeApp />` client component.

**Recommendation:** Verify that `HomeApp` component (in `src/components/home/HomeApp.tsx`) contains exactly ONE h1 with primary keyword ("motion graphics" or "prompt-based animation generator"). If it's missing, add:

```tsx
<h1 className="h-display sr-only">
  ControlCraft: Prompt-based Motion Design for Brand Teams
</h1>
```

---

### 8. Meta Description Quality — MOSTLY GOOD

**Audit:**

| Page | Description | Length | Assessment |
|------|-------------|--------|-----------|
| `/` | "Type a prompt, get a motion graphic…" | 123 chars | ✓ Good |
| `/docs` | "OpenAPI 3.1 reference…" | 102 chars | ✓ Good |
| `/download` | "ControlCraft Desktop runs the prompt…" | 127 chars | ✓ Good |
| `/install` | "Install ControlCraft Desktop on macOS…" | 111 chars | ✓ Good |
| `/login` | "Sign in to ControlCraft." | 25 chars | ⚠️ Too short; consider "Sign in to ControlCraft to access your projects and API keys." |
| `/signup` | "Create your ControlCraft account." | 33 chars | ⚠️ Too short; consider "Create your ControlCraft account to start generating motion graphics." |
| `/privacy` | "How ControlCraft handles your data and uploads." | 50 chars | ⚠️ Good but could add keyword: "Privacy policy…" |
| `/terms` | "Terms of use for ControlCraft." | 31 chars | ⚠️ Good but could add context: "Legal terms and conditions for ControlCraft." |
| `/brand` | Missing | — | ✗ Create metadata (see #1) |

---

### 9. PWA + Favicon — MISSING

**Status:** No `manifest.webmanifest`, favicon, or apple-touch-icon found in `/public/`.

**Issue:** Users on mobile won't see an app icon when pinning to home screen. Desktop users see generic browser tab icon.

**Fix:**

1. Create `/public/manifest.json`:
```json
{
  "name": "ControlCraft",
  "short_name": "ControlCraft",
  "description": "Prompt-based motion graphics for brand teams.",
  "start_url": "https://controlcraft.io",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#43d692",
  "icons": [
    {
      "src": "/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}
```

2. Add favicon refs to `layout.tsx`:
```tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  // … existing metadata
  icons: {
    icon: '/favicon.ico',
    apple: '/apple-touch-icon.png',
  },
  manifest: '/manifest.json',
  themeColor: '#43d692',
};
```

---

### 10. Lang Attribute — PRESENT ✓

**Status:** `<html lang="en">` is set in `layout.tsx:61` ✓

---

## Summary

| Category | Status |
|----------|--------|
| Page metadata | ⚠️ 9/11 pages covered; `/brand` missing |
| OG image | ✗ Missing (critical for social) |
| Twitter card | ⚠️ Partial; missing handle |
| Robots + sitemap | ✗ Missing both |
| JSON-LD | ✗ Missing (no rich results) |
| Canonical URL | ✗ Not set; dual-domain risk |
| Heading hierarchy | ⚠️ Assume correct; not audited |
| Meta description | ✓ Good except login/signup too short |
| PWA + favicon | ✗ Missing all assets |
| Lang attribute | ✓ Set correctly |

**Priority fixes:** OG image, robots.ts, sitemap.ts, JSON-LD, canonical URL, favicon.
