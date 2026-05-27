import { NextRequest, NextResponse } from 'next/server';
import { adminFindUserByEmail, KcError } from '@/lib/server/keycloak';
import { sendEmail, verifyEmailHtml } from '@/lib/server/email';
import {
  signToken,
  VERIFY_EMAIL_TTL_MS,
} from '@/lib/server/auth-tokens';
import { checkRateLimit, clientIp } from '@/lib/server/rate-limit';

/**
 * POST /api/auth/resend-verification
 * Body: { email }
 * Reply: 200 always (no enumeration). Internally:
 *   - account doesn't exist → no-op
 *   - account already verified → no-op
 *   - account exists + not verified → fresh signed token + email
 *
 * Rate-limited per IP at 5/15min. Resending more often than that is
 * almost certainly accidental.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!checkRateLimit(ip, { scope: 'resend-verification', max: 5, windowMs: 15 * 60_000 })) {
    return NextResponse.json(
      { error: 'too many requests; please wait a few minutes' },
      { status: 429, headers: { 'Retry-After': '300' } },
    );
  }

  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: true }, { status: 200 });
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    // Same 200 for invalid emails — don't leak which addresses pass syntax checks.
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  try {
    const user = await adminFindUserByEmail(email);
    if (user && !user.emailVerified) {
      const appUrl = process.env.PUBLIC_APP_URL ?? req.nextUrl.origin;
      const token = signToken({
        sub: user.id,
        email,
        purpose: 'verify-email',
        ttlMs: VERIFY_EMAIL_TTL_MS,
        exp: 0,
      });
      const link = `${appUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
      void sendEmail({
        to: email,
        subject: 'Confirm your ControlCraft account',
        html: verifyEmailHtml({ firstName: user.firstName, link }),
      });
    }
  } catch (e) {
    // Always 200, even on Keycloak errors — log internally so an
    // operator can see resend failures, but don't surface to the caller.
    if (e instanceof KcError) {
      console.error('[resend-verification] kc error', { status: e.status, message: e.message });
    } else {
      console.error('[resend-verification] unexpected', { err: String(e) });
    }
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
