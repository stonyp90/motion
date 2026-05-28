//! motion-forge desktop shell.
//!
//! What this does on launch:
//!   1. Pick a free localhost port for the engine.
//!   2. Generate a per-install secret for `MOTION_FORGE_AUTH_FALLBACK_KEY`
//!      — the engine accepts it as a bearer, and the web frontend reads it
//!      from a query parameter the first time it loads so generate/iterate
//!      calls succeed without forcing the user through Keycloak.
//!   3. Spawn the engine sidecar (`motion-forge serve --bind 127.0.0.1:<port>`)
//!      with the right env.
//!   4. Spawn Ollama (`ollama serve`) if it isn't already on :11434.
//!   5. Open the window pointing at the bundled web frontend (in dev:
//!      `http://localhost:3010`; in prod the hosted app URL) with
//!      `?engine=…&token=…` so the web app knows where to talk.
//!
//! Why a per-install fallback secret instead of skipping auth entirely:
//! it keeps the engine's auth surface uniform — production hosting and
//! local desktop use the same middleware. The web app reads the token
//! from the URL once and persists it in localStorage; we never put it on
//! disk in plaintext via Tauri.
//!
//! Sidecars are spawned via plain `std::process::Command` for dev. For
//! the packaged build the binaries come from `src-tauri/binaries/`
//! (see `tauri.conf.json` `externalBin`); Tauri's sidecar API will give
//! us proper signing + macOS notarisation in a follow-up.

use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use rand::Rng;
use serde::Serialize;
use tauri::{Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

mod setup;

/// State shared with Tauri commands so the spawned processes are kept
/// alive (and killed) for the app lifetime.
#[derive(Default)]
pub struct Sidecars {
    children: Mutex<Vec<Child>>,
}

impl Sidecars {
    fn track(&self, child: Child) {
        if let Ok(mut g) = self.children.lock() {
            g.push(child);
        }
    }

    fn shutdown(&self) {
        if let Ok(mut g) = self.children.lock() {
            for mut child in g.drain(..) {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // Auto-update plugin — endpoints + pubkey come from
        // tauri.conf.json. The frontend calls the JS API to check +
        // install; see web/src/components/UpdateBanner.tsx.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Process plugin — gives the frontend a `restart()` capability
        // so the UpdateBanner can relaunch the app after a successful
        // download_and_install.
        .plugin(tauri_plugin_process::init())
        // First-launch wizard commands — frontend invokes these to
        // detect Ollama, probe hardware, recommend a model, and stream
        // pull progress. See web/src/components/FirstRunWizard.tsx.
        .invoke_handler(tauri::generate_handler![
            setup::detect_ollama,
            setup::hw_profile,
            setup::pick_model,
            setup::pull_model,
            setup::first_run_status,
        ])
        .manage(Sidecars::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let engine_port = pick_free_port().unwrap_or(7700);
            let secret = generate_secret();
            log::info!("engine port: {engine_port}");
            log::info!(
                "install secret: {} chars (used as MOTION_FORGE_AUTH_FALLBACK_KEY)",
                secret.len()
            );

            // Spawn engine sidecar.
            match spawn_engine(engine_port, &secret) {
                Ok(child) => {
                    app.state::<Sidecars>().track(child);
                    log::info!("engine sidecar spawned");
                }
                Err(e) => log::error!("failed to spawn engine: {e}"),
            }

            // Spawn Ollama (if not already running).
            match spawn_ollama_if_absent() {
                Ok(Some(child)) => {
                    app.state::<Sidecars>().track(child);
                    log::info!("ollama sidecar spawned");
                }
                Ok(None) => log::info!("ollama already running on :11434 — reusing"),
                Err(e) => log::warn!("ollama sidecar skipped: {e}"),
            }

            // Build the URL with engine + token query params so the web
            // app reconfigures itself for local mode without rebuild.
            // We can hand these to the webview before the engine is
            // actually healthy — React's auth-store / runtime-config
            // consume them on hydrate, and any pre-engine-ready API
            // call will simply 503 with a clear error.
            let frontend = frontend_url();
            let url = format!(
                "{frontend}?engine=http%3A%2F%2F127.0.0.1%3A{engine_port}&token={secret}"
            );
            log::info!("opening window at {url}");

            // Parse + open the window IMMEDIATELY. Previously we
            // synchronously polled the engine's `/healthz` for up to
            // 10s before this line ran — that meant cold-start to
            // first paint took up to 10s. The window now opens as
            // soon as the sidecar is spawned; engine readiness is
            // polled on a background task and signalled via an
            // `engine-ready` Tauri event for the React side to react
            // to once it wires up a listener.
            //
            // The `windows[]` array in tauri.conf.json is intentionally
            // empty so we own window creation here — the URL is
            // per-launch dynamic (engine port + secret), so there's
            // nothing useful to pre-declare statically.
            let parsed: tauri::Url = url.parse().unwrap_or_else(|e| {
                log::error!("URL parse failed ({e}) — falling back to {frontend}");
                frontend.parse().expect("static frontend URL parses")
            });
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(parsed))
                .title("ControlCraft")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 640.0)
                .resizable(true)
                .build()?;

            // Now that the window is opening, kick off the engine
            // health-poll on Tauri's async runtime. When the engine
            // responds healthy we emit `engine-ready` so the frontend
            // can flip into "online" mode. In parallel we fire a
            // best-effort no-op GET against Ollama's `/api/tags` — if
            // the daemon is cold this nudges it to start serving so
            // the first model call doesn't pay a wakeup tax.
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let (engine_ready, _ollama) =
                    tokio::join!(poll_engine_ready(engine_port), wake_ollama());
                let payload = EngineReadyPayload {
                    port: engine_port,
                    healthy: engine_ready,
                };
                if let Err(e) = app_handle.emit("engine-ready", &payload) {
                    log::warn!("emit engine-ready failed: {e}");
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                log::info!("exit requested — killing sidecars");
                if let Some(s) = app_handle.try_state::<Sidecars>() {
                    s.shutdown();
                }
            }
        });
}

/* -------------------------------------------------------- sidecars */

fn spawn_engine(port: u16, secret: &str) -> std::io::Result<Child> {
    let bin = engine_binary_path();
    log::info!("engine binary: {}", bin.display());
    let bind = format!("127.0.0.1:{port}");
    let mut cmd = Command::new(&bin);
    cmd.arg("serve")
        .arg("--bind")
        .arg(&bind)
        .env("MOTION_FORGE_AUTH_FALLBACK_KEY", secret)
        // Per-install data dir so api_keys.json doesn't collide with a
        // hosted engine if the user also runs one for development.
        .env("MOTION_FORGE_DATA_DIR", default_data_dir())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // Prepend the sidecar binaries directory to PATH so the engine's
    // bare-name `Command::new("ffmpeg")` lookups in render/format.rs
    // (and the ffmpeg-sidecar crate in video-io) hit our bundled
    // ffmpeg before whatever happens to be on the user's host PATH.
    // No-op in dev when the binaries dir doesn't exist (the engine
    // falls back to homebrew/system ffmpeg as before).
    if let Some(sidecar_dir) = bin.parent() {
        let existing = std::env::var_os("PATH").unwrap_or_default();
        let mut paths = vec![sidecar_dir.to_path_buf()];
        paths.extend(std::env::split_paths(&existing));
        if let Ok(joined) = std::env::join_paths(paths) {
            cmd.env("PATH", joined);
        }
    }
    let mut child = cmd.spawn()?;
    pipe_to_log("engine", &mut child);
    Ok(child)
}

fn spawn_ollama_if_absent() -> std::io::Result<Option<Child>> {
    if TcpListener::bind("127.0.0.1:11434").is_err() {
        // Port in use — assume Ollama is already running.
        return Ok(None);
    }
    let bin = ollama_binary_path();
    log::info!("ollama binary: {}", bin.display());
    let mut cmd = Command::new(&bin);
    cmd.arg("serve")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn()?;
    pipe_to_log("ollama", &mut child);
    Ok(Some(child))
}

/// Resolve the engine binary. In dev we look in the cargo target dir
/// for the workspace; in prod the binary is unpacked next to the app.
fn engine_binary_path() -> PathBuf {
    // 1. Packaged: side-by-side under Resources/binaries/
    if let Some(side) = sibling_binary("motion-forge") {
        return side;
    }
    // 2. Dev: ../engine/target/{debug,release}/motion-forge
    let manifest = env!("CARGO_MANIFEST_DIR");
    let repo_root = PathBuf::from(manifest)
        .parent() // src-tauri
        .and_then(|p| p.parent()) // desktop
        .map(|p| p.to_path_buf())
        .unwrap_or_default();
    let candidates = [
        repo_root.join("engine/target/debug/motion-forge"),
        repo_root.join("engine/target/release/motion-forge"),
    ];
    for c in candidates {
        if c.exists() {
            return c;
        }
    }
    // 3. Fall back to PATH lookup.
    PathBuf::from("motion-forge")
}

fn ollama_binary_path() -> PathBuf {
    if let Some(side) = sibling_binary("ollama") {
        return side;
    }
    // Homebrew install path on mac dev machines.
    for c in ["/opt/homebrew/bin/ollama", "/usr/local/bin/ollama"] {
        let p = PathBuf::from(c);
        if p.exists() {
            return p;
        }
    }
    PathBuf::from("ollama")
}

fn sibling_binary(name: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let candidate = if cfg!(windows) {
        dir.join(format!("{name}.exe"))
    } else {
        dir.join(name)
    };
    candidate.exists().then_some(candidate)
}

fn pipe_to_log(tag: &'static str, child: &mut Child) {
    if let Some(out) = child.stdout.take() {
        thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                log::info!(target: "sidecar", "[{tag}] {line}");
            }
        });
    }
    if let Some(err) = child.stderr.take() {
        thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                log::warn!(target: "sidecar", "[{tag}] {line}");
            }
        });
    }
}

/* -------------------------------------------------------- helpers */

fn pick_free_port() -> Option<u16> {
    TcpListener::bind("127.0.0.1:0")
        .ok()
        .and_then(|l| l.local_addr().ok())
        .map(|a| a.port())
}

/// 32-char base32-ish secret. Same alphabet as the engine's api_keys
/// (drops visually ambiguous chars).
fn generate_secret() -> String {
    const ALPHABET: &[u8] = b"23456789abcdefghijkmnpqrstuvwxyz";
    let mut rng = rand::thread_rng();
    (0..32)
        .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
        .collect()
}

fn default_data_dir() -> String {
    let base = dirs_like();
    base.to_string_lossy().into_owned()
}

fn dirs_like() -> PathBuf {
    if let Ok(home) = std::env::var("HOME") {
        let p = PathBuf::from(home);
        if cfg!(target_os = "macos") {
            return p.join("Library/Application Support/motion-forge");
        }
        return p.join(".local/share/motion-forge");
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        return PathBuf::from(appdata).join("motion-forge");
    }
    PathBuf::from(".")
}

/// Payload sent on the `engine-ready` event. Carries the port so the
/// frontend can re-confirm which engine it should be talking to (the
/// same one it already got via the `?engine=…` URL param, but having
/// it here means the event is self-contained for any future consumer).
#[derive(Debug, Serialize, Clone)]
struct EngineReadyPayload {
    port: u16,
    /// `false` means we exhausted the polling budget without a healthy
    /// response. We still emit the event so the frontend can choose to
    /// surface a "engine still starting" affordance instead of hanging.
    healthy: bool,
}

/// Poll the engine's `/healthz` endpoint until it returns 200 or we
/// exhaust ~10s of attempts. Runs on Tauri's async runtime so the
/// main thread (and therefore the window paint) is never blocked.
///
/// Returns `true` if the engine came up healthy, `false` if we timed
/// out. Either way the `engine-ready` event is emitted by the caller
/// — the frontend can decide what to do with a `healthy: false`.
async fn poll_engine_ready(port: u16) -> bool {
    let url = format!("http://127.0.0.1:{port}/healthz");
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            log::warn!("engine health client build failed: {e}");
            return false;
        }
    };
    for attempt in 0..40 {
        match client.get(&url).send().await {
            Ok(r) if r.status().is_success() => {
                log::info!("engine healthy after {} attempts ({url})", attempt + 1);
                return true;
            }
            _ => tokio::time::sleep(Duration::from_millis(250)).await,
        }
    }
    log::warn!("engine did not become healthy within ~10s; window already open");
    false
}

/// Fire-and-forget GET against the local Ollama daemon. If it isn't
/// running yet (e.g. we just spawned it) the request will fail — we
/// don't care; the act of attempting the connection nudges the OS
/// scheduler / launchd to wake the daemon up so the first real model
/// call from the UI doesn't pay the full cold-start latency.
async fn wake_ollama() {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => return,
    };
    let _ = client
        .get("http://127.0.0.1:11434/api/tags")
        .send()
        .await;
}

fn frontend_url() -> String {
    // In dev the Next.js server is on :3010. In prod we point at the
    // hosted web frontend (overridable by env so internal testers can
    // pin a staging URL).
    if cfg!(debug_assertions) {
        std::env::var("MOTION_FORGE_FRONTEND_URL")
            .unwrap_or_else(|_| "http://localhost:3010".into())
    } else {
        // Prod default — overridable via env so internal testers can
        // pin a staging URL without rebuilding.
        std::env::var("MOTION_FORGE_FRONTEND_URL").unwrap_or_else(|_| "https://controlcraft.io".into())
    }
}
