import { NextRequest, NextResponse } from 'next/server';
import {
  adminFindUserByEmail,
  KcError,
  passwordLogin,
} from '@/lib/server/keycloak';

/**
 * POST /api/auth/login
 *
 * Body:  { email, password }
 * Reply: { access_token, refresh_token, expires_in, expires_at }
 *
 * The browser never sees Keycloak's client_secret — this route is the
 * single hop where it's attached. `expires_at` is a millisecond epoch
 * derived from `expires_in` so the client can run a refresh timer
 * without doing the arithmetic.
 *
 * When the realm enforces `verifyEmail: true` and the user hasn't yet
 * clicked their verification link, Keycloak refuses the password grant
 * with `invalid_grant + account is not fully set up`. We catch that
 * exact 400 / `invalid_grant` combo, look the user up via admin REST
 * to confirm `emailVerified === false`, and return a structured 403
 * `{error:'email_not_verified', email}` so the form can redirect to
 * /verify-email instead of showing a generic "wrong password" error.
 */
export async function POST(req: NextRequest) {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }

  try {
    const t = await passwordLogin(email, password);
    return NextResponse.json({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_in: t.expires_in,
      expires_at: Date.now() + t.expires_in * 1000,
    });
  } catch (e) {
    if (e instanceof KcError) {
      // Possible verify-email branch: Keycloak rejects unverified accounts
      // with `invalid_grant` + a description that includes "not fully set
      // up" or "verify email". Cross-check via admin REST so we never
      // misclassify a wrong-password attempt as a verify-email problem.
      const lower = e.message.toLowerCase();
      const couldBeUnverified =
        lower.includes('not fully set up') ||
        lower.includes('verify email') ||
        lower.includes('email is not verified');
      if (couldBeUnverified) {
        try {
          const user = await adminFindUserByEmail(email.toLowerCase());
          if (user && !user.emailVerified) {
            return NextResponse.json(
              { error: 'email_not_verified', email },
              { status: 403 },
            );
          }
        } catch {
          // fall through to the generic 401
        }
      }
      // 401 covers "invalid_grant" (wrong creds) + most realm errors.
      const status = e.status === 401 || e.status === 400 ? 401 : 500;
      return NextResponse.json({ error: e.message }, { status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
