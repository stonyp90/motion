import type { Metadata } from 'next';
import Link from 'next/link';
import { StudioClient } from '@/components/studio/StudioClient';

export const metadata: Metadata = {
  title: 'Studio',
  description:
    'Edit motion-design Lotties in the browser. Live recolor, retime, swap presets — zero server round-trips until you export an MP4.',
};

export default function StudioPage() {
  return (
    <div className="flex min-h-screen flex-col bg-bg-primary">
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border-light bg-bg-primary/85 px-4 backdrop-blur-md sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-lg bg-primary-900 text-text-inverse"
          >
            <span className="text-base font-bold tracking-tight">M</span>
          </span>
          <span className="font-semibold tracking-tight text-text-primary">motion-forge</span>
          <span className="ml-2 chip text-text-tertiary">/ studio</span>
        </Link>
        <div className="flex items-center gap-2">
          <Link href="/#pricing" className="text-sm text-text-secondary hover:text-text-primary">
            Pricing
          </Link>
          <Link href="/#cta" className="btn-primary py-2 text-sm">
            Book a demo
          </Link>
        </div>
      </header>
      <StudioClient />
    </div>
  );
}
