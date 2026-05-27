import { NextRequest, NextResponse } from 'next/server';
import { findAsset, VERSION, type DownloadOs } from '@/lib/download-manifest';

/**
 * GET /api/download/:os
 *
 * Three resolution paths, in priority order:
 *
 *   1. `ControlCraft_DOWNLOAD_BASE` set → 302 to `<base>/<asset.filename>`.
 *      The original story (CDN / Azure Blob mirror). Fastest; nothing
 *      flows through our server.
 *
 *   2. `GITHUB_TOKEN` set → proxy-stream the asset bytes from the
 *      private GitHub Release via the API. The browser never sees the
 *      token; only the binary streams through. Bandwidth cost lands on
 *      our web tier, but we don't need a separate CDN to ship.
 *
 *   3. Neither set → 503 `build_pending` with a friendly message.
 *
 * Cache: no-store on the redirect path (URL can rotate); 600 s on the
 * proxy path so a CDN edge can sit in front (the asset bytes are
 * immutable for a given tag, signed by Tauri, so caching is safe). We
 * never cache the 503.
 *
 * Why a separate `DESKTOP_RELEASE_TAG` env var: the manifest's
 * `VERSION` is `'0.1.0'`, but the operative GitHub tag during release
 * candidate cycles is `desktop-v0.1.0-rc5` etc. Operators set the env
 * to point at a draft / rc tag until the real v0.1.0 cuts; then they
 * unset it and the fallback `desktop-v${VERSION}` takes over.
 */

export const runtime = 'nodejs';

const VALID_OS: DownloadOs[] = [
  'mac-arm',
  'mac-intel',
  'windows',
  'linux-deb',
  'linux-appimage',
];

const DEFAULT_OWNER = 'stonyp90';
const DEFAULT_REPO = 'motion';

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

  // Path 1 — CDN mirror.
  const base = process.env.ControlCraft_DOWNLOAD_BASE;
  if (base) {
    const trimmed = base.replace(/\/+$/, '');
    return NextResponse.redirect(`${trimmed}/${asset.filename}`, {
      status: 302,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  // Path 2 — GitHub Releases proxy.
  const ghToken = process.env.GITHUB_TOKEN;
  if (ghToken) {
    return streamFromGitHubRelease({ ghToken, assetName: asset.filename });
  }

  // Path 3 — neither configured.
  return NextResponse.json(
    {
      error: 'build_pending',
      detail:
        'Desktop installer not yet reachable. Set ControlCraft_DOWNLOAD_BASE (CDN) or GITHUB_TOKEN (private-repo proxy) on the deploy environment.',
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

async function streamFromGitHubRelease({
  ghToken,
  assetName,
}: {
  ghToken: string;
  assetName: string;
}): Promise<Response> {
  const owner = process.env.DESKTOP_RELEASE_OWNER ?? DEFAULT_OWNER;
  const repo = process.env.DESKTOP_RELEASE_REPO ?? DEFAULT_REPO;
  const tag = process.env.DESKTOP_RELEASE_TAG ?? `desktop-v${VERSION}`;

  const apiBase = 'https://api.github.com';
  // Use the list endpoint (not /releases/tags/<tag>) because the
  // latter returns 404 on DRAFT releases — and we routinely point at
  // an unpromoted rc tag while smoke-testing the pipeline. The list
  // endpoint includes drafts when the token has write permission.
  const releasesUrl = `${apiBase}/repos/${owner}/${repo}/releases?per_page=30`;
  const releasesRes = await fetch(releasesUrl, {
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    next: { revalidate: 60 },
  });
  if (!releasesRes.ok) {
    return NextResponse.json(
      {
        error: 'releases_list_failed',
        detail: `GET ${releasesUrl} returned ${releasesRes.status}. Verify GITHUB_TOKEN has access to ${owner}/${repo}.`,
        version: VERSION,
        asset: assetName,
      },
      {
        status: 503,
        headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' },
      },
    );
  }
  const releases = (await releasesRes.json()) as Array<{
    tag_name: string;
    draft: boolean;
    assets?: Array<{ id: number; name: string; size: number; url: string }>;
  }>;
  const release = releases.find((r) => r.tag_name === tag);
  if (!release) {
    return NextResponse.json(
      {
        error: 'release_not_found',
        detail: `tag ${tag} not found in latest ${releases.length} releases of ${owner}/${repo}. Available tags: ${releases.map((r) => r.tag_name).join(', ')}`,
        version: VERSION,
        asset: assetName,
      },
      {
        status: 503,
        headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' },
      },
    );
  }
  const match = release.assets?.find((a) => a.name === assetName);
  if (!match) {
    const available = (release.assets ?? []).map((a) => a.name);
    return NextResponse.json(
      {
        error: 'asset_not_in_release',
        detail: `${assetName} not found in ${tag}. Available: ${available.join(', ')}`,
        version: VERSION,
      },
      {
        status: 503,
        headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' },
      },
    );
  }

  // Pull asset bytes via the assets endpoint with octet-stream Accept.
  // GitHub returns the file directly (no further redirect on the API
  // endpoint when using application/octet-stream).
  const assetRes = await fetch(`${apiBase}/repos/${owner}/${repo}/releases/assets/${match.id}`, {
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: 'application/octet-stream',
    },
  });
  if (!assetRes.ok || !assetRes.body) {
    return NextResponse.json(
      {
        error: 'asset_fetch_failed',
        detail: `asset ${match.id} (${assetName}) returned ${assetRes.status}`,
      },
      { status: 502 },
    );
  }

  // Stream through. Asset sizes are 60-156 MB; do not buffer.
  return new Response(assetRes.body, {
    status: 200,
    headers: {
      'Content-Type': contentTypeFor(assetName),
      'Content-Disposition': `attachment; filename="${assetName}"`,
      'Content-Length': String(match.size),
      // Asset bytes are immutable for a given tag (signed by Tauri).
      // Safe to let an edge CDN cache for 10 minutes.
      'Cache-Control': 'public, max-age=600, s-maxage=600',
      'X-Asset-Source': `${owner}/${repo}@${tag}`,
    },
  });
}

function contentTypeFor(name: string): string {
  if (name.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (name.endsWith('.msi')) return 'application/x-msi';
  if (name.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  if (name.endsWith('.deb')) return 'application/vnd.debian.binary-package';
  if (name.endsWith('.AppImage')) return 'application/x-iso9660-appimage';
  if (name.endsWith('.app.tar.gz') || name.endsWith('.tar.gz')) return 'application/gzip';
  if (name.endsWith('.sig')) return 'text/plain';
  return 'application/octet-stream';
}
