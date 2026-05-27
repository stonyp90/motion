'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Download, Loader2, RefreshCw, X, CheckCircle2 } from 'lucide-react';

/**
 * Auto-update banner for the ControlCraft desktop app.
 *
 * Mounts globally in the root layout. Self-gates on `window.__TAURI__`
 * so the hosted web build never sees it (no spurious "Update available"
 * popups on controlcraft.io).
 *
 * Flow (driven by the Tauri 2 `tauri-plugin-updater` IPC channel):
 *
 *   idle → check → available → downloading → ready → restart
 *
 * Once `ready` we surface a "Restart now" button. The actual restart
 * is invoked via the updater plugin's `relaunch` command on click.
 *
 * Failure paths collapse to a small dismissible notice — never blocks
 * the user from using the app. Each session re-checks on mount.
 */

interface TauriBridge {
  invoke?: <T>(cmd: string, payload?: unknown) => Promise<T>;
  event?: {
    listen?: (
      event: string,
      cb: (e: { payload: unknown }) => void,
    ) => Promise<() => void>;
  };
}

interface UpdateMetadata {
  available: boolean;
  version?: string;
  notes?: string;
  date?: string;
}

interface DownloadEvent {
  event: 'Started' | 'Progress' | 'Finished';
  data?: {
    contentLength?: number;
    chunkLength?: number;
  };
}

type State = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'dismissed';

const SESSION_DISMISSED_KEY = 'mf-update-dismissed-version';

function tauriBridge(): TauriBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { __TAURI__?: TauriBridge };
  return w.__TAURI__ ?? null;
}

export function UpdateBanner() {
  const bridge = useMemo(() => tauriBridge(), []);
  const [state, setState] = useState<State>('idle');
  const [meta, setMeta] = useState<UpdateMetadata | null>(null);
  const [downloaded, setDownloaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Run the check exactly once per mount.
  useEffect(() => {
    if (!bridge?.invoke) return;
    let cancelled = false;
    setState('checking');
    bridge
      .invoke<UpdateMetadata | null>('plugin:updater|check')
      .then((m) => {
        if (cancelled) return;
        if (!m || !m.available) {
          setState('idle');
          return;
        }
        // Session-level dismissal: if the user already said "not now"
        // for THIS version, stay quiet until the version bumps.
        try {
          const dismissed = window.sessionStorage.getItem(SESSION_DISMISSED_KEY);
          if (dismissed && dismissed === m.version) {
            setState('dismissed');
            return;
          }
        } catch {
          /* ignore */
        }
        setMeta(m);
        setState('available');
      })
      .catch((e) => {
        if (cancelled) return;
        // Network errors / no manifest / 204 / 404 — all silent.
        // Surface only if the plugin throws an actual reject.
        if (String(e).toLowerCase().includes('signature')) {
          setError('Update signature failed verification.');
          setState('error');
        } else {
          setState('idle');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  const handleDismiss = useCallback(() => {
    try {
      if (meta?.version) {
        window.sessionStorage.setItem(SESSION_DISMISSED_KEY, meta.version);
      }
    } catch {
      /* ignore */
    }
    setState('dismissed');
  }, [meta]);

  const handleInstall = useCallback(async () => {
    if (!bridge?.invoke || !bridge.event?.listen) return;
    setState('downloading');
    setDownloaded(0);
    setTotal(0);
    let unlisten: (() => void) | null = null;
    try {
      unlisten = await bridge.event.listen('tauri://update-download-progress', (e) => {
        const p = e.payload as DownloadEvent;
        if (p.event === 'Started') {
          setTotal(p.data?.contentLength ?? 0);
        } else if (p.event === 'Progress') {
          setDownloaded((d) => d + (p.data?.chunkLength ?? 0));
        } else if (p.event === 'Finished') {
          setState('ready');
        }
      });
      // `download_and_install` is the Tauri 2 one-shot — it streams
      // bytes, verifies the signature against the bundled pubkey,
      // applies the swap, and resolves only when the new bundle is
      // staged on disk ready for relaunch.
      await bridge.invoke('plugin:updater|download_and_install');
      setState('ready');
    } catch (e) {
      setError(String(e));
      setState('error');
    } finally {
      unlisten?.();
    }
  }, [bridge]);

  const handleRestart = useCallback(async () => {
    if (!bridge?.invoke) return;
    try {
      // `plugin:process|restart` relaunches the running app in-place
      // so the user lands back at the same surface on the new build.
      await bridge.invoke('plugin:process|restart');
    } catch {
      // Fall back to a soft reload; the new binary is already staged
      // so the next launch picks it up regardless.
      window.location.reload();
    }
  }, [bridge]);

  if (!bridge || state === 'idle' || state === 'dismissed' || state === 'checking') {
    return null;
  }

  const pct = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[110] flex w-[min(92vw,360px)] flex-col gap-3 rounded-2xl border border-border-light bg-bg-primary p-4 shadow-lift"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-700">
            {state === 'ready' ? (
              <CheckCircle2 className="h-4 w-4" aria-hidden />
            ) : state === 'downloading' ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <Download className="h-4 w-4" aria-hidden />
            )}
          </span>
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-bold tracking-tight text-text-primary">
              {state === 'ready'
                ? 'Update ready'
                : state === 'downloading'
                  ? 'Downloading update'
                  : state === 'error'
                    ? 'Update failed'
                    : 'New version available'}
              {meta?.version ? ` · ${meta.version}` : ''}
            </p>
            {meta?.notes && state !== 'error' && (
              <p className="line-clamp-2 text-xs leading-relaxed text-text-secondary">
                {meta.notes}
              </p>
            )}
            {state === 'error' && error && (
              <p className="text-xs leading-relaxed text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss update notice"
          className="-m-1 grid h-7 w-7 shrink-0 place-items-center rounded-full text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </header>

      {state === 'downloading' && (
        <div className="flex flex-col gap-1">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary">
            <div
              className="h-full rounded-full bg-accent-500 transition-[width] duration-300"
              style={{ width: pct == null ? '5%' : `${pct}%` } as CSSProperties}
            />
          </div>
          <p className="font-mono text-2xs uppercase tracking-[0.14em] text-text-tertiary">
            {pct != null ? `${pct}%` : '…'}
          </p>
        </div>
      )}

      <footer className="flex justify-end gap-2">
        {state === 'available' && (
          <button
            type="button"
            onClick={handleInstall}
            className="btn-accent px-4 py-2 text-xs"
          >
            <Download className="h-3 w-3" aria-hidden />
            Install update
          </button>
        )}
        {state === 'ready' && (
          <button
            type="button"
            onClick={handleRestart}
            className="btn-accent px-4 py-2 text-xs"
          >
            <RefreshCw className="h-3 w-3" aria-hidden />
            Restart now
          </button>
        )}
        {state === 'error' && (
          <button
            type="button"
            onClick={handleDismiss}
            className="btn-ghost px-4 py-2 text-xs"
          >
            Dismiss
          </button>
        )}
      </footer>
    </div>
  );
}
