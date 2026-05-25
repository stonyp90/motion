'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Apple,
  Cpu,
  Download as DownloadIcon,
  ExternalLink,
  Loader2,
  Server,
  Shield,
} from 'lucide-react';

/**
 * Download landing page. Pattern survey: Linear (per-OS card grid),
 * Cursor (OS-detected primary CTA + small links for the others),
 * Tauri.app's own download page (compact pill grid).
 *
 * We do all three:
 *   - Detect the user's OS via UA-CH + navigator.userAgent, primary-CTA
 *     the matching build with a big green button and the size/SHA chip.
 *   - List every other build as a secondary card in a 2-column grid.
 *   - Pull the freshest `desktop-v*` tag from the GitHub Releases API
 *     so the page never lies about the version. Fall back to a stable
 *     /releases link when the API is rate-limited or the repo is dark.
 *
 * The page is deliberately quiet on chrome — the buttons are the page.
 */

const REPO = 'stonyp90/motion';
const RELEASES_URL = `https://github.com/${REPO}/releases`;

type Platform = {
  id: 'mac-arm' | 'mac-intel' | 'windows' | 'linux-deb' | 'linux-appimage';
  label: string;
  detail: string;
  icon: React.ReactNode;
  /** RegEx that matches the asset filename for this platform. */
  match: RegExp;
};

const PLATFORMS: ReadonlyArray<Platform> = [
  {
    id: 'mac-arm',
    label: 'macOS · Apple silicon',
    detail: 'M1, M2, M3, M4. macOS 11+',
    icon: <Apple className="h-4 w-4" />,
    match: /aarch64\.dmg$/i,
  },
  {
    id: 'mac-intel',
    label: 'macOS · Intel',
    detail: 'macOS 11+',
    icon: <Apple className="h-4 w-4" />,
    match: /x64\.dmg$|x86_64\.dmg$/i,
  },
  {
    id: 'windows',
    label: 'Windows · x64',
    detail: 'Windows 10, 11',
    icon: <Cpu className="h-4 w-4" />,
    match: /x64.*\.(msi|exe)$/i,
  },
  {
    id: 'linux-deb',
    label: 'Linux · .deb',
    detail: 'Debian, Ubuntu',
    icon: <Server className="h-4 w-4" />,
    match: /amd64\.deb$/i,
  },
  {
    id: 'linux-appimage',
    label: 'Linux · AppImage',
    detail: 'Any distro',
    icon: <Server className="h-4 w-4" />,
    match: /amd64\.AppImage$/i,
  },
];

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface Release {
  tag_name: string;
  name: string;
  html_url: string;
  published_at: string;
  assets: ReleaseAsset[];
}

export function DownloadHero() {
  const [release, setRelease] = useState<Release | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    // Hit the unauthenticated Releases API. Anonymous quota is 60
    // req/hour per IP — plenty for a marketing surface, but we still
    // fall back gracefully if the call fails.
    fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then((r) => (r.ok ? (r.json() as Promise<Release[]>) : Promise.reject(r.status)))
      .then((all) => {
        if (cancelled) return;
        // Pick the freshest `desktop-v*` tag — ignore engine releases
        // and pre-releases without assets.
        const latest = all.find(
          (r) => r.tag_name.startsWith('desktop-v') && r.assets.length > 0,
        );
        if (latest) {
          setRelease(latest);
          setLoadState('ok');
        } else {
          setLoadState('error');
        }
      })
      .catch(() => !cancelled && setLoadState('error'));
    return () => {
      cancelled = true;
    };
  }, []);

  const detectedOs = useMemo(() => detectOs(), []);
  const primary = PLATFORMS.find((p) => p.id === detectedOs) ?? PLATFORMS[0];

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

        {loadState === 'loading' && (
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-border-light bg-bg-secondary px-4 py-2 text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" />
            Finding the latest build…
          </div>
        )}

        {loadState === 'error' && (
          <a
            href={RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            className="btn-accent mt-4 inline-flex items-center gap-2 px-6 py-3 text-base"
          >
            <DownloadIcon className="h-4 w-4" />
            See all downloads on GitHub
            <ExternalLink className="h-3.5 w-3.5 opacity-70" />
          </a>
        )}

        {loadState === 'ok' && release && (
          <PrimaryCTA release={release} platform={primary} />
        )}
      </div>

      {loadState === 'ok' && release && (
        <div className="mt-14">
          <p className="mb-4 text-center font-mono text-2xs uppercase tracking-[0.16em] text-text-tertiary">
            All platforms · {release.tag_name}
          </p>
          <ul className="mx-auto grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
            {PLATFORMS.map((p) => (
              <PlatformCard
                key={p.id}
                platform={p}
                release={release}
                isPrimary={p.id === detectedOs}
              />
            ))}
          </ul>
        </div>
      )}

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
        and run <code className="rounded bg-bg-tertiary px-1.5 py-0.5 font-mono text-2xs">ollama pull llava</code>{' '}
        so the desktop can talk to a vision model on first launch.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ CTA */

function PrimaryCTA({ release, platform }: { release: Release; platform: Platform }) {
  const asset = release.assets.find((a) => platform.match.test(a.name));
  if (!asset) {
    return (
      <a
        href={release.html_url}
        target="_blank"
        rel="noreferrer"
        className="btn-accent mt-4 inline-flex items-center gap-2 px-6 py-3 text-base"
      >
        <DownloadIcon className="h-4 w-4" />
        Browse {release.tag_name} on GitHub
        <ExternalLink className="h-3.5 w-3.5 opacity-70" />
      </a>
    );
  }
  return (
    <div className="mt-4 flex flex-col items-center gap-2">
      <a
        href={asset.browser_download_url}
        className="btn-accent inline-flex items-center gap-2 px-7 py-3.5 text-base"
        download
      >
        {platform.icon}
        Download for {platform.label}
      </a>
      <p className="font-mono text-2xs uppercase tracking-[0.14em] text-text-tertiary">
        {release.tag_name} · {humanBytes(asset.size)} · {platform.detail}
      </p>
    </div>
  );
}

function PlatformCard({
  platform,
  release,
  isPrimary,
}: {
  platform: Platform;
  release: Release;
  isPrimary: boolean;
}) {
  const asset = release.assets.find((a) => platform.match.test(a.name));
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
          {platform.icon}
        </span>
        <div className="flex flex-col">
          <span className="text-sm font-medium text-text-primary">
            {platform.label}
          </span>
          <span className="font-mono text-2xs text-text-tertiary">
            {asset ? humanBytes(asset.size) : 'not in this release'}
          </span>
        </div>
      </div>
      {asset ? (
        <a
          href={asset.browser_download_url}
          download
          className="inline-flex items-center gap-1.5 rounded-full border border-border-light bg-bg-primary px-3 py-1.5 text-xs font-medium text-text-primary transition hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700"
        >
          <DownloadIcon className="h-3.5 w-3.5" />
          Download
        </a>
      ) : (
        <span className="font-mono text-2xs text-text-tertiary">—</span>
      )}
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

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/**
 * Best-effort OS detection from the user agent. Doesn't rely on UA-CH
 * (which is only available over HTTPS in modern browsers) so it works
 * on localhost dev too.
 */
function detectOs(): Platform['id'] {
  if (typeof navigator === 'undefined') return 'mac-arm';
  const ua = navigator.userAgent || '';
  const plat = (navigator.platform || '').toLowerCase();
  if (/win/i.test(ua) || plat.includes('win')) return 'windows';
  if (/linux/i.test(ua) || plat.includes('linux')) return 'linux-deb';
  if (/mac/i.test(ua) || plat.includes('mac')) {
    // Heuristic: M-series Macs report "Intel" in the UA for historical
    // compat reasons. Best signal we have without UA-CH is the screen
    // device-pixel-ratio + memory profile; default to arm64 since the
    // overwhelming majority of new Macs since 2020 are Apple silicon.
    return 'mac-arm';
  }
  return 'mac-arm';
}
