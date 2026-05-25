#!/usr/bin/env node
/**
 * Mirror `engine/themes/` into `web/public/themes/` so the home-page
 * `CastDrawer` can fetch the character + integration manifests as
 * static JSON at runtime. Idempotent — safe to re-run.
 *
 * Looks for `engine/themes/` two levels up from this script (the
 * monorepo layout: `web/scripts/` → `web/` → repo root). If the
 * source is missing (Vercel sometimes builds with only the `web/`
 * subtree), we leave `public/themes/` untouched so a previously
 * synced copy keeps working.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '..');
const repoRoot = path.resolve(webDir, '..');
const sourceDir = path.join(repoRoot, 'engine', 'themes');
const destDir = path.join(webDir, 'public', 'themes');

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function copyTree(from, to) {
  const entries = await fs.readdir(from, { withFileTypes: true });
  await fs.mkdir(to, { recursive: true });
  for (const entry of entries) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      await copyTree(src, dst);
    } else if (entry.isFile()) {
      await fs.copyFile(src, dst);
    }
  }
}

async function main() {
  if (!(await exists(sourceDir))) {
    console.warn(
      `[sync-themes] source missing at ${sourceDir} — leaving ${destDir} as-is.`,
    );
    return;
  }
  // Clean only the cast-relevant subdirs; we don't want to nuke any
  // unrelated assets a future build might land under public/themes/.
  for (const sub of ['characters', 'integrations']) {
    const target = path.join(destDir, sub);
    await fs.rm(target, { recursive: true, force: true });
  }
  await copyTree(sourceDir, destDir);
  console.log(`[sync-themes] copied ${sourceDir} → ${destDir}`);
}

main().catch((err) => {
  console.error('[sync-themes] failed:', err);
  process.exitCode = 1;
});
