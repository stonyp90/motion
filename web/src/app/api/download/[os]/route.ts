import { NextRequest, NextResponse } from 'next/server';
import { findAsset, VERSION, type DownloadOs } from '@/lib/download-manifest';
import { requireBearer } from '@/lib/server/auth';

/**
 * GET /api/download/:os → 302 to the actual installer, or JSON with
 * the resolved URL when `Accept: application/json` is sent.
 *
 * Why a server route and not a direct link from the page:
 *   - The download origin is a server-only env var (`ControlCraft_DOWNLOAD_BASE`),
 *     so the URL is never exposed in the page HTML. Rotating the
 *     origin doesn't require a redeploy of the marketing site.
 *   - We can log + rate-limit the download event in one place if we
 *     ever want install funnel metrics.
 *   - When the env isn't set (fresh clone, local dev), we return a
 *     503 with a friendly message instead of a 404.
 *
 * Auth (defense-in-depth, paired with the UI-level AuthGate on /download):
 *   - Every caller must present `Authorization: Bearer <jwt>` issued by
 *     the Keycloak realm in `KEYCLOAK_ISSUER`. The token's `aud` must
 *     match `motion-forge-web` and pass standard `exp / nbf /
 *     signature` checks (see web/src/lib/server/jwks.ts).
 *   - Failures return 401 + `WWW-Authenticate: Bearer realm="controlcraft"`
 *     and no body that could leak the cause (expired vs. forged vs.
 *     wrong realm). The browser client treats 401 as "session expired"
 *     and bounces to `/login?next=/download`; curl users just get the
 *     401.
 *
 * Content negotiation:
 *   - Default response is a 302 → upstream installer URL. Good for
 *     `curl -L` and old browsers that follow a server-rendered link.
 *   - `Accept: application/json` returns `{ url: <upstream> }` instead
 *     of the redirect. The browser client uses this mode because
 *     `fetch(..., { redirect: 'manual' })` produces an `opaqueredirect`
 *     whose `Location` header is unreadable from JS, so we can't
 *     follow a 302 manually without leaking the bearer to the upstream
 *     origin. Reading the URL out of a JSON body lets the client do a
 *     plain `window.location.href = url` instead.
 *
 * Cache: no-store. We never want a CDN to cache a redirect for a
 * download because the upstream URL can rotate (CDN edge migrations,
 * signed URL rolls, asset re-uploads after a CVE).
 */

const VALID_OS: DownloadOs[] = [
  'mac-arm',
  'mac-intel',
  'windows',
  'linux-deb',
  'linux-appimage',
];

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ os: string }> },
) {
  // Bearer check runs before any OS / manifest lookups so an
  // unauthenticated probe can't enumerate which platforms have assets
  // staged. Same 401 regardless of the path the attacker tries.
  const gate = await requireBearer(req);
  if (!gate.ok) return gate.response;

  const { os: rawOs } = await ctx.params;
  if (!VALID_OS.includes(rawOs as DownloadOs)) {
    return NextResponse.json(
      { error: 'unknown platform', valid: VALID_OS },
      { status: 404 },
    );
  }
  const asset = findAsset(rawOs as DownloadOs);
  if (!asset) {
    return NextResponse.json({ error: 'asset not in manifest' }, { status: 404 });
  }
  const base = process.env.ControlCraft_DOWNLOAD_BASE;
  if (!base) {
    return NextResponse.json(
      {
        error: 'build_pending',
        detail:
          'Desktop installer not yet uploaded. Set ControlCraft_DOWNLOAD_BASE on the deploy environment once the release CI finishes producing assets.',
        version: VERSION,
        asset: asset.filename,
      },
      {
        status: 503,
        headers: {
          'Retry-After': '600',
          'Cache-Control': 'no-store',
        },
      },
    );
  }
  // Strip trailing slash; append the per-OS filename.
  const trimmed = base.replace(/\/+$/, '');
  const upstream = `${trimmed}/${asset.filename}`;

  // Content negotiation: JS clients (the browser hero) ask for JSON so
  // they can navigate the window themselves. Everyone else gets the
  // classic 302.
  const accept = req.headers.get('accept') ?? '';
  if (accept.includes('application/json')) {
    return NextResponse.json(
      { url: upstream, filename: asset.filename, version: VERSION },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.redirect(upstream, {
    status: 302,
    headers: { 'Cache-Control': 'no-store' },
  });
}
