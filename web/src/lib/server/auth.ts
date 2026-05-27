/**
 * Bearer-token guard helpers — server-only.
 *
 * Small wrappers around `verifyAccessToken` (see ./jwks) that pull the
 * `Authorization: Bearer <jwt>` header off a `NextRequest`, validate
 * it, and either hand the payload back or return a ready-to-ship 401
 * response. Keeps protected route handlers free of header parsing
 * ceremony.
 *
 * Usage:
 *   const gate = await requireBearer(req);
 *   if (!gate.ok) return gate.response;
 *   // gate.payload is the decoded JWT payload, ready to use.
 *
 * Returning a discriminated union (rather than throwing) lets the
 * caller branch with no try/catch and keeps the happy-path code linear.
 */

import 'server-only';

import { NextResponse, type NextRequest } from 'next/server';
import type { JWTPayload } from 'jose';
import { verifyAccessToken } from './jwks';

/** WWW-Authenticate value sent on every 401 from this module. */
const WWW_AUTH = 'Bearer realm="controlcraft"';

export type BearerGate =
  | { ok: true; token: string; payload: JWTPayload }
  | { ok: false; response: NextResponse };

/**
 * Extract `Authorization: Bearer <token>` (case-insensitive scheme).
 * Returns `null` if the header is missing or malformed.
 */
function readBearer(req: NextRequest): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const match = /^bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

/**
 * Build a 401 with the JSON shape the client UI expects and the
 * mandatory `WWW-Authenticate` challenge header. Centralised so every
 * protected endpoint reports failure identically.
 */
export function bearerChallenge(reason: 'missing' | 'invalid'): NextResponse {
  const body =
    reason === 'missing'
      ? { error: 'authentication_required', detail: 'bearer token required' }
      : { error: 'invalid_token', detail: 'bearer token rejected' };
  return NextResponse.json(body, {
    status: 401,
    headers: {
      'WWW-Authenticate': WWW_AUTH,
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Require a valid bearer token on the request. On success returns
 * `{ ok: true, token, payload }`; on failure returns
 * `{ ok: false, response }` where `response` is a 401 the caller can
 * `return` directly.
 */
export async function requireBearer(req: NextRequest): Promise<BearerGate> {
  const token = readBearer(req);
  if (!token) {
    return { ok: false, response: bearerChallenge('missing') };
  }
  const verified = await verifyAccessToken(token);
  if (!verified) {
    return { ok: false, response: bearerChallenge('invalid') };
  }
  return { ok: true, token, payload: verified.payload };
}
