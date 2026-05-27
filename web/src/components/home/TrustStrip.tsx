'use client';

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
 * Motion: when the strip scrolls into view the section header fades up
 * + the three cards stagger in (120 ms apart) using the brand
 * Decelerate easing. Once-only via `useInViewOnce` so the cards don't
 * re-animate when the user scrolls back up.
 *
 * Why no clickable badge logos: a real SVG badge for SOC 2 would imply
 * we've passed and been listed by AICPA. Until the audit completes,
 * we use plain typography + a one-liner — accurate, defensible, and
 * trivially upgraded to a real badge once the attestation PDF lands.
 */
import { useRef } from 'react';
import { ShieldCheck, Building2, Globe2 } from 'lucide-react';
import { useInViewOnce } from '@/lib/hooks/useInViewOnce';

interface Cert {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  detail: string;
  /** Optional status pill shown next to the title (e.g. "In progress").
   *  We use it on SOC 2 until the AICPA attestation lands — calling
   *  ourselves SOC 2-certified without the report on file would be
   *  misrepresentation. */
  status?: { label: string; tone: 'in-progress' | 'shipped' };
}

const CERTS: ReadonlyArray<Cert> = [
  {
    icon: <ShieldCheck className="h-5 w-5" aria-hidden />,
    title: 'SOC 2 Type II',
    subtitle: 'Independent security audit',
    detail:
      'Annual third-party attestation of how we handle your data, access, and uptime. Audit in progress — controls implemented, evidence collection underway.',
    status: { label: 'In progress', tone: 'in-progress' },
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
  const sectionRef = useRef<HTMLElement>(null);
  const inView = useInViewOnce(sectionRef);

  return (
    <section
      ref={sectionRef}
      id="trust"
      aria-labelledby="trust-heading"
      className="section-tight bg-bg-primary"
    >
      <div className="container">
        <div
          className="flex flex-col items-center gap-2 text-center transition-all duration-700"
          style={{
            opacity: inView ? 1 : 0,
            transform: inView ? 'translateY(0)' : 'translateY(12px)',
            // Brand Decelerate token instead of browser-default ease-out
            // — keeps the section header in lockstep with the KPI strip
            // above and the card stagger below.
            transitionTimingFunction: 'var(--ease-out-quart)',
          }}
        >
          {/* Eyebrow — bumped from text-tertiary to a stronger
              accent-600 / accent-400 split so it reads as a true
              label in both themes (was sitting at ~5:1 contrast
              and disappearing in dark mode). */}
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-accent-700 dark:text-accent-400">
            Built for enterprise
          </p>
          <h2 id="trust-heading" className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">
            The same trust posture your security team already approves.
          </h2>
        </div>

        <ul className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3 lg:gap-6">
          {CERTS.map((cert, i) => (
            <li
              key={cert.title}
              className="flex flex-col gap-2.5 rounded-2xl border border-border-light bg-bg-secondary p-5 transition-all duration-700 hover:border-accent-300 hover:shadow-card"
              style={{
                opacity: inView ? 1 : 0,
                transform: inView ? 'translateY(0)' : 'translateY(20px)',
                // Stagger the 3 cards by --stagger-cards (120ms token)
                // so the eye reads them as a sequence, not a wall.
                transitionDelay: inView ? `calc(180ms + ${i} * var(--stagger-cards))` : '0ms',
                transitionTimingFunction: 'var(--ease-out-quart)',
              }}
            >
              {/* Icon — no tinted background pill (was bg-accent-50 /
                  bg-accent-950). The icon stroke carries the accent
                  color directly; the card border + bg-secondary
                  already provide enough chrome around it. */}
              <span className="text-accent-600 dark:text-accent-400">
                {cert.icon}
              </span>
              <div className="flex flex-col gap-0.5">
                <h3 className="flex items-center gap-2 font-display text-base font-bold tracking-tight text-text-primary">
                  {cert.title}
                  {cert.status && (
                    <span
                      className={
                        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.12em] ' +
                        (cert.status.tone === 'in-progress'
                          ? 'border-secondary-300 bg-secondary-50 text-secondary-800 dark:border-secondary-700 dark:bg-secondary-950 dark:text-secondary-200'
                          : 'border-accent-300 bg-accent-50 text-accent-800 dark:border-accent-700 dark:bg-accent-950 dark:text-accent-200')
                      }
                      aria-label={`Status: ${cert.status.label}`}
                    >
                      <span
                        aria-hidden
                        className={
                          'h-1.5 w-1.5 rounded-full ' +
                          (cert.status.tone === 'in-progress'
                            ? 'bg-secondary-500'
                            : 'bg-accent-500')
                        }
                      />
                      {cert.status.label}
                    </span>
                  )}
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
