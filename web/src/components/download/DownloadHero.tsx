'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Apple,
  ArrowRight,
  Cpu,
  Download as DownloadIcon,
  Loader2,
  Server,
  Shield,
} from 'lucide-react';
import { ASSETS, VERSION, type DownloadAsset, type DownloadOs } from '@/lib/download-manifest';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Download landing for the ControlCraft desktop app.
 *
 * Repo is private — we don't link to GitHub Releases. Every install
 * button hits `/api/download/<os>` which, for an authenticated browser
 * caller, returns `{ url }` JSON pointing at the actual installer
 * hosted on our private storage origin. The URL never appears in the
 * page HTML; the server resolves it from `ControlCraft_DOWNLOAD_BASE`
 * (a server-only env) on every request and a 503 + "build pending"
 * comes back when the CI hasn't uploaded yet.
 *
 * Auth: the API route requires `Authorization: Bearer <jwt>` from the
 * Keycloak realm — see `web/src/app/api/download/[os]/route.ts`. This
 * component pulls the access token out of the zustand auth store and
 * attaches it before the fetch. A 401 bounces the user to `/login`.
 *
 * UX pattern: Linear's per-OS card grid + Cursor's OS-detected
 * primary CTA. The detected card gets the green emphasis; the others
 * sit in a 2-column secondary grid.
 */

export function DownloadHero() {
  const [pendingOs, setPendingOs] = useState<DownloadOs | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const router = useRouter();

  const detectedOs = useMemo(() => detectOs(), []);
  const primary = ASSETS.find((a) => a.os === detectedOs) ?? ASSETS[0];

  /**
   * Click handler — instead of a plain `<a download>` we GET the API
   * route ourselves with the user's bearer token in the
   * `Authorization` header. The server gate (see
   * `web/src/app/api/download/[os]/route.ts`) demands a valid Keycloak
   * JWT before handing back the upstream installer URL.
   *
   * Flow:
   *   1. Pull the access token from the zustand auth store. No token
   *      → bounce to `/login?next=/download` immediately.
   *   2. Fetch the API route with `Accept: application/json` so the
   *      server returns the upstream URL in the body instead of a 302.
   *      We can't follow a same-origin 302 manually from `fetch` —
   *      `redirect: 'manual'` produces an `opaqueredirect` whose
   *      `Location` header is unreadable per the spec.
   *   3. 200 → navigate the window to the `url` in the body. The
   *      browser handles the actual binary download on that GET.
   *   4. 401 → token expired/invalid (the auth-store refresh timer
   *      missed). Bounce to `/login?next=/download`.
   *   5. 503 → release CI hasn't uploaded the asset yet — show the
   *      inline "build pending" toast.
   */
  const startDownload = async (asset: DownloadAsset) => {
    const token = useAuthStore.getState().accessToken;
    if (!token) {
      router.replace((`/login?next=${encodeURIComponent('/download')}`) as never);
      return;
    }

    setPendingOs(asset.os);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/download/${asset.os}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
        cache: 'no-store',
      });

      if (res.status === 401) {
        // Token expired or refused — kick the user through /login
        // with a return URL so they land back here.
        router.replace((`/login?next=${encodeURIComponent('/download')}`) as never);
        return;
      }

      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { url?: string };
        if (body.url) {
          window.location.href = body.url;
          return;
        }
        setErrorMsg('Download failed (no upstream URL returned).');
        return;
      }

      if (res.status === 503) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
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
          Run ControlCraft
          <br />
          on your own machine.
        </h1>
        <p className="max-w-[34rem] text-lg leading-[1.55] text-text-secondary sm:text-xl">
          The same product as the web, packaged with a local engine and
          local-model support. Generate offline, keep every brief on your
          laptop, ship motion graphics without the cloud bill.
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
          body="Identical UI to controlcraft.io — the desktop just wraps it with sidecars."
        />
      </div>

      <p className="mx-auto mt-10 flex max-w-3xl items-center justify-center gap-2 text-center text-xs text-text-tertiary">
        First time setting up?
        <Link
          href={"/install" as never}
          className="inline-flex items-center gap-1 font-medium text-text-accent underline-offset-2 hover:underline"
        >
          Read the setup guide
          <ArrowRight className="h-3 w-3" aria-hidden />
        </Link>
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
