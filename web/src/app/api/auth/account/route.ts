import { NextRequest, NextResponse } from 'next/server';
import { readBearer } from '@/lib/server/bearer';
import {
  adminDisableUser,
  KcError,
  passwordLogin,
} from '@/lib/server/keycloak';

/**
 * DELETE /api/auth/account
 * Body: { password }
 *
 * v1 of account deletion: we DISABLE the Keycloak user (recoverable by
 * an operator) rather than hard-deleting. Once we have a retention
 * policy, a periodic job can switch disabled accounts older than
 * N days to `adminDeleteUser`.
 *
 * Re-verifies the password before disabling so a stolen JWT can't be
 * used to take down an account.
 */
export async function DELETE(req: NextRequest) {
  const ident = readBearer(req);
  if (!ident) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const password = typeof body.password === 'string' ? body.password : '';
  if (!password) {
    return NextResponse.json({ error: 'password is required to confirm' }, { status: 400 });
  }

  try {
    await passwordLogin(ident.email, password);
    await adminDisableUser(ident.sub);
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    if (e instanceof KcError) {
      if (e.status === 401 || e.message.toLowerCase().includes('invalid')) {
        return NextResponse.json({ error: 'password is wrong' }, { status: 401 });
      }
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'unexpected error' }, { status: 500 });
  }
}
