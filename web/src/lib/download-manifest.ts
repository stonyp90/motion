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

export const ASSETS: ReadonlyArray<DownloadAsset> = [
  {
    os: 'mac-arm',
    label: 'macOS · Apple silicon',
    detail: 'M1, M2, M3, M4 · macOS 11+',
    sizeMb: 12,
    filename: `ControlCraft_${VERSION}_aarch64.dmg`,
  },
  {
    os: 'mac-intel',
    label: 'macOS · Intel',
    detail: 'macOS 11+',
    sizeMb: 13,
    filename: `ControlCraft_${VERSION}_x64.dmg`,
  },
  {
    os: 'windows',
    label: 'Windows · x64',
    detail: 'Windows 10, 11',
    sizeMb: 14,
    filename: `ControlCraft_${VERSION}_x64_en-US.msi`,
  },
  {
    os: 'linux-deb',
    label: 'Linux · .deb',
    detail: 'Debian, Ubuntu',
    sizeMb: 15,
    filename: `controlcraft_${VERSION}_amd64.deb`,
  },
  {
    os: 'linux-appimage',
    label: 'Linux · AppImage',
    detail: 'Any distro',
    sizeMb: 16,
    filename: `controlcraft_${VERSION}_amd64.AppImage`,
  },
];

export function findAsset(os: DownloadOs): DownloadAsset | undefined {
  return ASSETS.find((a) => a.os === os);
}
