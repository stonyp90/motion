#!/usr/bin/env node
/**
 * Capture a real /v1/brief/generate run from the engine and freeze it
 * to disk so the anonymous home demo plays back genuine pipeline
 * output without burning compute per pageview.
 *
 * What the script writes (atomic — temp file + rename):
 *
 *   web/public/sample-run/animation.json   — the Lottie the engine emitted
 *   web/public/sample-run/run.json         — metadata + measured timings
 *
 * The demo's `useSampleRunMachine` consumes `run.json` and derives its
 * stage timeline from the recorded `total_ms`. When the cache is
 * absent the demo falls back to the existing `/lottie/*.json` presets.
 *
 * Required env:
 *   ENGINE_BASE_URL          e.g. http://127.0.0.1:6321
 *   ENGINE_AUTH_TOKEN        bearer accepted by the engine
 *                            (typically MOTION_FORGE_AUTH_FALLBACK_KEY
 *                             for local capture)
 *
 * Optional env:
 *   SAMPLE_PROMPT            override the canned brief
 *   SAMPLE_DURATION_SECONDS  override the duration (default 30)
 *   SAMPLE_SCENE_COUNT       override the scene count (default 6)
 *
 * Idempotent: re-running overwrites the cache. Safe to wire into CI
 * or a daily cron once the engine is reachable from the build env.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '..');
const outDir = path.join(webDir, 'public', 'sample-run');
const outRun = path.join(outDir, 'run.json');
const outAnim = path.join(outDir, 'animation.json');

const DEFAULT_PROMPT =
  'Animate our Q3 earnings: $2.4M revenue, 18% growth, three customer logos.';
const DEFAULT_DURATION = 30;
const DEFAULT_SCENE_COUNT = 6;

// Static cast for the demo. The engine's BriefGenerateResponse doesn't
// surface cast metadata today, so we ship a sensible canned roster
// that matches the brief above. When the engine starts returning cast,
// move this into the response and drop the hardcode.
const DEFAULT_CAST = [
  { id: 'alex', name: 'Alex · Founder', accent_hex: '#10b981' },
];

// Proportional split of total_ms across the four UI stages. Tuned to
// reflect the actual pipeline shape (brief parse is fast, scene
// composition is the long pole, render is fast). Same total_ms ends
// up in the stage rows — only the split is heuristic.
const STAGE_RATIOS = [
  { id: 'brief', label: 'Reading the brief', ratio: 0.12 },
  { id: 'cast', label: 'Casting characters', ratio: 0.08 },
  { id: 'compose', label: 'Composing scenes', ratio: 0.65 },
  { id: 'render', label: 'Polishing motion', ratio: 0.15 },
];

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(
      `[capture-sample-run] missing env ${name}. ` +
        'Set ENGINE_BASE_URL + ENGINE_AUTH_TOKEN and retry.',
    );
    process.exit(2);
  }
  return v;
}

/**
 * Resolve the Lottie file the engine wrote. The path the engine
 * returns is absolute on its filesystem. When we're running on the
 * same host we can `fs.readFile` directly; when the engine is remote
 * we fall back to the web's `/api/engine/file` pass-through proxy.
 */
async function readEngineFile({ engineBase, token, outputLottiePath }) {
  // Try local FS first.
  try {
    const buf = await fs.readFile(outputLottiePath, 'utf8');
    return { json: JSON.parse(buf), source: 'local-fs' };
  } catch {
    /* fall through */
  }

  // Otherwise hit the engine's static-serve via the web proxy. The
  // engine itself doesn't expose a generic file endpoint, so this
  // requires the web app to be running on the same host that captured
  // the file — which is typically true since the script runs against
  // a dev engine + a dev web simultaneously.
  const webOrigin = process.env.WEB_ORIGIN ?? 'http://127.0.0.1:3001';
  const url = `${webOrigin}/api/engine/file?path=${encodeURIComponent(outputLottiePath)}`;
  const r = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!r.ok) {
    throw new Error(
      `could not read output_lottie via web proxy (${url}): HTTP ${r.status}`,
    );
  }
  return { json: await r.json(), source: 'web-proxy' };
}

async function writeJsonAtomic(filePath, data) {
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, filePath);
}

async function main() {
  const engineBase = requireEnv('ENGINE_BASE_URL').replace(/\/+$/, '');
  const token = requireEnv('ENGINE_AUTH_TOKEN');

  const prompt = process.env.SAMPLE_PROMPT ?? DEFAULT_PROMPT;
  const duration = Number(
    process.env.SAMPLE_DURATION_SECONDS ?? DEFAULT_DURATION,
  );
  const sceneCount = Number(
    process.env.SAMPLE_SCENE_COUNT ?? DEFAULT_SCENE_COUNT,
  );

  await fs.mkdir(outDir, { recursive: true });

  console.log(
    `[capture-sample-run] POST ${engineBase}/v1/brief/generate ` +
      `(duration=${duration}s, scenes=${sceneCount})`,
  );

  const t0 = Date.now();
  const resp = await fetch(`${engineBase}/v1/brief/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      brief: prompt,
      duration,
      scene_count: sceneCount,
    }),
  });
  const totalMs = Date.now() - t0;

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(
      `engine returned HTTP ${resp.status}${body ? ` — ${body.slice(0, 400)}` : ''}`,
    );
  }

  const result = await resp.json();
  console.log(
    `[capture-sample-run] engine done in ${totalMs}ms — ` +
      `${result.shots} shots, ${result.assets_generated} assets ` +
      `(${result.asset_provider}), $${(result.asset_cost_micros / 1e6).toFixed(4)}`,
  );

  // Read the Lottie the engine wrote.
  const { json: animation, source } = await readEngineFile({
    engineBase,
    token,
    outputLottiePath: result.output_lottie,
  });
  console.log(`[capture-sample-run] read Lottie via ${source}`);

  // Build the stages array from the measured total_ms.
  const stages = STAGE_RATIOS.map((s) => ({
    id: s.id,
    label: s.label,
    ms: Math.round(totalMs * s.ratio),
  }));

  const runMeta = {
    version: 1,
    generated_at: new Date().toISOString(),
    request: {
      prompt,
      duration_seconds: duration,
      scene_count: sceneCount,
      aspect: '16:9',
    },
    response: {
      shots: result.shots,
      duration_seconds: result.duration_seconds,
      assets_generated: result.assets_generated,
      assets_failed: result.assets_failed,
      asset_cost_micros: result.asset_cost_micros,
      asset_provider: result.asset_provider,
    },
    stages,
    total_ms: totalMs,
    cast: DEFAULT_CAST,
    animation_path: '/sample-run/animation.json',
  };

  await writeJsonAtomic(outAnim, animation);
  await writeJsonAtomic(outRun, runMeta);

  console.log(
    `[capture-sample-run] wrote ${path.relative(webDir, outAnim)} + ` +
      `${path.relative(webDir, outRun)} (total ${totalMs}ms)`,
  );
}

main().catch((err) => {
  console.error('[capture-sample-run] failed:', err);
  process.exitCode = 1;
});
