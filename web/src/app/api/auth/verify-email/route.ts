import { NextRequest, NextResponse } from 'next/server';
import { adminFindUserByEmail, adminSetEmailVerified, KcError } from '@/lib/server/keycloak';
import { sendEmail, welcomeEmailHtml } from '@/lib/server/email';
import { verifyToken } from '@/lib/server/auth-tokens';

/**
 * GET /api/auth/verify-email?token=…
 *
 * Resolves the HMAC token, sets `emailVerified: true` on the Keycloak
 * user, sends the welcome email (now its proper job — register no
 * longer fires it), and redirects to the success page.
 *
 * Idempotent — clicking the link twice lands the user on /success
 * either way, because we treat already-verified as success.
 *
 * Branches:
 *  - bad / expired / wrong-purpose token → /verify-email/expired
 *  - user not found (deleted before clicking) → /verify-email/expired
 *  - happy path → /verify-email/success
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? '';
  const appUrl = process.env.PUBLIC_APP_URL ?? req.nextUrl.origin;

  const result = verifyToken(token, 'verify-email');
  if (!result.ok) {
    return NextResponse.redirect(`${appUrl}/verify-email/expired`, { status: 302 });
  }
  const { sub, email } = result.payload;

  try {
    // Look up by email so we tolerate the (unlikely) case where the
    // user id changed between issue and click. The token's `sub` is
    // authoritative when present, but we always cross-check the email.
    const user = await adminFindUserByEmail(email.toLowerCase());
    if (!user || (sub && user.id !== sub)) {
      return NextResponse.redirect(`${appUrl}/verify-email/expired`, { status: 302 });
    }

    // Idempotent — if already verified, still send to the success page.
    if (!user.emailVerified) {
      await adminSetEmailVerified(user.id);
      // Welcome email is now triggered HERE, not at register time, so
      // that an abandoned signup never receives the welcome.
      void sendEmail({
        to: email,
        subject: 'Welcome to ControlCraft',
        html: welcomeEmailHtml({ firstName: user.firstName }),
      });
    }
    return NextResponse.redirect(`${appUrl}/verify-email/success`, { status: 302 });
  } catch (e) {
    if (e instanceof KcError) {
      console.error('[verify-email] kc error', { status: e.status, message: e.message });
    } else {
      console.error('[verify-email] unexpected', { err: String(e) });
    }
    return NextResponse.redirect(`${appUrl}/verify-email/expired`, { status: 302 });
  }
}
