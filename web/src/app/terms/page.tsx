import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Terms',
  description: 'Terms of use for ControlCraft.',
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
              These terms govern your use of ControlCraft. Replace with your master service
              agreement at the procurement stage; this short-form is the day-zero
              contract.
            </p>
            <Section title="Scope">
              ControlCraft is provided under a written enterprise agreement once signed;
              the default short-form below applies before that. Service availability
              and SLAs are described in the agreement, not here.
            </Section>
            <Section title="Your content">
              You retain ownership of every brief, reference video, image, and audio
              file you upload, as well as the animations and videos ControlCraft generates
              from them. You are responsible for having the rights to the references
              you provide.
            </Section>
            <Section title="Acceptable use">
              Do not use ControlCraft to generate content depicting real people without
              consent, to infringe intellectual property, to attempt to circumvent
              authentication, or to bypass the per-session workspace scoping.
            </Section>
            <Section title="Liability">
              ControlCraft is not liable for any indirect, incidental, or consequential
              damage arising from use of the product or its outputs. Direct-damage
              caps are described in your enterprise agreement.
            </Section>
            <Section title="Contact">
              Questions: <a className="text-text-accent underline-offset-2 hover:underline" href="mailto:hello@controlcraft.io">hello@controlcraft.io</a>.
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
