import { NextRequest, NextResponse } from 'next/server';
import { findAsset, VERSION, type DownloadOs } from '@/lib/download-manifest';

/**
 * GET /api/download/:os → 302 to the actual installer.
 *
 * Why a server route and not a direct link from the page:
 *   - The download origin is a server-only env var (`IMTN_DOWNLOAD_BASE`),
 *     so the URL is never exposed in the page HTML. Rotating the
 *     origin doesn't require a redeploy of the marketing site.
 *   - We can log + rate-limit the download event in one place if we
 *     ever want install funnel metrics.
 *   - When the env isn't set (fresh clone, local dev), we return a
 *     503 with a friendly message instead of a 404.
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
  _req: NextRequest,
  ctx: { params: Promise<{ os: string }> },
) {
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
  const base = process.env.IMTN_DOWNLOAD_BASE;
  if (!base) {
    return NextResponse.json(
      {
        error: 'build_pending',
        detail:
          'Desktop installer not yet uploaded. Set IMTN_DOWNLOAD_BASE on the deploy environment once the release CI finishes producing assets.',
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
  return NextResponse.redirect(`${trimmed}/${asset.filename}`, {
    status: 302,
    headers: { 'Cache-Control': 'no-store' },
  });
}
