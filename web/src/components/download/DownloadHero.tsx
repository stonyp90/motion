'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Apple,
  ArrowRight,
  Check,
  Copy,
  Cpu,
  Download as DownloadIcon,
  Loader2,
  Server,
  Shield,
  ShieldAlert,
} from 'lucide-react';
import {
  ASSETS,
  VERSION,
  detectOs,
  type DownloadAsset,
  type DownloadOs,
} from '@/lib/download-manifest';

/**
 * Download landing for the ControlCraft desktop app.
 *
 * Repo is private — we don't link to GitHub Releases. Every install
 * button hits `/api/download/<os>` which 302-redirects to the actual
 * installer URL hosted on our private storage origin. The URL is a
 * server-only env (`ControlCraft_DOWNLOAD_BASE`) so it's never in the HTML;
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
      // Success paths from /api/download/<os>:
      //   - 3xx redirect (CDN path) — `redirect: 'manual'` surfaces it as
      //     `opaqueredirect`. Browser follows natively.
      //   - 2xx with attachment (GitHub Releases proxy) — body IS the
      //     installer. Re-trigger via window.location so the browser's
      //     save dialog handles it; prior fetch bytes are discarded.
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

      {/* Codesign bypass — inlined per OS so a buyer who just hit
          the Gatekeeper / SmartScreen wall can grab the fix in one
          place without bouncing through /install. Auto-selects the
          tab matching the visitor's detected OS. */}
      <CodesignBypass detectedOs={detectedOs} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Codesign bypass panel — temporary docs for the pre-signed window   */
/* ------------------------------------------------------------------ */

/**
 * The 4 bypass snippets, one per artifact we ship. Each is a
 * single-line shell or PowerShell command. The OS-detection in
 * `DownloadHero` picks which tab opens first; visitors can switch
 * to any other tab to grab another platform's fix.
 *
 * Keep these in sync with `/install#bypass-codesign` — that page is
 * the canonical reference. When the Apple Developer ID + Windows EV
 * cert land, both this panel and the install-page block retire
 * together.
 */
const BYPASS_SNIPPETS: Array<{
  os: DownloadOs;
  label: string;
  problem: string;
  command: string;
  note?: string;
}> = [
  {
    os: 'mac-arm',
    label: 'macOS (Apple silicon)',
    problem: '"Apple cannot verify…" / "malicious software"',
    command:
      'xattr -dr com.apple.quarantine /Applications/ControlCraft.app',
    note:
      'Or use System Settings → Privacy & Security → Open Anyway after the first launch attempt.',
  },
  {
    os: 'mac-intel',
    label: 'macOS (Intel)',
    problem: '"Apple cannot verify…" / "malicious software"',
    command:
      'xattr -dr com.apple.quarantine /Applications/ControlCraft.app',
    note:
      'Or use System Settings → Privacy & Security → Open Anyway after the first launch attempt.',
  },
  {
    os: 'windows',
    label: 'Windows',
    problem: 'SmartScreen "Windows protected your PC"',
    command:
      'Unblock-File -Path "$env:USERPROFILE\\Downloads\\ControlCraft-Setup-*.exe"',
    note:
      'Or click "More info → Run anyway" on the SmartScreen dialog. PowerShell command is for IT-managed boxes that block the GUI path.',
  },
  {
    os: 'linux-appimage',
    label: 'Linux (AppImage)',
    problem: 'AppImage won’t launch',
    command:
      'chmod +x ~/Downloads/ControlCraft-*.AppImage && ~/Downloads/ControlCraft-*.AppImage',
  },
  {
    os: 'linux-deb',
    label: 'Linux (.deb)',
    problem: 'apt / dpkg refuses to install',
    command:
      'sudo dpkg -i ~/Downloads/controlcraft_*.deb && sudo apt --fix-broken install',
  },
];

function CodesignBypass({ detectedOs }: { detectedOs: DownloadOs }) {
  // Default-open the snippet matching the visitor's detected OS so
  // they don't have to click around to find their platform.
  const [activeOs, setActiveOs] = useState<DownloadOs>(
    BYPASS_SNIPPETS.find((s) => s.os === detectedOs)?.os ??
      BYPASS_SNIPPETS[0]!.os,
  );
  const active = BYPASS_SNIPPETS.find((s) => s.os === activeOs)!;

  return (
    <section
      aria-labelledby="codesign-heading"
      className="mx-auto mt-12 max-w-3xl rounded-2xl border border-secondary-200 bg-secondary-50 p-5 sm:p-6"
    >
      <header className="flex items-start gap-3">
        <ShieldAlert
          aria-hidden
          className="mt-0.5 h-5 w-5 shrink-0 text-secondary-600"
        />
        <div className="flex-1">
          <h2
            id="codesign-heading"
            className="text-sm font-bold text-text-primary"
          >
            Your OS may flag the installer — here&apos;s the one-line fix
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-text-secondary">
            We&apos;re shipping ControlCraft Desktop before the Apple
            Developer ID notarization + Windows EV Code-Signing
            certificate paperwork clears. The binary is exactly what
            our CI built — no third-party rewrap — so you can safely
            bypass the warning. Tap your OS:
          </p>
        </div>
      </header>

      <div
        role="tablist"
        aria-label="Per-OS bypass commands"
        className="mt-4 flex flex-wrap gap-2"
      >
        {BYPASS_SNIPPETS.map((s) => (
          <button
            key={s.os}
            role="tab"
            aria-selected={s.os === activeOs}
            type="button"
            onClick={() => setActiveOs(s.os)}
            className={
              'rounded-full border px-3 py-1 text-xs font-medium transition ' +
              (s.os === activeOs
                ? 'border-secondary-600 bg-secondary-600 text-white shadow-soft'
                : 'border-border-light bg-bg-primary text-text-secondary hover:border-border-default hover:text-text-primary')
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        <p className="text-2xs font-medium uppercase tracking-[0.14em] text-text-tertiary">
          {active.problem}
        </p>
        <CopyableCommand command={active.command} />
        {active.note && (
          <p className="mt-3 text-xs leading-relaxed text-text-tertiary">
            {active.note}
          </p>
        )}
      </div>

      <p className="mt-5 border-t border-secondary-200/70 pt-4 text-2xs text-text-tertiary">
        This panel retires when our signed builds land. Full
        reference + DMG-mount edge case →{' '}
        <Link
          href={"/install#bypass-codesign" as never}
          className="font-medium text-text-secondary underline-offset-2 hover:text-text-accent hover:underline"
        >
          /install
        </Link>
        .
      </p>
    </section>
  );
}

/**
 * Single-line shell-style block with an inline copy button. Click
 * to copy; the button flips to a check icon for 2s as confirmation.
 */
function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked (non-https / strict policy) — no-op */
    }
  };
  return (
    <div className="mt-2 flex items-stretch overflow-hidden rounded-lg border border-border-light bg-bg-primary">
      <pre className="flex-1 overflow-x-auto px-3 py-2.5 font-mono text-xs leading-relaxed text-text-primary">
        <code>{command}</code>
      </pre>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? 'Copied' : 'Copy command'}
        className={
          'grid place-items-center border-l border-border-light px-3 transition ' +
          (copied
            ? 'bg-accent-50 text-accent-700'
            : 'bg-bg-secondary text-text-tertiary hover:bg-bg-tertiary hover:text-text-secondary')
        }
      >
        {copied ? (
          <Check className="h-4 w-4" />
        ) : (
          <Copy className="h-4 w-4" />
        )}
      </button>
    </div>
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

