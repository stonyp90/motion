import type { Metadata } from 'next';
import { ThemeProvider } from '@/components/ThemeProvider';
import './globals.css';

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
  metadataBase: new URL('https://motion-forge.io'),
  title: {
    default: 'motion-forge — prompt-based motion graphics',
    template: '%s · motion-forge',
  },
  description:
    'Type a prompt, get a motion graphic. 90s first render, sub-second iterations, $0.18 per spot.',
  openGraph: {
    title: 'motion-forge — prompt-based motion graphics',
    description:
      'Type a prompt, get a motion graphic. 90s first render, sub-second iterations, $0.18 per spot.',
    type: 'website',
  },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeFoucScript }} />
      </head>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
