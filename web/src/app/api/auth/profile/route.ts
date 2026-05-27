import { NextRequest, NextResponse } from 'next/server';
import { readBearer } from '@/lib/server/bearer';
import {
  adminGetUser,
  adminUpdateUser,
  KcError,
} from '@/lib/server/keycloak';

/**
 * GET /api/auth/profile  → full Keycloak user record for the bearer JWT
 * PATCH /api/auth/profile → updates firstName / lastName
 *
 * The PATCH body is small by design — email is read-only in the
 * dashboard (re-verifying a changed email is its own flow we haven't
 * built yet), and `enabled` / `emailVerified` aren't user-controllable.
 */

const NAME_MAX = 50;

function safeName(s: unknown): string | undefined {
  if (s === undefined || s === null) return undefined;
  if (typeof s !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const cleaned = s.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return cleaned.slice(0, NAME_MAX);
}

export async function GET(req: NextRequest) {
  const ident = readBearer(req);
  if (!ident) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  try {
    const user = await adminGetUser(ident.sub);
    return NextResponse.json({
      id: user.id,
      email: user.email,
      firstName: user.firstName ?? '',
      lastName: user.lastName ?? '',
      emailVerified: user.emailVerified,
      enabled: user.enabled,
      createdTimestamp: user.createdTimestamp ?? null,
    });
  } catch (e) {
    if (e instanceof KcError) {
      return NextResponse.json({ error: e.message }, { status: e.status === 404 ? 404 : 500 });
    }
    return NextResponse.json({ error: 'unexpected error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const ident = readBearer(req);
  if (!ident) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: { firstName?: unknown; lastName?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const firstName = safeName(body.firstName);
  const lastName = safeName(body.lastName);

  if (firstName === undefined && lastName === undefined) {
    return NextResponse.json({ error: 'no fields to update' }, { status: 400 });
  }

  try {
    await adminUpdateUser(ident.sub, {
      ...(firstName !== undefined ? { firstName } : {}),
      ...(lastName !== undefined ? { lastName } : {}),
    });
    const fresh = await adminGetUser(ident.sub);
    return NextResponse.json({
      id: fresh.id,
      email: fresh.email,
      firstName: fresh.firstName ?? '',
      lastName: fresh.lastName ?? '',
      emailVerified: fresh.emailVerified,
      enabled: fresh.enabled,
      createdTimestamp: fresh.createdTimestamp ?? null,
    });
  } catch (e) {
    if (e instanceof KcError) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'unexpected error' }, { status: 500 });
  }
}
