/**
 * Tiny browser client for the Ollama HTTP API on
 * http://127.0.0.1:11434 by default. Used by the home page to surface
 * "is this local model installed / loaded / how much RAM" so users
 * running on-device know what's happening without a separate dashboard.
 *
 * Endpoints we touch (no auth — Ollama is loopback by default):
 *   GET  /api/tags   — every model the user has pulled
 *   GET  /api/ps     — models currently loaded into RAM/VRAM
 *
 * Failures are swallowed and reported as `unreachable: true` so the
 * chip never blocks the UI when Ollama isn't running.
 */

export interface OllamaTag {
  name: string;
  size: number;
  modified_at?: string;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
  };
}

export interface OllamaRunning {
  name: string;
  /** Total RAM/VRAM footprint of the loaded model in bytes. */
  size: number;
  /** VRAM-only footprint (0 = CPU-resident). */
  size_vram: number;
  /** When the loaded model will be evicted from RAM. */
  expires_at?: string;
}

export interface OllamaStatus {
  unreachable: boolean;
  installed: OllamaTag[];
  running: OllamaRunning[];
  /** Friendly base URL of the polled instance. */
  endpoint: string;
}

const OLLAMA_BASE =
  (typeof process !== 'undefined' &&
    process.env?.NEXT_PUBLIC_OLLAMA_BASE_URL) ||
  'http://127.0.0.1:11434';

export async function fetchOllamaStatus(signal?: AbortSignal): Promise<OllamaStatus> {
  try {
    const [tagsRes, psRes] = await Promise.all([
      fetch(`${OLLAMA_BASE}/api/tags`, { signal, cache: 'no-store' }),
      fetch(`${OLLAMA_BASE}/api/ps`, { signal, cache: 'no-store' }),
    ]);
    if (!tagsRes.ok || !psRes.ok) {
      return { unreachable: true, installed: [], running: [], endpoint: OLLAMA_BASE };
    }
    const tagsJson = (await tagsRes.json()) as { models?: OllamaTag[] };
    const psJson = (await psRes.json()) as { models?: OllamaRunning[] };
    return {
      unreachable: false,
      installed: tagsJson.models ?? [],
      running: psJson.models ?? [],
      endpoint: OLLAMA_BASE,
    };
  } catch {
    return { unreachable: true, installed: [], running: [], endpoint: OLLAMA_BASE };
  }
}

/**
 * Resolve a motion-forge model id (e.g. `ollama/llava`) into the
 * Ollama-style tag (`llava` or `llava:latest`). Cloud models return
 * undefined.
 */
export function resolveOllamaTag(modelId: string): string | undefined {
  if (!modelId.startsWith('ollama/')) return undefined;
  return modelId.slice('ollama/'.length);
}

/** Match a motion-forge model id against the installed Ollama models. */
export function findInstalled(
  installed: OllamaTag[],
  modelId: string,
): OllamaTag | undefined {
  const tag = resolveOllamaTag(modelId);
  if (!tag) return undefined;
  // Allow either bare name (`llava`) or `llava:latest`.
  return installed.find((m) => m.name === tag || m.name === `${tag}:latest`);
}

/** Match a motion-forge model id against currently-loaded Ollama models. */
export function findRunning(
  running: OllamaRunning[],
  modelId: string,
): OllamaRunning | undefined {
  const tag = resolveOllamaTag(modelId);
  if (!tag) return undefined;
  return running.find((m) => m.name === tag || m.name === `${tag}:latest`);
}

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
