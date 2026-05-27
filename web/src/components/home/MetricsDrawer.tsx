'use client';

import { useEffect, useState } from 'react';
import { Activity, Cpu, HardDrive, X, Layers } from 'lucide-react';
import {
  fetchEngineMetrics,
  humanBytes,
  humanDuration,
  severityColors,
  severityFor,
  type EngineMetrics,
  type Severity,
} from '@/lib/metrics';
import {
  fetchOllamaStatus,
  type OllamaRunning,
  type OllamaStatus,
} from '@/lib/ollama';

interface Props {
  open: boolean;
  onClose: () => void;
  bearer?: string | null;
}

const POLL_MS = 3000;

/**
 * Side-panel that surfaces real host + engine + local-LLM telemetry.
 * Modelled on the internal design system's MetricsPanel:
 *   - Each metric is a labelled progress bar coloured by the
 *     50%/80% green/amber/red convention (thresholds come from the
 *     engine so we can tune in one place).
 *   - Per-Ollama-loaded-model row shows total RAM + VRAM split.
 *   - "Why is this slow?" answer fits in one glance.
 *
 * Polls every 3s while open, cleans up on close — no work while the
 * drawer is hidden.
 */
export function MetricsDrawer({ open, onClose, bearer }: Props) {
  const [metrics, setMetrics] = useState<EngineMetrics | null>(null);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);

  useEffect(() => {
    if (!open) return;
    const ac = new AbortController();
    let cancelled = false;
    const tick = async () => {
      const [m, o] = await Promise.all([
        fetchEngineMetrics(bearer, ac.signal),
        fetchOllamaStatus(ac.signal),
      ]);
      if (cancelled) return;
      setMetrics(m);
      setOllama(o);
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      ac.abort();
      clearInterval(id);
    };
  }, [open, bearer]);

  if (!open) return null;

  return (
    <>
      {/* click-outside scrim */}
      <button
        type="button"
        aria-label="Close metrics"
        className="fixed inset-0 z-30 cursor-default bg-black/20 backdrop-blur-sm"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-label="System metrics"
        className="fixed right-4 top-20 z-40 w-[min(92vw,360px)] overflow-hidden rounded-2xl border border-border-light bg-bg-primary shadow-lift"
        data-testid="metrics-drawer"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-light bg-bg-secondary px-4 py-2.5">
          <div className="flex items-center gap-2 font-mono text-2xs uppercase tracking-wider text-text-secondary">
            <Activity className="h-3 w-3 text-accent-600" />
            live · 3s poll
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-6 w-6 place-items-center rounded-full text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-4">
          {/* Host CPU */}
          {metrics ? (
            <Bar
              icon={<Cpu className="h-3.5 w-3.5" />}
              label={metrics.cpu.brand ?? `${metrics.cpu.cores}-core CPU`}
              value={metrics.cpu.usage_percent}
              denom={100}
              text={`${metrics.cpu.usage_percent.toFixed(0)}% · ${metrics.cpu.cores} cores`}
              severity={severityFor(
                metrics.cpu.usage_percent,
                metrics.thresholds,
              )}
            />
          ) : (
            <Skeleton label="CPU" />
          )}

          {/* Host memory */}
          {metrics ? (
            <Bar
              icon={<HardDrive className="h-3.5 w-3.5" />}
              label="Memory"
              value={metrics.memory.usage_percent}
              denom={100}
              text={`${humanBytes(metrics.memory.used_bytes)} / ${humanBytes(metrics.memory.total_bytes)}`}
              severity={severityFor(
                metrics.memory.usage_percent,
                metrics.thresholds,
              )}
            />
          ) : (
            <Skeleton label="Memory" />
          )}

          {/* Swap (only when actually being used) */}
          {metrics && metrics.memory.swap_used_bytes > 0 && (
            <Bar
              icon={<HardDrive className="h-3.5 w-3.5 opacity-60" />}
              label="Swap"
              value={
                (metrics.memory.swap_used_bytes /
                  Math.max(1, metrics.memory.swap_total_bytes)) *
                100
              }
              denom={100}
              text={`${humanBytes(metrics.memory.swap_used_bytes)} / ${humanBytes(metrics.memory.swap_total_bytes)}`}
              severity={
                metrics.memory.swap_used_bytes / metrics.memory.swap_total_bytes >
                0.5
                  ? 'warning'
                  : 'healthy'
              }
            />
          )}

          {/* Engine process RSS */}
          {metrics && (
            <p className="font-mono text-2xs text-text-tertiary">
              engine: rss {humanBytes(metrics.process.rss_bytes)} ·{' '}
              {metrics.process.threads} thread
              {metrics.process.threads === 1 ? '' : 's'} · uptime{' '}
              {humanDuration(metrics.uptime_seconds)}
            </p>
          )}

          {/* Local models loaded */}
          <div className="border-t border-border-light pt-3">
            <p className="mb-2 flex items-center gap-1.5 font-mono text-2xs uppercase tracking-wider text-text-tertiary">
              <Layers className="h-3 w-3" />
              local models loaded
            </p>
            {ollama?.running && ollama.running.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {ollama.running.map((m) => (
                  <ModelRow key={m.name} model={m} />
                ))}
              </ul>
            ) : (
              <p className="text-2xs text-text-tertiary">
                {ollama?.unreachable
                  ? 'ollama unreachable · is it running?'
                  : 'no models loaded · first inference will warm cache'}
              </p>
            )}
          </div>

          {/* Footnote — surfaces the threshold rule so users see why
              the bars went amber, not just that they did. */}
          {metrics && (
            <p className="border-t border-border-light pt-3 font-mono text-2xs text-text-tertiary">
              thresholds · &lt;{metrics.thresholds.healthy_below}% healthy ·
              &lt;{metrics.thresholds.warning_below}% warning · ≥
              {metrics.thresholds.warning_below}% critical
            </p>
          )}
        </div>
      </aside>
    </>
  );
}

/* --------------------------------------------------- helpers */

function Bar({
  icon,
  label,
  value,
  denom,
  text,
  severity,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  denom: number;
  text: string;
  severity: Severity;
}) {
  const pct = Math.min(100, Math.max(0, (value / denom) * 100));
  const colors = severityColors[severity];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
          <span className="text-text-tertiary">{icon}</span>
          <span className="truncate">{label}</span>
        </span>
        <span className={`font-mono text-2xs ${colors.text}`}>{text}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-border-light">
        <div
          className={`h-full rounded-full transition-all duration-300 ${colors.bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ModelRow({ model }: { model: OllamaRunning }) {
  const onGpu = model.size_vram > 0;
  return (
    <li
      className={`rounded-xl border border-border-light bg-bg-secondary px-3 py-2`}
      title={
        model.expires_at
          ? `evicts ${new Date(model.expires_at).toLocaleTimeString()}`
          : ''
      }
    >
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-text-primary">{model.name}</span>
        <span className="font-mono text-2xs text-text-tertiary">
          {onGpu ? 'GPU' : 'CPU'}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 font-mono text-2xs text-text-tertiary">
        <span>{humanBytes(model.size)} RAM</span>
        {onGpu && (
          <>
            <span>·</span>
            <span>{humanBytes(model.size_vram)} VRAM</span>
          </>
        )}
      </div>
    </li>
  );
}

function Skeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-1.5 opacity-60">
      <span className="text-xs text-text-tertiary">{label}…</span>
      <div className="h-1.5 w-full animate-pulse rounded-full bg-border-light" />
    </div>
  );
}
