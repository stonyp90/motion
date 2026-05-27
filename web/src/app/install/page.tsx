import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Cpu,
  Download as DownloadIcon,
  ShieldAlert,
  Terminal,
  Zap,
} from 'lucide-react';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export const metadata: Metadata = {
  title: 'Install ControlCraft Desktop · Setup guide',
  description:
    'Install ControlCraft Desktop on macOS, Windows, or Linux. Includes the one-time Ollama install for local vision-model inference.',
};

/**
 * Technical setup guide for the desktop app. Lives under /install
 * (not /docs — that's the public OpenAPI Scalar viewer) and is
 * deliberately engineer-facing: code blocks, exact commands, no
 * marketing chrome.
 *
 * The marketing /download page links here under "Need help?" rather
 * than inlining install instructions that water down the buyer pitch.
 */
export default function InstallPage() {
  return (
    <main className="flex min-h-screen flex-col bg-bg-primary">
      <Header />
      <article className="container flex-1 py-12">
        <div className="mx-auto max-w-2xl">
          <Link
            href={"/download" as never}
            className="mb-8 inline-flex items-center gap-1.5 text-sm text-text-tertiary transition hover:text-text-secondary"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to downloads
          </Link>

          <p className="font-mono text-xs font-medium uppercase tracking-[0.18em] text-accent-700">
            Desktop · Setup
          </p>
          <h1 className="mt-2 text-[36px] font-bold leading-[1.1] tracking-tight text-text-primary sm:text-[44px]">
            Install ControlCraft Desktop
          </h1>
          <p className="mt-3 text-base leading-[1.6] text-text-secondary sm:text-lg">
            Three steps. About five minutes. After this, generation runs
            entirely on your machine — no requests leave your laptop.
          </p>

          <ol className="mt-12 flex flex-col gap-12">
            <Step number={1} icon={<DownloadIcon className="h-4 w-4" />} title="Install the ControlCraft app">
              <p>
                Grab the installer for your OS from{' '}
                <Link
                  href={"/download" as never}
                  className="font-medium text-text-accent underline-offset-2 hover:underline"
                >
                  the downloads page
                </Link>
                . Open the installer and complete the OS prompts. macOS
                users: drag <code className="rounded bg-bg-tertiary px-1 font-mono text-xs">ControlCraft.app</code>{' '}
                into Applications.
              </p>
            </Step>

            <Step number={2} icon={<Terminal className="h-4 w-4" />} title="Install Ollama">
              <p>
                ControlCraft talks to a local LLM through Ollama. The desktop
                shell auto-detects it on first launch but doesn&apos;t
                bundle it — install once, used forever.
              </p>
              <CodeBlock label="macOS · Homebrew">
                brew install ollama
              </CodeBlock>
              <CodeBlock label="macOS · DMG · Linux · Windows">
                {`# Download from https://ollama.com/download
# Run the installer; the \`ollama\` CLI ends up on PATH.`}
              </CodeBlock>
            </Step>

            <Step number={3} icon={<Zap className="h-4 w-4" />} title="Pull a vision model">
              <p>
                ControlCraft uses a vision-capable model so reference images
                actually inform the output. <code className="rounded bg-bg-tertiary px-1 font-mono text-xs">llava</code>{' '}
                is the proven default (~4 GB download).
              </p>
              <CodeBlock label="Pull the default model">
                ollama pull llava
              </CodeBlock>
              <p className="text-sm text-text-tertiary">
                Faster alternatives — pick one that fits your machine:
              </p>
              <ul className="ml-5 list-disc text-sm text-text-secondary [&_code]:rounded [&_code]:bg-bg-tertiary [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs">
                <li>
                  <code>ollama pull llama3.2-vision</code> — sharper JSON
                  output, ~7 GB
                </li>
                <li>
                  <code>ollama pull qwen2-vl</code> — strong image
                  reasoning, ~5 GB
                </li>
                <li>
                  <code>ollama pull llava:13b</code> — higher fidelity,
                  ~8 GB, needs &gt;16 GB RAM
                </li>
              </ul>
            </Step>
          </ol>

          <section className="mt-16 rounded-2xl border border-accent-200 bg-accent-50 p-6">
            <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-text-primary">
              <CheckCircle2 className="h-4 w-4 text-accent-600" />
              You&apos;re ready.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-text-secondary">
              Launch ControlCraft. The first window opens to a prompt and a
              live model chip in the top-right showing{' '}
              <code className="rounded bg-bg-primary px-1 font-mono text-xs">
                llava · loaded · X GB
              </code>{' '}
              once the model is warm. Click Generate to make your first
              motion graphic.
            </p>
          </section>

          {/* --- diagnostic + advanced section ------------------------------- */}
          <section className="mt-16">
            <h2 className="text-xl font-bold tracking-tight text-text-primary">
              Diagnostics + advanced
            </h2>
            <div className="mt-5 flex flex-col gap-5 text-sm leading-relaxed text-text-secondary">
              <Detail title="Hardware recommendations">
                <ul className="ml-5 list-disc">
                  <li>
                    macOS · Apple silicon (M1+) · 16 GB RAM minimum, 32 GB
                    recommended for the 13B-class models.
                  </li>
                  <li>
                    Windows / Linux · NVIDIA GPU with ≥8 GB VRAM for
                    GPU-accelerated inference; CPU-only works but is
                    ~6-10× slower.
                  </li>
                </ul>
              </Detail>

              <Detail title="Verify Ollama is reachable">
                <CodeBlock>{`curl http://127.0.0.1:11434/api/tags
# Should return: {"models":[{"name":"llava:latest", …}]}`}</CodeBlock>
              </Detail>

              <Detail title="Pin a different frontend URL">
                <p>
                  By default the desktop shell loads <code className="rounded bg-bg-tertiary px-1 font-mono text-xs">https://controlcraft.io</code>.
                  To point at a staging build:
                </p>
                <CodeBlock>{`MOTION_FORGE_FRONTEND_URL=https://staging.controlcraft.io open -a ControlCraft`}</CodeBlock>
              </Detail>

              <Detail title="Where data lives">
                <ul className="ml-5 list-disc [&_code]:rounded [&_code]:bg-bg-tertiary [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs">
                  <li>
                    macOS · <code>~/Library/Application Support/ControlCraft/</code>
                  </li>
                  <li>
                    Linux · <code>~/.local/share/ControlCraft/</code>
                  </li>
                  <li>
                    Windows · <code>%APPDATA%\ControlCraft\</code>
                  </li>
                </ul>
                <p className="mt-2">
                  Per-session uploads land in your OS temp dir under{' '}
                  <code className="rounded bg-bg-tertiary px-1 font-mono text-xs">
                    mf-upload-…
                  </code>{' '}
                  and are not retained automatically — export anything you
                  want to keep.
                </p>
              </Detail>

              <Detail
                id="bypass-codesign"
                title="Open the installer when the OS warns it's unsigned"
              >
                <p>
                  We&apos;re shipping ControlCraft Desktop before the
                  Apple Developer ID and EV Code-Signing certificate
                  paperwork clears. Until those land, your OS will
                  flag the installer as &quot;from an unidentified
                  developer.&quot; The binary is exactly what our CI
                  built — no third-party rewrap — so you can safely
                  bypass the warning. Pick the snippet for your
                  platform.
                </p>

                <p className="font-mono text-2xs uppercase tracking-[0.14em] text-text-tertiary">
                  macOS · &quot;Apple cannot verify…&quot; / &quot;malicious software&quot;
                </p>
                <p>
                  The fastest fix: strip the quarantine attribute
                  Apple set when you downloaded the file. This is the
                  same thing Right-click → Open does under the hood,
                  but it works on the un-mounted DMG too.
                </p>
                <CodeBlock label="One-liner — replace path if you renamed it">
                  {`xattr -dr com.apple.quarantine /Applications/ControlCraft.app`}
                </CodeBlock>
                <p>
                  Or via the GUI:{' '}
                  <strong>System Settings → Privacy &amp; Security →
                  scroll to &quot;ControlCraft.app was blocked&quot;
                  → Open Anyway</strong>. macOS 15+ requires you
                  re-confirm with Touch ID after first launch — that
                  unlocks the app for every subsequent open.
                </p>

                <p className="font-mono text-2xs uppercase tracking-[0.14em] text-text-tertiary">
                  macOS · the DMG itself won&apos;t mount
                </p>
                <CodeBlock>{`xattr -dr com.apple.quarantine ~/Downloads/ControlCraft-*.dmg
open ~/Downloads/ControlCraft-*.dmg`}</CodeBlock>

                <p className="font-mono text-2xs uppercase tracking-[0.14em] text-text-tertiary">
                  Windows · SmartScreen &quot;Windows protected your PC&quot;
                </p>
                <p>
                  Click <strong>More info</strong> on the SmartScreen
                  dialog, then <strong>Run anyway</strong>. If
                  PowerShell flags the file with &quot;file came from
                  another computer&quot;, unblock it once:
                </p>
                <CodeBlock label="PowerShell — adjust filename">
                  {`Unblock-File -Path "$env:USERPROFILE\\Downloads\\ControlCraft-Setup-*.exe"`}
                </CodeBlock>
                <p className="text-xs text-text-tertiary">
                  IT-managed laptops may need
                  <code className="mx-1 rounded bg-bg-tertiary px-1 font-mono text-2xs">
                    Set-ExecutionPolicy -Scope CurrentUser
                    -ExecutionPolicy RemoteSigned
                  </code>
                  first. Talk to your sysadmin before relaxing
                  policy.
                </p>

                <p className="font-mono text-2xs uppercase tracking-[0.14em] text-text-tertiary">
                  Linux · .AppImage won&apos;t launch
                </p>
                <CodeBlock>{`chmod +x ~/Downloads/ControlCraft-*.AppImage
~/Downloads/ControlCraft-*.AppImage`}</CodeBlock>

                <p className="font-mono text-2xs uppercase tracking-[0.14em] text-text-tertiary">
                  Linux · .deb refuses to install
                </p>
                <CodeBlock>{`sudo dpkg -i ~/Downloads/controlcraft_*.deb
# If dependencies complain:
sudo apt --fix-broken install`}</CodeBlock>

                <p className="text-xs text-text-tertiary">
                  These steps will retire once our Apple Developer
                  ID notarization and Windows EV Code-Signing cert
                  are live — the installer will then launch with a
                  single click on every platform. Tracked at{' '}
                  <code className="rounded bg-bg-tertiary px-1 font-mono text-2xs">
                    desktop signing certs
                  </code>{' '}
                  in the release runbook.
                </p>
              </Detail>

              <Detail title="Troubleshooting">
                <ul className="ml-5 list-disc">
                  <li>
                    <strong>Local model chip stays grey:</strong> Ollama
                    isn&apos;t running. <code className="rounded bg-bg-tertiary px-1 font-mono text-xs">ollama serve</code>{' '}
                    in a terminal — or restart the desktop, which auto-starts
                    it.
                  </li>
                  <li>
                    <strong>First generate takes ~3 minutes:</strong>{' '}
                    expected. Ollama loads the model into RAM on the first
                    inference; subsequent generates are ~30-60s.
                  </li>
                  <li>
                    <strong>Engine port already in use:</strong> the shell
                    picks a fresh port on every launch — restart fixes it.
                  </li>
                </ul>
              </Detail>
            </div>
          </section>
        </div>
      </article>
      <Footer />
    </main>
  );
}

function Step({
  number,
  icon,
  title,
  children,
}: {
  number: number;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-5">
      <div className="flex flex-col items-center">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-600 font-mono text-sm font-bold text-white">
          {number}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3">
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-text-primary">
          <span className="text-accent-700">{icon}</span>
          {title}
        </h2>
        <div className="flex flex-col gap-3 text-sm leading-relaxed text-text-secondary">
          {children}
        </div>
      </div>
    </li>
  );
}

function CodeBlock({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <p className="font-mono text-2xs uppercase tracking-[0.14em] text-text-tertiary">
          {label}
        </p>
      )}
      <pre className="overflow-x-auto rounded-xl border border-border-light bg-bg-secondary px-4 py-3 text-xs leading-relaxed text-text-primary">
        <code>{children}</code>
      </pre>
    </div>
  );
}

function Detail({
  title,
  children,
  id,
}: {
  title: string;
  children: React.ReactNode;
  /** Anchor id — when set, the section can be deep-linked
   *  (e.g. /install#bypass-codesign) and opens by default. */
  id?: string;
}) {
  const isCodesign = id === 'bypass-codesign';
  return (
    <details
      id={id}
      open={!!id}
      className="rounded-2xl border border-border-light bg-bg-secondary p-4 [&_summary]:cursor-pointer [&_summary]:select-none [&[open]>summary]:mb-3"
    >
      <summary className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        {isCodesign ? (
          <ShieldAlert className="h-3.5 w-3.5 text-secondary-600" />
        ) : (
          <Cpu className="h-3.5 w-3.5 text-text-tertiary" />
        )}
        {title}
      </summary>
      <div className="flex flex-col gap-3">{children}</div>
    </details>
  );
}
