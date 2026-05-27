import type { ReactNode } from 'react';

interface StepProps {
  number: number;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}

/**
 * Numbered step card shared between /install and the welcome dashboard.
 * Caller supplies the icon + body so the same scaffold renders both the
 * verbose engineer-facing install guide and the friendlier 3-card welcome
 * summary.
 */
export function Step({ number, icon, title, children }: StepProps) {
  return (
    <li className="flex gap-5">
      <div className="flex flex-col items-center">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-600 font-mono text-sm font-bold text-white">
          {number}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-text-primary">
          <span className="text-accent-700">{icon}</span>
          {title}
        </h2>
        <div className="flex flex-col gap-3 text-sm leading-relaxed text-text-secondary">
          {children}
        </div>
      </div>
    </li>
  );
}
