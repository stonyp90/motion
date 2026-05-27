# Desktop auto-update runbook

ControlCraft Desktop ships with Tauri 2's built-in updater plugin. Every
launch the app calls `/api/updater/{target-arch}/{current_version}` on
controlcraft.io; if a newer signed release is available the bundled
`UpdateBanner` component (`web/src/components/UpdateBanner.tsx`) prompts
the user to install + restart.

## Architecture

```
                            ┌──────────────────────────────────┐
                            │  github.com/owner/repo/releases  │
                            │  (binaries + .sig files)         │
                            └──────────────┬───────────────────┘
                                           │ URL embedded in
                                           ▼
   ┌────────────────────────┐   reads    ┌──────────────────────────────────┐
   │ web/public/desktop-    │ ◀──────────│  web/src/app/api/updater/...     │
   │ updates/manifest.json  │            │  (Next.js route)                 │
   │ (committed by CI)      │            └──────────────┬───────────────────┘
   └────────────────────────┘                           │ responds JSON
                                                       ▼
                            ┌──────────────────────────────────┐
                            │ tauri-plugin-updater (in app)    │
                            │ verifies signature via pubkey    │
                            │ → tauri-plugin-process restart   │
                            └──────────────────────────────────┘
```

## One-time setup

1. **Generate a signing keypair** (already done once for this repo):
   ```bash
   cd desktop
   npx tauri signer generate --write-keys .tauri-keys/key
   ```
   Outputs:
   - `desktop/.tauri-keys/key` — **PRIVATE**, never commit. Already in `.gitignore`.
   - `desktop/.tauri-keys/key.pub` — public, lives inside `tauri.conf.json`'s `plugins.updater.pubkey`.

2. **Add the private key to GitHub Actions** as a repo secret:
   - Name: `TAURI_SIGNING_PRIVATE_KEY`
   - Value: the **full file contents** of `desktop/.tauri-keys/key` (multi-line base64 blob, no password set).
   - If the key has a password, also set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

3. **Verify** the `pubkey` field in `desktop/src-tauri/tauri.conf.json` matches your `key.pub` file contents (base64, single line). Already wired for the keypair generated in step 1.

## Release flow

Tag a release with the `desktop-v*` pattern:
```bash
git tag desktop-v0.2.0
git push origin desktop-v0.2.0
```

That triggers `.github/workflows/desktop-release.yml`:

1. **Matrix build** (4 legs: macOS arm64, macOS x86_64, Windows x86_64, Linux x86_64). Each leg:
   - Fetches the pinned Ollama sidecar via `desktop/scripts/fetch-ollama.sh`.
   - Runs `tauri build` with `TAURI_SIGNING_PRIVATE_KEY` populated → emits `.sig` files next to each `.app.tar.gz` / `.nsis.zip` / `.AppImage.tar.gz`.
   - Uploads installers AND signature siblings to a draft GitHub Release.
   - Writes a per-platform fragment (`updater-fragments/<platform>.json`) capturing the artifact URL + signature.
2. **`merge-manifest` job** (after all legs):
   - Pulls every fragment, merges them into one manifest at `web/public/desktop-updates/manifest.json`.
   - Commits the manifest to `main` so the Next.js updater route picks it up on the next deploy.

## What ships in the manifest

```jsonc
{
  "version": "0.2.0",
  "notes": "ControlCraft Desktop desktop-v0.2.0 — see ...",
  "pub_date": "2026-05-27T12:34:56Z",
  "platforms": {
    "darwin-aarch64":  { "url": ".../ControlCraft_0.2.0_aarch64.app.tar.gz",  "signature": "..." },
    "darwin-x86_64":   { "url": ".../ControlCraft_0.2.0_x64.app.tar.gz",      "signature": "..." },
    "windows-x86_64":  { "url": ".../ControlCraft_0.2.0_x64-setup.nsis.zip",  "signature": "..." },
    "linux-x86_64":    { "url": ".../controlcraft_0.2.0_amd64.AppImage.tar.gz", "signature": "..." }
  }
}
```

## Verifying auto-update locally

1. Build a debug `.app`: `npm run tauri -- build --debug`.
2. Bump `version` in `desktop/src-tauri/tauri.conf.json` from `0.1.0` to e.g. `0.2.0`.
3. Sign a dummy installer:
   ```bash
   TAURI_SIGNING_PRIVATE_KEY_PATH=desktop/.tauri-keys/key \
     npx tauri signer sign --no-password some-fake-installer.app.tar.gz
   ```
4. Edit `web/public/desktop-updates/manifest.json` to point at the fake installer URL + paste the `.sig` content.
5. Launch the **0.1.0** debug `.app` against the local Next.js server. The UpdateBanner appears within a few seconds.

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Banner never appears | `/api/updater/...` returning 204 | Manifest's `version` matches current; bump it. |
| `Update signature failed verification` | Pubkey/private key mismatch | Regenerate keypair; update both `tauri.conf.json` AND CI secret. |
| Banner appears but install hangs | Artifact URL 404s | GitHub Release is still in `draft` state; flip to published. |
| Restart doesn't relaunch | `tauri-plugin-process` not initialized | Confirm `.plugin(tauri_plugin_process::init())` in `lib.rs` + `"process:default"` in `capabilities/default.json`. |
