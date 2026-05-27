import 'server-only';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Stateless HMAC-signed tokens for verify-email and password-reset
 * links. Same scheme as JWT-HS256 but with a smaller payload surface
 * (we control both ends — no need for the full JOSE envelope).
 *
 * Wire format: base64url(payloadJson) + '.' + base64url(hmacSha256(payloadJson))
 *
 * Reason for not using Keycloak's built-in actions: those route via
 * SMTP. We send through Azure Communication Services (ACS) and want
 * one delivery path / one template system. Trade-off: we accept a tiny
 * bit of token-format ownership in exchange for a single, observable
 * email pipeline.
 */

const SECRET = process.env.AUTH_SECRET ?? '';

function requireSecret(): string {
  if (!SECRET || SECRET.length < 32) {
    throw new Error(
      'AUTH_SECRET must be set to at least 32 characters in production for signed auth tokens.',
    );
  }
  return SECRET;
}

export type TokenPurpose = 'verify-email' | 'reset-password';

export interface TokenPayload {
  /** Keycloak user id. */
  sub: string;
  email: string;
  purpose: TokenPurpose;
  /** Issued-at (ms since epoch). */
  iat: number;
  /** Expiry (ms since epoch). */
  exp: number;
  /**
   * Optional binding claim — for reset-password we tie the token to the
   * user's `createdTimestamp` so a re-issued token after a password
   * change can be invalidated by rotating any user attribute we control.
   * We use `createdTimestamp` because it's stable, monotonic, and
   * visible via the admin REST API without an extra round-trip.
   */
  bind?: string;
}

function b64urlEncode(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf, 'utf8') : buf;
  return b
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function b64urlDecode(s: string): Buffer {
  const pad = (4 - (s.length % 4)) % 4;
  const norm = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  return Buffer.from(norm, 'base64');
}

export function signToken(payload: Omit<TokenPayload, 'iat'> & { ttlMs: number; bind?: string }): string {
  const secret = requireSecret();
  const now = Date.now();
  const full: TokenPayload = {
    sub: payload.sub,
    email: payload.email,
    purpose: payload.purpose,
    iat: now,
    exp: now + payload.ttlMs,
    ...(payload.bind ? { bind: payload.bind } : {}),
  };
  const json = JSON.stringify(full);
  const head = b64urlEncode(json);
  const sig = createHmac('sha256', secret).update(head).digest();
  return `${head}.${b64urlEncode(sig)}`;
}

export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: 'malformed' | 'bad-signature' | 'wrong-purpose' | 'expired' };

export function verifyToken(raw: string, expectedPurpose: TokenPurpose): VerifyResult {
  if (!raw || typeof raw !== 'string' || !raw.includes('.')) {
    return { ok: false, reason: 'malformed' };
  }
  const [head, sigB64] = raw.split('.');
  if (!head || !sigB64) return { ok: false, reason: 'malformed' };

  let secret: string;
  try {
    secret = requireSecret();
  } catch {
    return { ok: false, reason: 'bad-signature' };
  }

  const expected = createHmac('sha256', secret).update(head).digest();
  const actual = b64urlDecode(sigB64);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'bad-signature' };
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(b64urlDecode(head).toString('utf8')) as TokenPayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (payload.purpose !== expectedPurpose) return { ok: false, reason: 'wrong-purpose' };
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, payload };
}

/** TTL constants — verify links live a day, password resets one hour. */
export const VERIFY_EMAIL_TTL_MS = 24 * 60 * 60_000;
export const RESET_PASSWORD_TTL_MS = 60 * 60_000;
