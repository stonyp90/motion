'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Fires `true` once when the referenced element scrolls into view, then
 * stays true forever. The "once" semantics matter for entrance
 * animations — we don't want shapes that fly out + back in when the
 * user scrolls past + back.
 *
 * Implementation notes:
 * - SSR-safe: `useState(false)` initial so the server renders the
 *   pre-animation state.
 * - Respects `prefers-reduced-motion`: returns `true` immediately so
 *   the caller can skip the entrance and render the final state.
 * - IntersectionObserver root margin `-10%` so the trigger fires
 *   slightly after the element peeks past the viewport edge — gives
 *   the user a moment of "I see something" before the animation
 *   starts, so the motion reads as an arrival rather than an alarm.
 *
 * Usage:
 * ```tsx
 * const ref = useRef<HTMLDivElement>(null);
 * const visible = useInViewOnce(ref);
 * return <div ref={ref} className={visible ? 'fade-in' : 'opacity-0'} />;
 * ```
 */
export function useInViewOnce<T extends Element>(
  ref: React.RefObject<T | null>,
): boolean {
  const [inView, setInView] = useState(false);
  const triggered = useRef(false);

  useEffect(() => {
    // Honor reduced-motion preference — skip the observer entirely
    // and just flip true so callers render the final (post-anim) state.
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      setInView(true);
      return;
    }

    const node = ref.current;
    if (!node || triggered.current) return;

    // IntersectionObserver isn't on every browser (Safari < 12.1), so
    // a tiny feature-check + fallback prevents crashes.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && !triggered.current) {
            triggered.current = true;
            setInView(true);
            observer.disconnect();
            break;
          }
        }
      },
      {
        // Fire when the element is 10% past the viewport edge — gives
        // the eye a moment of "I see something" before the entrance
        // animation starts.
        rootMargin: '0px 0px -10% 0px',
        threshold: 0.05,
      },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return inView;
}
