import Link from 'next/link';
import { Github, Twitter, Linkedin, Mail } from 'lucide-react';
import { MotionLogo } from './MotionLogo';

const NAV = [
  { label: 'Product', links: [
    { href: '/#reel',    text: 'Watch the reel' },
    { href: '/signup',   text: 'Get started free' },
    { href: '/login',    text: 'Sign in' },
    { href: '/download', text: 'Desktop app' },
  ]},
  { label: 'Company', links: [
    { href: 'mailto:hello@controlcraft.io', text: 'Contact' },
    { href: '/security', text: 'Security' },
  ]},
  { label: 'Legal', links: [
    { href: '/privacy', text: 'Privacy policy' },
    { href: '/terms',   text: 'Terms of service' },
  ]},
];

const SOCIAL = [
  { href: 'https://twitter.com/controlcraft',          Icon: Twitter,  label: 'Twitter / X' },
  { href: 'https://linkedin.com/company/controlcraft', Icon: Linkedin, label: 'LinkedIn' },
  { href: 'https://github.com/stonyp90',               Icon: Github,   label: 'GitHub' },
  { href: 'mailto:hello@controlcraft.io',              Icon: Mail,     label: 'Email' },
];

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-border-light bg-bg-primary">

      {/* ── Main grid ─────────────────────────────────────── */}
      <div className="container py-16 lg:py-20">
        <div className="grid grid-cols-1 gap-12 sm:grid-cols-2 lg:grid-cols-5">

          {/* Brand — 2 cols */}
          <div className="flex flex-col gap-6 lg:col-span-2">
            <MotionLogo size="md" />
            <p className="max-w-[22ch] text-sm leading-relaxed text-text-secondary">
              From brief to broadcast in minutes.
              Brand-grade motion, on tap.
            </p>
            <div className="flex items-center gap-2">
              {SOCIAL.map(({ href, Icon, label }) => (
                <a
                  key={label}
                  href={href}
                  aria-label={label}
                  target={href.startsWith('http') ? '_blank' : undefined}
                  rel={href.startsWith('http') ? 'noopener noreferrer' : undefined}
                  className="grid h-8 w-8 place-items-center rounded-full border border-border-light text-text-tertiary transition-colors hover:border-accent-500 hover:text-accent-400"
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </a>
              ))}
            </div>
          </div>

          {/* Nav columns — 3 cols */}
          {NAV.map(({ label, links }) => (
            <div key={label} className="flex flex-col gap-4">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.28em] text-accent-500">
                {label}
              </p>
              <ul className="flex flex-col gap-2.5">
                {links.map(({ href, text }) => (
                  <li key={text}>
                    <Link
                      href={href as never}
                      className="text-sm text-text-secondary transition-colors hover:text-text-primary"
                    >
                      {text}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* ── Bottom bar ────────────────────────────────────── */}
      <div className="border-t border-border-light">
        <div className="container flex flex-col gap-1 py-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[11px] text-text-tertiary">
            © {year} ControlCraft · All rights reserved
          </p>
          <p className="font-mono text-[11px] italic text-text-tertiary/60">
            Brief to broadcast · Prompt-based motion graphics
          </p>
        </div>
      </div>
    </footer>
  );
}
