'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * motion-forge brand logo.
 *
 * Icon — three rounded squares cascading horizontally with three distinct
 * accent stops (deepest at the leading edge, palest trailing). Reads as
 * "frames in flight, time moving left → right". Sibling Tablix uses the
 * same 3-stop family logic but with a diagonal stack (data-in-space);
 * motion's is horizontal (animation-in-time).
 *
 * Wordmark — "motion-forge" rendered with two custom typographic details:
 *   1. the 'i' is replaced with dotless `ı` and a brand-colored *square*
 *      dot is overlaid in the right pixel position
 *   2. the hyphen `-` is replaced with a small inline square (matching #1)
 *      so the inter-word break reads as a brand mark rather than a dash
 *
 * The square-dot trick is borrowed from Tablix; the cascade geometry,
 * color stops, and the hyphen-as-square treatment are motion's own.
 */

type Size = 'sm' | 'md' | 'lg';

interface MotionLogoProps {
  size?: Size;
  /** Wrap the logo in a <Link>; defaults true. Set false inside an
   *  existing anchor or when the logo is purely decorative. */
  showLink?: boolean;
  /** Destination when wrapped. Defaults to '/'. */
  href?: string;
  /** Override the wordmark — defaults to 'motion-forge'. Pass an empty
   *  string to render the icon alone. */
  wordmark?: string;
  /** Optional class hook for the outer flex container. */
  className?: string;
}

/* Side-by-side sizes. Icon width is derived from height × 1.5714 to keep
   the cascade aspect ratio constant across sizes (44/28 viewBox). */
const SIZES: Record<Size, { icon: number; text: string; gap: string }> = {
  sm: { icon: 24, text: 'text-[15px]', gap: 'gap-2'    },
  md: { icon: 28, text: 'text-[18px]', gap: 'gap-2.5'  },
  lg: { icon: 40, text: 'text-2xl',    gap: 'gap-3'    },
};

export function MotionLogo({
  size = 'md',
  showLink = true,
  href = '/',
  wordmark = 'motion-forge',
  className,
}: MotionLogoProps) {
  const s = SIZES[size];

  const content = (
    <div className={`flex items-center ${s.gap} ${className ?? ''}`}>
      <MotionMark size={s.icon} />
      {wordmark && (
        <span
          className={`${s.text} font-bold tracking-tight text-text-primary`}
        >
          <Wordmark text={wordmark} />
        </span>
      )}
    </div>
  );

  if (!showLink) return content;
  return (
    <Link href={href as never} aria-label="motion-forge home" className="group inline-flex">
      {content}
    </Link>
  );
}

/* ----------------------------------------------------------------- icon */

/**
 * The 3-rect cascade. Pure SVG so it inherits color via Tailwind fill-*
 * utilities and the dark-mode flip via `dark:`.
 *
 * Layout: viewBox 44x28. Rects are 20x20 at y=4, offset x=0/9/18, so
 * they overlap by ~11px each (a hair more than half). Color depth climbs
 * left → right: pale accent → brand emerald → deep emerald. Three solid
 * stops (no opacity) so each frame reads cleanly on light AND dark.
 *
 * Dark-mode: the deep stop would muddle into the soft-black surface, so
 * we invert the gradient — palest at the back, brightest at the front —
 * to keep the leading frame as the visual anchor.
 */
function MotionMark({ size }: { size: number }) {
  // 44/28 aspect ratio
  const width = Math.round(size * 1.5714);
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
      <rect
        x="0"
        y="4"
        width="20"
        height="20"
        rx="5"
        className="fill-accent-300 dark:fill-accent-700"
      />
      <rect
        x="9"
        y="4"
        width="20"
        height="20"
        rx="5"
        className="fill-accent-500 dark:fill-accent-500"
      />
      <rect
        x="18"
        y="4"
        width="20"
        height="20"
        rx="5"
        className="fill-accent-700 dark:fill-accent-300"
      />
    </svg>
  );
}

/* ------------------------------------------------------------- wordmark */

/**
 * Render `text` with two motion-specific typographic substitutions:
 *  - first occurrence of 'i'  → dotless `ı` + overlaid square dot
 *  - every '-'                → small inline square (mid-dot register)
 *
 * Both replacement glyphs share the same brand-colored square — that's
 * what knits the icon and wordmark together visually.
 */
function Wordmark({ text }: { text: string }) {
  // Split on '-' to apply the inline-square separator.
  const segments = text.split('-');
  // Find the first segment that contains 'i' so we know where to apply
  // the dotless-i substitution.
  let dottedConsumed = false;
  return (
    <>
      {segments.map((seg, i) => {
        const node =
          !dottedConsumed && seg.includes('i')
            ? (() => {
                dottedConsumed = true;
                return renderDottedI(seg);
              })()
            : seg;
        return (
          <span key={i}>
            {i > 0 && <SquareDot inline />}
            {node}
          </span>
        );
      })}
    </>
  );
}

function renderDottedI(seg: string): ReactNode {
  const idx = seg.indexOf('i');
  if (idx === -1) return seg;
  return (
    <>
      {seg.slice(0, idx)}
      <span className="relative">
        <span
          aria-hidden
          className="absolute bg-accent-700 dark:bg-accent-300"
          style={{
            left: '50%',
            transform: 'translateX(-50%)',
            top: '0.18em',
            width: '0.18em',
            height: '0.18em',
            borderRadius: '1px',
            zIndex: 1,
          }}
        />
        ı
      </span>
      {seg.slice(idx + 1)}
    </>
  );
}

/**
 * Brand-colored square used in two places: above the dotless `ı` (the
 * 'i' dot replacement) and inline between word segments (the hyphen
 * replacement). The `inline` variant is the latter.
 */
function SquareDot({ inline = false }: { inline?: boolean }) {
  if (!inline) {
    // Not used as a standalone component today, but kept for the brand
    // kit's logo catalog to render an isolated dot.
    return (
      <span
        aria-hidden
        className="inline-block bg-accent-700 dark:bg-accent-300"
        style={{
          width: '0.18em',
          height: '0.18em',
          borderRadius: '1px',
        }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-block bg-accent-700 dark:bg-accent-300"
      style={{
        width: '0.20em',
        height: '0.20em',
        borderRadius: '1px',
        marginLeft: '0.18em',
        marginRight: '0.18em',
        verticalAlign: '0.30em',
      }}
    />
  );
}
