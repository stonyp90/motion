import { NextRequest, NextResponse } from 'next/server';
import { KcError, passwordLogin } from '@/lib/server/keycloak';

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
