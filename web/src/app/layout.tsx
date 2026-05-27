import type { Metadata, Viewport } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import { ThemeProvider } from '@/components/ThemeProvider';
import { AuthInitializer } from '@/components/auth/AuthInitializer';
import { FirstRunWizard } from '@/components/FirstRunWizard';
import { UpdateBanner } from '@/components/UpdateBanner';
import './globals.css';

// Body font — Inter for paragraphs, buttons, form fields, anything
// that needs the maximum legibility budget. Variable, swap-loaded.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

// Display font — Space Grotesk for the ControlCraft wordmark and section
// headlines. Geometric, slightly mechanical, reads premium-tech at
// large sizes. Pairs cleanly with Inter (matching x-height) so the
// type system stays cohesive.
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
  weight: ['400', '500', '600', '700'],
});

// FOUC guard: set data-theme on <html> before React hydrates, based on
// localStorage `mf-theme` (`light` | `dark` | `system`) → falls through
// to the OS `prefers-color-scheme` media query. Synchronous; runs in
// <head> so the first paint matches the chosen theme.
const themeFoucScript = `
(function () {
  try {
    var s = localStorage.getItem('mf-theme');
    var t = s === 'light' || s === 'dark' ? s
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', t);
  } catch (_) {}
})();
`;

export const metadata: Metadata = {
  metadataBase: new URL('https://controlcraft.io'),
  title: {
    default: 'ControlCraft — prompt-based motion graphics',
    template: '%s · ControlCraft',
  },
  description:
    'Type a prompt, get a motion graphic. Local engine + local models, no cloud round-trip. 90s first render, sub-second iterations.',
  applicationName: 'ControlCraft',
  authors: [{ name: 'ControlCraft' }],
  generator: 'Next.js',
  keywords: [
    'motion graphics',
    'motion design',
    'prompt-based animation',
    'lottie',
    'brand motion',
    'animated explainer',
    'after effects alternative',
  ],
  // Pin the canonical so the site reads as one origin even when served
  // from motion.ursly.io or any preview/alias domain. Prevents duplicate-
  // content downranking and unifies link equity.
  alternates: {
    canonical: 'https://controlcraft.io',
  },
  openGraph: {
    type: 'website',
    siteName: 'ControlCraft',
    url: 'https://controlcraft.io',
    title: 'ControlCraft — prompt-based motion graphics',
    description:
      'Type a prompt, get a motion graphic. Local engine + local models, no cloud round-trip. 90s first render, sub-second iterations.',
    // opengraph-image.tsx is picked up automatically by Next at this URL.
    images: [{ url: '/opengraph-image', width: 1200, height: 630 }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ControlCraft — prompt-based motion graphics',
    description:
      'Type a prompt, get a motion graphic. Brand-grade motion design the same day a brief lands.',
    images: ['/opengraph-image'],
  },
  // Icons: Next auto-discovers app/icon.svg, app/apple-icon.tsx, etc.
  // from the filesystem — no explicit URLs needed here. See:
  // https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons
  manifest: '/manifest.webmanifest',
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
  },
};

// Viewport — Next 15 moved themeColor + colorScheme out of metadata into
// a dedicated viewport export. The split below recolors Safari's toolbar
// + Android's status bar to match whichever theme is active rather than
// picking one literal globally.
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1014' },
  ],
  colorScheme: 'light dark',
  width: 'device-width',
  initialScale: 1,
};

// JSON-LD — SoftwareApplication schema. Lets Google render rich
// "tool" results (cross-platform support, price, category) and ties
// search impressions to the brand-name knowledge graph.
const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': 'https://controlcraft.io#org',
      name: 'ControlCraft',
      url: 'https://controlcraft.io',
      logo: 'https://controlcraft.io/icon.svg',
    },
    {
      '@type': 'WebSite',
      '@id': 'https://controlcraft.io#site',
      url: 'https://controlcraft.io',
      name: 'ControlCraft',
      publisher: { '@id': 'https://controlcraft.io#org' },
    },
    {
      '@type': 'SoftwareApplication',
      name: 'ControlCraft',
      description:
        'Prompt-based motion-graphics tool. Local engine + local models. 90s first render, sub-second iterations.',
      url: 'https://controlcraft.io',
      applicationCategory: 'DesignApplication',
      operatingSystem: 'macOS, Windows, Linux',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
      creator: { '@id': 'https://controlcraft.io#org' },
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeFoucScript }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      </head>
      <body>
        {/* Skip-to-content link — invisible until keyboard-focused. Gives
            keyboard-only and screen-reader users a single-tab jump past
            the header into the page's main landmark. The receiving
            element is whatever page mounts <main id="main">. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-text-primary focus:shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          Skip to content
        </a>
        <ThemeProvider>
          <AuthInitializer />
          {children}
          {/* Desktop-only: first-launch model-setup wizard. Self-gated
              on window.__TAURI__ so the hosted web build never sees it. */}
          <FirstRunWizard />
          {/* Desktop-only: auto-update banner. Polls `plugin:updater|check`
              on mount; shows a floating toast when a new version is
              available and walks the user through download + restart. */}
          <UpdateBanner />
        </ThemeProvider>
      </body>
    </html>
  );
}
