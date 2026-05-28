'use client';

import type { CSSProperties } from 'react';
import Link from 'next/link';
import { Download as DownloadIcon, Terminal, Zap, ArrowRight } from 'lucide-react';
import { Step } from '@/components/install/Step';

/**
 * Compressed install summary on the welcome dashboard — three steps,
 * one line each. The long-form guide lives at /install; this is the
 * orienting recap, not the doc.
 *
 * Anchored with `data-testid="mf-welcome-install"` for the WelcomeTour.
 */
export function InstallSteps() {
  return (
    <section
      data-testid="mf-welcome-install"
      className="animate-reveal-up stagger-child rounded-3xl border border-border-light bg-bg-primary p-8 sm:p-10"
      style={{ '--i': 4 } as CSSProperties}
    >
      <div className="flex flex-col items-start gap-2">
        <p className="font-mono text-2xs font-medium uppercase tracking-[0.18em] text-text-accent">
          After you download
        </p>
        <h2 className="text-2xl font-bold tracking-tight text-text-primary sm:text-[28px]">
          Three steps. About five minutes.
        </h2>
      </div>

      <ol className="mt-8 flex flex-col gap-8">
        <Step number={1} icon={<DownloadIcon className="h-4 w-4" />} title="Open the installer">
          <p>
            <strong className="font-semibold text-text-primary">macOS</strong> — drag{' '}
            <code className="rounded bg-bg-tertiary px-1 font-mono text-xs">ControlCraft.app</code>{' '}
            into Applications.{' '}
            <strong className="font-semibold text-text-primary">Windows / Linux</strong> — run
            the installer.
          </p>
        </Step>
        <Step number={2} icon={<Terminal className="h-4 w-4" />} title="Install Ollama (once)">
          <p>
            Ollama runs the local model. One command per platform —{' '}
            <Link
              href={"/install#install-ollama" as never}
              className="font-medium text-text-accent underline-offset-2 hover:underline"
            >
              copy it from the setup guide
            </Link>
            . If Ollama is already installed, ControlCraft picks it up automatically.
          </p>
        </Step>
        <Step number={3} icon={<Zap className="h-4 w-4" />} title="Launch and generate">
          <p>
            Open ControlCraft, paste a brief, click <strong className="font-semibold text-text-primary">Generate</strong>.
            First run downloads the model once; every brief after that is local and offline.
          </p>
        </Step>
      </ol>

      <p className="mt-8 flex items-center gap-2 text-xs text-text-tertiary">
        Need the long form?{' '}
        <Link
          href={"/install" as never}
          className="inline-flex items-center gap-1 font-medium text-text-accent underline-offset-2 hover:underline"
        >
          Open the setup guide
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
      </p>
    </section>
  );
}
