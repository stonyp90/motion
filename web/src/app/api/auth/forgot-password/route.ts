import { NextRequest, NextResponse } from 'next/server';
import { adminFindUserByEmail, KcError } from '@/lib/server/keycloak';
import { sendEmail, resetPasswordEmailHtml } from '@/lib/server/email';
import {
  signToken,
  RESET_PASSWORD_TTL_MS,
} from '@/lib/server/auth-tokens';
import { checkRateLimit, clientIp } from '@/lib/server/rate-limit';

/**
 * POST /api/auth/forgot-password
 * Body: { email }
 * Reply: 200 always (no enumeration). Emits a reset email when the
 * address is on file.
 *
 * Token TTL is one hour. The token binds to the user's
 * `createdTimestamp` so that re-issuing one invalidates the old; in
 * practice users only request one reset, but the binding is cheap
 * insurance.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!checkRateLimit(ip, { scope: 'forgot-password', max: 5, windowMs: 15 * 60_000 })) {
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
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  try {
    const user = await adminFindUserByEmail(email);
    if (user && user.enabled) {
      const appUrl = process.env.PUBLIC_APP_URL ?? req.nextUrl.origin;
      const token = signToken({
        sub: user.id,
        email,
        purpose: 'reset-password',
        ttlMs: RESET_PASSWORD_TTL_MS,
        exp: 0,
        bind: String(user.createdTimestamp ?? ''),
      });
      const link = `${appUrl}/reset-password?token=${encodeURIComponent(token)}`;
      void sendEmail({
        to: email,
        subject: 'Reset your ControlCraft password',
        html: resetPasswordEmailHtml({ firstName: user.firstName, link }),
      });
    }
  } catch (e) {
    if (e instanceof KcError) {
      console.error('[forgot-password] kc error', { status: e.status, message: e.message });
    } else {
      console.error('[forgot-password] unexpected', { err: String(e) });
    }
  }
  return NextResponse.json({ ok: true }, { status: 200 });
}
