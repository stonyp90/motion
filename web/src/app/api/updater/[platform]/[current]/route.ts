import { NextResponse } from 'next/server';
import { VERSION } from '@/lib/download-manifest';

/**
 * Tauri auto-updater endpoint.
 *
 * Tauri 2's updater plugin calls this URL on app startup (and on
 * demand from the JS API). The route is parameterized by `platform`
 * (e.g. `darwin-aarch64`, `windows-x86_64`, `linux-x86_64`) and
 * `current` (the version string the running client reports).
 *
 * Response contract:
 *   * **204 No Content** — client is up to date; no update available.
 *   * **200 OK** with a JSON body — newer version available; client
 *     should download + verify + install.
 *
 * The JSON shape Tauri expects:
 *   {
 *     "version": "0.2.0",
 *     "notes": "release notes...",
 *     "pub_date": "2026-05-26T22:00:00Z",
 *     "url": "https://controlcraft.io/api/download/mac-arm",
 *     "signature": "<base64 minisign signature from tauri signer sign>"
 *   }
 *
 * The signature is generated in CI when each binary is built (`tauri
 * build` with `bundle.createUpdaterArtifacts: true` emits `.sig` files
 * next to each artifact). The desktop-release workflow will POST the
 * full manifest to a server-only endpoint that updates this route's
 * source-of-truth (TBD: probably an Azure Blob the route reads from).
 *
 * For now (no published releases yet) this always returns 204.
 */

interface Params {
  params: Promise<{ platform: string; current: string }>;
}

export async function GET(_req: Request, { params }: Params) {
  const { platform, current } = await params;
  // Normalize: tauri's `target-arch` for our 4 supported builds.
  const supported = new Set([
    'darwin-aarch64',
    'darwin-x86_64',
    'windows-x86_64',
    'linux-x86_64',
  ]);
  if (!supported.has(platform)) {
    return new NextResponse(null, { status: 404 });
  }
  // If the client already runs the published version, no-op.
  // Tauri treats 204 as "you're up to date".
  if (current === VERSION) {
    return new NextResponse(null, { status: 204 });
  }
  // Once we ship a signed release, replace this with a real manifest
  // read from Azure Blob / KV / a baked-in JSON. Without `signature`
  // the Tauri updater refuses to install — which is the right
  // failsafe until the CI signing flow is wired.
  return new NextResponse(null, { status: 204 });
}
