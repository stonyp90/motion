import { NextRequest, NextResponse } from 'next/server';
import { KcError, adminCreateUser, passwordLogin } from '@/lib/server/keycloak';

/**
 * POST /api/auth/register
 *
 * Body:  { email, password, first_name?, last_name? }
 * Reply: { access_token, refresh_token, expires_in, expires_at }
 *
 * Two-step server flow:
 *   1) Admin REST POST /users — creates the Keycloak user.
 *   2) Direct grant immediately as that user — returns tokens to the
 *      caller so the UX is "form submit → logged in" with no extra
 *      round-trip.
 *
 * The realm export currently has `registrationAllowed: false`, so this
 * is the only path through which a user can be created. Email
 * verification is also disabled (`verifyEmail: false`), so the new
 * user can log in immediately.
 */
export async function POST(req: NextRequest) {
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
  const firstName = typeof body.first_name === 'string' ? body.first_name.trim() : undefined;
  const lastName = typeof body.last_name === 'string' ? body.last_name.trim() : undefined;

  if (!email || !password) {
    return NextResponse.json({ error: 'email and password are required' }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid email' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'password must be at least 8 characters' }, { status: 400 });
  }

  try {
    await adminCreateUser({ email, password, firstName, lastName });
    const t = await passwordLogin(email, password);
    return NextResponse.json({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_in: t.expires_in,
      expires_at: Date.now() + t.expires_in * 1000,
    });
  } catch (e) {
    if (e instanceof KcError) {
      const status = e.status === 409 ? 409 : e.status === 401 || e.status === 400 ? 400 : 500;
      return NextResponse.json({ error: e.message }, { status });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
