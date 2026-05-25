'use client';

/**
 * FirstUseTooltip — a small popover that appears once per UI element
 * on first hover/focus, then never again on that browser.
 *
 * Use cases (W18 spec):
 *   - mic button         → "Click and talk. Your words appear as you speak."
 *   - cast `+` button    → "Add a person, mascot, or brand logo that should appear in the video."
 *   - theme toggle       → "Light or dark — your call."
 *   - export buttons     → "Three flavors. Lottie for the web, MP4 for everything else,
 *                          pack for designers."
 *
 * Storage
 *  - localStorage key per element: `mf-tip-{tipKey}` (ISO timestamp of dismissal).
 *
 * UX
 *  - Shows on the first `mouseenter` OR `focus` of the wrapped child.
 *  - Auto-dismisses on the first `mouseleave` after a 600 ms delay, OR
 *    when the user clicks anywhere outside the popover.
 *  - "Got it" CTA marks it dismissed permanently.
 *  - Esc dismisses (and marks dismissed).
 *  - Hidden if the WelcomeTour is currently on screen (one overlay at a time).
 *
 * API
 *  <FirstUseTooltip tipKey="mic" body="Click and talk…">
 *    <button>...</button>
 *  </FirstUseTooltip>
 *
 *  The wrapper renders a relatively-positioned span around the child so
 *  the popover can be positioned without changing the child's layout.
 *
 * i18n keys (W18):
 *   onboarding.tip.gotIt
 *   onboarding.tip.{tipKey}.body   (host passes the resolved string in via `body`)
 */

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useWelcomeTourOptional } from './WelcomeTour';

export type TipPlacement = 'top' | 'bottom' | 'left' | 'right';

export interface FirstUseTooltipProps {
  /** Unique, stable key per UI element (e.g. "mic", "cast-add", "theme", "export"). */
  tipKey: string;
  /** Resolved English (or i18n-resolved) body copy. */
  body: ReactNode;
  /** Optional title — bolded above the body. */
  title?: string;
  /** Preferred placement. Defaults to `bottom`. */
  placement?: TipPlacement;
  /** The element to attach the tooltip to. Must be a single React child. */
  children: ReactElement;
  /** "Got it" CTA label. Defaults to onboarding.tip.gotIt. */
  ctaLabel?: string;
  /**
   * Override for the storage key (rare — tests, multi-tenant, etc.).
   * Default: `mf-tip-${tipKey}`.
   */
  storageKey?: string;
}

export function FirstUseTooltip({
  tipKey,
  body,
  title,
  placement = 'bottom',
  children,
  ctaLabel = 'Got it',
  storageKey,
}: FirstUseTooltipProps) {
  const key = storageKey ?? `mf-tip-${tipKey}`;
  const id = useId();

  // Hidden when (a) already dismissed, or (b) WelcomeTour is on top.
  const [dismissed, setDismissed] = useState<boolean>(true);
  const [open, setOpen] = useState<boolean>(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tour = useWelcomeTourOptional();
  const tourIsOpen = tour?.isOpen ?? false;

  // Read storage once on mount — `dismissed` defaults to true so we never
  // flash the popover during hydration.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const v = window.localStorage.getItem(key);
      setDismissed(Boolean(v));
    } catch {
      setDismissed(false); // localStorage blocked — treat as not dismissed.
    }
  }, [key]);

  const markDismissed = useCallback(() => {
    setOpen(false);
    setDismissed(true);
    try {
      window.localStorage.setItem(key, new Date().toISOString());
    } catch {
      /* ignore */
    }
  }, [key]);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 600);
  }, [cancelClose]);

  // Esc dismisses (and marks dismissed). Outside click dismisses.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        markDismissed();
      }
    };
    const onPointer = (e: PointerEvent) => {
      const tgt = e.target as Node | null;
      if (!tgt) return;
      const root = document.getElementById(id);
      if (root && !root.contains(tgt)) markDismissed();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open, id, markDismissed]);

  // Don't render the popover at all if already dismissed or tour is up.
  // Still render the child unmodified so the wrapped UI keeps working.
  if (!isValidElement(children)) return children;

  if (dismissed || tourIsOpen) {
    return <>{children}</>;
  }

  // Attach handlers to the child to drive open/close on first hover or focus.
  type AnyHandler<E> = ((e: E) => void) | undefined;
  type ChildProps = {
    onMouseEnter?: AnyHandler<MouseEvent<HTMLElement>>;
    onMouseLeave?: AnyHandler<MouseEvent<HTMLElement>>;
    onFocus?: AnyHandler<FocusEvent<HTMLElement>>;
    onBlur?: AnyHandler<FocusEvent<HTMLElement>>;
  };

  const childProps = (children.props ?? {}) as ChildProps;
  const handleEnter = (e: MouseEvent<HTMLElement>) => {
    childProps.onMouseEnter?.(e);
    cancelClose();
    setOpen(true);
  };
  const handleLeave = (e: MouseEvent<HTMLElement>) => {
    childProps.onMouseLeave?.(e);
    scheduleClose();
  };
  const handleFocus = (e: FocusEvent<HTMLElement>) => {
    childProps.onFocus?.(e);
    cancelClose();
    setOpen(true);
  };
  const handleBlur = (e: FocusEvent<HTMLElement>) => {
    childProps.onBlur?.(e);
    scheduleClose();
  };

  return (
    <span
      id={id}
      className="relative inline-flex"
      data-testid={`mf-tip-wrapper-${tipKey}`}
      onMouseEnter={cancelClose}
      onMouseLeave={scheduleClose}
    >
      {cloneElement(children, {
        onMouseEnter: handleEnter,
        onMouseLeave: handleLeave,
        onFocus: handleFocus,
        onBlur: handleBlur,
        'aria-describedby': open ? `${id}-popover` : undefined,
      } as Partial<typeof children.props>)}

      {open && (
        <span
          role="tooltip"
          id={`${id}-popover`}
          data-testid={`mf-tip-${tipKey}`}
          className={[
            'pointer-events-auto absolute z-[110] w-64 rounded-xl border border-border-light bg-bg-primary p-3 text-left shadow-lift',
            'motion-safe:animate-[mf-tip-pop_140ms_ease-out]',
            placementClass(placement),
          ].join(' ')}
          // Inline keyframes — kept local so this component is fully drop-in.
          // The host page may already define a similar utility; that's fine.
          style={{}}
        >
          <span
            aria-hidden
            className={[
              'absolute h-2.5 w-2.5 rotate-45 border border-border-light bg-bg-primary',
              arrowClass(placement),
            ].join(' ')}
          />
          {title && (
            <p className="mb-1 text-xs font-semibold text-text-primary">{title}</p>
          )}
          <p className="text-xs leading-relaxed text-text-secondary">{body}</p>
          <div className="mt-2.5 flex justify-end">
            <button
              type="button"
              onClick={markDismissed}
              className="text-xs font-semibold text-accent-600 transition hover:text-accent-700 focus-visible:underline"
            >
              {ctaLabel}
            </button>
          </div>
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Placement helpers — pure Tailwind, no JS math (the tooltip is small enough
// that the simple "place relative to wrapper" model is sufficient).
// ---------------------------------------------------------------------------
function placementClass(p: TipPlacement): string {
  switch (p) {
    case 'top':
      return 'bottom-full left-1/2 mb-2 -translate-x-1/2';
    case 'right':
      return 'left-full top-1/2 ml-2 -translate-y-1/2';
    case 'left':
      return 'right-full top-1/2 mr-2 -translate-y-1/2';
    case 'bottom':
    default:
      return 'top-full left-1/2 mt-2 -translate-x-1/2';
  }
}

function arrowClass(p: TipPlacement): string {
  switch (p) {
    case 'top':
      return 'left-1/2 -bottom-1.5 -translate-x-1/2 border-l-0 border-t-0';
    case 'right':
      return 'top-1/2 -left-1.5 -translate-y-1/2 border-r-0 border-t-0';
    case 'left':
      return 'top-1/2 -right-1.5 -translate-y-1/2 border-l-0 border-b-0';
    case 'bottom':
    default:
      return 'left-1/2 -top-1.5 -translate-x-1/2 border-r-0 border-b-0';
  }
}

// ---------------------------------------------------------------------------
// Pop-in keyframes — emitted once at the bottom of the page via a <style>
// tag so this component is a single import. Hosts that prefer a global
// rule can lift this into globals.css and delete the export below.
// ---------------------------------------------------------------------------
export const FIRST_USE_TOOLTIP_KEYFRAMES = `
@keyframes mf-tip-pop {
  from { opacity: 0; transform: scale(0.96) translate(var(--mf-tip-tx, -50%), var(--mf-tip-ty, 0)); }
  to   { opacity: 1; transform: scale(1) translate(var(--mf-tip-tx, -50%), var(--mf-tip-ty, 0)); }
}
`;
