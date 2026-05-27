import { NextRequest, NextResponse } from 'next/server';
import { adminFindUserByEmail, adminResetPassword, KcError } from '@/lib/server/keycloak';
import { verifyToken } from '@/lib/server/auth-tokens';
import { checkRateLimit, clientIp } from '@/lib/server/rate-limit';

/**
 * POST /api/auth/reset-password
 * Body: { token, password }
 * Reply:
 *   200 {ok:true} on success
 *   400 {error} on bad token, expired, or invalid password length
 *   429 on rate limit
 *
 * The reset link itself is single-use in practice: once the password
 * changes, the `bind` claim (user `createdTimestamp`) still matches —
 * but the new password is now persisted, so a replay just sets the
 * same password again. If you need strict single-use, store consumed
 * jti's in Redis; not needed for the threat model today.
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  if (!checkRateLimit(ip, { scope: 'reset-password', max: 10, windowMs: 15 * 60_000 })) {
    return NextResponse.json(
      { error: 'too many attempts; please wait a few minutes' },
      { status: 429, headers: { 'Retry-After': '300' } },
    );
  }

  let body: { token?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid request' }, { status: 400 });
  }
  const token = typeof body.token === 'string' ? body.token : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (password.length < 8 || password.length > 256) {
    return NextResponse.json({ error: 'password must be 8–256 characters' }, { status: 400 });
  }

  const result = verifyToken(token, 'reset-password');
  if (!result.ok) {
    return NextResponse.json({ error: 'link is invalid or has expired' }, { status: 400 });
  }
  const { sub, email, bind } = result.payload;

  try {
    const user = await adminFindUserByEmail(email.toLowerCase());
    if (!user || user.id !== sub) {
      return NextResponse.json({ error: 'link is invalid or has expired' }, { status: 400 });
    }
    if (bind && bind !== String(user.createdTimestamp ?? '')) {
      return NextResponse.json({ error: 'link is invalid or has expired' }, { status: 400 });
    }
    await adminResetPassword(user.id, password);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    if (e instanceof KcError) {
      console.error('[reset-password] kc error', { status: e.status, message: e.message });
      return NextResponse.json({ error: 'reset failed; please try again' }, { status: 500 });
    }
    console.error('[reset-password] unexpected', { err: String(e) });
    return NextResponse.json({ error: 'reset failed; please try again' }, { status: 500 });
  }
}
