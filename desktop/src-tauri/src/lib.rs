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
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

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

            // Best-effort: wait up to 10s for the engine to become healthy
            // before opening the window so the first paint isn't a 503.
            wait_for_engine(engine_port);

            // Build the URL with engine + token query params so the web
            // app reconfigures itself for local mode without rebuild.
            let frontend = frontend_url();
            let url = format!(
                "{frontend}?engine=http%3A%2F%2F127.0.0.1%3A{engine_port}&token={secret}"
            );
            log::info!("opening window at {url}");

            // Parse + open. The `windows[]` array in tauri.conf.json
            // is intentionally empty so we own window creation here —
            // the URL is per-launch dynamic (engine port + secret), so
            // there's nothing useful to pre-declare statically.
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

fn wait_for_engine(port: u16) {
    let url = format!("http://127.0.0.1:{port}/healthz");
    for attempt in 0..40 {
        match std::net::TcpStream::connect_timeout(
            &format!("127.0.0.1:{port}").parse().unwrap(),
            Duration::from_millis(250),
        ) {
            Ok(_) => {
                log::info!("engine healthy after {} attempts ({url})", attempt + 1);
                return;
            }
            Err(_) => std::thread::sleep(Duration::from_millis(250)),
        }
    }
    log::warn!("engine did not become healthy within ~10s; opening window anyway");
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
