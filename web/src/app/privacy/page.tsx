import type { Metadata } from 'next';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Privacy',
  description: 'How ControlCraft handles your data and uploads.',
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
              ControlCraft turns a brief into a finished motion graphic. The principles
              below describe how we handle the data you bring in.
            </p>
            <Section title="What we collect">
              Sign-in is provided by your enterprise SSO (Okta, Azure AD, Google
              Workspace, Ping, or your own identity provider). We store your email +
              display name and the session tokens needed to sign you in. We do not
              track behaviour beyond the request logs needed to debug a failed render.
            </Section>
            <Section title="Uploads">
              Reference videos, images, and briefs you attach are written to a
              per-session workspace scoped by a random id, not addressable without it.
              We do not move uploads off your tenant or share them with third parties.
            </Section>
            <Section title="Generated assets">
              Animations and videos produced by ControlCraft live alongside their session
              workspace. You can export them locally; nothing is published or shared
              automatically.
            </Section>
            <Section title="Retention">
              Session workspaces follow your tenant&apos;s retention policy and may
              be cleared at any time. Long-term assets should live in your DAM,
              not ControlCraft.
            </Section>
            <Section title="Contact">
              Questions or deletion requests: <a className="text-text-accent underline-offset-2 hover:underline" href="mailto:hello@controlcraft.io">hello@controlcraft.io</a>.
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
