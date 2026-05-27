# ControlCraft desktop — local dev

Tauri 2 shell. Wraps the motion-forge web app and spawns the engine +
Ollama as local sidecars. Architecture in `README.md`; this is the fast
path to "running on my laptop".

## One-time setup

- Rust ≥ 1.77.2 (`rustup`)
- Node ≥ 20
- Ollama on `:11434` (`brew install ollama`)
- Engine binary at `engine/target/{debug,release}/motion-forge`
  (produced by `cargo build` in the engine workspace)

## Stage the Ollama sidecar (per target triple)

Tauri's `externalBin` step needs the host-triple Ollama binary in
`src-tauri/binaries/`. Apple silicon:

```bash
cp /opt/homebrew/bin/ollama \
   desktop/src-tauri/binaries/ollama-aarch64-apple-darwin
```

CI handles other targets via `scripts/fetch-ollama.sh <target-triple>`,
which verifies SHA-256 against `desktop/ollama-pins.json` first.

## Run dev mode

Start Next.js on `:3010` first (`cd web && next dev -p 3010`). Then from
`desktop/`:

```bash
npm run dev    # = tauri dev
```

Compiles a debug binary, spawns the engine sidecar on a free port,
reuses host Ollama, opens a webview at `http://localhost:3010`. Web
edits hot-reload via Next.js; Rust edits trigger rebuild + relaunch.

## Build a packaged `.app` (for visual verification)

`tauri dev` produces `target/debug/controlcraft` which is NOT registered
with LaunchServices — Spotlight, the computer-use MCP, etc. can't see
it. For a proper bundle:

```bash
cd desktop
npm run tauri -- build --debug
```

Output:

```
desktop/src-tauri/target/debug/bundle/macos/ControlCraft.app
desktop/src-tauri/target/debug/bundle/dmg/ControlCraft_0.1.0_aarch64.dmg
```

Layout (Tauri 2 puts macOS externalBins in `MacOS/`, not
`Resources/binaries/`):

```
ControlCraft.app/Contents/
├── Info.plist            # CFBundleIdentifier = io.controlcraft.desktop
├── MacOS/{controlcraft, ollama}   # both arm64 Mach-O, ad-hoc signed
└── Resources/icon.icns
```

Launch + verify:

```bash
open desktop/src-tauri/target/debug/bundle/macos/ControlCraft.app
pgrep -fl ControlCraft.app
```

The "A public key has been found, but no private key" tail message is
the updater warning about `TAURI_SIGNING_PRIVATE_KEY` not being set —
harmless for dev, required only for signed releases.

## Environment overrides

| Env                         | Purpose                                                |
| --------------------------- | ------------------------------------------------------ |
| `MOTION_FORGE_FRONTEND_URL` | Window URL. Dev default: `http://localhost:3010`. Prod default: `https://controlcraft.io`. |
| `MOTION_FORGE_DATA_DIR`     | Passed to engine (api_keys.json + uploads).            |
| `TAURI_SIGNING_PRIVATE_KEY` | Required for signed updater artifacts; leave unset locally. |

Pointing the dev binary at the deployed site
(`MOTION_FORGE_FRONTEND_URL=https://www.controlcraft.io`) loads whatever
CSS bundle is currently deployed, not your local changes — if the page
looks wrong, check that first.
