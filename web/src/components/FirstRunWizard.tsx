'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { CheckCircle2, Cpu, Download, Loader2, ShieldAlert, X } from 'lucide-react';

/**
 * First-launch setup wizard for the ControlCraft desktop app.
 *
 * Only renders inside the Tauri shell — gated on `window.__TAURI__`
 * (the JS bridge Tauri exposes; absent on the hosted web build).
 * Anonymous web visitors never see this.
 *
 * Flow (driven by the Rust `setup::first_run_status` command):
 *
 *   Detect → ModelDecision
 *     ↓
 *   model_present? → Ready                    (close + flag onboarded=1)
 *     ↓ no
 *   Disclose ("we'll download ~X GB") → Pull
 *     ↓
 *   Pull (NDJSON progress events → bar) → Ready
 *
 * Cancellation: ESC closes the wizard without flagging onboarded.
 * Next launch the wizard re-detects and re-offers.
 */

interface OllamaStatus {
  reachable: boolean;
  version: string;
  models: string[];
}

interface HwProfile {
  total_ram_gb: number;
  cpu_count: number;
  is_apple_silicon: boolean;
  os: string;
}

interface ModelChoice {
  name: string;
  size_gb: number;
  reason: string;
}

interface FirstRunStatus {
  ollama: OllamaStatus;
  hw: HwProfile;
  recommended: ModelChoice;
  model_present: boolean;
}

interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
}

type WizardState = 'loading' | 'disclose' | 'pulling' | 'ready' | 'error' | 'offline';

const ONBOARDED_QS = 'onboarded';
const ONBOARDED_STORAGE = 'mf-desktop-onboarded';

interface TauriBridge {
  invoke?: <T>(cmd: string, payload?: unknown) => Promise<T>;
  event?: {
    listen?: (event: string, cb: (e: { payload: unknown }) => void) => Promise<() => void>;
  };
}

function tauriBridge(): TauriBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { __TAURI__?: TauriBridge };
  return w.__TAURI__ ?? null;
}

function isAlreadyOnboarded(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    if (window.localStorage.getItem(ONBOARDED_STORAGE) === '1') return true;
  } catch {
    /* private mode — fall through */
  }
  const url = new URL(window.location.href);
  return url.searchParams.get(ONBOARDED_QS) === '1';
}

function markOnboarded() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ONBOARDED_STORAGE, '1');
  } catch {
    /* ignore */
  }
}

export function FirstRunWizard() {
  const bridge = useMemo(() => tauriBridge(), []);
  const [state, setState] = useState<WizardState>('loading');
  const [status, setStatus] = useState<FirstRunStatus | null>(null);
  const [progress, setProgress] = useState<PullProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    markOnboarded();
    setState('ready');
  }, []);

  useEffect(() => {
    if (!bridge?.invoke) return;
    if (isAlreadyOnboarded()) {
      setState('ready');
      return;
    }
    let cancelled = false;
    bridge
      .invoke<FirstRunStatus>('first_run_status')
      .then((s) => {
        if (cancelled) return;
        setStatus(s);
        if (!s.ollama.reachable) {
          setState('offline');
          return;
        }
        if (s.model_present) {
          markOnboarded();
          setState('ready');
          return;
        }
        setState('disclose');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  // Listen for streaming pull progress.
  useEffect(() => {
    if (!bridge?.event?.listen) return;
    if (state !== 'pulling') return;
    let unlisten: (() => void) | null = null;
    void bridge.event
      .listen('setup://progress', (e) => {
        const p = e.payload as PullProgress;
        setProgress(p);
        if (
          (p.status === 'success' || p.status.toLowerCase().includes('success')) ||
          (p.total && p.completed && p.completed >= p.total)
        ) {
          markOnboarded();
          setState('ready');
        }
      })
      .then((unfn) => {
        unlisten = unfn;
      });
    return () => {
      unlisten?.();
    };
  }, [bridge, state]);

  // ESC closes (without flagging onboarded — re-offered next launch).
  useEffect(() => {
    if (state === 'ready') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setState('ready');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);

  const startPull = useCallback(async () => {
    if (!bridge?.invoke || !status) return;
    setState('pulling');
    setProgress({ status: 'starting' });
    try {
      await bridge.invoke('pull_model', { name: status.recommended.name });
      // Final success can also arrive via the event channel — either
      // path lands the wizard in `ready`.
      markOnboarded();
      setState('ready');
    } catch (e) {
      setError(String(e));
      setState('error');
    }
  }, [bridge, status]);

  if (!bridge || state === 'ready') return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="mf-wizard-title"
      className="fixed inset-0 z-[140] grid place-items-center bg-text-primary/60 backdrop-blur-sm"
    >
      <div
        className="animate-reveal-up relative mx-4 w-full max-w-lg rounded-2xl border border-border-light bg-bg-primary p-6 shadow-lift sm:p-8"
        style={{ '--i': 0 } as CSSProperties}
      >
        <button
          type="button"
          onClick={() => setState('ready')}
          aria-label="Close setup"
          className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>

        {state === 'loading' && <LoadingState />}
        {state === 'offline' && status && <OfflineState />}
        {state === 'disclose' && status && (
          <DiscloseState status={status} onStart={startPull} />
        )}
        {state === 'pulling' && status && (
          <PullingState model={status.recommended.name} progress={progress} />
        )}
        {state === 'error' && <ErrorState error={error} onClose={close} />}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-text-secondary">
      <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
      <span className="text-sm">Checking your setup…</span>
    </div>
  );
}

function OfflineState() {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-secondary-50 text-secondary-700">
        <ShieldAlert className="h-6 w-6" aria-hidden />
      </span>
      <h2 id="mf-wizard-title" className="text-xl font-bold tracking-tight text-text-primary">
        We can&apos;t reach the local model runtime yet.
      </h2>
      <p className="text-sm leading-relaxed text-text-secondary">
        The bundled Ollama process didn&apos;t start. Restart ControlCraft;
        if this persists, see{' '}
        <a href="/install#troubleshooting" className="font-medium text-text-accent underline-offset-2 hover:underline">
          the install guide
        </a>
        .
      </p>
    </div>
  );
}

function DiscloseState({
  status,
  onStart,
}: {
  status: FirstRunStatus;
  onStart: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="font-mono text-2xs font-medium uppercase tracking-[0.18em] text-text-accent">
          One-time setup
        </p>
        <h2 id="mf-wizard-title" className="text-2xl font-bold tracking-tight text-text-primary">
          Let&apos;s warm up the engine.
        </h2>
      </header>
      <p className="text-sm leading-relaxed text-text-secondary">
        ControlCraft will download a vision model so generation runs
        on your machine. About{' '}
        <strong className="text-text-primary">{status.recommended.size_gb} GB</strong>
        {' '}of disk space. One time — kept under <code className="rounded bg-bg-tertiary px-1 font-mono text-xs">~/.ollama/models</code> so a system-wide Ollama install can share it.
      </p>
      <div className="flex items-start gap-3 rounded-xl border border-border-light bg-bg-secondary p-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-700">
          <Cpu className="h-4 w-4" aria-hidden />
        </span>
        <div className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-text-primary">{status.recommended.name}</span>
          <span className="text-text-tertiary">{status.recommended.reason}</span>
          <span className="font-mono text-2xs text-text-tertiary">
            {hwSummary(status.hw)}
          </span>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onStart}
          className="btn-accent px-5 py-2.5 text-sm"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Download ({status.recommended.size_gb} GB)
        </button>
      </div>
    </div>
  );
}

function PullingState({
  model,
  progress,
}: {
  model: string;
  progress: PullProgress | null;
}) {
  const pct = progress?.total && progress?.completed
    ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
    : null;
  const statusLabel = progress?.status ?? 'Starting';

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <p className="font-mono text-2xs font-medium uppercase tracking-[0.18em] text-text-accent">
          Downloading model
        </p>
        <h2 id="mf-wizard-title" className="text-2xl font-bold tracking-tight text-text-primary">
          {model}
        </h2>
      </header>
      <div className="flex flex-col gap-2">
        <div className="h-2 w-full overflow-hidden rounded-full bg-bg-tertiary">
          <div
            className="h-full rounded-full bg-accent-500 transition-[width] duration-300"
            style={{ width: pct == null ? '5%' : `${pct}%` }}
          />
        </div>
        <p className="font-mono text-2xs uppercase tracking-[0.14em] text-text-tertiary">
          {pct != null ? `${pct}% · ` : ''}{statusLabel}
        </p>
      </div>
      <p className="text-xs leading-relaxed text-text-tertiary">
        You can keep this window open or hide it — the download continues
        in the background. We&apos;ll open the main window once the model
        is warm.
      </p>
    </div>
  );
}

function ErrorState({ error, onClose }: { error: string | null; onClose: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300">
        <ShieldAlert className="h-6 w-6" aria-hidden />
      </span>
      <h2 id="mf-wizard-title" className="text-xl font-bold tracking-tight text-text-primary">
        Setup hit a snag.
      </h2>
      <p className="text-sm leading-relaxed text-text-secondary">
        {error ?? 'Something went wrong while preparing the local model.'}
      </p>
      <button type="button" onClick={onClose} className="btn-ghost px-5 py-2 text-sm">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
        Continue anyway
      </button>
    </div>
  );
}

function hwSummary(hw: HwProfile): string {
  const parts: string[] = [];
  if (hw.is_apple_silicon) parts.push('Apple silicon');
  else if (hw.os === 'macos') parts.push('macOS · Intel');
  else if (hw.os === 'windows') parts.push('Windows');
  else if (hw.os === 'linux') parts.push('Linux');
  parts.push(`${hw.total_ram_gb} GB RAM`);
  parts.push(`${hw.cpu_count} CPUs`);
  return parts.join(' · ');
}
