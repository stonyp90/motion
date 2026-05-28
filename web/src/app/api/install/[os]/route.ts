import { NextRequest, NextResponse } from 'next/server';
import { VERSION } from '@/lib/download-manifest';

/**
 * GET /api/install/:os → bash/PowerShell install script.
 *
 * Users run a one-liner like
 *
 *   curl -fsSL https://controlcraft.io/api/install/mac | bash
 *
 * which fetches the right installer for their platform, copies the
 * .app into /Applications, strips the macOS quarantine attribute,
 * and ejects the dmg. The key trick: `curl`-downloaded files
 * **never** get the `com.apple.quarantine` extended attribute (only
 * browsers set it on downloads). So the whole chain is
 * Gatekeeper-free without needing an Apple Developer ID.
 *
 * The Windows variant emits PowerShell that does the equivalent
 * `Unblock-File` + Start-Process. Linux just chmod+xes the AppImage
 * (no Gatekeeper analogue).
 *
 * Cache: short (60 s) so a fresh release auto-cuts over without
 * users hitting a stale script.
 */

// Mac Intel removed — no Intel binary is currently shipped (see
// download-manifest.ts comment). The `mac` alias still works and
// maps to Apple silicon. If an Intel user explicitly passes
// `mac-intel`, fall through to a 404 so they get an honest signal.
const VALID = ['mac', 'mac-arm', 'windows', 'linux'] as const;

interface Params {
  params: Promise<{ os: string }>;
}

export async function GET(req: NextRequest, { params }: Params) {
  const { os } = await params;
  if (!VALID.includes(os as (typeof VALID)[number])) {
    return new NextResponse(`unknown platform: ${os}`, { status: 404 });
  }

  const base = `${req.nextUrl.origin}`;

  if (os === 'mac' || os === 'mac-arm') {
    // Apple silicon only — `mac` aliases to it. Mac Intel is not
    // currently shipped (see download-manifest.ts).
    const script = macScript({ downloadUrl: `${base}/api/download/mac-arm` });
    return new NextResponse(script, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
        'X-Install-Os': 'macos',
        'X-Install-Version': VERSION,
      },
    });
  }

  if (os === 'windows') {
    const script = windowsScript({ downloadUrl: `${base}/api/download/windows` });
    return new NextResponse(script, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
        'X-Install-Os': 'windows',
        'X-Install-Version': VERSION,
      },
    });
  }

  // linux
  const script = linuxScript({ downloadUrl: `${base}/api/download/linux-appimage` });
  return new NextResponse(script, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
      'X-Install-Os': 'linux',
      'X-Install-Version': VERSION,
    },
  });
}

function macScript({ downloadUrl }: { downloadUrl: string }): string {
  return `#!/usr/bin/env bash
# ControlCraft macOS installer — Gatekeeper-bypass edition.
#
# Run with:
#   curl -fsSL https://controlcraft.io/api/install/mac | bash
#
# How it bypasses the codesign warning without notarisation:
#   1. \`curl\` downloads do NOT get the macOS quarantine bit (only
#      browser downloads do), so the .dmg never trips Gatekeeper.
#   2. We strip quarantine from the .app post-copy as a belt-and-braces
#      measure for users whose corporate proxies inject the bit anyway.
#   3. /Applications/ControlCraft.app launches with no warning.

set -euo pipefail

APP_NAME="ControlCraft"
DMG_URL="${downloadUrl}"
TMP_DIR="$(mktemp -d -t controlcraft-install)"
DMG_PATH="\$TMP_DIR/ControlCraft.dmg"
MOUNTPOINT="\$TMP_DIR/mnt"

cleanup() {
  if mount | grep -q "\$MOUNTPOINT"; then
    hdiutil detach "\$MOUNTPOINT" -quiet || true
  fi
  rm -rf "\$TMP_DIR" || true
}
trap cleanup EXIT

echo "→ downloading ControlCraft installer"
curl --fail --location --progress-bar --output "\$DMG_PATH" "\$DMG_URL"

# Even though curl downloads are quarantine-free by default, strip
# the attribute explicitly so corporate-managed Macs (where the EDR
# might inject one) stay on the happy path.
xattr -dr com.apple.quarantine "\$DMG_PATH" 2>/dev/null || true

echo "→ mounting"
mkdir -p "\$MOUNTPOINT"
hdiutil attach "\$DMG_PATH" -mountpoint "\$MOUNTPOINT" -quiet -nobrowse -noverify -noautoopen

if [ ! -d "\$MOUNTPOINT/\$APP_NAME.app" ]; then
  echo "error: \$APP_NAME.app not found inside the .dmg" >&2
  ls -la "\$MOUNTPOINT" >&2
  exit 1
fi

DEST="/Applications/\$APP_NAME.app"
if [ -e "\$DEST" ]; then
  echo "→ removing previous install at \$DEST"
  rm -rf "\$DEST"
fi

echo "→ copying to /Applications"
cp -R "\$MOUNTPOINT/\$APP_NAME.app" /Applications/

echo "→ stripping quarantine (belt-and-braces)"
xattr -dr com.apple.quarantine "\$DEST" 2>/dev/null || true

echo "→ unmounting"
hdiutil detach "\$MOUNTPOINT" -quiet
trap - EXIT
cleanup

echo
echo "✓ installed: \$DEST"
echo
echo "Launch with:  open \$DEST"
echo "Or click the icon in /Applications."
`;
}

function windowsScript({ downloadUrl }: { downloadUrl: string }): string {
  return `# ControlCraft Windows installer — Unblock-File + run.
#
# Run with (PowerShell):
#   iwr -useb https://controlcraft.io/api/install/windows | iex
#
# How it bypasses SmartScreen:
#   1. \`Invoke-WebRequest\` downloads don't set the Mark-of-the-Web
#      zone identifier, so the binary doesn't trip SmartScreen.
#   2. We Unblock-File post-download as a belt-and-braces measure
#      for tenants where AppLocker or Defender re-stamps the file.

$ErrorActionPreference = 'Stop'

$DownloadUrl = '${downloadUrl}'
$TmpDir      = Join-Path $env:TEMP "controlcraft-install"
New-Item -ItemType Directory -Force -Path $TmpDir | Out-Null

$Installer = Join-Path $TmpDir "ControlCraft-Setup.exe"

Write-Host "-> downloading ControlCraft installer"
Invoke-WebRequest -Uri $DownloadUrl -OutFile $Installer -UseBasicParsing

Write-Host "-> unblocking (belt-and-braces)"
Unblock-File -Path $Installer

Write-Host "-> launching installer (silent)"
Start-Process -FilePath $Installer -ArgumentList '/passive','/norestart' -Wait

Write-Host ""
Write-Host "[ok] ControlCraft installed."
`;
}

function linuxScript({ downloadUrl }: { downloadUrl: string }): string {
  return `#!/usr/bin/env bash
# ControlCraft Linux installer — fetches the AppImage, makes it
# executable, and drops a desktop entry so the icon shows up in
# the launcher.
#
# Run with:
#   curl -fsSL https://controlcraft.io/api/install/linux | bash

set -euo pipefail

DOWNLOAD_URL="${downloadUrl}"
INSTALL_DIR="\${XDG_DATA_HOME:-\$HOME/.local/share}/controlcraft"
APP_PATH="\$INSTALL_DIR/ControlCraft.AppImage"
DESKTOP_FILE="\${XDG_DATA_HOME:-\$HOME/.local/share}/applications/controlcraft.desktop"

mkdir -p "\$INSTALL_DIR"
mkdir -p "\$(dirname "\$DESKTOP_FILE")"

echo "→ downloading ControlCraft AppImage"
curl --fail --location --progress-bar --output "\$APP_PATH" "\$DOWNLOAD_URL"

chmod +x "\$APP_PATH"

cat > "\$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=ControlCraft
Comment=Prompt-based motion graphics — local engine + local models
Exec="\$APP_PATH" %u
Icon=controlcraft
Terminal=false
Categories=Graphics;AudioVideo;
EOF

echo
echo "✓ installed: \$APP_PATH"
echo "✓ desktop entry: \$DESKTOP_FILE"
echo
echo "Launch with:  \"\$APP_PATH\""
echo "Or find ControlCraft in your application launcher."
`;
}
