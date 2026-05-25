'use client';

/**
 * ErrorToast — bottom-right transient notification, hand-rolled.
 *
 * Design intent: errors must never block the prompt textarea. The user is
 * mid-thought; we communicate the failure, offer a retry, and disappear on
 * their schedule. The toast lives in a portal-friendly fixed position so
 * any caller can mount it anywhere in the tree.
 *
 * Behavior:
 *  - Slides in from below-right with the toast-in keyframe.
 *  - Auto-dismisses after `durationMs` (default 6s — long enough to read
 *    and click Retry, short enough not to nag).
 *  - Hovering pauses the dismiss timer (Stripe-doc pattern). Mouse-leave
 *    resumes it from where it paused.
 *  - Clicking the dismiss × runs the exit animation, then unmounts via
 *    onDismiss.
 *  - Retry button calls onRetry and dismisses immediately.
 *  - role="alert" + aria-live="assertive" so screen readers announce it
 *    without waiting.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, RotateCw, X } from 'lucide-react';

interface ErrorToastProps {
  message: string;
  onRetry?: () => void;
  onDismiss: () => void;
  /** Auto-dismiss timeout in ms. Default 6000. */
  durationMs?: number;
}

export function ErrorToast({
  message,
  onRetry,
  onDismiss,
  durationMs = 6000,
}: ErrorToastProps) {
  const [exiting, setExiting] = useState(false);
  const remainingRef = useRef<number>(durationMs);
  const startedAtRef = useRef<number>(Date.now());
  const timerRef = useRef<number | null>(null);

  // Run the exit animation, then call the parent's onDismiss.
  const dismiss = useCallback(() => {
    if (exiting) return;
    setExiting(true);
    // Match --dur-fast from motion-principles.css.
    window.setTimeout(onDismiss, 180);
  }, [exiting, onDismiss]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleDismiss = useCallback(
    (ms: number) => {
      clearTimer();
      startedAtRef.current = Date.now();
      timerRef.current = window.setTimeout(dismiss, ms);
    },
    [clearTimer, dismiss],
  );

  // Start the dismiss timer on mount; clean up on unmount.
  useEffect(() => {
    scheduleDismiss(remainingRef.current);
    return clearTimer;
  }, [scheduleDismiss, clearTimer]);

  // Hover pauses the dismiss timer; leave resumes from where it left off.
  const onMouseEnter = () => {
    if (timerRef.current === null) return;
    const elapsed = Date.now() - startedAtRef.current;
    remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    clearTimer();
  };

  const onMouseLeave = () => {
    scheduleDismiss(remainingRef.current);
  };

  const handleRetry = () => {
    onRetry?.();
    dismiss();
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`fixed bottom-6 right-6 z-50 flex max-w-sm items-start gap-3 rounded-2xl border border-border bg-bg-primary p-4 shadow-lift ${
        exiting ? 'animate-toast-out' : 'animate-toast-in'
      }`}
    >
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary-50 text-secondary-700">
        <AlertCircle className="h-4 w-4" />
      </div>

      <div className="flex-1 pt-0.5">
        <p className="text-sm font-medium text-text-primary">{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={handleRetry}
            className="motion-hover mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-accent-600 hover:text-accent-700"
          >
            <RotateCw className="h-3 w-3" />
            Try again
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss notification"
        className="motion-hover -mr-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
