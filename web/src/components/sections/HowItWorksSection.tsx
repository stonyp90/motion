import { FileImage, Type, Sparkles, Film } from 'lucide-react';

const steps = [
  {
    n: '01',
    icon: FileImage,
    title: 'Drop your brand pack',
    body: 'Illustrator files, a reference MP4, or a single brand-guidelines PDF. motion-forge segments, extracts your palette, and learns your shot rhythm.',
    cli: 'motion-forge style-card --input brand.mp4 --out style.json',
  },
  {
    n: '02',
    icon: Type,
    title: 'Write the prompt (or speak it)',
    body: 'Plain English. Pick a theme preset (corporate, playful, tech-reveal, minimalist, explainer) or BYO. Optionally pipe a voice note through the local Whisper sidecar.',
    cli: 'motion-forge transcribe note.wav | xargs -0 -I{} motion-forge generate --prompt "{}"',
  },
  {
    n: '03',
    icon: Sparkles,
    title: 'Generate — the heavy work happens once',
    body: 'Segmentation, scene split, sprite decomposition, style extraction, LLM orchestration. ~90 seconds on a laptop. Persists every intermediate so iteration is cheap.',
    cli: 'motion-forge generate --reference brand.mp4 --prompt "Q4 launch trailer" --duration 30',
  },
  {
    n: '04',
    icon: Film,
    title: 'Iterate at 150 milliseconds',
    body: 'Re-prompt against the cached work-dir. Swap the theme. Bump duration. Get a new Lottie + MP4 without re-segmenting. Editable in LottieFiles or Adobe.',
    cli: 'motion-forge iterate --work-dir ./brand-work --prompt "Same shot, bouncier"',
  },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="section bg-bg-secondary">
      <div className="container">
        <div className="mx-auto max-w-2xl text-center">
          <p className="eyebrow">How it works</p>
          <h2 className="h-section mt-3">Four steps from brand pack to broadcast.</h2>
        </div>

        <ol className="mt-14 grid gap-5 lg:grid-cols-2">
          {steps.map((s) => (
            <li key={s.n} className="card flex flex-col">
              <div className="flex items-start gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary-900 text-text-inverse">
                  <s.icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-xs font-mono font-semibold text-text-accent">{s.n}</p>
                  <h3 className="mt-1 text-lg font-semibold text-text-primary">{s.title}</h3>
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-text-secondary">{s.body}</p>
              <pre className="mt-4 overflow-x-auto rounded-xl bg-primary-900 p-4 text-xs leading-relaxed text-accent-300 font-mono">
                <code>{s.cli}</code>
              </pre>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
