import { MotionLogo } from './MotionLogo';

/**
 * One-row slim footer: logo + 3 links + copyright.
 *
 * No marketing columns. The product is the page.
 */
export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border-light bg-bg-secondary">
      <div className="container flex flex-col gap-3 py-5 text-xs text-text-tertiary sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <MotionLogo size="sm" />
          <span>· © {year}</span>
        </div>

        <nav className="flex items-center gap-5" aria-label="Footer">
          <a href="/privacy" className="hover:text-text-primary">
            Privacy
          </a>
          <a href="/terms" className="hover:text-text-primary">
            Terms
          </a>
          <a href="mailto:hello@motion-forge.io" className="hover:text-text-primary">
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
