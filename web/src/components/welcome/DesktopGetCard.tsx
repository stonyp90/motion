'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import {
  Apple,
  Cpu,
  Loader2,
  Server,
  Download as DownloadIcon,
} from 'lucide-react';
import {
  ASSETS,
  VERSION,
  detectOs,
  type DownloadAsset,
  type DownloadOs,
} from '@/lib/download-manifest';

/**
 * The hero card of the welcome dashboard: OS-detected primary download
 * CTA, with the four secondary platforms on a single row beneath. Hits
 * `/api/download/<os>` — same protocol as the full /download page —
 * but in a more compact frame so the install steps stay visible below
 * the fold.
 *
 * Anchored with `data-testid="mf-welcome-download"` for the WelcomeTour.
 */
export function DesktopGetCard() {
  const [pendingOs, setPendingOs] = useState<DownloadOs | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const detectedOs = useMemo(() => detectOs(), []);
  const primary = ASSETS.find((a) => a.os === detectedOs) ?? ASSETS[0]!;
  const secondaries = ASSETS.filter((a) => a.os !== primary.os);

  const startDownload = async (asset: DownloadAsset) => {
    setPendingOs(asset.os);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/download/${asset.os}`, {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
      });
      // Success paths from /api/download/<os>:
      //   - 3xx redirect: CDN-base configured, hand off to the browser
      //   - 2xx with attachment: GitHub Releases proxy, the response body
      //     IS the installer. Re-trigger via window.location so the browser
      //     handles the save dialog (the prior fetch's bytes are discarded).
      const isAttachment = res.headers
        .get('content-disposition')
        ?.toLowerCase()
        .includes('attachment');
      if (
        res.type === 'opaqueredirect' ||
        (res.status >= 300 && res.status < 400) ||
        (res.ok && isAttachment)
      ) {
        window.location.href = `/api/download/${asset.os}`;
        return;
      }
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(body?.detail ?? 'Build pending — check back once CI finishes.');
        return;
      }
      setErrorMsg(`Download failed (HTTP ${res.status}).`);
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'network error');
    } finally {
      setPendingOs(null);
    }
  };

  return (
    <section
      data-testid="mf-welcome-download"
      className="animate-reveal-up stagger-child rounded-3xl border border-border-light bg-bg-secondary p-8 shadow-card sm:p-10"
      style={{ '--i': 3 } as CSSProperties}
    >
      <div className="flex flex-col items-start gap-2">
        <p className="font-mono text-2xs font-medium uppercase tracking-[0.18em] text-text-accent">
          Desktop · Native shell
        </p>
        <h2 className="text-2xl font-bold tracking-tight text-text-primary sm:text-[28px]">
          Built for {primary.label.split('·')[0].trim()}.
        </h2>
        <p className="max-w-xl text-sm leading-relaxed text-text-secondary">
          The same product as the web, packaged with a local engine and
          model runtime. No cloud, no rate limits, full motion stack.
        </p>
      </div>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <button
          type="button"
          onClick={() => startDownload(primary)}
          disabled={pendingOs === primary.os}
          className="btn-accent inline-flex items-center justify-center gap-2 px-6 py-3 text-base disabled:cursor-not-allowed disabled:opacity-70"
        >
          {pendingOs === primary.os ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <PlatformIcon os={primary.os} />
          )}
          Download for {primary.label}
        </button>
        <span className="font-mono text-2xs uppercase tracking-[0.14em] text-text-tertiary">
          v{VERSION} · ~{primary.sizeMb} MB · {primary.detail}
        </span>
      </div>

      {errorMsg && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-2 text-xs text-secondary-700"
        >
          {errorMsg}
        </p>
      )}

      <div className="mt-8 border-t border-border-light pt-5">
        <p className="mb-3 font-mono text-2xs font-medium uppercase tracking-[0.14em] text-text-tertiary">
          Other platforms
        </p>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {secondaries.map((a) => (
            <SecondaryRow
              key={a.os}
              asset={a}
              pending={pendingOs === a.os}
              onClick={() => startDownload(a)}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

function SecondaryRow({
  asset,
  pending,
  onClick,
}: {
  asset: DownloadAsset;
  pending: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="motion-hover flex w-full items-center justify-between gap-3 rounded-xl border border-border-light bg-bg-primary px-3 py-2.5 text-left hover:border-accent-200 hover:bg-accent-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-bg-tertiary text-text-secondary">
            <PlatformIcon os={asset.os} small />
          </span>
          <span className="text-sm font-medium text-text-primary">
            {asset.label}
          </span>
        </span>
        <span className="font-mono text-2xs text-text-tertiary">
          {pending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <DownloadIcon className="h-3.5 w-3.5" />
          )}
        </span>
      </button>
    </li>
  );
}

function PlatformIcon({ os, small }: { os: DownloadOs; small?: boolean }) {
  const c = small ? 'h-3.5 w-3.5' : 'h-4 w-4';
  if (os.startsWith('mac')) return <Apple className={c} aria-hidden />;
  if (os === 'windows') return <Cpu className={c} aria-hidden />;
  return <Server className={c} aria-hidden />;
}
