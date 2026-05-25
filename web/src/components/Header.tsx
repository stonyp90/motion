import Link from 'next/link';
import { Github } from 'lucide-react';

/**
 * Slim app header: logo + GitHub link + Sign in.
 *
 * The single-screen app does not have marketing nav — the page itself
 * IS the call to action. We keep just enough chrome to identify the
 * product and give a user a way back into their account.
 */
export function Header() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border-light bg-bg-primary/85 backdrop-blur-md">
      <div className="container flex h-14 items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group" aria-label="motion-forge home">
          <span
            aria-hidden
            className="grid h-7 w-7 place-items-center rounded-lg bg-primary-900 text-text-inverse transition group-hover:bg-accent-500"
          >
            <span className="text-sm font-bold tracking-tight">M</span>
          </span>
          <span className="text-sm font-semibold tracking-tight text-text-primary">
            motion-forge
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <a
            href="https://github.com/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-text-secondary transition hover:bg-bg-tertiary hover:text-text-primary"
            aria-label="GitHub repository"
          >
            <Github className="h-4 w-4" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <button
            type="button"
            className="rounded-full border border-border px-3 py-1.5 text-sm font-medium text-text-primary transition hover:bg-bg-tertiary"
          >
            Sign in
          </button>
        </div>
      </div>
    </header>
  );
}
