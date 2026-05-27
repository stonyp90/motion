/**
 * Provider-agnostic analytics shim. Today: dispatches a CustomEvent
 * on `window` so the host page can pipe it wherever (PostHog, Segment,
 * server beacon). Also `console.debug`s the event for dev visibility.
 *
 * Replace with the real client when one lands — every call site
 * already uses this shape so the migration is a one-file change.
 */

export interface TrackEvent {
  event: string;
  props?: Record<string, unknown>;
  /** Wall-clock ms when the event was emitted. Stamped here, not by the consumer. */
  at: number;
}

export function track(event: string, props?: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  const detail: TrackEvent = { event, props, at: Date.now() };
  try {
    window.dispatchEvent(new CustomEvent('cc:telemetry', { detail }));
  } catch {
    /* ignore — old browsers without CustomEvent constructor */
  }
  if (process.env.NODE_ENV !== 'production') {
    console.debug('[cc:telemetry]', detail);
  }
}
