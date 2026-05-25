import { Github, ArrowRight } from 'lucide-react';
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
      <div className="container flex h-16 items-center justify-between">
        <MotionLogo size="md" />

        <div className="flex items-center gap-1">
          <ThemeToggle />
          <a
            href="https://github.com/stonyp90/motion"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
            aria-label="GitHub repository"
          >
            <Github className="h-4 w-4" />
            <span className="hidden sm:inline">GitHub</span>
          </a>
          <div className="mx-1 h-5 w-px bg-border-light" aria-hidden />
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full bg-accent-700 px-4 py-1.5 text-sm font-semibold text-white shadow-card transition-all duration-200 hover:-translate-y-px hover:bg-accent-800 hover:shadow-glow active:translate-y-0 active:shadow-card"
          >
            Sign in
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </header>
  );
}
