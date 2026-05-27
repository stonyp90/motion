# macOS code-signing & Gatekeeper bypass — quick reference

## What "the codesign error" actually is

When a macOS user downloads a `.dmg` from the web, the browser stamps
the file with `com.apple.quarantine`. On first launch Gatekeeper
checks that bit, then asks notarytool whether the binary inside is
notarised by Apple. If the binary is unsigned or signed by an
identity Apple doesn't recognise, Gatekeeper blocks with one of:

- *"ControlCraft cannot be opened because Apple cannot verify that it
  is free of malware."*
- *"ControlCraft is damaged and can't be opened."* (macOS 14+)
- *"This application is from an unidentified developer."*

This is **not** a real malware verdict — it just means we haven't
notarised the build yet. Three bypass tiers, ordered cheapest to most
robust:

## Tier 1 · User-side bypass (free, terminal one-liner)

This is what `/install#bypass-codesign` documents and what the
`fix-quarantine-mac.sh` helper automates:

```bash
xattr -dr com.apple.quarantine /Applications/ControlCraft.app
```

After that, `open /Applications/ControlCraft.app` (or double-click)
launches without the warning. Strips the quarantine bit — Apple's
documented sanctioned bypass; same thing Right-click → Open does
under the hood. Works on `.dmg` files too (strip before mounting).

The convenience script ships at `desktop/scripts/fix-quarantine-mac.sh`:

```bash
./scripts/fix-quarantine-mac.sh                            # auto-detect
./scripts/fix-quarantine-mac.sh ~/Downloads/ControlCraft.dmg   # explicit
```

Safe to re-run; idempotent.

## Tier 2 · Right-click → Open (free, GUI)

For users who won't open a terminal:

1. After downloading, do NOT double-click. Right-click (or
   Control-click) → **Open**.
2. macOS shows a dialog warning about the unsigned binary; click
   **Open** again.
3. macOS 15+ requires you re-confirm with Touch ID once. After that,
   the app is whitelisted for every subsequent launch.

If macOS refused to mount the .dmg in the first place, run the
xattr command above on the .dmg file first.

## Tier 3 · Apple Developer ID + notarisation (proper fix)

This is the only path that ships a build with **zero** warnings.
Cost: USD $99/year + ~1 hour of one-time setup. Pipeline is already
wired in `.github/workflows/desktop-release.yml` — it activates the
moment the secrets land.

### One-time setup

1. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/enroll/).
2. In Xcode → Settings → Accounts, generate a **Developer ID
   Application** certificate. Export the `.p12` (set a strong password).
3. Generate an app-specific password at
   <https://appleid.apple.com/account/manage>. This is for `notarytool`.
4. In your GitHub repo → Settings → Secrets → Actions, add:

   | Secret | Value |
   |---|---|
   | `APPLE_CERTIFICATE` | base64 of the `.p12` file |
   | `APPLE_CERTIFICATE_PASSWORD` | password from step 2 |
   | `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Your Name (TEAM12345)` |
   | `APPLE_ID` | your Apple ID email |
   | `APPLE_PASSWORD` | the app-specific password from step 3 |
   | `APPLE_TEAM_ID` | the 10-character team ID |

   ```bash
   # base64-encoding the .p12 for the secret value:
   base64 -i developer_id.p12 | pbcopy
   ```

5. Tag the next release: `git tag desktop-v0.2.0 && git push origin desktop-v0.2.0`.
6. The CI step in `desktop-release.yml` detects `APPLE_CERTIFICATE` is
   populated, enters the signing block, signs every Mach-O in the
   bundle (including the bundled `ollama` sidecar — Tauri does this
   automatically for everything in `externalBin`), notarises with
   `notarytool`, and staples the result. The `.dmg` users download
   then launches with zero warnings.

### Local pre-flight check

Before tagging the release, you can dry-run the signing locally:

```bash
cd desktop
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAM12345)"
export APPLE_ID="..."
export APPLE_PASSWORD="..."
export APPLE_TEAM_ID="..."
npm run tauri -- build
codesign --verify --verbose=4 src-tauri/target/release/bundle/macos/ControlCraft.app
spctl --assess --type execute --verbose src-tauri/target/release/bundle/macos/ControlCraft.app
```

The `spctl` check is the same one Gatekeeper runs. `accepted` means
the build will launch cleanly on any Mac.

## What we've already done so this works the moment the cert lands

- `desktop/src-tauri/entitlements.plist` — hardened-runtime entitlements
  matching the engine + Ollama sidecar's needs (JIT, dyld env vars,
  library validation off for the unsigned sidecar). Notarisation
  rejects builds that ask for entitlements they don't need *and*
  builds that need entitlements they didn't declare.
- `tauri.conf.json` macOS block now sets `hardenedRuntime: true` and
  `entitlements: "entitlements.plist"`.
- `.github/workflows/desktop-release.yml` already has the conditional
  signing block (`if [ -n "${{ secrets.APPLE_CERTIFICATE }}" ]`).
  When the secret is empty it builds unsigned + emits a
  `::notice::APPLE_CERTIFICATE secret not set` — explicit, not
  silent.

## Windows + Linux notes

Same logic applies on Windows: SmartScreen blocks unsigned `.msi`/`.exe`
until you click *More info → Run anyway* or `Unblock-File` the
download. The CI also has a conditional EV-signing block; populate
`WINDOWS_CERT_*` secrets to skip the warning there too.

Linux .deb and .AppImage have no Gatekeeper equivalent — `chmod +x`
and run.
