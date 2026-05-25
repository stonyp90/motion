import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Read a file out of the engine's local work-dir and return its body
 * to the browser.
 *
 * Background — the engine's `/v1/generate` and `/v1/iterate` endpoints
 * return *paths* to files on the engine's filesystem
 * (`out.lottie.json`, `iterate.lottie.json`). When the engine and the
 * Next.js dev server share a host (the local-dev scenario), this
 * route exposes those files to the browser without giving the engine
 * a static-file route of its own.
 *
 * In production this route MUST be replaced by an engine-owned
 * authenticated download endpoint (or a presigned URL from object
 * storage) — see TODO at the bottom.
 *
 * Hardening:
 *  - We only serve paths that resolve under one of the allow-list
 *    prefixes below (env-configurable). `..` is rejected up-front.
 *  - Other origins are blocked by the same-origin browser policy
 *    (this route doesn't set CORS headers).
 *  - No auth check here — the dev assumption is that the engine
 *    work-dirs are scoped per upload session id (random suffix), so
 *    guessing a path is impractical. Tighten before prod.
 */

const DEFAULT_ALLOWED_ROOTS = ['/tmp/motion-forge-uploads', '/tmp/mf-'];

function allowedRoots(): string[] {
  const fromEnv = process.env.ENGINE_FILE_ALLOW_PREFIX;
  if (!fromEnv) return DEFAULT_ALLOWED_ROOTS;
  return fromEnv.split(',').map((s) => s.trim()).filter(Boolean);
}

function isAllowed(absPath: string): boolean {
  return allowedRoots().some((root) => absPath === root || absPath.startsWith(root));
}

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('path');
  if (!raw) {
    return NextResponse.json({ error: 'missing ?path' }, { status: 400 });
  }
  if (raw.includes('\0')) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 });
  }

  // Normalise + reject traversal. `path.resolve` collapses `..` so
  // any attempt to escape the allow-list still produces a final
  // absolute path we re-validate against the prefix list.
  const abs = path.resolve(raw);
  if (!isAllowed(abs)) {
    return NextResponse.json(
      { error: 'path outside allowed roots' },
      { status: 403 },
    );
  }

  try {
    const body = await fs.readFile(abs);
    const mime = mimeFromExt(abs);
    return new NextResponse(new Uint8Array(body), {
      status: 200,
      headers: {
        'content-type': mime,
        'cache-control': 'no-store',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('ENOENT')) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function mimeFromExt(p: string): string {
  const ext = path.extname(p).toLowerCase();
  switch (ext) {
    case '.json':
      return 'application/json; charset=utf-8';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

// TODO: replace with an engine-owned authenticated download route
// once the deployment story is finalised. Tracking in the engine repo
// alongside the existing `/v1/uploads` handler.
