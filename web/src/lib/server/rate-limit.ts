import type { NextRequest } from 'next/server';

/**
 * Per-IP sliding-window rate limit, in-memory. Cheap defense against
 * wordlist walkers and resend abuse. ACA is single-instance so a
 * process-local store is fine; multi-instance deployments should swap
 * this for Redis without changing the call sites.
 *
 * Returns true if the request is within the limit, false if it should
 * be rejected with 429.
 */

const buckets: Map<string, number[]> = new Map();

export interface RateLimitOptions {
  /** Unique key for the limit family (e.g., 'register', 'forgot-password'). */
  scope: string;
  /** Max requests per window. */
  max: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

export function checkRateLimit(ip: string, opts: RateLimitOptions): boolean {
  const key = `${opts.scope}:${ip}`;
  const now = Date.now();
  const cutoff = now - opts.windowMs;
  const hits = (buckets.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length >= opts.max) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}

/** Best-effort client IP — works behind ACA's ingress proxy. */
export function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}
