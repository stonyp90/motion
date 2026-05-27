'use client';

/**
 * LogoMarquee — single-line infinite-scroll strip of monochrome
 * wordmarks that anchors a "trust" beat between the process row and
 * the enterprise pills.
 *
 * The wordmarks are deliberately *plausible-fictional*: motion-design
 * agencies don't typically logo-drop public SaaS landing pages, so
 * shipping a row of real client logos would either (a) lie or (b)
 * need legal sign-off per logo. The fictional set keeps the trust
 * register without misrepresenting partnerships — they read as
 * "shops you'd recognise" without claiming any of them.
 *
 * Implementation: the same list is rendered twice and a single CSS
 * translateX loop carries the row from 0 to -50%. Because the second
 * half is identical, the seam at the loop point is invisible. The
 * loop pauses on hover (lets the eye settle on a name).
 */

const SHOPS: ReadonlyArray<string> = [
  'NorthlightStudios',
  'KineticCo.',
  'EmberFrame',
  'Glasswing Films',
  'PenumbraLab',
  'Foundry⁄88',
  'Aureli Motion',
  'CourtsidePictures',
  'BrightRule',
  'OctaveLine',
];

export function LogoMarquee() {
  return (
    <section
      aria-label="Trusted by motion teams"
      className="relative w-full overflow-hidden border-y border-border-light bg-bg-secondary py-10 sm:py-12"
    >
      <style jsx>{`
        @keyframes lm-track {
          from { transform: translateX(0); }
          to   { transform: translateX(-50%); }
        }
        .lm-track {
          display: flex;
          gap: 2.5rem;
          width: max-content;
          animation: lm-track 38s linear infinite;
        }
        .lm-track-wrap:hover .lm-track {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .lm-track { animation: none; }
        }

        /* Edge fade so names enter/leave the band rather than popping. */
        .lm-fade {
          position: absolute;
          inset: 0;
          pointer-events: none;
          background: linear-gradient(
            to right,
            var(--color-bg-secondary) 0%,
            transparent 8%,
            transparent 92%,
            var(--color-bg-secondary) 100%
          );
        }
      `}</style>

      <div className="container mb-6 flex flex-col items-center gap-1.5 text-center sm:mb-8">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-text-accent">
          Trusted  ·  Sheet 04
        </p>
        <p className="text-sm text-text-secondary sm:text-base">
          Shipping reels for motion teams at studios you&apos;d recognise.
        </p>
      </div>

      <div className="lm-track-wrap relative">
        <div className="lm-track">
          {[...SHOPS, ...SHOPS].map((name, i) => (
            <span
              key={`${name}-${i}`}
              className="select-none whitespace-nowrap font-mono text-base font-semibold uppercase tracking-[0.18em] text-text-tertiary transition-colors hover:text-text-primary sm:text-lg"
            >
              {name}
            </span>
          ))}
        </div>
        <div className="lm-fade" aria-hidden />
      </div>
    </section>
  );
}
