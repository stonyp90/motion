import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'Terms of use for motion-forge.',
};

/**
 * Minimal terms page — fills the Footer link so the route doesn't
 * 404. Replace with counsel-reviewed copy before any external launch;
 * the stub describes the deployment posture (single-tenant, local
 * uploads, no warranty) without making contractual claims.
 */
export default function TermsPage() {
  return (
    <main className="flex min-h-screen flex-col bg-bg-primary">
      <Header />
      <article className="container flex-1 py-16">
        <div className="mx-auto max-w-2xl">
          <h1 className="h-section mb-4">Terms of use</h1>
          <p className="text-sm text-text-tertiary">Effective May 2026</p>
          <div className="mt-10 flex flex-col gap-6 text-base leading-[1.7] text-text-secondary">
            <p>
              These terms govern your use of motion-forge. They are a placeholder until
              counsel-reviewed copy is in place; do not rely on them for contractual purposes.
            </p>
            <Section title="Scope">
              motion-forge is offered as-is, without warranty of fitness or merchantability.
              The engine may be unavailable, change without notice, or fail in ways that
              produce unusable output. Use it for production work at your own risk.
            </Section>
            <Section title="Your content">
              You retain ownership of every brief, reference video, image, and audio file you
              upload, as well as the Lotties and MP4s the engine generates from them. You are
              responsible for having the rights to the references you provide.
            </Section>
            <Section title="Acceptable use">
              Do not use motion-forge to generate content depicting real people without
              consent, to infringe intellectual property, to attempt to circumvent the engine&apos;s
              authentication, or to bypass the per-session work-dir scoping.
            </Section>
            <Section title="Liability">
              motion-forge is not liable for any indirect, incidental, or consequential damage
              arising from use of the engine or its outputs, including but not limited to lost
              renders, missed deadlines, or rejected assets.
            </Section>
            <Section title="Contact">
              Questions: <a className="text-text-accent underline-offset-2 hover:underline" href="mailto:hello@motion-forge.io">hello@motion-forge.io</a>.
            </Section>
          </div>
        </div>
      </article>
      <Footer />
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-base font-semibold text-text-primary">{title}</h2>
      <p>{children}</p>
    </section>
  );
}
