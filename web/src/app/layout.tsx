import type { Metadata } from 'next';
import './globals.css';

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
      <body>{children}</body>
    </html>
  );
}
