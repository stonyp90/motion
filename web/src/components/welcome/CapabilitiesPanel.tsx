'use client';

import type { CSSProperties } from 'react';
import { Brain, Brush, Cpu, FileVideo } from 'lucide-react';

/**
 * Four-card grid showcasing the desktop app's capabilities without
 * implying any of them are reachable from this web surface. Pure
 * marketing — no link-outs, no interactive elements; the user's next
 * move is "Download" above. Anchored for the WelcomeTour final step.
 */
export function CapabilitiesPanel() {
  return (
    <section
      data-testid="mf-welcome-capabilities"
      className="animate-reveal-up stagger-child flex flex-col gap-5"
      style={{ '--i': 6 } as CSSProperties}
    >
      <header className="flex flex-col gap-1.5">
        <p className="font-mono text-2xs font-medium uppercase tracking-[0.18em] text-text-tertiary">
          Step 3 · Inside the app
        </p>
        <h2 className="text-2xl font-bold tracking-tight text-text-primary sm:text-[28px]">
          What you&apos;ll be able to do.
        </h2>
      </header>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Capability
          icon={<Brain className="h-4 w-4" aria-hidden />}
          title="Local vision-model inference"
          body="Llama 3.2 Vision, Qwen2-VL, LLaVA — your reference images stay on disk."
        />
        <Capability
          icon={<Brush className="h-4 w-4" aria-hidden />}
          title="Brand-locked palette + type"
          body="Drop your logo and brand kit. Every scene is recolored automatically."
        />
        <Capability
          icon={<FileVideo className="h-4 w-4" aria-hidden />}
          title="Lottie · MP4 · GSAP · Theatre"
          body="Pick the export your stack already accepts. No re-encoding step."
        />
        <Capability
          icon={<Cpu className="h-4 w-4" aria-hidden />}
          title="GPU-aware throughput"
          body="Detects your Apple silicon / NVIDIA / iGPU and routes inference correctly."
        />
      </ul>
    </section>
  );
}

function Capability({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="motion-hover flex items-start gap-3 rounded-2xl border border-border-light bg-bg-primary p-5 hover:-translate-y-px hover:border-accent-200">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-700">
        {icon}
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-sm font-bold tracking-tight text-text-primary">
          {title}
        </span>
        <span className="text-xs leading-relaxed text-text-secondary">{body}</span>
      </span>
    </li>
  );
}
