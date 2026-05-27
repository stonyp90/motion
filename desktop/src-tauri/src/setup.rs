//! First-launch wizard backend.
//!
//! The user-visible promise is "ControlCraft just works." Behind that
//! promise this module:
//!
//!   1. Detects whether a host Ollama is already on `:11434`.
//!      - If yes, lists installed models so the wizard can skip ahead.
//!   2. Profiles the machine (RAM bucket, Apple silicon flag).
//!   3. Recommends a vision model for that hardware tier.
//!   4. Streams `POST /api/pull` NDJSON progress events back to the
//!      Tauri frontend over a Tauri event channel so a React component
//!      can render a clean progress bar.
//!
//! All commands are wired into `lib.rs`'s `tauri::generate_handler!`.
//! The frontend (web/src/components/FirstRunWizard.tsx) gates on
//! `window.__TAURI__` so this whole flow stays invisible on the hosted
//! web build.

use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use sysinfo::System;
use tauri::{AppHandle, Emitter};

const OLLAMA_HOST: &str = "http://127.0.0.1:11434";
/// Tauri event name the frontend listens on for streaming progress.
pub const SETUP_PROGRESS_EVENT: &str = "setup://progress";

/* -------------------------------------------------- Detect existing host */

#[derive(Debug, Serialize)]
pub struct OllamaStatus {
    /// True if we got a 200 from `/api/tags`.
    pub reachable: bool,
    /// Daemon version (e.g. "0.3.14") when reachable; empty otherwise.
    pub version: String,
    /// Tag names we can use without pulling.
    pub models: Vec<String>,
}

#[tauri::command]
pub async fn detect_ollama() -> OllamaStatus {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
    {
        Ok(c) => c,
        Err(_) => {
            return OllamaStatus {
                reachable: false,
                version: String::new(),
                models: vec![],
            }
        }
    };

    // /api/tags is cheap + always-on for any running daemon.
    let tags = match client.get(format!("{OLLAMA_HOST}/api/tags")).send().await {
        Ok(r) if r.status().is_success() => r.json::<serde_json::Value>().await.ok(),
        _ => None,
    };
    let mut models = Vec::new();
    if let Some(serde_json::Value::Array(arr)) =
        tags.as_ref().and_then(|v| v.get("models").cloned()).map(Some).flatten()
    {
        for m in arr {
            if let Some(name) = m.get("name").and_then(|x| x.as_str()) {
                models.push(name.to_string());
            }
        }
    }

    let version = match client.get(format!("{OLLAMA_HOST}/api/version")).send().await {
        Ok(r) if r.status().is_success() => r
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|j| j.get("version").and_then(|v| v.as_str()).map(String::from))
            .unwrap_or_default(),
        _ => String::new(),
    };

    OllamaStatus {
        reachable: tags.is_some(),
        version,
        models,
    }
}

/* ----------------------------------------------------- Hardware profile */

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HwProfile {
    pub total_ram_gb: u64,
    pub cpu_count: usize,
    pub is_apple_silicon: bool,
    pub os: String,
}

#[tauri::command]
pub fn hw_profile() -> HwProfile {
    let mut sys = System::new();
    sys.refresh_memory();
    sys.refresh_cpu_all();
    let total_ram_gb = sys.total_memory() / 1024 / 1024 / 1024;
    let cpu_count = sys.cpus().len();
    let os = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH;
    let is_apple_silicon = os == "macos" && arch == "aarch64";
    HwProfile {
        total_ram_gb,
        cpu_count,
        is_apple_silicon,
        os,
    }
}

/* --------------------------------------------------------- Model picker */

/// Returned to the frontend's "you'll download X" disclosure.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelChoice {
    /// Ollama registry name (e.g. `llava:7b`).
    pub name: String,
    /// Human-readable size for the wizard's disk-space card.
    pub size_gb: f32,
    /// One-line rationale shown beneath the recommendation.
    pub reason: String,
}

#[tauri::command]
pub fn pick_model(hw: HwProfile) -> ModelChoice {
    // Tiers — kept conservative on the "best fit" side. We can always
    // download a smaller model and offer a bigger one later; we cannot
    // unstick a user whose first-launch download blew out their RAM.
    if hw.is_apple_silicon && hw.total_ram_gb >= 16 {
        return ModelChoice {
            name: "llama3.2-vision:11b".into(),
            size_gb: 7.9,
            reason: "Apple silicon with ≥16 GB unified memory — sharp JSON output, fast inference.".into(),
        };
    }
    if hw.total_ram_gb >= 16 {
        return ModelChoice {
            name: "llava:7b".into(),
            size_gb: 4.7,
            reason: "Battle-tested vision model, runs on CPU-only with ≥16 GB RAM.".into(),
        };
    }
    if hw.is_apple_silicon && hw.total_ram_gb >= 8 {
        return ModelChoice {
            name: "llava:7b".into(),
            size_gb: 4.7,
            reason: "Apple silicon, 8 GB unified memory — quantised model fits comfortably.".into(),
        };
    }
    ModelChoice {
        name: "moondream:1.8b".into(),
        size_gb: 1.7,
        reason: "Low-RAM tier — degraded fidelity, but usable while you upgrade.".into(),
    }
}

/* ------------------------------------------------ Streaming model pull */

/// One progress event emitted to the frontend.
#[derive(Debug, Serialize, Deserialize)]
pub struct PullProgress {
    pub status: String,
    #[serde(default)]
    pub digest: String,
    #[serde(default)]
    pub total: u64,
    #[serde(default)]
    pub completed: u64,
}

#[tauri::command]
pub async fn pull_model(app: AppHandle, name: String) -> Result<(), String> {
    let client = reqwest::Client::builder()
        // No timeout — pulls can run for minutes. The frontend Cancel
        // button drops the listener and we abort here via the body.
        .timeout(Duration::from_secs(60 * 60))
        .build()
        .map_err(|e| format!("client: {e}"))?;

    let mut resp = client
        .post(format!("{OLLAMA_HOST}/api/pull"))
        .json(&serde_json::json!({ "name": name, "stream": true }))
        .send()
        .await
        .map_err(|e| format!("pull request: {e}"))?
        .error_for_status()
        .map_err(|e| format!("pull http: {e}"))?
        .bytes_stream();

    let mut buf: Vec<u8> = Vec::with_capacity(4096);
    while let Some(chunk) = resp.next().await {
        let bytes = chunk.map_err(|e| format!("pull stream: {e}"))?;
        buf.extend_from_slice(&bytes);
        // NDJSON: split on \n and emit one event per complete line.
        while let Some(nl) = buf.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = buf.drain(..=nl).collect();
            let trimmed = std::str::from_utf8(&line[..line.len() - 1]).unwrap_or("").trim();
            if trimmed.is_empty() {
                continue;
            }
            match serde_json::from_str::<PullProgress>(trimmed) {
                Ok(progress) => {
                    let _ = app.emit(SETUP_PROGRESS_EVENT, &progress);
                }
                Err(e) => {
                    log::warn!("pull: malformed NDJSON line: {e} — {trimmed}");
                }
            }
        }
    }
    // Final flush in case the daemon dropped the trailing newline.
    let trimmed = std::str::from_utf8(&buf).unwrap_or("").trim();
    if !trimmed.is_empty() {
        if let Ok(progress) = serde_json::from_str::<PullProgress>(trimmed) {
            let _ = app.emit(SETUP_PROGRESS_EVENT, &progress);
        }
    }
    Ok(())
}

/* -------------------------------------------------- Composite status call */

/// Single-shot "should the wizard appear, and what should it propose?".
#[derive(Debug, Serialize)]
pub struct FirstRunStatus {
    pub ollama: OllamaStatus,
    pub hw: HwProfile,
    pub recommended: ModelChoice,
    /// True when the recommended model is already present so the
    /// wizard can fast-path to "ready".
    pub model_present: bool,
}

#[tauri::command]
pub async fn first_run_status() -> FirstRunStatus {
    let ollama = detect_ollama().await;
    let hw = hw_profile();
    let recommended = pick_model(hw.clone());
    let model_present = ollama
        .models
        .iter()
        .any(|m| m == &recommended.name || m.starts_with(&format!("{}:", recommended.name)));
    FirstRunStatus {
        ollama,
        hw,
        recommended,
        model_present,
    }
}
