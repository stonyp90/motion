# motion-forge desktop

Tauri 2 shell that turns the motion-forge web app into an OS-native
application (mac / Windows / Linux) and runs the engine + Ollama as
local sidecars so the whole product works offline.

## Status

Scaffold + sidecar boot logic landed. First launch:

1. Picks a free localhost port for the engine.
2. Generates a per-install secret used as the engine's auth fallback
   so generate / iterate calls succeed without a Keycloak login.
3. Spawns `motion-forge serve --bind 127.0.0.1:<port>` as a child
   process.
4. Spawns `ollama serve` if `127.0.0.1:11434` is free (otherwise reuses
   the host install).
5. Opens the window pointing at the web frontend with
   `?engine=…&token=…` query params so the web app can swap into
   local mode (web-side wiring is the next commit).

## Dev workflow

You need:

- Rust ≥ 1.77.2 (the engine workspace already enforces this)
- Node ≥ 20
- Ollama on `$PATH` (or already running on :11434)
- The motion-forge engine binary in `engine/target/{debug,release}/motion-forge` (this is the default `cargo build` output)
- The Next.js web app running on `localhost:3010`

Then from this directory:

```bash
npm install
npm run dev
```

Tauri opens a native window at `localhost:3010` with the engine override
threaded through the URL.

## Production build

```bash
npm run build
```

Produces installers in `src-tauri/target/release/bundle/`:

| Platform | Output                  |
| -------- | ----------------------- |
| macOS    | `dmg/`, `macos/.app`    |
| Windows  | `msi/`, `nsis/`         |
| Linux    | `deb/`, `appimage/`     |

Cross-platform builds are wired in `.github/workflows/desktop-release.yml`
(see task #59).

## Sidecar bundling (production)

`ollama` is bundled as a Tauri `externalBin`. The release CI fetches
the pinned binary per platform via `scripts/fetch-ollama.sh`, drops it
into `src-tauri/binaries/`, and `tauri build` co-signs it with the app.
Local builds can do the same:

```bash
./scripts/fetch-ollama.sh aarch64-apple-darwin    # or your target triple
npm run build
```

The pin lives at `desktop/ollama-pins.json` (version + per-platform
SHA-256). Bump the version + checksums in one commit. The script
refuses to proceed if the SHA is still the `TODO_…` placeholder, so a
typo or registry compromise can't slip in unnoticed.

The engine sidecar (`motion-forge`) is still PATH-resolved. Folding it
into the installer is pending a portable Python story for the
segmentation + render sidecars.

## First-launch wizard

On the very first launch (no `?onboarded=1` URL flag, no
`mf-desktop-onboarded` localStorage entry), `web/src/components/FirstRunWizard.tsx`
shows a modal that:

1. Probes the bundled Ollama via `tauri::invoke('first_run_status')`.
2. Profiles the machine (RAM, CPU, Apple silicon flag) — see
   `src-tauri/src/setup.rs::hw_profile`.
3. Recommends a vision model sized to the hardware tier.
4. Discloses the disk-space cost.
5. Streams `POST /api/pull` NDJSON progress events from Ollama back
   to a React progress bar.
6. Marks `mf-desktop-onboarded` and dismisses; the model lives in
   `~/.ollama/models` so a host Ollama install can share it.

ESC closes without flagging — next launch will re-offer.

## Environment overrides

| Env                            | Purpose                                                   |
| ------------------------------ | --------------------------------------------------------- |
| `MOTION_FORGE_FRONTEND_URL`    | Override the URL the window opens (defaults to `localhost:3010` in dev, `app.motion-forge.io` in prod). |
| `MOTION_FORGE_DATA_DIR`        | Inherited by the engine sidecar — where API keys + uploads live. |

## Roadmap

- [ ] Web-side runtime override (read `?engine=` + `?token=` on first
      paint, persist to localStorage, swap the bearer)
- [x] First-launch model setup (`scripts/fetch-ollama.sh` bundles
      Ollama; `setup.rs` + `FirstRunWizard.tsx` handle the model pull)
- [ ] Engine sidecar bundling — pending portable Python story
- [x] Auto-update via Tauri Updater pointed at the GitHub Releases feed
- [ ] Code-signing + macOS notarisation
- [ ] System tray + status bar showing engine + Ollama health
