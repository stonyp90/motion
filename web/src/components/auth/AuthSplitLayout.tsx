'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { MotionLogo } from '@/components/MotionLogo';
import { AuthMotionBackground } from './AuthMotionBackground';

interface Props {
  children: ReactNode;
  /** Small label used as the section's aria-label since the form is the
   *  only visible heading on the page now ("Create your account", "Sign in", etc.). */
  eyebrow?: string;
}

/**
 * Single-column scaffold shared by every auth surface (login, signup,
 * verify-email pending/success/expired, forgot-password, reset-password).
 *
 * The form card floats centered on top of AuthMotionBackground — a
 * full-bleed cinema-style scene player that cycles through the same
 * scenes the home hero uses, with a stylized super-hero silhouette per
 * scene. A radial vignette around the form keeps inputs legible no
 * matter which scene is on screen.
 *
 * On mobile the background still fills the viewport; a slim header
 * carries the logo and reel label so the form stays the focal point.
 */
export function AuthSplitLayout({ children, eyebrow }: Props) {
  return (
    <main className="dark relative flex min-h-screen flex-col bg-[#0e1014]">
      <AuthMotionBackground />

      {/* Mobile slim header — keeps the brand anchor visible above the
          form. Inlines the wordmark with white styling because the
          canvas behind it is always dark, regardless of theme. */}
      <header className="relative z-10 flex items-center justify-between px-4 py-4 md:hidden">
        <Link
          href={'/' as never}
          aria-label="ControlCraft home"
          className="group inline-flex items-center gap-2.5"
        >
          <MotionLogo size="md" showLink={false} wordmark="" />
          <span className="font-display text-[19px] font-bold uppercase leading-none tracking-[0.08em] text-white">
            Control<span className="text-accent-400">Craft</span>
          </span>
        </Link>
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-white/70">
          <span className="h-1 w-1 animate-pulse rounded-full bg-accent-400" aria-hidden />
          Reel 000
        </span>
      </header>

      {/* Form card — centered on top of the motion background. The
          background's top HUD already carries reel/act metadata and
          the bottom pipeline timeline shows what's next, so this slot
          is intentionally chrome-free: the form is the only thing the
          user actually needs to do here. */}
      <section className="relative z-10 flex flex-1 items-center justify-center px-4 py-10 sm:py-14">
        <div className="auth-card-halo relative w-full max-w-md" aria-label={eyebrow}>
          {children}
        </div>
      </section>

      <style jsx>{`
        /* "Lit booth" halo — drop-shadow lifts the card off the dark
           stage in light mode; the radial behind it acts as the lamp
           that keeps the card visible against an identically-dark
           canvas in dark mode (where the card's own bg matches the
           background and only its border would otherwise differentiate
           it). */
        .auth-card-halo {
          position: relative;
          filter: drop-shadow(0 30px 60px rgba(0, 0, 0, 0.55))
                  drop-shadow(0 8px 18px rgba(0, 0, 0, 0.35));
        }
        .auth-card-halo::before {
          content: '';
          position: absolute;
          inset: -10%;
          z-index: -1;
          background: radial-gradient(
            ellipse at center,
            color-mix(in srgb, var(--color-accent-400) 18%, transparent),
            transparent 65%
          );
          pointer-events: none;
        }
      `}</style>
    </main>
  );
}
