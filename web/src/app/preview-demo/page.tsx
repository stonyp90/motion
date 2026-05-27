'use client';

/**
 * /preview-demo — internal-only page for verifying the
 * BrandMotionShowcase visually. Mounts the showcase at a real
 * 16:9 aspect ratio so the team can confirm motion + theming
 * look right in both light and dark mode without having to sign in
 * and walk to the workflow's empty-state.
 *
 * Safe to leave in the production bundle — there's no link to it
 * from anywhere, no PII, no API surface. Tree-shake-friendly.
 */

import { BrandMotionShowcase } from '@/components/home/BrandMotionShowcase';

export default function PreviewDemoPage() {
  return (
    <main className="min-h-screen bg-bg-primary p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-6 text-xl font-semibold text-text-primary">
          Brand motion showcase — preview
        </h1>
        <div className="aspect-video w-full overflow-hidden rounded-2xl border border-border-light">
          <BrandMotionShowcase />
        </div>
      </div>
    </main>
  );
}
