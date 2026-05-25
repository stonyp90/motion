'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Key, Loader2, Plus, Trash2 } from 'lucide-react';
import { useAuthStore, selectIsAuthenticated } from '@/stores/auth-store';

const ENGINE_BASE =
  (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_ENGINE_BASE_URL) || '';

type Tier = 'free' | 'pro' | 'enterprise';

interface ApiKeyPublic {
  id: string;
  name: string;
  owner_sub: string;
  tier: Tier;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface IssuedApiKey {
  id: string;
  name: string;
  tier: Tier;
  created_at: string;
  /** Only present right after issuance — show once, never store. */
  secret: string;
}

/**
 * Dashboard for the API key surface. Behaviour mirrors what most
 * cloud-API consoles do (Stripe, GitHub, Anthropic):
 *   - List of active + revoked keys, newest first
 *   - "Create" prompts for a label, returns a one-time secret display
 *     with a copy button (no warning toast required — we say it on the
 *     row itself)
 *   - "Revoke" is a single-click destructive action
 *
 * Why fetch from the browser rather than a Next API route:
 *   - The engine already accepts the same JWT the store holds; threading
 *     it through a Next route would add a hop without buying isolation
 *     (no client secret involved).
 */
export function ApiKeysDashboard() {
  const router = useRouter();
  const hydrated = useAuthStore((s) => s.hydrated);
  const isAuthed = useAuthStore(selectIsAuthenticated);
  const bearer = useAuthStore((s) => s.accessToken);

  const [keys, setKeys] = useState<ApiKeyPublic[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [justIssued, setJustIssued] = useState<IssuedApiKey | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    if (!hydrated) return;
    if (!isAuthed) {
      router.push('/login?next=/dashboard/api-keys' as never);
    }
  }, [hydrated, isAuthed, router]);

  const refresh = useCallback(async () => {
    if (!bearer) return;
    try {
      const r = await fetch(`${ENGINE_BASE}/v1/api-keys`, {
        headers: { Authorization: `Bearer ${bearer}` },
        cache: 'no-store',
      });
      if (!r.ok) {
        setLoadError(`HTTP ${r.status}`);
        return;
      }
      const data = (await r.json()) as ApiKeyPublic[];
      setKeys(data);
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'fetch failed');
    }
  }, [bearer]);

  useEffect(() => {
    if (hydrated && isAuthed) void refresh();
  }, [hydrated, isAuthed, refresh]);

  const handleIssue = async () => {
    const name = window.prompt(
      'Label for the new key (visible in the dashboard only):',
      'untitled key',
    );
    if (!name?.trim() || !bearer) return;
    setIssuing(true);
    try {
      const r = await fetch(`${ENGINE_BASE}/v1/api-keys`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${bearer}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: name.trim(), tier: 'free' }),
      });
      if (!r.ok) {
        const body = await r.text();
        alert(`Create failed: ${body || r.status}`);
        return;
      }
      const issued = (await r.json()) as IssuedApiKey;
      setJustIssued(issued);
      await refresh();
    } finally {
      setIssuing(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!bearer) return;
    if (!window.confirm(`Revoke key ${id}? This cannot be undone.`)) return;
    setRevoking(id);
    try {
      const r = await fetch(`${ENGINE_BASE}/v1/api-keys/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${bearer}` },
      });
      if (!r.ok) {
        const body = await r.text();
        alert(`Revoke failed: ${body || r.status}`);
        return;
      }
      await refresh();
    } finally {
      setRevoking(null);
    }
  };

  if (!hydrated || !isAuthed) {
    return (
      <div className="flex h-64 items-center justify-center text-text-tertiary">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        loading…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="flex items-center gap-2 text-[28px] font-bold tracking-tight text-text-primary">
          <Key className="h-6 w-6 text-accent-600" />
          API keys
        </h1>
        <p className="text-sm text-text-secondary">
          Use these to call the motion-forge engine from SDKs, CLIs, and
          server-side scripts.{' '}
          <code className="rounded bg-bg-tertiary px-1.5 py-0.5 font-mono text-xs">
            mf_live_…
          </code>{' '}
          keys are prefix-grep-able so leaks are scannable.
        </p>
      </header>

      {justIssued && (
        <div
          role="status"
          className="rounded-2xl border border-accent-200 bg-accent-50 p-5"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-accent-800">
            New key — copy it now, you won&apos;t see it again
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 select-all overflow-x-auto whitespace-nowrap rounded-lg bg-bg-primary px-3 py-2 font-mono text-xs text-text-primary">
              {justIssued.secret}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(justIssued.secret);
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-accent-300 bg-bg-primary px-3 py-2 text-xs font-medium text-text-primary hover:bg-bg-tertiary"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </button>
            <button
              type="button"
              onClick={() => setJustIssued(null)}
              className="text-2xs text-text-tertiary hover:text-text-primary"
            >
              Dismiss
            </button>
          </div>
          <p className="mt-2 text-2xs text-text-secondary">
            Label: <span className="font-medium">{justIssued.name}</span> · Tier:{' '}
            <span className="font-medium">{justIssued.tier}</span>
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-2xs uppercase tracking-[0.14em] text-text-tertiary">
          {keys ? `${keys.length} ${keys.length === 1 ? 'key' : 'keys'}` : 'loading…'}
        </p>
        <button
          type="button"
          onClick={handleIssue}
          disabled={issuing}
          className="btn-accent inline-flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          {issuing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          New key
        </button>
      </div>

      {loadError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {loadError}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {(keys ?? []).map((k) => (
          <li
            key={k.id}
            className={`rounded-xl border border-border-light bg-bg-secondary px-4 py-3 ${
              k.revoked_at ? 'opacity-60' : ''
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-text-primary">
                  {k.name}
                </span>
                <span className="font-mono text-2xs text-text-tertiary">
                  mf_live_{k.id}_•••••••••••••••••••••••••••••••• · {k.tier}
                </span>
              </div>
              <div className="flex items-center gap-3 text-2xs text-text-tertiary">
                <span title={k.created_at}>created {fmtDate(k.created_at)}</span>
                {k.last_used_at && (
                  <span title={k.last_used_at}>
                    · used {fmtDate(k.last_used_at)}
                  </span>
                )}
                {k.revoked_at ? (
                  <span className="rounded-full bg-secondary-100 px-2 py-0.5 text-secondary-700">
                    revoked
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleRevoke(k.id)}
                    disabled={revoking === k.id}
                    className="inline-flex items-center gap-1 rounded-md border border-border-light px-2 py-1 text-text-secondary hover:border-red-300 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                  >
                    {revoking === k.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                    Revoke
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
        {keys?.length === 0 && (
          <li className="rounded-xl border border-dashed border-border-light bg-bg-secondary px-4 py-8 text-center text-sm text-text-tertiary">
            No keys yet. Click <span className="font-medium">New key</span> to
            issue one.
          </li>
        )}
      </ul>
    </div>
  );
}

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
