'use client';

/**
 * WelcomeTour — 3-step first-visit onboarding for the post-login
 * welcome dashboard. Walks new users through the desktop-acquire path:
 * download the binary → install Ollama → discover what the app does.
 *
 * Architecture
 * ------------
 *  <WelcomeTourProvider>           — context + portal mount; wraps WelcomeDashboard
 *    └─ <WelcomeTour />            — overlay renderer (renders into <body>)
 *         ├─ <ScrimAndCutout />    — full-screen dim + transparent cutout
 *         └─ <Callout />           — pointer-aware popover with copy + CTAs
 *
 * The tour anchors to DOM nodes via `data-testid` attributes so it
 * remains decoupled from class names that change with styling passes.
 *
 *   Required testids on the welcome dashboard:
 *     - data-testid="mf-welcome-download"     on the OS-detected download card
 *     - data-testid="mf-welcome-install"      on the install-steps section
 *     - data-testid="mf-welcome-capabilities" on the capabilities grid
 *
 * Behavior
 * --------
 *  - Renders only when localStorage `mf-tour-completed` is absent.
 *  - Step 1 has a "Skip tour" link in addition to "Next".
 *  - Esc dismisses. Backdrop click does NOT (avoids accidents).
 *  - On reduced-motion, transitions collapse to fades only.
 *  - All copy is keyed for i18n (W18) via the `t()` helper. Default
 *    strings inline so this works before the i18n catalogue lands.
 *  - Recomputes anchor rects on resize/scroll via ResizeObserver.
 *  - Focus trap inside the callout while it's open.
 *
 * i18n keys (W18 will lift these into messages/en.json):
 *   onboarding.tour.step1.title
 *   onboarding.tour.step1.body
 *   onboarding.tour.step2.title
 *   onboarding.tour.step2.body
 *   onboarding.tour.step3.title
 *   onboarding.tour.step3.body
 *   onboarding.tour.next
 *   onboarding.tour.back
 *   onboarding.tour.skip
 *   onboarding.tour.done
 *   onboarding.tour.close
 *   onboarding.tour.progress   ("Step {current} of {total}")
 */

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// ---------------------------------------------------------------------------
// Storage key (single source of truth for "has the user finished the tour?")
// ---------------------------------------------------------------------------
export const TOUR_STORAGE_KEY = 'mf-welcome-tour-seen';

// ---------------------------------------------------------------------------
// i18n shim — replace with real hook in W18.
// ---------------------------------------------------------------------------
type Dict = Record<string, string>;
const DEFAULT_COPY: Dict = {
  'onboarding.tour.step1.title': 'Grab the build for your machine.',
  'onboarding.tour.step1.body':
    'ControlCraft runs natively. We picked the right installer for your OS — one click and the download starts.',
  'onboarding.tour.step2.title': 'Set up in about five minutes.',
  'onboarding.tour.step2.body':
    'The desktop shell wraps a local engine plus Ollama for on-device inference. Three steps, no command-line voodoo.',
  'onboarding.tour.step3.title': 'This is what waits inside the app.',
  'onboarding.tour.step3.body':
    'Local vision-model inference, brand-locked palette, every export your stack already takes. Run ControlCraft to start generating.',
  'onboarding.tour.next': 'Next',
  'onboarding.tour.back': 'Back',
  'onboarding.tour.skip': 'Skip tour',
  'onboarding.tour.done': 'Got it',
  'onboarding.tour.close': 'Close tour',
  'onboarding.tour.progress': 'Step {current} of {total}',
};
function t(key: string, vars?: Record<string, string | number>): string {
  let raw = DEFAULT_COPY[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      raw = raw.replace(`{${k}}`, String(v));
    }
  }
  return raw;
}

// ---------------------------------------------------------------------------
// Step spec — keep purely declarative so steps can be re-ordered or
// localised without code churn.
// ---------------------------------------------------------------------------
type Side = 'top' | 'bottom' | 'left' | 'right';

interface TourStep {
  id: 'download' | 'install' | 'launch';
  /** Primary DOM anchor — the callout points at this. */
  anchorTestId: string;
  /** Optional second anchor — both rects merge so the cutout covers both. */
  secondaryAnchorTestId?: string;
  /** Preferred side of the anchor to place the callout. */
  preferredSide: Side;
  titleKey: string;
  bodyKey: string;
}

const STEPS: readonly TourStep[] = [
  {
    id: 'download',
    anchorTestId: 'mf-welcome-download',
    preferredSide: 'bottom',
    titleKey: 'onboarding.tour.step1.title',
    bodyKey: 'onboarding.tour.step1.body',
  },
  {
    id: 'install',
    anchorTestId: 'mf-welcome-install',
    preferredSide: 'top',
    titleKey: 'onboarding.tour.step2.title',
    bodyKey: 'onboarding.tour.step2.body',
  },
  {
    id: 'launch',
    anchorTestId: 'mf-welcome-capabilities',
    preferredSide: 'top',
    titleKey: 'onboarding.tour.step3.title',
    bodyKey: 'onboarding.tour.step3.body',
  },
];

// ---------------------------------------------------------------------------
// Context — lets the host page imperatively re-open the tour (e.g. from a "?"
// help menu) or test it from a Storybook story.
// ---------------------------------------------------------------------------
interface WelcomeTourCtx {
  /** Forcibly (re-)open the tour, ignoring localStorage. */
  open: () => void;
  /** Close without marking complete (e.g. user navigated away mid-tour). */
  close: () => void;
  /** Mark complete and close. */
  complete: () => void;
  /** True while overlay is visible. */
  isOpen: boolean;
}

// Exported so peers (EmptyPreview, FirstUseTooltip) can do a safe
// `useContext(TourContext)` with a fallback when the provider is absent
// (e.g. inside a Storybook story or an isolated unit test).
export const TourContext = createContext<WelcomeTourCtx | null>(null);

export function useWelcomeTour(): WelcomeTourCtx {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useWelcomeTour must be used inside <WelcomeTourProvider>');
  return ctx;
}

/** Provider-optional variant for components that may render outside the tour. */
export function useWelcomeTourOptional(): WelcomeTourCtx | null {
  return useContext(TourContext);
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------
export interface WelcomeTourProviderProps {
  children: ReactNode;
  /**
   * If true (default), auto-open on first visit when localStorage flag is missing.
   * Set to false to gate the tour behind another signal (e.g. only after first sign-in).
   */
  autoStart?: boolean;
}

export function WelcomeTourProvider({
  children,
  autoStart = true,
}: WelcomeTourProviderProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Decide on mount whether to auto-open. Done once, in an effect, to keep
  // SSR/Next.js happy (no window access during render).
  useEffect(() => {
    if (!autoStart) return;
    if (typeof window === 'undefined') return;
    try {
      const completed = window.localStorage.getItem(TOUR_STORAGE_KEY);
      if (!completed) setIsOpen(true);
    } catch {
      // localStorage unavailable (private mode etc.) — fail open, show tour.
      setIsOpen(true);
    }
  }, [autoStart]);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const complete = useCallback(() => {
    try {
      window.localStorage.setItem(TOUR_STORAGE_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
    setIsOpen(false);
  }, []);

  const value = useMemo(() => ({ isOpen, open, close, complete }), [isOpen, open, close, complete]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {isOpen && <WelcomeTour />}
    </TourContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Overlay renderer
// ---------------------------------------------------------------------------
function WelcomeTour() {
  const { complete, close } = useWelcomeTour();
  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;

  // Track anchor geometry; re-measure on resize / scroll / step change.
  const rect = useAnchorRect(step.anchorTestId, step.secondaryAnchorTestId);

  // Esc handling + focus management.
  const calloutRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      } else if (e.key === 'Tab' && calloutRef.current) {
        trapFocus(e, calloutRef.current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  // Move focus into the callout when it opens / step changes.
  useEffect(() => {
    const el = calloutRef.current?.querySelector<HTMLElement>('[data-tour-autofocus]');
    el?.focus();
  }, [stepIndex]);

  const handleNext = useCallback(() => {
    if (isLast) complete();
    else setStepIndex((i) => i + 1);
  }, [isLast, complete]);

  const handleBack = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] motion-reduce:[--mf-tour-anim:none]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mf-tour-title"
      data-testid="mf-welcome-tour"
    >
      <ScrimAndCutout rect={rect} />
      <Callout
        ref={calloutRef}
        rect={rect}
        side={step.preferredSide}
        title={t(step.titleKey)}
        body={t(step.bodyKey)}
        progress={t('onboarding.tour.progress', {
          current: stepIndex + 1,
          total: STEPS.length,
        })}
        onClose={close}
        onNext={handleNext}
        onBack={handleBack}
        onSkip={complete}
        isFirst={isFirst}
        isLast={isLast}
      />
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Scrim + transparent cutout — draws a single big SVG <rect> with a
// mask carved out around the anchor. No nested DOM trickery, no layout
// jumps when steps switch.
// ---------------------------------------------------------------------------
function ScrimAndCutout({ rect }: { rect: DOMRect | null }) {
  // 8px breathing room around the highlighted element.
  const pad = 8;
  const cutout = rect
    ? {
        x: Math.max(0, rect.left - pad),
        y: Math.max(0, rect.top - pad),
        w: rect.width + pad * 2,
        h: rect.height + pad * 2,
      }
    : null;

  return (
    <svg
      className="absolute inset-0 h-full w-full transition-opacity duration-200 [transition:var(--mf-tour-anim,opacity_200ms_ease)]"
      aria-hidden="true"
      data-testid="mf-tour-scrim"
    >
      <defs>
        <mask id="mf-tour-cutout">
          {/* Full white = visible scrim */}
          <rect x="0" y="0" width="100%" height="100%" fill="white" />
          {cutout && (
            <rect
              x={cutout.x}
              y={cutout.y}
              width={cutout.w}
              height={cutout.h}
              rx="12"
              ry="12"
              fill="black"
            />
          )}
        </mask>
      </defs>
      <rect
        x="0"
        y="0"
        width="100%"
        height="100%"
        fill="var(--color-text-primary)"
        fillOpacity="0.55"
        mask="url(#mf-tour-cutout)"
      />
      {/* Emerald outline around the cutout — gives the "this is the bit" cue. */}
      {cutout && (
        <rect
          x={cutout.x}
          y={cutout.y}
          width={cutout.w}
          height={cutout.h}
          rx="12"
          ry="12"
          fill="none"
          stroke="var(--color-accent-500)"
          strokeWidth="2"
        />
      )}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Callout popover
// ---------------------------------------------------------------------------
interface CalloutProps {
  rect: DOMRect | null;
  side: Side;
  title: string;
  body: string;
  progress: string;
  onClose: () => void;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  isFirst: boolean;
  isLast: boolean;
}

const Callout = forwardRef<HTMLDivElement, CalloutProps>(function Callout(
  {
    rect,
    side,
    title,
    body,
    progress,
    onClose,
    onNext,
    onBack,
    onSkip,
    isFirst,
    isLast,
  },
  ref,
) {
  // Resolve callout position. Falls back to a centered modal when no anchor
  // (e.g. the page hasn't rendered yet — happens on the first frame).
  const position = useMemo(() => resolvePosition(rect, side), [rect, side]);

  return (
    <div
      ref={ref}
      role="document"
      className="absolute w-[min(92vw,420px)] rounded-2xl border border-border-light bg-bg-primary p-5 shadow-lift transition-[transform,opacity] duration-200 motion-reduce:transition-none"
      style={position.style}
      data-testid="mf-tour-callout"
      data-tour-side={position.side}
    >
      {/* Pointer arrow — pure CSS triangle anchored on the matching edge. */}
      <span
        aria-hidden="true"
        className="absolute h-3 w-3 rotate-45 border border-border-light bg-bg-primary"
        style={position.arrowStyle}
      />

      <header className="mb-2 flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-text-accent">
          {progress}
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('onboarding.tour.close')}
          className="-m-1 grid h-7 w-7 place-items-center rounded-full text-text-tertiary transition hover:bg-bg-tertiary hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <h2
        id="mf-tour-title"
        className="text-lg font-semibold leading-snug tracking-tight text-text-primary"
      >
        {title}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">{body}</p>

      <footer className="mt-5 flex items-center justify-between gap-3">
        {/* Left slot: Back on steps >1, Skip on step 1 */}
        {isFirst ? (
          <button
            type="button"
            onClick={onSkip}
            className="text-xs font-medium text-text-tertiary underline-offset-4 hover:text-text-secondary hover:underline"
          >
            {t('onboarding.tour.skip')}
          </button>
        ) : (
          <button
            type="button"
            onClick={onBack}
            className="text-xs font-medium text-text-tertiary hover:text-text-secondary"
          >
            {t('onboarding.tour.back')}
          </button>
        )}

        <button
          type="button"
          onClick={onNext}
          data-tour-autofocus
          className="inline-flex items-center justify-center gap-2 rounded-full bg-accent-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-accent-600 focus-visible:ring-2 focus-visible:ring-accent-500"
        >
          {isLast ? t('onboarding.tour.done') : t('onboarding.tour.next')}
        </button>
      </footer>

      {/* Step dots — sub-affordance so the user can see how many steps remain. */}
      <StepDots progress={progress} />
    </div>
  );
});

function StepDots({ progress }: { progress: string }) {
  // Derive current step from the progress string ("Step 2 of 3" → 1).
  const current = Math.max(0, Number(progress.match(/\d+/)?.[0] ?? '1') - 1);
  return (
    <div className="mt-4 flex justify-center gap-1.5" aria-hidden>
      {STEPS.map((s, i) => (
        <span
          key={s.id}
          className={`h-1.5 rounded-full transition-all ${
            i === current ? 'w-6 bg-accent-500' : 'w-1.5 bg-border-default'
          }`}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Position resolver
// ---------------------------------------------------------------------------
interface ResolvedPosition {
  side: Side;
  style: React.CSSProperties;
  arrowStyle: React.CSSProperties;
}

function resolvePosition(rect: DOMRect | null, preferred: Side): ResolvedPosition {
  // Fallback: centered modal.
  if (!rect) {
    return {
      side: preferred,
      style: {
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
      },
      arrowStyle: { display: 'none' },
    };
  }

  // Viewport bounds with a 16px safe margin.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const m = 16; // gap between anchor and callout
  const calloutW = Math.min(420, vw - 32);
  const calloutH = 200; // rough — final height auto, this only feeds clamping

  // Pick side: respect preferred unless it doesn't fit.
  let side: Side = preferred;
  const fits = {
    bottom: rect.bottom + m + calloutH < vh,
    top: rect.top - m - calloutH > 0,
    right: rect.right + m + calloutW < vw,
    left: rect.left - m - calloutW > 0,
  };
  if (!fits[side]) {
    side =
      (['bottom', 'top', 'right', 'left'] as Side[]).find((s) => fits[s]) ?? preferred;
  }

  // Compute top/left based on chosen side.
  let top = 0;
  let left = 0;
  let arrowTop = 0;
  let arrowLeft = 0;

  switch (side) {
    case 'bottom':
      top = rect.bottom + m;
      left = clamp(rect.left + rect.width / 2 - calloutW / 2, 16, vw - calloutW - 16);
      arrowTop = -6;
      arrowLeft = rect.left + rect.width / 2 - left - 6;
      break;
    case 'top':
      top = rect.top - m - calloutH;
      left = clamp(rect.left + rect.width / 2 - calloutW / 2, 16, vw - calloutW - 16);
      arrowTop = calloutH - 6;
      arrowLeft = rect.left + rect.width / 2 - left - 6;
      break;
    case 'right':
      top = clamp(rect.top + rect.height / 2 - calloutH / 2, 16, vh - calloutH - 16);
      left = rect.right + m;
      arrowTop = rect.top + rect.height / 2 - top - 6;
      arrowLeft = -6;
      break;
    case 'left':
      top = clamp(rect.top + rect.height / 2 - calloutH / 2, 16, vh - calloutH - 16);
      left = rect.left - m - calloutW;
      arrowTop = rect.top + rect.height / 2 - top - 6;
      arrowLeft = calloutW - 6;
      break;
  }

  return {
    side,
    style: { top, left, width: calloutW },
    arrowStyle: {
      top: arrowTop,
      left: arrowLeft,
      // Cull the two interior borders so the arrow looks seamless with the card.
      borderTop: side === 'bottom' ? undefined : 'none',
      borderLeft: side === 'right' ? undefined : 'none',
      borderRight: side === 'left' ? undefined : 'none',
      borderBottom: side === 'top' ? undefined : 'none',
    },
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ---------------------------------------------------------------------------
// Anchor rect hook — merges 1-2 testids into one bounding rect, re-measures
// on resize / scroll / DOM mutation.
// ---------------------------------------------------------------------------
function useAnchorRect(
  primaryId: string,
  secondaryId?: string,
): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  const measure = useCallback(() => {
    if (typeof document === 'undefined') return;
    const a = document.querySelector<HTMLElement>(`[data-testid="${primaryId}"]`);
    if (!a) {
      setRect(null);
      return;
    }
    const aRect = a.getBoundingClientRect();
    if (!secondaryId) {
      setRect(aRect);
      return;
    }
    const b = document.querySelector<HTMLElement>(`[data-testid="${secondaryId}"]`);
    if (!b) {
      setRect(aRect);
      return;
    }
    const bRect = b.getBoundingClientRect();
    setRect(unionRect(aRect, bRect));
  }, [primaryId, secondaryId]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let raf = 0;
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);

    // Also watch the anchor itself in case its size changes (e.g. textarea grows).
    const target = document.querySelector<HTMLElement>(`[data-testid="${primaryId}"]`);
    const ro = target && 'ResizeObserver' in window ? new ResizeObserver(schedule) : null;
    if (target && ro) ro.observe(target);

    return () => {
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      ro?.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [measure, primaryId]);

  return rect;
}

function unionRect(a: DOMRect, b: DOMRect): DOMRect {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  const right = Math.max(a.right, b.right);
  const bottom = Math.max(a.bottom, b.bottom);
  return new DOMRect(left, top, right - left, bottom - top);
}

// ---------------------------------------------------------------------------
// Focus trap — minimal, no dependency. Keeps Tab inside the callout while
// the tour is open, so screen-reader users can't accidentally land behind
// the scrim.
// ---------------------------------------------------------------------------
function trapFocus(e: KeyboardEvent, container: HTMLElement) {
  const focusables = container.querySelectorAll<HTMLElement>(
    'button, [href], input, textarea, [tabindex]:not([tabindex="-1"])',
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
