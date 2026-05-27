import { NextRequest, NextResponse } from 'next/server';
import {
  KcError,
  adminCreateUser,
  adminFindUserByEmail,
} from '@/lib/server/keycloak';
import { sendEmail, verifyEmailHtml } from '@/lib/server/email';
import { checkRateLimit, clientIp } from '@/lib/server/rate-limit';
import { signToken, VERIFY_EMAIL_TTL_MS } from '@/lib/server/auth-tokens';

/**
 * POST /api/auth/register
 *
 * Body:  { email, password, first_name?, last_name? }
 * Reply: { ok: true, email }   (no tokens — the user must verify first)
 *
 * Server flow:
 *   1) Admin REST POST /users — creates the Keycloak user with
 *      `emailVerified: false`.
 *   2) Sign an HMAC verify-email token and email the click-link via
 *      ACS. Fire-and-forget — a transient ACS hiccup never blocks the
 *      signup (the user can hit /verify-email's "resend" link).
 *   3) Return 200 with the email so the client can navigate to
 *      /verify-email?email=… for the pending screen.
 *
 * No `passwordLogin` here: until the user clicks the link, the realm
 * refuses to issue tokens. This is enforced both at the realm level
 * (`verifyEmail: true`) and at the login route (defense-in-depth).
 *
 * ## Anti-enumeration / abuse mitigations
 *
 * - **Per-IP rate limit** (5 attempts / 15 min, in-memory sliding
 *   window). Cheap defense against a wordlist walker.
 * - **Equalized latency on the 409 branch** so an attacker can't
 *   distinguish duplicate from new via response time. Combined with
 *   the masked error string, this raises the bar for enumeration.
 * - **firstName / lastName sanitization** (length cap + control-char
 *   strip) blocks CRLF/SMTP injection through the email.
 * - **Resend for unverified duplicates**: if an existing account is
 *   unverified, transparently re-issue the verify link instead of
 *   surfacing a 409 — same user-experience as a fresh signup; no
 *   enumeration signal because verified accounts also return success
 *   (the 409 case below).
 */

/** Caps + strips control chars from user-supplied name fields so they
 *  cannot be used for SMTP/CRLF injection through the welcome email. */
function safeName(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const cleaned = s.replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!cleaned) return undefined;
  return cleaned.slice(0, 50);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function POST(req: NextRequest) {
  // Rate limit before doing any work — fail fast under attack.
  const ip = clientIp(req);
  if (!checkRateLimit(ip, { scope: 'register', max: 5, windowMs: 15 * 60_000 })) {
    return NextResponse.json(
      { error: 'too many signup attempts; please try again later' },
      { status: 429, headers: { 'Retry-After': '900' } },
    );
  }

  let body: {
    email?: unknown;
    password?: unknown;
    first_name?: unknown;
    last_name?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const firstName = safeName(body.first_name);
  const lastName = safeName(body.last_name);

  if (!email || !password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }
  if (email.length > 320 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid email' }, { status: 400 });
  }
  if (password.length < 8 || password.length > 256) {
    return NextResponse.json({ error: 'password must be 8–256 characters' }, { status: 400 });
  }

  try {
    const userId = await adminCreateUser({ email, password, firstName, lastName });
    const appUrl = process.env.PUBLIC_APP_URL ?? req.nextUrl.origin;
    const token = signToken({
      sub: userId,
      email,
      purpose: 'verify-email',
      ttlMs: VERIFY_EMAIL_TTL_MS,
      exp: 0,
    });
    const link = `${appUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
    void sendEmail({
      to: email,
      subject: 'Confirm your ControlCraft account',
      html: verifyEmailHtml({ firstName, link }),
    });
    return NextResponse.json({ ok: true, email });
  } catch (e) {
    if (e instanceof KcError) {
      if (e.status === 409) {
        // Equalize duplicate-email response timing with the happy path
        // (one Keycloak admin POST ≈ 100ms locally; production typically
        // 50-150ms).
        await sleep(150);
        // If the existing account is unverified we transparently re-issue
        // a verify-email link — same outcome as a fresh signup, no leak.
        // For verified accounts we still return 200 with a stripped
        // payload so an attacker can't distinguish via shape; the form
        // navigates to /verify-email either way, which itself surfaces
        // an "already verified, sign in" path.
        try {
          const existing = await adminFindUserByEmail(email);
          if (existing && !existing.emailVerified) {
            const appUrl = process.env.PUBLIC_APP_URL ?? req.nextUrl.origin;
            const token = signToken({
              sub: existing.id,
              email,
              purpose: 'verify-email',
              ttlMs: VERIFY_EMAIL_TTL_MS,
              exp: 0,
            });
            const link = `${appUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
            void sendEmail({
              to: email,
              subject: 'Confirm your ControlCraft account',
              html: verifyEmailHtml({ firstName: existing.firstName, link }),
            });
          }
        } catch (lookupErr) {
          console.error('[register] resend lookup failed', { err: String(lookupErr) });
        }
        return NextResponse.json({ ok: true, email });
      }
      const status = e.status === 401 || e.status === 400 ? 400 : 500;
      return NextResponse.json({ error: e.message }, { status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
