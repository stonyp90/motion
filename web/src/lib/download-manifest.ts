/**
 * Desktop download manifest.
 *
 * The repo is private, so we don't link out to GitHub Releases.
 * Instead the desktop CI uploads installers to a private storage
 * origin (Azure Blob with a CDN edge, R2, S3 + CloudFront, etc.)
 * and the manifest below names the exact filename per platform.
 *
 * The `ControlCraft_DOWNLOAD_BASE` env var points at that origin's URL
 * prefix; the per-platform asset path is appended. When the env
 * var is unset (fresh clone, local dev) the `/api/download/<os>`
 * route returns 503 with a friendly "build pending" message so
 * the user sees an honest state instead of a 404.
 *
 * Asset filenames follow Tauri's defaults:
 *   macOS .dmg → `ControlCraft_<version>_<arch>.dmg`
 *   Windows .msi → `ControlCraft_<version>_<arch>_en-US.msi`
 *   Linux .deb → `controlcraft_<version>_<arch>.deb`
 *   Linux .AppImage → `controlcraft_<version>_<arch>.AppImage`
 *
 * Update VERSION + ASSETS whenever a new `desktop-v*` tag is cut.
 * Future-proof option: have the CI write a generated `.ts` here
 * from `desktop/src-tauri/Cargo.toml` so the manifest stays in
 * sync without manual edits.
 */

export const VERSION = '0.1.0';

export type DownloadOs =
  | 'mac-arm'
  | 'mac-intel'
  | 'windows'
  | 'linux-deb'
  | 'linux-appimage';

export interface DownloadAsset {
  os: DownloadOs;
  label: string;
  detail: string;
  /** Approximate installer size — used for the download chip label. */
  sizeMb: number;
  /** Filename uploaded by `desktop-release.yml`. */
  filename: string;
}

// Sizes + filenames verified against the rc5 GitHub Release on
// 2026-05-27 — see the matching tag at
// https://github.com/stonyp90/motion/releases/tag/desktop-v0.1.0-rc5.
// Tauri derives the filename prefix from `productName` in
// tauri.conf.json (= "ControlCraft" — capital C) for every target,
// so all five entries below use the same casing. Sizes are the actual
// byte sizes reported by the GitHub Releases API rounded to whole MB.
export const ASSETS: ReadonlyArray<DownloadAsset> = [
  {
    os: 'mac-arm',
    label: 'macOS · Apple silicon',
    detail: 'M1, M2, M3, M4 · macOS 11+',
    sizeMb: 58,
    filename: `ControlCraft_${VERSION}_aarch64.dmg`,
  },
  {
    os: 'mac-intel',
    label: 'macOS · Intel',
    detail: 'macOS 11+',
    sizeMb: 58,
    filename: `ControlCraft_${VERSION}_x64.dmg`,
  },
  {
    os: 'windows',
    label: 'Windows · x64',
    detail: 'Windows 10, 11',
    sizeMb: 83,
    filename: `ControlCraft_${VERSION}_x64_en-US.msi`,
  },
  {
    os: 'linux-deb',
    label: 'Linux · .deb',
    detail: 'Debian, Ubuntu',
    sizeMb: 87,
    filename: `ControlCraft_${VERSION}_amd64.deb`,
  },
  {
    os: 'linux-appimage',
    label: 'Linux · AppImage',
    detail: 'Any distro',
    sizeMb: 149,
    filename: `ControlCraft_${VERSION}_amd64.AppImage`,
  },
];

export function findAsset(os: DownloadOs): DownloadAsset | undefined {
  return ASSETS.find((a) => a.os === os);
}

/**
 * Best-effort browser detection. Returns the asset key matching the
 * visitor's OS. Apple silicon is the default for any Mac because the
 * userAgent doesn't reliably distinguish — Intel users still see the
 * mac-intel card in any secondary grid below.
 *
 * SSR-safe: returns a stable `mac-arm` when called without `navigator`.
 */
export function detectOs(): DownloadOs {
  if (typeof navigator === 'undefined') return 'mac-arm';
  const ua = navigator.userAgent || '';
  const plat = (navigator.platform || '').toLowerCase();
  if (/win/i.test(ua) || plat.includes('win')) return 'windows';
  if (/linux/i.test(ua) || plat.includes('linux')) return 'linux-deb';
  if (/mac/i.test(ua) || plat.includes('mac')) return 'mac-arm';
  return 'mac-arm';
}
