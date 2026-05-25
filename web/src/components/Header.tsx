'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';

const navItems = [
  { label: 'Studio', href: '/studio' },
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'Compare', href: '/#compare' },
  { label: 'Architecture', href: '/#architecture' },
  { label: 'Pricing', href: '/#pricing' },
  { label: 'FAQ', href: '/#faq' },
];

export function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border-light bg-bg-primary/85 backdrop-blur-md">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-lg bg-motion text-white shadow-motion transition group-hover:shadow-motion-lg"
          >
            <span className="text-base font-bold tracking-tight">M</span>
          </span>
          <span className="font-semibold tracking-tight text-text-primary">motion-forge</span>
        </Link>

        <nav className="hidden lg:flex items-center gap-7" aria-label="Primary">
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm text-text-secondary transition hover:text-text-primary"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="hidden lg:flex items-center gap-3">
          <a href="https://github.com/" className="btn-ghost py-2 text-sm">
            GitHub
          </a>
          <a href="#cta" className="btn-motion py-2 text-sm">
            Book a demo
          </a>
        </div>

        <button
          className="lg:hidden text-text-primary"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {open && (
        <div className="lg:hidden border-t border-border-light bg-bg-primary">
          <nav className="container flex flex-col gap-3 py-4" aria-label="Mobile">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-2 text-sm font-medium text-text-secondary hover:bg-bg-tertiary"
                onClick={() => setOpen(false)}
              >
                {item.label}
              </a>
            ))}
            <a href="#cta" className="btn-motion mt-2" onClick={() => setOpen(false)}>
              Book a demo
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
