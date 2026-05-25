import { ArrowRight } from 'lucide-react';

export function CTASection() {
  return (
    <section id="cta" className="section">
      <div className="container">
        <div className="relative overflow-hidden rounded-3xl border border-border-light bg-primary-900 px-8 py-14 text-text-inverse shadow-lift sm:px-14 lg:px-20">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-accent-500/30 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-secondary-500/20 blur-3xl"
          />

          <div className="relative grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:items-center">
            <div>
              <p className="eyebrow text-accent-400">Talk to a founder</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-text-inverse sm:text-4xl">
                See your brand pack come to life in 20 minutes.
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-primary-200">
                Send us a representative reference clip, your last brand
                animation, or just a logo. We&apos;ll generate three variants live
                on the call and walk you through the math against your current
                motion-design spend.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <a
                  href="mailto:hello@motion-forge.io?subject=motion-forge%20exec%20demo"
                  className="btn-accent text-sm"
                >
                  Email hello@motion-forge.io
                  <ArrowRight className="h-4 w-4" />
                </a>
                <a
                  href="https://cal.com/"
                  className="inline-flex items-center justify-center gap-2 rounded-full border border-primary-700 px-6 py-3 text-sm font-semibold text-text-inverse hover:border-accent-400 hover:text-accent-300"
                >
                  Pick a 20-min slot
                </a>
              </div>
            </div>

            <ul className="grid gap-3 text-sm text-primary-100">
              {[
                'No agency contract, no per-seat licensing, no per-export fees',
                'See your real brand pack rendered — we do not show stock demos',
                'Walk away with the CLI, the Lottie, and the cost model — even if you don&apos;t buy',
                'Apache-2.0 source ships either way',
              ].map((bullet) => (
                <li
                  key={bullet}
                  className="rounded-xl border border-primary-700/50 bg-primary-800/40 p-4 backdrop-blur"
                  dangerouslySetInnerHTML={{ __html: `<span class="text-accent-400">✓</span> ${bullet}` }}
                />
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
