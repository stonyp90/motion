import { Github } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { MotionLogo } from './MotionLogo';

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
        <MotionLogo size="sm" />

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <a
            href="https://github.com/stonyp90/motion"
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
