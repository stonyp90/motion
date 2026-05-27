import { NextRequest, NextResponse } from 'next/server';
import { readBearer } from '@/lib/server/bearer';
import {
  adminResetPassword,
  KcError,
  passwordLogin,
} from '@/lib/server/keycloak';
import { checkRateLimit, clientIp } from '@/lib/server/rate-limit';

/**
 * POST /api/auth/password
 * Body: { currentPassword, newPassword }
 *
 * Two-step: re-verify the current password via `passwordLogin()` (which
 * exercises Keycloak's brute-force throttle), then admin-REST the new
 * password. Bearer JWT proves the user is signed in; the password
 * re-prompt proves they're the same person sitting at the keyboard.
 */
export async function POST(req: NextRequest) {
  const ident = readBearer(req);
  if (!ident) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const ip = clientIp(req);
  if (!checkRateLimit(ip, { scope: 'change-password', max: 5, windowMs: 15 * 60_000 })) {
    return NextResponse.json(
      { error: 'too many attempts; please wait a few minutes' },
      { status: 429, headers: { 'Retry-After': '300' } },
    );
  }

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: 'both passwords are required' }, { status: 400 });
  }
  if (newPassword.length < 8 || newPassword.length > 256) {
    return NextResponse.json({ error: 'password must be 8–256 characters' }, { status: 400 });
  }
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: 'new password must be different' }, { status: 400 });
  }

  try {
    // Step 1: prove possession of the current password.
    await passwordLogin(ident.email, currentPassword);
    // Step 2: rotate.
    await adminResetPassword(ident.sub, newPassword);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof KcError) {
      if (e.status === 401 || (e.message.toLowerCase().includes('invalid'))) {
        return NextResponse.json({ error: 'current password is wrong' }, { status: 401 });
      }
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'unexpected error' }, { status: 500 });
  }
}
