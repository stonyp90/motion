import type { Metadata } from 'next';
import { Inter, Space_Grotesk } from 'next/font/google';
import { ThemeProvider } from '@/components/ThemeProvider';
import { AuthInitializer } from '@/components/auth/AuthInitializer';
import './globals.css';

// Body font — Inter for paragraphs, buttons, form fields, anything
// that needs the maximum legibility budget. Variable, swap-loaded.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

// Display font — Space Grotesk for the IMTN wordmark and section
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
  metadataBase: new URL('https://imtn.io'),
  title: {
    default: 'IMTN — prompt-based motion graphics',
    template: '%s · IMTN',
  },
  description:
    'Type a prompt, get a motion graphic. Local engine + local models, no cloud round-trip. 90s first render, sub-second iterations.',
  openGraph: {
    title: 'IMTN — prompt-based motion graphics',
    description:
      'Type a prompt, get a motion graphic. Local engine + local models, no cloud round-trip. 90s first render, sub-second iterations.',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
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
      </head>
      <body>
        <ThemeProvider>
          <AuthInitializer />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
