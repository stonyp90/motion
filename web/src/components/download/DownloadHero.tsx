'use client';

import { useMemo, useState } from 'react';
import {
  Apple,
  Cpu,
  Download as DownloadIcon,
  Loader2,
  Server,
  Shield,
} from 'lucide-react';
import { ASSETS, VERSION, type DownloadAsset, type DownloadOs } from '@/lib/download-manifest';

/**
 * Download landing for the IMTN desktop app.
 *
 * Repo is private — we don't link to GitHub Releases. Every install
 * button hits `/api/download/<os>` which 302-redirects to the actual
 * installer URL hosted on our private storage origin. The URL is a
 * server-only env (`IMTN_DOWNLOAD_BASE`) so it's never in the HTML;
 * a 503 + "build pending" comes back when the CI hasn't uploaded yet.
 *
 * UX pattern: Linear's per-OS card grid + Cursor's OS-detected
 * primary CTA. The detected card gets the green emphasis; the others
 * sit in a 2-column secondary grid.
 */

export function DownloadHero() {
  const [pendingOs, setPendingOs] = useState<DownloadOs | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const detectedOs = useMemo(() => detectOs(), []);
  const primary = ASSETS.find((a) => a.os === detectedOs) ?? ASSETS[0];

  /**
   * Click handler — instead of a plain `<a download>`, we GET the API
   * route ourselves so we can show a "build pending" toast inline
   * when the release CI hasn't uploaded the asset for this version.
   * On success the API returns 302; the browser follows it natively.
   */
  const startDownload = async (asset: DownloadAsset) => {
    setPendingOs(asset.os);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/download/${asset.os}`, {
        method: 'GET',
        redirect: 'manual',
        cache: 'no-store',
      });
      // 302 lands as `opaqueredirect` when `redirect: 'manual'`. Treat
      // it as success and let the browser follow it natively.
      if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
        window.location.href = `/api/download/${asset.os}`;
        return;
      }
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        setErrorMsg(
          body?.detail ?? 'Build pending — check back once the release CI finishes.',
        );
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
    <section className="container py-16 sm:py-20">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center">
        <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-accent-700">
          Desktop · Native shell
        </p>
        <h1 className="text-[44px] font-bold leading-[1.05] tracking-tight text-text-primary sm:text-[56px]">
          Run IMTN
          <br />
          on your own machine.
        </h1>
        <p className="max-w-[34rem] text-lg leading-[1.55] text-text-secondary sm:text-xl">
          The same product as the web, packaged with a local engine and
          local-model support. Generate offline, keep every brief on your
          laptop, ship videos without the cloud bill.
        </p>

        <PrimaryCTA
          asset={primary}
          pending={pendingOs === primary.os}
          onClick={() => startDownload(primary)}
        />

        {errorMsg && (
          <p
            role="status"
            className="mt-3 rounded-lg border border-secondary-200 bg-secondary-50 px-3 py-2 text-xs text-secondary-700"
          >
            {errorMsg}
          </p>
        )}
      </div>

      <div className="mt-14">
        <p className="mb-4 text-center font-mono text-2xs uppercase tracking-[0.16em] text-text-tertiary">
          All platforms · v{VERSION}
        </p>
        <ul className="mx-auto grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
          {ASSETS.map((a) => (
            <PlatformCard
              key={a.os}
              asset={a}
              isPrimary={a.os === detectedOs}
              pending={pendingOs === a.os}
              onClick={() => startDownload(a)}
            />
          ))}
        </ul>
      </div>

      <div className="mx-auto mt-16 grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-3">
        <TrustChip
          icon={<Shield className="h-4 w-4" />}
          title="Local-first"
          body="Engine + Ollama run on your machine. No data leaves your laptop."
        />
        <TrustChip
          icon={<Cpu className="h-4 w-4" />}
          title="GPU-aware"
          body="Detects your Apple silicon / NVIDIA / iGPU and routes inference."
        />
        <TrustChip
          icon={<Server className="h-4 w-4" />}
          title="Same web product"
          body="Identical UI to imtn.io — the desktop just wraps it with sidecars."
        />
      </div>

      <p className="mx-auto mt-10 max-w-3xl text-center text-xs text-text-tertiary">
        Ollama is not yet bundled — install it once from{' '}
        <a
          href="https://ollama.com/download"
          target="_blank"
          rel="noreferrer"
          className="text-text-accent underline-offset-2 hover:underline"
        >
          ollama.com/download
        </a>{' '}
        and run{' '}
        <code className="rounded bg-bg-tertiary px-1.5 py-0.5 font-mono text-2xs">
          ollama pull llava
        </code>{' '}
        so the desktop can talk to a vision model on first launch.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function PrimaryCTA({
  asset,
  pending,
  onClick,
}: {
  asset: DownloadAsset;
  pending: boolean;
  onClick: () => void;
}) {
  const icon =
    asset.os.startsWith('mac') ? (
      <Apple className="h-4 w-4" />
    ) : asset.os === 'windows' ? (
      <Cpu className="h-4 w-4" />
    ) : (
      <Server className="h-4 w-4" />
    );
  return (
    <div className="mt-4 flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="btn-accent inline-flex items-center gap-2 px-7 py-3.5 text-base disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
        Download for {asset.label}
      </button>
      <p className="font-mono text-2xs uppercase tracking-[0.14em] text-text-tertiary">
        v{VERSION} · ~{asset.sizeMb} MB · {asset.detail}
      </p>
    </div>
  );
}

function PlatformCard({
  asset,
  isPrimary,
  pending,
  onClick,
}: {
  asset: DownloadAsset;
  isPrimary: boolean;
  pending: boolean;
  onClick: () => void;
}) {
  const icon =
    asset.os.startsWith('mac') ? (
      <Apple className="h-4 w-4" />
    ) : asset.os === 'windows' ? (
      <Cpu className="h-4 w-4" />
    ) : (
      <Server className="h-4 w-4" />
    );
  return (
    <li
      className={`flex items-center justify-between gap-3 rounded-2xl border bg-bg-secondary px-4 py-3 transition ${
        isPrimary
          ? 'border-accent-300 shadow-card'
          : 'border-border-light hover:border-accent-200'
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-bg-primary text-text-secondary">
          {icon}
        </span>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-text-primary">{asset.label}</span>
          <span className="font-mono text-2xs text-text-tertiary">
            ~{asset.sizeMb} MB · {asset.filename}
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-full border border-border-light bg-bg-primary px-3 py-1.5 text-xs font-medium text-text-primary transition hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <DownloadIcon className="h-3.5 w-3.5" />
        )}
        Download
      </button>
    </li>
  );
}

function TrustChip({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border-light bg-bg-secondary p-5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-50 text-accent-700">
        {icon}
      </span>
      <h3 className="text-base font-bold tracking-tight text-text-primary">{title}</h3>
      <p className="text-sm leading-snug text-text-secondary">{body}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ utils */

function detectOs(): DownloadOs {
  if (typeof navigator === 'undefined') return 'mac-arm';
  const ua = navigator.userAgent || '';
  const plat = (navigator.platform || '').toLowerCase();
  if (/win/i.test(ua) || plat.includes('win')) return 'windows';
  if (/linux/i.test(ua) || plat.includes('linux')) return 'linux-deb';
  if (/mac/i.test(ua) || plat.includes('mac')) {
    // Default to Apple silicon — the vast majority of new Macs since
    // 2020 are M-series. Intel users will see the same big CTA but
    // can grab the x64 build from the secondary grid below.
    return 'mac-arm';
  }
  return 'mac-arm';
}
