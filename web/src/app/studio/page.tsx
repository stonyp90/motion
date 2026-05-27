import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { StudioPanel } from '@/components/studio/StudioPanel';

export const metadata: Metadata = {
  title: 'Studio · ControlCraft',
  description:
    'Edit motion-design Lotties locally: recolour, retime, swap presets, then render to MP4, WebM, GIF, .lottie and 6 more formats — all via the embedded engine.',
};

export default function StudioPage() {
  return (
    <main className="flex min-h-screen flex-col bg-bg-primary">
      <Header />
      <div className="flex-1">
        <StudioPanel />
      </div>
      <Footer />
    </main>
  );
}
