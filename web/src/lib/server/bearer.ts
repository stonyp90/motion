import 'server-only';
import type { NextRequest } from 'next/server';

/**
 * Extract the user id (`sub`) and email from a Bearer JWT on the
 * incoming request. We do NOT validate the signature here — the
 * Keycloak admin REST calls downstream will fail if the user id is
 * fake. For sensitive operations (password change, account delete)
 * the route additionally re-verifies the user's password via
 * `passwordLogin()` before doing anything destructive.
 *
 * Returns null if the header is missing, malformed, or the JWT has
 * no usable `sub` / `email` claim.
 */
export interface BearerIdentity {
  sub: string;
  email: string;
  emailVerified: boolean;
}

export function readBearer(req: NextRequest): BearerIdentity | null {
  const h = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1];
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(json) as Record<string, unknown>;
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    const email = typeof payload.email === 'string' ? payload.email : '';
    const emailVerified =
      typeof payload.email_verified === 'boolean' ? payload.email_verified : false;
    if (!sub || !email) return null;
    // Check exp if present.
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
      return null;
    }
    return { sub, email, emailVerified };
  } catch {
    return null;
  }
}
