import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://motion-forge.io'),
  title: {
    default: 'motion-forge — motion design at the speed of your roadmap',
    template: '%s · motion-forge',
  },
  description:
    'Ship broadcast-grade motion design from a prompt, your illustrations, or a reference video. Local-first, backend-agnostic, deployable on Azure in one command. License the engine instead of paying per video.',
  openGraph: {
    title: 'motion-forge — motion design at the speed of your roadmap',
    description:
      'License the engine that turns illustrations + a prompt into shipped motion in 90 seconds.',
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
