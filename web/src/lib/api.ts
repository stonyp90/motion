/**
 * Thin HTTP client for the motion-forge engine.
 *
 * `fetchEngine(path, opts)` is the single chokepoint every UI call
 * goes through: it reads the engine base URL from
 * `NEXT_PUBLIC_ENGINE_BASE_URL`, attaches the Keycloak bearer token
 * from the NextAuth session, and forwards JSON bodies.
 *
 * Server components / route handlers should use `fetchEngineServer`
 * (defined below) which can call `auth()` directly. Client
 * components use `fetchEngine` which pulls the token off the
 * client-side session (via `getSession`).
 */

import type { Session } from 'next-auth';

const DEFAULT_BASE_URL =
  process.env.NEXT_PUBLIC_ENGINE_BASE_URL ?? 'http://localhost:7755';

export class EngineError extends Error {
  constructor(
    public status: number,
    public path: string,
    public detail: unknown,
  ) {
    super(`engine ${status} on ${path}`);
    this.name = 'EngineError';
  }
}

export interface FetchEngineOptions extends Omit<RequestInit, 'body'> {
  /** JSON body — will be stringified + Content-Type added. */
  json?: unknown;
  /** Explicit token override; otherwise resolved from the session. */
  token?: string | null;
  /** Override base URL (useful in tests). */
  baseUrl?: string;
}

interface AuthedSession extends Session {
  accessToken?: string;
}

/**
 * Resolve the bearer token from the client-side NextAuth session.
 * Returns `null` if there is no session.
 */
async function clientAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') {
    return null;
  }
  // Dynamic import so server bundles never pull `next-auth/react`.
  const { getSession } = await import('next-auth/react');
  const session = (await getSession()) as AuthedSession | null;
  return session?.accessToken ?? null;
}

function joinUrl(base: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const baseClean = base.replace(/\/+$/, '');
  const pathClean = path.startsWith('/') ? path : `/${path}`;
  return `${baseClean}${pathClean}`;
}

/**
 * Call the engine API from a client component. Throws `EngineError`
 * on non-2xx responses, returns the JSON-decoded body on success.
 */
export async function fetchEngine<T = unknown>(
  path: string,
  opts: FetchEngineOptions = {},
): Promise<T> {
  const { json, token, baseUrl, headers: headerInit, ...rest } = opts;
  const url = joinUrl(baseUrl ?? DEFAULT_BASE_URL, path);

  const headers = new Headers(headerInit);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }

  const resolvedToken =
    token === undefined ? await clientAccessToken() : token;
  if (resolvedToken) {
    headers.set('Authorization', `Bearer ${resolvedToken}`);
  }

  const init: RequestInit = { ...rest, headers };
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
    init.body = JSON.stringify(json);
    if (!init.method) {
      init.method = 'POST';
    }
  }

  const res = await fetch(url, init);
  const isJson = res.headers
    .get('content-type')
    ?.includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    throw new EngineError(res.status, path, payload);
  }
  return payload as T;
}

/**
 * Server-only variant. Pulls the bearer token via NextAuth's `auth()`
 * helper so server components and route handlers don't have to thread
 * the session manually.
 */
export async function fetchEngineServer<T = unknown>(
  path: string,
  opts: FetchEngineOptions = {},
): Promise<T> {
  const { auth } = await import('@/lib/auth');
  const session = (await auth()) as AuthedSession | null;
  const token = opts.token === undefined ? session?.accessToken ?? null : opts.token;
  return fetchEngine<T>(path, { ...opts, token });
}
