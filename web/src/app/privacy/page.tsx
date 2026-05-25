import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'How motion-forge handles your data and uploads.',
};

/**
 * Minimal privacy page — fills the Footer link so the route doesn't
 * 404. Counsel-reviewed copy lands here later; this stub describes
 * the principles the engine actually enforces today (no third-party
 * sharing, work-dirs are session-scoped, etc.) without making legal
 * claims the company hasn't signed off on.
 */
export default function PrivacyPage() {
  return (
    <main className="flex min-h-screen flex-col bg-bg-primary">
      <Header />
      <article className="container flex-1 py-16">
        <div className="mx-auto max-w-2xl">
          <h1 className="h-section mb-4">Privacy</h1>
          <p className="text-sm text-text-tertiary">Effective May 2026</p>
          <div className="mt-10 flex flex-col gap-6 text-base leading-[1.7] text-text-secondary">
            <p>
              motion-forge is a single-tenant rendering pipeline for motion graphics.
              The principles below describe how we handle the data you bring in.
            </p>
            <Section title="What we collect">
              Sign-in is provided by Keycloak SSO; we store your email + display name and
              the access tokens needed to authenticate you against the engine. We do not
              track behavior beyond the engine logs needed to debug a failed render.
            </Section>
            <Section title="Uploads">
              Reference videos, images, and briefs you attach are written to a per-session
              work-dir on the engine host. The work-dir is scoped by a random session id
              and is not addressable without that id. We do not move uploads off-host or
              share them with third parties.
            </Section>
            <Section title="Generated assets">
              Lotties + MP4s produced by the engine live next to their session work-dir.
              You can export them locally; nothing is published or shared automatically.
            </Section>
            <Section title="Retention">
              Session work-dirs are subject to the operator&apos;s retention policy and may
              be cleared at any time. Do not treat the engine as durable storage.
            </Section>
            <Section title="Contact">
              Questions or deletion requests: <a className="text-text-accent underline-offset-2 hover:underline" href="mailto:hello@motion-forge.io">hello@motion-forge.io</a>.
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
