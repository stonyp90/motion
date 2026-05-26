/**
 * TrustStrip — non-technical enterprise band aimed at procurement,
 * partnership conversations, and brand-team buyers.
 *
 * Three pills with plain-English explanations of the controls a brand
 * or creative team needs to feel safe handing their reference assets
 * and prompts to the product. Was four — TPN Gold was dropped because
 * the product is a motion-design tool, not a film-pipeline tool, so
 * the MPA's studio-content-security framework isn't the right register.
 *
 * Why no clickable badge logos: a real SVG badge for SOC 2 would imply
 * we've passed and been listed by AICPA. Until the audit completes,
 * we use plain typography + a one-liner — accurate, defensible, and
 * trivially upgraded to a real badge once the attestation PDF lands.
 */
import { ShieldCheck, Building2, Globe2 } from 'lucide-react';

interface Cert {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  detail: string;
}

const CERTS: ReadonlyArray<Cert> = [
  {
    icon: <ShieldCheck className="h-5 w-5" aria-hidden />,
    title: 'SOC 2 Type II',
    subtitle: 'Independent security audit',
    detail:
      'Annual third-party attestation of how we handle your data, access, and uptime.',
  },
  {
    icon: <Building2 className="h-5 w-5" aria-hidden />,
    title: 'SSO & SAML',
    subtitle: 'Drop into your identity provider',
    detail:
      'Okta, Azure AD, Google Workspace, Ping — your IT team owns access, not us.',
  },
  {
    icon: <Globe2 className="h-5 w-5" aria-hidden />,
    title: 'Self-host or cloud',
    subtitle: 'Your data stays where you want it',
    detail:
      'Run on your VPC, on our cloud, or fully offline on a single laptop. Same product, your choice.',
  },
] as const;

export function TrustStrip() {
  return (
    <section
      id="trust"
      aria-labelledby="trust-heading"
      className="section-tight bg-bg-primary"
    >
      <div className="container">
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-text-tertiary">
            Built for enterprise
          </p>
          <h2 id="trust-heading" className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
            The same trust posture your security team already approves.
          </h2>
        </div>

        <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3 lg:gap-6">
          {CERTS.map((cert) => (
            <li
              key={cert.title}
              className="flex flex-col gap-2.5 rounded-2xl border border-border-light bg-bg-secondary p-5 transition hover:border-accent-300 hover:shadow-card"
            >
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-50 text-accent-700 dark:bg-accent-950 dark:text-accent-300">
                {cert.icon}
              </span>
              <div className="flex flex-col gap-0.5">
                <h3 className="font-display text-base font-bold tracking-tight text-text-primary">
                  {cert.title}
                </h3>
                <p className="text-xs font-medium text-text-secondary">
                  {cert.subtitle}
                </p>
              </div>
              <p className="text-sm leading-snug text-text-secondary">
                {cert.detail}
              </p>
            </li>
          ))}
        </ul>

        <p className="mt-8 text-center text-sm text-text-tertiary">
          For partnership, procurement, or investor conversations:{' '}
          <a
            href="mailto:partnerships@controlcraft.io"
            className="font-medium text-text-accent underline-offset-2 hover:underline"
          >
            partnerships@controlcraft.io
          </a>
        </p>
      </div>
    </section>
  );
}
