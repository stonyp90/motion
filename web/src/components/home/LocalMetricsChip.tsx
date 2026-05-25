'use client';

import { useEffect, useState } from 'react';
import { Activity, AlertCircle, Cloud, Cpu, Loader2 } from 'lucide-react';
import {
  fetchOllamaStatus,
  findInstalled,
  findRunning,
  humanBytes,
  resolveOllamaTag,
  type OllamaStatus,
} from '@/lib/ollama';
import { MetricsDrawer } from './MetricsDrawer';
import type { ModelChoice } from './ModelPicker';

interface Props {
  model: ModelChoice;
  /** Bearer for engine /v1/metrics polling inside the drawer. */
  bearer?: string | null;
}

/**
 * Live status chip for the currently selected model.
 *
 * Local models (`ollama/...`):
 *   - polls Ollama every 5 s for `/api/tags` + `/api/ps`
 *   - GREEN dot + "loaded, RAM 5.0 GB · GPU 4.8 GB" when running
 *   - YELLOW dot + "installed, idle" when present but not loaded
 *   - RED dot + "ollama pull llava" hint when missing
 *   - GRAY  dot + "Ollama unreachable" when daemon is down
 *
 * Cloud models render a static chip (no metrics to poll without an API
 * key on the client; the engine accounts cost separately).
 */
export function LocalMetricsChip({ model, bearer }: Props) {
  const isLocal = model.startsWith('ollama/');
  const tag = resolveOllamaTag(model);
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!isLocal) return;
    const ac = new AbortController();
    let cancelled = false;
    const tick = async () => {
      const s = await fetchOllamaStatus(ac.signal);
      if (!cancelled) setStatus(s);
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      ac.abort();
      clearInterval(id);
    };
  }, [isLocal]);

  // ---- Cloud (no live polling on the client) — still clickable to
  //      surface engine host metrics, which still matter when remote.
  if (!isLocal) {
    return (
      <>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-border-light bg-bg-secondary px-2.5 py-1 font-mono text-2xs text-text-secondary transition hover:border-accent-300 hover:text-text-primary"
          data-testid="local-metrics-chip"
          title="Cloud model — click for engine host metrics"
        >
          <Cloud className="h-3 w-3 text-text-tertiary" />
          <span className="font-medium text-text-primary">cloud</span>
          <Activity className="h-2.5 w-2.5 text-text-tertiary" />
        </button>
        <MetricsDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          bearer={bearer}
        />
      </>
    );
  }

  // ---- Local, but status pending
  if (!status) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-border-light bg-bg-secondary px-2.5 py-1 font-mono text-2xs text-text-tertiary"
        data-testid="local-metrics-chip"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        ollama…
      </span>
    );
  }

  // ---- Ollama unreachable
  if (status.unreachable) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 font-mono text-2xs text-red-700"
        data-testid="local-metrics-chip"
        title={`Tried ${status.endpoint}`}
      >
        <AlertCircle className="h-3 w-3" />
        ollama offline
      </span>
    );
  }

  const installed = findInstalled(status.installed, model);
  const running = findRunning(status.running, model);

  // ---- Model not installed locally
  if (!installed) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full border border-secondary-200 bg-secondary-50 px-2.5 py-1 font-mono text-2xs text-secondary-700"
        data-testid="local-metrics-chip"
        title={`Run: ollama pull ${tag}`}
      >
        <AlertCircle className="h-3 w-3" />
        not installed · pull {tag}
      </span>
    );
  }

  // ---- Loaded into RAM — clickable, expands to MetricsDrawer
  if (running) {
    const onGpu = running.size_vram > 0;
    return (
      <>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-accent-200 bg-accent-50 px-2.5 py-1 font-mono text-2xs text-accent-800 transition hover:bg-accent-100"
          data-testid="local-metrics-chip"
          title={`Loaded ${humanBytes(running.size)} total · ${humanBytes(running.size_vram)} VRAM · evicts ${running.expires_at ? new Date(running.expires_at).toLocaleTimeString() : 'soon'} · click for details`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-accent-600" aria-hidden />
          <Cpu className="h-3 w-3" />
          <span className="font-medium">loaded</span>
          <span className="text-text-tertiary">·</span>
          <span>{humanBytes(running.size)}</span>
          <span className="text-text-tertiary">·</span>
          <span>{onGpu ? 'GPU' : 'CPU'}</span>
        </button>
        <MetricsDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          bearer={bearer}
        />
      </>
    );
  }

  // ---- Installed but idle (cold cache → first inference will be slow)
  return (
    <>
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border-light bg-bg-secondary px-2.5 py-1 font-mono text-2xs text-text-secondary transition hover:border-accent-300 hover:text-text-primary"
        data-testid="local-metrics-chip"
        title={`Installed (${humanBytes(installed.size)}), not loaded — first inference will load weights · click for system metrics`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-secondary-500" aria-hidden />
        <Cpu className="h-3 w-3" />
        <span className="font-medium">idle</span>
        <span className="text-text-tertiary">·</span>
        <span>{humanBytes(installed.size)}</span>
      </button>
      <MetricsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        bearer={bearer}
      />
    </>
  );
}
