import { Cpu, Layers3, GitBranch, ShieldCheck, Gauge, Sparkles } from 'lucide-react';

const pillars = [
  {
    icon: Sparkles,
    title: 'Your brand, in motion — without a designer in the loop',
    body: 'Hand in a brand pack (Illustrator, Figma export, PNG sequence) and a prompt. motion-forge animates it using your palette, your easing language, your shot rhythm.',
  },
  {
    icon: Gauge,
    title: 'Iteration is the product',
    body: 'Generate once (~90s heavy work). Then iterate at 150ms per try. Voice, theme, duration — change anything; render in seconds.',
  },
  {
    icon: ShieldCheck,
    title: 'Local-first; your data never leaves',
    body: 'Runs on your laptop, your Azure tenant, your air-gapped box. The LLM backend is swappable — Ollama, Azure OpenAI, or a private model.',
  },
  {
    icon: Layers3,
    title: 'Editable output, not a black-box render',
    body: 'You get a Lottie JSON timeline you can open in Adobe, LottieFiles, Rive, or your CI pipeline — plus an MP4 if you want one.',
  },
  {
    icon: GitBranch,
    title: 'Versioned, scriptable, CI-friendly',
    body: 'Every iteration is a deterministic CLI invocation. Wire it into your release pipeline, your CMS publish flow, or your campaign management.',
  },
  {
    icon: Cpu,
    title: 'Hexagonal architecture you can extend',
    body: 'Each crate is a port + adapter. Swap our SAM 2 segmenter for an in-house model, or our LLM for your fine-tuned Qwen — without touching the rest.',
  },
];

export function ValuePillarsSection() {
  return (
    <section className="section">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">Why operators pick this over an agency</p>
          <h2 className="h-section mt-3">
            Engineered for shipping motion, not for charging by the hour.
          </h2>
          <p className="mt-5 text-lg text-text-secondary">
            The agency model wasn&apos;t built for teams that ship weekly. This was.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {pillars.map((p) => (
            <article key={p.title} className="card">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent-50 text-accent-600">
                <p.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-text-primary">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{p.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
