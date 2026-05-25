import Link from 'next/link';

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border-light bg-bg-secondary">
      <div className="container grid gap-10 py-14 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Link href="/" className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="grid h-8 w-8 place-items-center rounded-lg bg-motion text-white shadow-motion"
            >
              <span className="text-base font-bold tracking-tight">M</span>
            </span>
            <span className="font-semibold tracking-tight text-text-primary">motion-forge</span>
          </Link>
          <p className="mt-4 max-w-sm text-sm text-text-secondary">
            License the engine instead of paying per video. Brand-consistent
            motion design rendered from a prompt, an illustration pack, or a
            reference clip — in seconds, on your infrastructure.
          </p>
        </div>

        <FooterColumn
          title="Product"
          links={[
            { label: 'How it works', href: '#how-it-works' },
            { label: 'Architecture', href: '#architecture' },
            { label: 'Themes', href: '#proof' },
            { label: 'Pricing', href: '#pricing' },
            { label: 'API + OpenAPI', href: '#architecture' },
          ]}
        />
        <FooterColumn
          title="For executives"
          links={[
            { label: 'Compare to agency', href: '#compare' },
            { label: 'Compare to in-house', href: '#compare' },
            { label: 'Total cost model', href: '#pricing' },
            { label: 'Deployment options', href: '#architecture' },
          ]}
        />
        <FooterColumn
          title="Company"
          links={[
            { label: 'Book a demo', href: '#cta' },
            { label: 'Contact', href: 'mailto:hello@motion-forge.io' },
            { label: 'Privacy', href: '/privacy' },
            { label: 'Terms', href: '/terms' },
          ]}
        />
      </div>

      <div className="border-t border-border-light">
        <div className="container flex flex-col gap-2 py-6 text-xs text-text-tertiary sm:flex-row sm:items-center sm:justify-between">
          <span>© {year} motion-forge. Built in Rust + a touch of Python + zero apologies.</span>
          <span className="font-mono">v0.0.1 · local-first · cloud-optional</span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-text-tertiary">
        {title}
      </h3>
      <ul className="space-y-2.5">
        {links.map((l) => (
          <li key={l.label}>
            <a href={l.href} className="text-sm text-text-secondary hover:text-text-primary">
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
