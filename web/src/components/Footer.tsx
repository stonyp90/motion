import Link from 'next/link';

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
          <Link href="/" className="flex items-center gap-2" aria-label="motion-forge home">
            <span
              aria-hidden
              className="grid h-5 w-5 place-items-center rounded-md bg-primary-900 text-text-inverse"
            >
              <span className="text-[10px] font-bold tracking-tight">M</span>
            </span>
            <span className="text-xs font-semibold tracking-tight text-text-primary">
              motion-forge
            </span>
          </Link>
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
