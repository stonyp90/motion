/**
 * Client for the engine's /v1/metrics endpoint. Returns CPU, RAM and
 * engine-process stats plus the suggested warn/critical thresholds so
 * the UI doesn't have to guess colours.
 *
 * Auth: same Bearer JWT the rest of /v1 takes. When unset we still
 * poll (the engine accepts the static fallback key in dev).
 */

export interface EngineMetrics {
  cpu: { usage_percent: number; cores: number; brand?: string | null };
  memory: {
    total_bytes: number;
    used_bytes: number;
    free_bytes: number;
    usage_percent: number;
    swap_total_bytes: number;
    swap_used_bytes: number;
  };
  process: { rss_bytes: number; threads: number };
  thresholds: { healthy_below: number; warning_below: number };
  uptime_seconds: number;
  timestamp: number;
}

import { getEngineBase } from './runtime-config';

export async function fetchEngineMetrics(
  bearer?: string | null,
  signal?: AbortSignal,
): Promise<EngineMetrics | null> {
  try {
    const r = await fetch(`${getEngineBase()}/v1/metrics`, {
      cache: 'no-store',
      signal,
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : undefined,
    });
    if (!r.ok) return null;
    return (await r.json()) as EngineMetrics;
  } catch {
    return null;
  }
}

/**
 * Map a 0-100 percentage to one of three semantic levels using the
 * thresholds the engine recommends. Mirrors ursly's success / warning
 * / critical convention so the dashboard register is consistent.
 */
export type Severity = 'healthy' | 'warning' | 'critical';

export function severityFor(
  value: number,
  thresholds: { healthy_below: number; warning_below: number },
): Severity {
  if (value < thresholds.healthy_below) return 'healthy';
  if (value < thresholds.warning_below) return 'warning';
  return 'critical';
}

/**
 * Tailwind class fragments for bar fill + text colour per severity.
 * Kept here (not in CSS) so the rules are visible alongside the
 * threshold logic.
 */
export const severityColors: Record<
  Severity,
  { bar: string; text: string; ring: string }
> = {
  healthy: {
    bar: 'bg-accent-600',
    text: 'text-accent-700',
    ring: 'ring-accent-300',
  },
  warning: {
    bar: 'bg-secondary-500',
    text: 'text-secondary-700',
    ring: 'ring-secondary-300',
  },
  critical: {
    bar: 'bg-red-500',
    text: 'text-red-700',
    ring: 'ring-red-300',
  },
};

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function humanDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(0)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86400).toFixed(1)}d`;
}
