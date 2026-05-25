import { NextRequest, NextResponse } from 'next/server';
import { KcError, refreshTokens } from '@/lib/server/keycloak';

/**
 * POST /api/auth/refresh
 *
 * Body:  { refresh_token }
 * Reply: { access_token, refresh_token, expires_in, expires_at }
 *
 * Keycloak rotates refresh tokens on every refresh — the response's
 * `refresh_token` is a NEW one and the previous becomes invalid. The
 * client must store the new pair atomically.
 */
export async function POST(req: NextRequest) {
  let body: { refresh_token?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const refreshToken = typeof body.refresh_token === 'string' ? body.refresh_token : '';
  if (!refreshToken) {
    return NextResponse.json({ error: 'refresh_token is required' }, { status: 400 });
  }
  try {
    const t = await refreshTokens(refreshToken);
    return NextResponse.json({
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_in: t.expires_in,
      expires_at: Date.now() + t.expires_in * 1000,
    });
  } catch (e) {
    if (e instanceof KcError) {
      // 400/401 here means the refresh_token is expired or revoked.
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
