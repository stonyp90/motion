'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * ControlCraft brand lockup.
 *
 * Mark — the 3-rounded-rect cascade we've shipped since v0: pale →
 * brand → deep emerald, overlapping by ~half their width to read as
 * "frames in motion". The cascade is the icon glyph in the dock, the
 * favicon, every marketing surface, AND the leading element of the
 * wordmark lockup.
 *
 * Wordmark — ControlCraft, set in Space Grotesk Bold, all-caps, with 0.08em
 * letter-spacing. Three deliberate typographic choices:
 *
 *   1. The terminal `T` gets its crossbar tinted in the brand emerald
 *      so the eye lands on the same color signal that the cascade
 *      ends on. (Look at the rightmost rect in the icon — it's the
 *      deep emerald accent-700; the T-bar matches.)
 *
 *   2. Wide tracking (~0.08em). Reads premium-tech at every size and
 *      keeps the 4-letter wordmark from feeling cramped next to the
 *      3-element icon.
 *
 *   3. Space Grotesk over Inter — Inter is our body font (it has to
 *      perform at 13–16px in dashboards), but the brand wordmark
 *      wants something with more personality. Space Grotesk's geometric
 *      character with quirky details (the angled `t` crossbar, open `M`
 *      apertures) reads "engineering-led design tool" without going
 *      full bespoke-foundry.
 */

type Size = 'sm' | 'md' | 'lg' | 'xl';

interface MotionLogoProps {
  size?: Size;
  showLink?: boolean;
  href?: string;
  /** Override the wordmark — defaults to 'ControlCraft'. Pass '' for icon-only. */
  wordmark?: string;
  className?: string;
}

const SIZES: Record<Size, { icon: number; text: string; gap: string }> = {
  sm: { icon: 22, text: 'text-[15px]', gap: 'gap-2'    },
  md: { icon: 28, text: 'text-[19px]', gap: 'gap-2.5'  },
  lg: { icon: 40, text: 'text-[26px]', gap: 'gap-3'    },
  xl: { icon: 56, text: 'text-[36px]', gap: 'gap-3.5'  },
};

export function MotionLogo({
  size = 'md',
  showLink = true,
  href = '/',
  wordmark = 'ControlCraft',
  className,
}: MotionLogoProps) {
  const s = SIZES[size];

  const content = (
    <div className={`flex items-center ${s.gap} ${className ?? ''}`}>
      <CascadeMark size={s.icon} />
      {wordmark && (
        <span
          className={`${s.text} font-display font-bold uppercase tracking-[0.08em] leading-none text-text-primary`}
        >
          <Wordmark text={wordmark} />
        </span>
      )}
    </div>
  );

  if (!showLink) return content;
  return (
    <Link
      href={href as never}
      aria-label="ControlCraft home"
      className="group inline-flex items-center"
    >
      {content}
    </Link>
  );
}

/* ----------------------------------------------------------------- icon */

/**
 * 3-rect cascade. viewBox 44×28 inherited from v0; never change without
 * also regenerating the desktop app icons (those derive from the same
 * geometry — see desktop/src-tauri/icons/source.svg).
 */
function CascadeMark({ size }: { size: number }) {
  const width = Math.round(size * 1.5714); // 44/28 aspect
  return (
    <svg
      width={width}
      height={size}
      viewBox="0 0 44 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      className="shrink-0 transition-transform duration-300 group-hover:translate-x-[1px]"
    >
      <rect x="0"  y="4" width="20" height="20" rx="5" className="fill-accent-300 dark:fill-accent-700"/>
      <rect x="9"  y="4" width="20" height="20" rx="5" className="fill-accent-500"/>
      <rect x="18" y="4" width="20" height="20" rx="5" className="fill-accent-700 dark:fill-accent-300"/>
    </svg>
  );
}

/* ------------------------------------------------------------- wordmark */

/**
 * The wordmark renderer. If the text is exactly `ControlCraft` we apply the
 * brand-specific accent treatment (tinted terminal). Any other string
 * (e.g. callers passing a custom label) renders plain — graceful
 * fallback so `<MotionLogo wordmark="Studio"/>` still works.
 */
function Wordmark({ text }: { text: string }): ReactNode {
  if (text === 'ControlCraft') {
    return (
      <>
        Control
        {/* light mode bumped to accent-700 — accent-600 (#059669) on
            #fff lands at ~4.5:1 which Lighthouse rounds below the
            color-contrast threshold; accent-700 (#047857) clears it. */}
        <span className="text-accent-700 dark:text-accent-400">Craft</span>
      </>
    );
  }
  return text;
}
