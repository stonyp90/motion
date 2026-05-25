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

For production builds we still need to ship `motion-forge` and `ollama`
inside the installer rather than relying on the user having them
installed. The mechanism is Tauri's `bundle.externalBin` config; the
binaries land in `Resources/binaries/` (or `Contents/Resources/` on macOS)
next to the app executable.

The current `tauri.conf.json` does **not** include the `externalBin`
entry — `tauri build` would otherwise fail if the binaries aren't there.
To package:

1. Build the engine for the target triple:
   `cargo build --release -p motion-forge-cli --bin motion-forge`
2. Copy / symlink the binaries into `src-tauri/binaries/` with the
   triple suffix Tauri expects, e.g.
   `motion-forge-aarch64-apple-darwin` + `ollama-aarch64-apple-darwin`.
3. Add the entry back to `tauri.conf.json`:
   ```json
   "externalBin": ["binaries/motion-forge", "binaries/ollama"]
   ```
4. `npm run build`.

The release CI workflow handles steps 1-3 automatically per platform.

## Environment overrides

| Env                            | Purpose                                                   |
| ------------------------------ | --------------------------------------------------------- |
| `MOTION_FORGE_FRONTEND_URL`    | Override the URL the window opens (defaults to `localhost:3010` in dev, `app.motion-forge.io` in prod). |
| `MOTION_FORGE_DATA_DIR`        | Inherited by the engine sidecar — where API keys + uploads live. |

## Roadmap

- [ ] Web-side runtime override (read `?engine=` + `?token=` on first
      paint, persist to localStorage, swap the bearer)
- [ ] First-launch Ollama auto-install (download if not on PATH)
- [ ] Auto-update via Tauri Updater pointed at the GitHub Releases feed
- [ ] Code-signing + macOS notarisation
- [ ] System tray + status bar showing engine + Ollama health
