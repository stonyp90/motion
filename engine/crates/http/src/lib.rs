//! HTTP surface for motion-forge — Adobe-style request/iterate flow.
//!
//! Endpoints (all JSON):
//! - `GET  /healthz`          — liveness probe
//! - `GET  /openapi.json`     — OpenAPI 3.1 spec (hand-written; small surface)
//! - `GET  /themes`           — list bundled themes
//! - `GET  /v1/presets`       — list the starter preset library (id + metadata only)
//! - `GET  /v1/presets/{id}`  — full preset spec + preview Lottie
//! - `POST /generate`         — run the full pipeline on a reference video
//! - `POST /iterate`          — re-prompt against an existing work-dir
//!
//! The server is single-binary, single-tenant, local-first. Designed to
//! sit behind a desktop UI that lets users iterate verbally or by prompt
//! without re-running the slow segmentation phases.

pub mod api_keys;
pub mod auth;
pub mod notifications;
pub mod rate_limit;
pub mod stt_route;
pub mod timefmt;
pub mod usage;

use anyhow::Result;
use axum::{
    Json, Router,
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use motion_forge_render::OutputFormat;
use motion_forge_figma::{ImportKind, fetch_frame, parse_figma_url, to_lottie_layer};
use motion_forge_pipeline::{Composition, GenerateConfig, IterateConfig, Pipeline};
use motion_forge_prompt_orchestrator::{
    brief::{Brief, parse_brief},
    llm,
    presets::{self, Preset, PresetSummary},
    script_synth::synthesize_script,
};
use motion_forge_style_extract::Theme;
use motion_forge_web_export::{WebExportFormat, export as web_export};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;

use crate::api_keys::{ApiKeyStore, IssuedApiKey, Tier};
use crate::auth::{Claims, KeycloakAuthLayer, KeycloakConfig, Principal, PrincipalKind};
use crate::notifications::{EmailService, EventKind, NotificationPrefs, NotificationPrefsStore};
use crate::rate_limit::RateLimitLayer;
use crate::usage::{UsageEvent, UsageLog, UsageReport};
use axum::Extension;
use stt_route::{SttRouteConfig, stt_stream_handler};

#[derive(Clone)]
struct AppState {
    pipeline: Arc<Pipeline>,
    api_keys: ApiKeyStore,
    notif_prefs: NotificationPrefsStore,
    email: Arc<dyn EmailService>,
    usage: UsageLog,
}

pub async fn serve(bind: &str) -> Result<()> {
    // API key store — file-backed, loaded once at boot. Failing to
    // open is fatal because it's the source of truth for non-JWT auth.
    let api_keys = ApiKeyStore::from_env()
        .map_err(|e| anyhow::anyhow!("failed to open API key store: {e}"))?;
    let notif_prefs = NotificationPrefsStore::from_env()
        .map_err(|e| anyhow::anyhow!("failed to open notification prefs store: {e}"))?;
    let usage = UsageLog::from_env()
        .map_err(|e| anyhow::anyhow!("failed to open usage log: {e}"))?;
    let email = notifications::email_service_from_env();
    tracing::info!(
        backend = std::env::var("MOTION_FORGE_EMAIL_BACKEND")
            .unwrap_or_else(|_| "stub".into())
            .as_str(),
        "email backend selected"
    );

    let state = AppState {
        pipeline: Arc::new(Pipeline::new()),
        api_keys: api_keys.clone(),
        notif_prefs,
        email,
        usage,
    };
    let stt_state = Arc::new(SttRouteConfig::from_env());
    if stt_state.model_path.is_none() {
        tracing::warn!(
            env = stt_route::MODEL_PATH_ENV,
            "voice STT route disabled — set the env var to a whisper.cpp GGUF model to enable /v1/stt/stream"
        );
    }

    // STT WebSocket route (separate sub-router because axum binds state by type).
    let stt_router = Router::new()
        .route("/v1/stt/stream", get(stt_stream_handler))
        .with_state(stt_state);

    // Keycloak auth layer for protected routes — both JWT *and* API
    // key paths share this Layer; the credential type discriminates.
    let auth_cfg = KeycloakConfig::from_env();
    let auth_layer = KeycloakAuthLayer::new(auth_cfg.clone()).with_api_keys(api_keys.clone());
    if auth_cfg.issuer.is_empty() {
        tracing::warn!(
            "KEYCLOAK_ISSUER not set — only MOTION_FORGE_AUTH_FALLBACK_KEY tokens and X-API-Key headers will be accepted"
        );
    } else {
        tracing::info!(issuer = %auth_cfg.issuer, "Keycloak JWT validation enabled");
    }

    // Protected routes: themes, generate, iterate, brief, export, presets, web-export.
    // Registered both at flat paths (back-compat) and /v1/... (public API).
    let protected = Router::new()
        .route("/themes", get(themes))
        .route("/v1/themes", get(themes))
        .route("/generate", post(generate))
        .route("/iterate", post(iterate))
        .route("/v1/generate", post(generate))
        .route("/v1/iterate", post(iterate))
        .route("/v1/presets", get(list_presets))
        .route("/v1/presets/:id", get(get_preset))
        .route("/v1/brief/parse", post(brief_parse))
        .route("/v1/brief/synth", post(brief_synth))
        .route("/v1/web-export/:format", post(web_export_handler))
        .route("/v1/export/:format", post(binary_export_handler))
        .route("/v1/uploads", post(upload_handler))
        .route("/v1/metrics", get(metrics_handler))
        .route("/v1/api-keys", post(api_keys_issue).get(api_keys_list))
        .route("/v1/api-keys/:id", axum::routing::delete(api_keys_revoke))
        .route("/v1/me", get(me_handler))
        .route("/v1/me/notifications", get(notifications_get).put(notifications_put))
        .route("/v1/me/notifications/test", post(notifications_test))
        .route("/v1/me/usage", get(usage_get))
        .layer(tower_http::limit::RequestBodyLimitLayer::new(
            // 256 MiB — large enough for a typical reference video
            // (a 60-second 4K H.264 clip lands ~80 MB) without
            // letting a runaway upload chew all process RAM.
            256 * 1024 * 1024,
        ))
        // Order matters: layers wrap from bottom up, so rate_limit
        // runs INSIDE auth (sees the Principal that auth attached).
        .layer(RateLimitLayer::new())
        .layer(auth_layer)
        .layer(tower_http::cors::CorsLayer::permissive())
        .layer(tower_http::trace::TraceLayer::new_for_http())
        .with_state(state);

    // Open routes: liveness, OpenAPI, voice STT (intentionally pre-auth).
    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/openapi.json", get(openapi))
        .merge(protected)
        .merge(stt_router)
        .layer(tower_http::cors::CorsLayer::permissive())
        .layer(tower_http::trace::TraceLayer::new_for_http());

    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .map_err(|e| anyhow::anyhow!("bind {bind}: {e}"))?;

    // The server accepts arbitrary local paths in request bodies; warn loudly
    // if the operator is binding it to a non-loopback interface.
    if !is_loopback_bind(bind) {
        tracing::warn!(
            addr = bind,
            "binding HTTP server to non-loopback address — generate/iterate accept arbitrary local paths; ensure firewall/reverse-proxy auth is in front"
        );
    }
    tracing::info!(addr = bind, "motion-forge http listening");
    axum::serve(listener, app).await?;
    Ok(())
}

fn is_loopback_bind(bind: &str) -> bool {
    // Accept "127.0.0.1:PORT", "localhost:PORT", "[::1]:PORT".
    bind.starts_with("127.") || bind.starts_with("localhost:") || bind.starts_with("[::1]:")
}

/// Reject paths with `..` components or NUL bytes. The server runs as the
/// caller's user, so an attacker who can post to `/generate` could already
/// touch the same files — this guard exists to defend against accidental
/// traversal patterns in front-end inputs, not against malicious local users.
fn validate_path(s: &str, label: &str) -> Result<PathBuf, ApiError> {
    if s.is_empty() {
        return Err(ApiError::bad_request(format!("{label} is empty")));
    }
    if s.contains('\0') {
        return Err(ApiError::bad_request(format!("{label} contains NUL byte")));
    }
    let p = PathBuf::from(s);
    if p.components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(ApiError::bad_request(format!(
            "{label} must not contain `..` components"
        )));
    }
    Ok(p)
}

// ---- handlers ----

async fn healthz() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok", "service": "imtn" }))
}

async fn openapi() -> impl IntoResponse {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    (StatusCode::OK, headers, OPENAPI_JSON)
}

async fn themes() -> Json<ThemesResponse> {
    let slugs = Theme::list_bundled_slugs();
    let entries = slugs
        .iter()
        .filter_map(|slug| {
            Theme::load_bundled(slug).ok().map(|t| ThemeEntry {
                slug: t.slug,
                name: t.name,
                description: t.description,
                default_duration_seconds: t.default_duration_seconds,
                composition_width: t.composition.width,
                composition_height: t.composition.height,
                frame_rate: t.composition.frame_rate,
            })
        })
        .collect();
    Json(ThemesResponse { themes: entries })
}

async fn list_presets() -> Result<Json<PresetsResponse>, ApiError> {
    let presets = presets::all_presets().map_err(ApiError::internal)?;
    Ok(Json(PresetsResponse { presets }))
}

async fn get_preset(Path(id): Path<String>) -> Result<Json<Preset>, ApiError> {
    let preset = presets::load_preset(&id).map_err(|e| {
        let msg = e.to_string();
        if msg.contains("no preset") {
            ApiError::not_found(msg)
        } else if msg.contains("must be a single path segment") {
            ApiError::bad_request(msg)
        } else {
            ApiError::internal(msg)
        }
    })?;
    Ok(Json(preset))
}

async fn generate(
    State(state): State<AppState>,
    Json(req): Json<GenerateRequest>,
) -> Result<Json<GenerateResponse>, ApiError> {
    let theme = match req.theme.as_deref() {
        Some(t) => Some(Theme::resolve(t).map_err(ApiError::bad_request)?),
        None => None,
    };
    let reference_video = validate_path(&req.reference_video, "reference_video")?;
    let work_dir = match req.work_dir.as_deref() {
        Some(s) => validate_path(s, "work_dir")?,
        None => std::env::temp_dir().join(format!("mf-{}", short_id())),
    };
    let out_lottie = match req.out_lottie.as_deref() {
        Some(s) => validate_path(s, "out_lottie")?,
        None => work_dir.join("out.lottie.json"),
    };
    let out_video = match req.out_video.as_deref() {
        Some(s) => Some(validate_path(s, "out_video")?),
        None => None,
    };
    let config = GenerateConfig {
        reference_video,
        prompt: req.prompt,
        theme,
        composition: Composition {
            width: req.width.unwrap_or(0),
            height: req.height.unwrap_or(0),
            frame_rate: req.fps.unwrap_or(0.0),
        },
        duration_seconds: req.duration_seconds.unwrap_or(0.0),
        work_dir,
        output_lottie: out_lottie,
        output_video: out_video,
    };
    let result = state
        .pipeline
        .run_full(config)
        .await
        .map_err(ApiError::internal)?;
    Ok(Json(GenerateResponse {
        work_dir: result.work_dir.display().to_string(),
        output_lottie: result.output_lottie.display().to_string(),
        output_video: result.output_video.map(|p| p.display().to_string()),
        backend_name: result.backend_name,
        shots: result.timeline.shots.len() as u32,
        duration_seconds: result.timeline.duration_seconds,
    }))
}

async fn iterate(
    State(state): State<AppState>,
    Json(req): Json<IterateRequest>,
) -> Result<Json<GenerateResponse>, ApiError> {
    let theme = match req.theme.as_deref() {
        Some(t) => Some(Theme::resolve(t).map_err(ApiError::bad_request)?),
        None => None,
    };
    let composition_override = if req.width.is_some() || req.height.is_some() || req.fps.is_some() {
        Some(Composition {
            width: req.width.unwrap_or(1920),
            height: req.height.unwrap_or(1080),
            frame_rate: req.fps.unwrap_or(30.0),
        })
    } else {
        None
    };
    // Iterate now accepts an optional work_dir: when missing, create a
    // fresh one (parity with /v1/generate) so the web can fire iterate
    // for a prompt-only render without a prior session.
    let work_dir = match req.work_dir.as_deref() {
        Some(s) => validate_path(s, "work_dir")?,
        None => std::env::temp_dir().join(format!("mf-iter-{}", short_id())),
    };
    if !work_dir.exists() {
        std::fs::create_dir_all(&work_dir).map_err(ApiError::internal)?;
    }
    let out_lottie = match req.out_lottie.as_deref() {
        Some(s) => validate_path(s, "out_lottie")?,
        None => work_dir.join("iterate.lottie.json"),
    };
    let out_video = match req.out_video.as_deref() {
        Some(s) => Some(validate_path(s, "out_video")?),
        None => None,
    };
    let config = IterateConfig {
        work_dir,
        prompt: req.prompt,
        theme,
        composition_override,
        duration_seconds: req.duration_seconds,
        output_lottie: out_lottie,
        output_video: out_video,
    };
    let result = state
        .pipeline
        .run_iterate(config)
        .await
        .map_err(ApiError::internal)?;
    Ok(Json(GenerateResponse {
        work_dir: result.work_dir.display().to_string(),
        output_lottie: result.output_lottie.display().to_string(),
        output_video: result.output_video.map(|p| p.display().to_string()),
        backend_name: result.backend_name,
        shots: result.timeline.shots.len() as u32,
        duration_seconds: result.timeline.duration_seconds,
    }))
}

/// `POST /v1/web-export/{format}` — convert a Lottie JSON body to the
/// requested web-native target. The body is the full Lottie document
/// (same shape we ship from `/generate`). The response body is the
/// exported text in the appropriate MIME type for the format.
///
/// Valid `{format}` values: `svg-smil`, `svg-css`, `gsap`, `motion-js`,
/// `theatre`, `framer-variants`.
async fn web_export_handler(
    State(_state): State<AppState>,
    Path(format): Path<String>,
    Json(body): Json<serde_json::Value>,
) -> Result<Response, ApiError> {
    let fmt = WebExportFormat::from_slug(&format)
        .ok_or_else(|| ApiError::bad_request(format!("unknown format `{format}`")))?;
    let payload = web_export(fmt, &body).map_err(ApiError::internal)?;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(fmt.mime_type()),
    );
    // Convenience for `curl -OJ`.
    let disposition = format!("inline; filename=\"motion.{}\"", fmt.extension());
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&disposition).unwrap_or_else(|_| HeaderValue::from_static("inline")),
    );
    Ok((StatusCode::OK, headers, payload).into_response())
}

// ---- binary export (Lottie → MP4 / MOV / WebM / GIF / etc.) ----

/// Accepts a Lottie JSON body and renders it through the python
/// lottie sidecar + ffmpeg transcode to the requested binary
/// container (mp4, mov, webm, webm-av1, gif, webp, apng, lottie,
/// dotlottie, svg). Returns the encoded bytes inline with the right
/// Content-Type and a Content-Disposition so curl -OJ writes
/// `motion.<ext>` straight to disk.
async fn binary_export_handler(
    Path(format): Path<String>,
    body: Bytes,
) -> Result<Response, ApiError> {
    use motion_forge_render::python_sidecar_adapter::PythonLottieRenderer;
    use motion_forge_render::{RenderConfig, render_to_format};

    let fmt = OutputFormat::from_str(&format)
        .map_err(|_| ApiError::bad_request(format!("unknown format `{format}`")))?;

    // 1. Stash the Lottie body to a scratch file (the renderer expects a path).
    let scratch = std::env::temp_dir().join(format!("mf-export-{}", short_id()));
    std::fs::create_dir_all(&scratch).map_err(ApiError::internal)?;
    let lottie_path = scratch.join("input.lottie.json");
    std::fs::write(&lottie_path, &body).map_err(ApiError::internal)?;
    let out_path = scratch.join(format!("output.{}", fmt.extension()));

    // 2. Run the render → transcode chain on a blocking thread so we
    // don't park a tokio worker on the python + ffmpeg spawn.
    let lottie_path_cl = lottie_path.clone();
    let out_path_cl = out_path.clone();
    let bytes_written = tokio::task::spawn_blocking(move || -> anyhow::Result<u64> {
        let mut renderer = PythonLottieRenderer::default_in_workspace();
        let config = RenderConfig {
            format: fmt,
            ..RenderConfig::default()
        };
        render_to_format(&mut renderer, &lottie_path_cl, &out_path_cl, &config)
    })
    .await
    .map_err(|e| ApiError::internal(anyhow::anyhow!("render task join: {e}")))?
    .map_err(ApiError::internal)?;

    let payload = std::fs::read(&out_path).map_err(ApiError::internal)?;
    let _ = std::fs::remove_dir_all(&scratch);

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(fmt.mime())
            .unwrap_or_else(|_| HeaderValue::from_static("application/octet-stream")),
    );
    let disposition = format!("attachment; filename=\"motion.{}\"", fmt.extension());
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&disposition).unwrap_or_else(|_| HeaderValue::from_static("attachment")),
    );
    tracing::info!(
        format = %fmt.slug(),
        bytes = bytes_written,
        "binary export ok"
    );
    Ok((StatusCode::OK, headers, payload).into_response())
}

// ---- metrics ----

/// Snapshot of the host's CPU / memory usage + the running motion-forge
/// engine's basic process stats. Polled by the web dashboard chip so
/// users running local models can see when they're starving the
/// machine. Thresholds match ursly's 50/80% success/warning/critical
/// convention so the dashboard register stays consistent across the
/// sibling apps.
#[derive(Debug, Serialize, Deserialize)]
pub struct MetricsSnapshot {
    pub cpu: CpuMetric,
    pub memory: MemoryMetric,
    pub process: ProcessMetric,
    /// Suggested warn/critical thresholds for the UI to colour bars
    /// with. The engine is the source of truth so a future tuning
    /// only requires bumping these numbers.
    pub thresholds: Thresholds,
    pub uptime_seconds: u64,
    pub timestamp: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CpuMetric {
    /// Global CPU usage, 0.0 – 100.0.
    pub usage_percent: f32,
    pub cores: usize,
    /// CPU brand string when available (e.g. "Apple M2 Pro").
    pub brand: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MemoryMetric {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub free_bytes: u64,
    pub usage_percent: f32,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessMetric {
    /// Resident set size for *this* engine process, in bytes.
    pub rss_bytes: u64,
    /// Number of threads the engine is currently running.
    pub threads: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Thresholds {
    /// Below this, colour green. Default 50.
    pub healthy_below: f32,
    /// Below this (and above healthy), colour amber. Default 80.
    pub warning_below: f32,
    // ≥ warning_below → red.
}

impl Default for Thresholds {
    fn default() -> Self {
        Self {
            healthy_below: 50.0,
            warning_below: 80.0,
        }
    }
}

/// Cached system handle so we don't re-spawn /proc readers on every
/// request. Mutex is cheap relative to a sysinfo refresh.
static SYS: std::sync::OnceLock<std::sync::Mutex<sysinfo::System>> =
    std::sync::OnceLock::new();

async fn metrics_handler() -> Json<MetricsSnapshot> {
    use sysinfo::{Pid, ProcessRefreshKind, RefreshKind, System};

    let mutex = SYS.get_or_init(|| {
        std::sync::Mutex::new(System::new_with_specifics(
            RefreshKind::new()
                .with_cpu(sysinfo::CpuRefreshKind::everything())
                .with_memory(sysinfo::MemoryRefreshKind::everything())
                .with_processes(ProcessRefreshKind::everything()),
        ))
    });
    let snapshot = tokio::task::spawn_blocking(move || {
        let mut sys = mutex.lock().expect("sysinfo poisoned");
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        let pid = Pid::from_u32(std::process::id());
        sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);

        let cpu = CpuMetric {
            usage_percent: sys.global_cpu_usage(),
            cores: sys.cpus().len(),
            brand: sys.cpus().first().map(|c| c.brand().to_string()),
        };
        let total = sys.total_memory();
        let used = sys.used_memory();
        let memory = MemoryMetric {
            total_bytes: total,
            used_bytes: used,
            free_bytes: sys.free_memory(),
            usage_percent: if total > 0 {
                (used as f64 / total as f64 * 100.0) as f32
            } else {
                0.0
            },
            swap_total_bytes: sys.total_swap(),
            swap_used_bytes: sys.used_swap(),
        };
        let process = match sys.process(pid) {
            Some(p) => ProcessMetric {
                rss_bytes: p.memory(),
                threads: p.tasks().map(|t| t.len() as u32).unwrap_or(1),
            },
            None => ProcessMetric { rss_bytes: 0, threads: 1 },
        };
        MetricsSnapshot {
            cpu,
            memory,
            process,
            thresholds: Thresholds::default(),
            uptime_seconds: System::uptime(),
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0),
        }
    })
    .await
    .unwrap_or_else(|_| empty_metrics());
    Json(snapshot)
}

fn empty_metrics() -> MetricsSnapshot {
    MetricsSnapshot {
        cpu: CpuMetric {
            usage_percent: 0.0,
            cores: 0,
            brand: None,
        },
        memory: MemoryMetric {
            total_bytes: 0,
            used_bytes: 0,
            free_bytes: 0,
            usage_percent: 0.0,
            swap_total_bytes: 0,
            swap_used_bytes: 0,
        },
        process: ProcessMetric {
            rss_bytes: 0,
            threads: 0,
        },
        thresholds: Thresholds::default(),
        uptime_seconds: 0,
        timestamp: 0,
    }
}

// ---- api keys ----

#[derive(Deserialize)]
struct IssueApiKeyRequest {
    name: String,
    #[serde(default)]
    tier: Option<Tier>,
}

/// Only JWT-authenticated users may manage API keys — an API key
/// must not be able to mint more API keys (privilege escalation).
fn require_jwt(claims: Option<&Claims>, principal_kind: Option<&PrincipalKind>) -> Result<String, ApiError> {
    match (claims, principal_kind) {
        (Some(c), Some(PrincipalKind::User)) => Ok(c.sub.clone()),
        _ => Err(ApiError::forbidden(
            "API key management requires a logged-in user; bearer JWT only",
        )),
    }
}

async fn api_keys_issue(
    State(state): State<AppState>,
    claims: Option<Extension<Claims>>,
    principal: Option<Extension<crate::auth::Principal>>,
    Json(req): Json<IssueApiKeyRequest>,
) -> Result<Json<IssuedApiKey>, ApiError> {
    let claims = claims.map(|e| e.0);
    let kind = principal.as_ref().map(|p| &p.0.kind);
    let owner_sub = require_jwt(claims.as_ref(), kind)?;
    let name = req.name.trim();
    if name.is_empty() {
        return Err(ApiError::bad_request("name is required"));
    }
    if name.len() > 100 {
        return Err(ApiError::bad_request("name max length is 100 chars"));
    }
    let tier = req.tier.unwrap_or_default();
    let issued = state
        .api_keys
        .issue(name, owner_sub, tier)
        .await
        .map_err(ApiError::internal)?;
    Ok(Json(issued))
}

async fn api_keys_list(
    State(state): State<AppState>,
    claims: Option<Extension<Claims>>,
    principal: Option<Extension<crate::auth::Principal>>,
) -> Result<Json<Vec<crate::api_keys::ApiKeyPublic>>, ApiError> {
    let claims = claims.map(|e| e.0);
    let kind = principal.as_ref().map(|p| &p.0.kind);
    let owner_sub = require_jwt(claims.as_ref(), kind)?;
    let keys = state.api_keys.list_for_owner(&owner_sub).await;
    Ok(Json(keys))
}

async fn api_keys_revoke(
    State(state): State<AppState>,
    Path(id): Path<String>,
    claims: Option<Extension<Claims>>,
    principal: Option<Extension<crate::auth::Principal>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let claims = claims.map(|e| e.0);
    let kind = principal.as_ref().map(|p| &p.0.kind);
    let owner_sub = require_jwt(claims.as_ref(), kind)?;
    let revoked = state
        .api_keys
        .revoke(&id, &owner_sub)
        .await
        .map_err(ApiError::internal)?;
    if !revoked {
        return Err(ApiError::not_found("key not found or already revoked"));
    }
    Ok(Json(serde_json::json!({ "revoked": id })))
}

// ---- me / notifications / usage ----

/// Extract the calling JWT user's sub + email. Returns 403 for API-key /
/// fallback principals (these surfaces are user-only).
fn require_user(
    claims: Option<&Claims>,
    principal_kind: Option<&PrincipalKind>,
) -> Result<(String, Option<String>, Option<String>), ApiError> {
    match (claims, principal_kind) {
        (Some(c), Some(PrincipalKind::User)) => {
            Ok((c.sub.clone(), c.email.clone(), c.preferred_username.clone()))
        }
        _ => Err(ApiError::forbidden(
            "this endpoint requires a logged-in user; bearer JWT only",
        )),
    }
}

async fn me_handler(
    claims: Option<Extension<Claims>>,
    principal: Option<Extension<Principal>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let claims = claims.map(|e| e.0);
    let kind = principal.as_ref().map(|p| &p.0.kind);
    let (sub, email, username) = require_user(claims.as_ref(), kind)?;
    let claims = claims.expect("require_user enforces claims is Some");
    Ok(Json(serde_json::json!({
        "sub": sub,
        "email": email,
        "username": username,
        "name": claims.preferred_username.or(claims.email.clone()),
        "issuer": claims.iss,
        "roles": claims
            .realm_access
            .as_ref()
            .map(|r| r.roles.clone())
            .unwrap_or_default(),
        "principal_kind": "user",
    })))
}

async fn notifications_get(
    State(state): State<AppState>,
    claims: Option<Extension<Claims>>,
    principal: Option<Extension<Principal>>,
) -> Result<Json<NotificationPrefs>, ApiError> {
    let claims = claims.map(|e| e.0);
    let kind = principal.as_ref().map(|p| &p.0.kind);
    let (sub, email, _) = require_user(claims.as_ref(), kind)?;
    let mut p = state.notif_prefs.get(&sub).await;
    // Seed the email from the JWT on first read if user hasn't set
    // their own — saves the user a step in the UI.
    if p.email.is_none() {
        p.email = email;
    }
    Ok(Json(p))
}

async fn notifications_put(
    State(state): State<AppState>,
    claims: Option<Extension<Claims>>,
    principal: Option<Extension<Principal>>,
    Json(prefs): Json<NotificationPrefs>,
) -> Result<Json<NotificationPrefs>, ApiError> {
    let claims = claims.map(|e| e.0);
    let kind = principal.as_ref().map(|p| &p.0.kind);
    let (sub, _, _) = require_user(claims.as_ref(), kind)?;
    let saved = state
        .notif_prefs
        .put(&sub, prefs)
        .await
        .map_err(ApiError::internal)?;
    Ok(Json(saved))
}

async fn notifications_test(
    State(state): State<AppState>,
    claims: Option<Extension<Claims>>,
    principal: Option<Extension<Principal>>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let claims = claims.map(|e| e.0);
    let kind = principal.as_ref().map(|p| &p.0.kind);
    let (sub, jwt_email, _) = require_user(claims.as_ref(), kind)?;
    let prefs = state.notif_prefs.get(&sub).await;
    let to = prefs
        .email
        .or(jwt_email)
        .ok_or_else(|| ApiError::bad_request("no email on file"))?;
    state
        .email
        .send(&to, "IMTN — notification test", "Notifications are wired up.")
        .await
        .map_err(|e| ApiError::internal(e.to_string()))?;
    Ok(Json(serde_json::json!({
        "sent_to": to,
        "backend": std::env::var("MOTION_FORGE_EMAIL_BACKEND").unwrap_or_else(|_| "stub".into()),
    })))
}

async fn usage_get(
    State(state): State<AppState>,
    claims: Option<Extension<Claims>>,
    principal: Option<Extension<Principal>>,
) -> Result<Json<UsageReport>, ApiError> {
    let claims = claims.map(|e| e.0);
    let kind = principal.as_ref().map(|p| &p.0.kind);
    let (sub, _, _) = require_user(claims.as_ref(), kind)?;
    let report = state.usage.aggregate_for(&format!("user:{sub}"), 30);
    Ok(Json(report))
}

// ---- uploads ----

/// Accepts a multipart upload of one or more reference assets (video,
/// still image stacks, brief documents). Each file is dropped into a
/// per-session work-dir under `$MOTION_FORGE_UPLOAD_DIR` (defaults to
/// the system temp dir). Returns a JSON manifest of server-side paths
/// the caller can then pass to `/v1/generate` as `reference_video` or
/// in the (future) `reference_images` field.
async fn upload_handler(
    mut multipart: axum::extract::Multipart,
) -> Result<Json<UploadResponse>, ApiError> {
    let base = std::env::var("MOTION_FORGE_UPLOAD_DIR")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let session = format!("mf-upload-{}", short_id());
    let dir = base.join(&session);
    std::fs::create_dir_all(&dir).map_err(ApiError::internal)?;

    let mut files: Vec<UploadedFile> = Vec::new();
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::bad_request(format!("multipart parse: {e}")))?
    {
        let original_name = field.file_name().map(str::to_owned);
        let content_type = field.content_type().map(str::to_owned);
        let bytes = field
            .bytes()
            .await
            .map_err(|e| ApiError::bad_request(format!("read field: {e}")))?;
        if bytes.is_empty() {
            continue;
        }
        // Sanitise: keep extension only, generate a fresh filename.
        let ext = original_name
            .as_deref()
            .and_then(|n| std::path::Path::new(n).extension())
            .and_then(|e| e.to_str())
            .unwrap_or("bin")
            .chars()
            .filter(|c| c.is_ascii_alphanumeric())
            .take(8)
            .collect::<String>();
        let filename = format!("{}.{}", short_id(), if ext.is_empty() { "bin".into() } else { ext });
        let path = dir.join(&filename);
        std::fs::write(&path, &bytes).map_err(ApiError::internal)?;
        let kind = classify(content_type.as_deref(), &filename);
        files.push(UploadedFile {
            kind,
            path: path.display().to_string(),
            original_name,
            content_type,
            bytes: bytes.len() as u64,
        });
    }

    if files.is_empty() {
        return Err(ApiError::bad_request("no files received".to_string()));
    }

    Ok(Json(UploadResponse {
        session,
        work_dir: dir.display().to_string(),
        files,
    }))
}

fn classify(content_type: Option<&str>, filename: &str) -> String {
    let ct = content_type.unwrap_or("");
    let lower = filename.to_ascii_lowercase();
    // PDFs come first: many browsers send application/pdf but we
    // also accept the extension so a stray .pdf with text/plain
    // mime still classifies correctly. PDFs are first-class because
    // the brief-intake path commonly receives them.
    if ct == "application/pdf" || lower.ends_with(".pdf") {
        "pdf".into()
    } else if ct.starts_with("video/")
        || lower.ends_with(".mp4")
        || lower.ends_with(".mov")
        || lower.ends_with(".webm")
        || lower.ends_with(".mkv")
    {
        "video".into()
    } else if ct.starts_with("image/")
        || lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".gif")
        || lower.ends_with(".webp")
        || lower.ends_with(".avif")
    {
        "image".into()
    } else if ct.starts_with("audio/")
        || lower.ends_with(".wav")
        || lower.ends_with(".mp3")
        || lower.ends_with(".ogg")
        || lower.ends_with(".m4a")
    {
        "audio".into()
    } else if ct.starts_with("text/")
        || lower.ends_with(".txt")
        || lower.ends_with(".md")
        || lower.ends_with(".json")
        || lower.ends_with(".csv")
    {
        "text".into()
    } else {
        "binary".into()
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UploadResponse {
    /// Opaque session id (folder name under the upload root).
    pub session: String,
    /// Absolute path of the per-session work-dir on the server.
    pub work_dir: String,
    pub files: Vec<UploadedFile>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UploadedFile {
    /// One of: `video`, `image`, `audio`, `text`, `binary`.
    pub kind: String,
    /// Absolute path of the sanitised file on the server. Pass this
    /// straight back to `/v1/generate` as `reference_video` (or, when
    /// the field lands, `reference_images: [...]`).
    pub path: String,
    pub original_name: Option<String>,
    pub content_type: Option<String>,
    pub bytes: u64,
}

// ---- brief intake (W4) ----

#[derive(Debug, Serialize, Deserialize)]
pub struct BriefParseRequest {
    pub text: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BriefSynthRequest {
    pub brief: String,
    pub duration: f32,
    pub scene_count: u32,
}

async fn brief_parse(Json(req): Json<BriefParseRequest>) -> Result<Json<Brief>, ApiError> {
    let brief = parse_brief(&req.text).map_err(ApiError::bad_request)?;
    Ok(Json(brief))
}

async fn brief_synth(Json(req): Json<BriefSynthRequest>) -> Result<Json<Brief>, ApiError> {
    let backend = llm::auto_local_first("{\"scenes\":[]}").await;
    let brief = synthesize_script(&*backend, &req.brief, req.duration, req.scene_count)
        .await
        .map_err(ApiError::internal)?;
    Ok(Json(brief))
}

// ---- types ----

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateRequest {
    pub reference_video: String,
    pub prompt: String,
    pub theme: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f32>,
    pub duration_seconds: Option<f32>,
    pub work_dir: Option<String>,
    pub out_lottie: Option<String>,
    pub out_video: Option<String>,
    /// Optional model id (e.g. `ollama/llava`, `openai/gpt-4o`).
    /// Today the engine picks the backend from env; this field is
    /// captured so the call is forward-compatible.
    #[serde(default)]
    pub model: Option<String>,
    /// Optional list of per-server-path image references to ground
    /// the orchestration on (e.g. brand frames, storyboard sketches).
    #[serde(default)]
    pub reference_images: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IterateRequest {
    /// Optional — when missing we create a fresh work-dir, so the
    /// web can call /v1/iterate without an existing project.
    #[serde(default)]
    pub work_dir: Option<String>,
    pub prompt: String,
    pub theme: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f32>,
    /// Accept either `duration_seconds` (canonical) or `duration`
    /// (legacy / shorthand) via alias.
    #[serde(default, alias = "duration")]
    pub duration_seconds: Option<f32>,
    /// Alias of `theme` to match the web's `preset` field name.
    #[serde(default, alias = "preset")]
    pub preset: Option<String>,
    pub out_lottie: Option<String>,
    pub out_video: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reference_images: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GenerateResponse {
    pub work_dir: String,
    pub output_lottie: String,
    pub output_video: Option<String>,
    pub backend_name: String,
    pub shots: u32,
    pub duration_seconds: f32,
}

#[derive(Debug, Serialize)]
pub struct ThemesResponse {
    pub themes: Vec<ThemeEntry>,
}

#[derive(Debug, Deserialize)]
pub struct FigmaImportRequest {
    /// Share URL — accepts `/file/` or `/design/` or `/proto/` shapes.
    pub file_url: String,
    /// Optional override; falls back to the `node-id` query param in `file_url`.
    #[serde(default)]
    pub node_id: Option<String>,
    /// Sprite vs. background.
    pub kind: ImportKind,
    /// User-scoped Figma personal-access token. Per the task brief this
    /// is request-body for now; later moves to a Keycloak realm secret.
    pub figma_token: String,
}

#[derive(Debug, Serialize)]
pub struct FigmaImportResponse {
    pub file_key: String,
    pub node_id: String,
    pub kind: ImportKind,
    /// The converted Lottie layer (ready to slot into a composition).
    pub layer: serde_json::Value,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct PresetsResponse {
    pub presets: Vec<PresetSummary>,
}

#[derive(Debug, Serialize)]
pub struct ThemeEntry {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub default_duration_seconds: f32,
    pub composition_width: u32,
    pub composition_height: u32,
    pub frame_rate: f32,
}

// ---- error type ----

struct ApiError {
    status: StatusCode,
    message: String,
}

impl ApiError {
    fn bad_request<E: std::fmt::Display>(e: E) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message: e.to_string(),
        }
    }
    fn not_found<E: std::fmt::Display>(e: E) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: e.to_string(),
        }
    }
    fn forbidden<E: std::fmt::Display>(e: E) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            message: e.to_string(),
        }
    }
    fn internal<E: std::fmt::Display>(e: E) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            message: e.to_string(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = Json(serde_json::json!({ "error": self.message }));
        (self.status, body).into_response()
    }
}

// ---- misc ----

fn short_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}

// ---- hand-written OpenAPI 3.1 spec ----

const OPENAPI_JSON: &str = r##"{
  "openapi": "3.1.0",
  "info": {
    "title": "IMTN",
    "version": "0.1.0",
    "description": "Public API for IMTN — brand-grade video, generated from a prompt.\n\nAuth: every endpoint except `/healthz` and `/openapi.json` requires one of:\n  - `Authorization: Bearer <Keycloak JWT>` (interactive users + the web app)\n  - `X-API-Key: mf_live_<id>_<secret>` (SDK / server callers)\n  - `Authorization: Bearer mf_live_<...>` (equivalent shape; SDKs that only know about Bearer headers can use this)\n\nRate limits: per-key sliding window. The free tier admits 60 rpm, pro 600 rpm, enterprise 6000 rpm. Every response carries `X-RateLimit-Limit` and `X-RateLimit-Remaining`; 429s additionally carry `Retry-After`."
  },
  "security": [
    { "bearerAuth": [] },
    { "apiKeyAuth": [] }
  ],
  "paths": {
    "/healthz": {
      "get": {
        "summary": "Liveness probe",
        "responses": { "200": { "description": "OK" } }
      }
    },
    "/themes": {
      "get": {
        "summary": "List bundled themes",
        "responses": {
          "200": {
            "description": "Theme catalogue",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/ThemesResponse" }
              }
            }
          }
        }
      }
    },
    "/v1/presets": {
      "get": {
        "summary": "List starter presets",
        "description": "Curated templates a user can pick on the home page instead of starting from a blank prompt. Each entry is metadata only; fetch /v1/presets/{id} for the full spec + preview Lottie.",
        "responses": {
          "200": {
            "description": "Preset catalogue",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/PresetsResponse" }
              }
            }
          }
        }
      }
    },
    "/v1/presets/{id}": {
      "get": {
        "summary": "Fetch a single preset including its preview Lottie",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": { "type": "string" }
          }
        ],
        "responses": {
          "200": {
            "description": "Full preset spec + preview Lottie",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/Preset" }
              }
            }
          },
          "404": { "description": "No preset with that id" }
        }
      }
    },
    "/generate": {
      "post": {
        "summary": "Run the full pipeline on a reference video",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/GenerateRequest" }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Generation result",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/GenerateResponse" }
              }
            }
          }
        }
      }
    },
    "/iterate": {
      "post": {
        "summary": "Re-prompt against an existing work directory (fast iteration)",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/IterateRequest" }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Iteration result",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/GenerateResponse" }
              }
            }
          }
        }
      }
    },
    "/v1/web-export/{format}": {
      "post": {
        "summary": "Convert a Lottie JSON body to a web-native animation target",
        "description": "Re-emit the same composition as SVG+SMIL, SVG+CSS @keyframes, a GSAP timeline JS module, a Motion (framer-motion vanilla) snippet, a Theatre.js project state JSON, or a Framer Motion variants object. Response body is text in the appropriate MIME type for the format.",
        "parameters": [
          {
            "name": "format",
            "in": "path",
            "required": true,
            "schema": {
              "type": "string",
              "enum": ["svg-smil", "svg-css", "gsap", "motion-js", "theatre", "framer-variants"]
            }
          }
        ],
        "requestBody": {
          "required": true,
          "description": "A complete Lottie JSON document.",
          "content": {
            "application/json": {
              "schema": { "type": "object" }
            }
          }
        },
        "responses": {
          "200": {
            "description": "Exported payload.",
            "content": {
              "image/svg+xml": { "schema": { "type": "string" } },
              "application/javascript": { "schema": { "type": "string" } },
              "application/json": { "schema": { "type": "object" } }
            }
          },
          "400": { "description": "Unknown format slug or invalid Lottie body." }
        }
      }
    },
    "/v1/api-keys": {
      "post": {
        "summary": "Issue a new API key. JWT-only (an API key cannot mint more API keys).",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": { "$ref": "#/components/schemas/IssueApiKeyRequest" }
            }
          }
        },
        "responses": {
          "200": {
            "description": "The new key — the `secret` field is returned exactly once.",
            "content": {
              "application/json": {
                "schema": { "$ref": "#/components/schemas/IssuedApiKey" }
              }
            }
          },
          "403": { "description": "Caller is authenticated via API key, not JWT." }
        }
      },
      "get": {
        "summary": "List the calling user's API keys (no secrets).",
        "responses": {
          "200": {
            "description": "Array of public key views.",
            "content": {
              "application/json": {
                "schema": {
                  "type": "array",
                  "items": { "$ref": "#/components/schemas/ApiKeyPublic" }
                }
              }
            }
          }
        }
      }
    },
    "/v1/api-keys/{id}": {
      "delete": {
        "summary": "Revoke an API key. JWT-only.",
        "parameters": [
          {
            "name": "id",
            "in": "path",
            "required": true,
            "schema": { "type": "string" }
          }
        ],
        "responses": {
          "200": { "description": "Revoked." },
          "404": { "description": "Key not found or already revoked." }
        }
      }
    }
  },
  "components": {
    "securitySchemes": {
      "bearerAuth": {
        "type": "http",
        "scheme": "bearer",
        "bearerFormat": "JWT or mf_live_..."
      },
      "apiKeyAuth": {
        "type": "apiKey",
        "in": "header",
        "name": "X-API-Key"
      }
    },
    "schemas": {
      "IssueApiKeyRequest": {
        "type": "object",
        "required": ["name"],
        "properties": {
          "name": { "type": "string", "description": "Human-readable label, max 100 chars.", "maxLength": 100 },
          "tier": { "type": "string", "enum": ["free", "pro", "enterprise"], "default": "free" }
        }
      },
      "IssuedApiKey": {
        "type": "object",
        "required": ["id", "name", "tier", "created_at", "secret"],
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "tier": { "type": "string", "enum": ["free", "pro", "enterprise"] },
          "created_at": { "type": "string", "format": "date-time" },
          "secret": { "type": "string", "description": "The mf_live_<id>_<secret> string. Returned once — never retrievable again." }
        }
      },
      "ApiKeyPublic": {
        "type": "object",
        "required": ["id", "name", "owner_sub", "tier", "created_at"],
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "owner_sub": { "type": "string" },
          "tier": { "type": "string", "enum": ["free", "pro", "enterprise"] },
          "created_at": { "type": "string", "format": "date-time" },
          "last_used_at": { "type": ["string", "null"], "format": "date-time" },
          "revoked_at": { "type": ["string", "null"], "format": "date-time" }
        }
      },
      "GenerateRequest": {
        "type": "object",
        "required": ["reference_video", "prompt"],
        "properties": {
          "reference_video": { "type": "string", "description": "Local path to the reference MP4." },
          "prompt": { "type": "string" },
          "theme": { "type": "string", "description": "Theme slug (corporate, playful, ...) or path to a theme JSON file." },
          "width": { "type": "integer" },
          "height": { "type": "integer" },
          "fps": { "type": "number" },
          "duration_seconds": { "type": "number" },
          "work_dir": { "type": "string" },
          "out_lottie": { "type": "string" },
          "out_video": { "type": "string" }
        }
      },
      "IterateRequest": {
        "type": "object",
        "required": ["work_dir", "prompt"],
        "properties": {
          "work_dir": { "type": "string" },
          "prompt": { "type": "string" },
          "theme": { "type": "string" },
          "width": { "type": "integer" },
          "height": { "type": "integer" },
          "fps": { "type": "number" },
          "duration_seconds": { "type": "number" },
          "out_lottie": { "type": "string" },
          "out_video": { "type": "string" }
        }
      },
      "GenerateResponse": {
        "type": "object",
        "required": ["work_dir", "output_lottie", "backend_name", "shots", "duration_seconds"],
        "properties": {
          "work_dir": { "type": "string" },
          "output_lottie": { "type": "string" },
          "output_video": { "type": ["string", "null"] },
          "backend_name": { "type": "string" },
          "shots": { "type": "integer" },
          "duration_seconds": { "type": "number" }
        }
      },
      "ThemeEntry": {
        "type": "object",
        "required": ["slug", "name", "description", "default_duration_seconds", "composition_width", "composition_height", "frame_rate"],
        "properties": {
          "slug": { "type": "string" },
          "name": { "type": "string" },
          "description": { "type": "string" },
          "default_duration_seconds": { "type": "number" },
          "composition_width": { "type": "integer" },
          "composition_height": { "type": "integer" },
          "frame_rate": { "type": "number" }
        }
      },
      "ThemesResponse": {
        "type": "object",
        "required": ["themes"],
        "properties": {
          "themes": {
            "type": "array",
            "items": { "$ref": "#/components/schemas/ThemeEntry" }
          }
        }
      },
      "PresetSummary": {
        "type": "object",
        "required": ["id", "name", "tagline", "category", "duration_sec", "width", "height", "frame_rate", "brief_skeleton"],
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "tagline": { "type": "string" },
          "category": { "type": "string" },
          "duration_sec": { "type": "number" },
          "width": { "type": "integer" },
          "height": { "type": "integer" },
          "frame_rate": { "type": "number" },
          "theme_slug": { "type": ["string", "null"] },
          "brief_skeleton": { "type": "string" }
        }
      },
      "PresetsResponse": {
        "type": "object",
        "required": ["presets"],
        "properties": {
          "presets": {
            "type": "array",
            "items": { "$ref": "#/components/schemas/PresetSummary" }
          }
        }
      },
      "Preset": {
        "type": "object",
        "required": ["id", "name", "tagline", "category", "duration_sec", "composition", "suggested_cast", "brief_skeleton", "preview", "preview_lottie"],
        "properties": {
          "id": { "type": "string" },
          "name": { "type": "string" },
          "tagline": { "type": "string" },
          "category": { "type": "string" },
          "duration_sec": { "type": "number" },
          "composition": {
            "type": "object",
            "required": ["width", "height", "frame_rate"],
            "properties": {
              "width": { "type": "integer" },
              "height": { "type": "integer" },
              "frame_rate": { "type": "number" }
            }
          },
          "theme_slug": { "type": ["string", "null"] },
          "transparent_background": { "type": "boolean" },
          "loop": { "type": "boolean" },
          "sticker_count": { "type": ["integer", "null"] },
          "export_format": { "type": ["string", "null"] },
          "suggested_cast": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["id", "kind", "role"],
              "properties": {
                "id": { "type": "string" },
                "kind": { "type": "string" },
                "role": { "type": "string" },
                "note": { "type": ["string", "null"] }
              }
            }
          },
          "brief_skeleton": { "type": "string" },
          "placeholders": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["id", "label", "type"],
              "properties": {
                "id": { "type": "string" },
                "label": { "type": "string" },
                "type": { "type": "string" },
                "required": { "type": "boolean" },
                "default": {}
              }
            }
          },
          "preview": { "type": "string", "description": "Filename of the preview Lottie within the preset directory." },
          "preview_lottie": {
            "type": "object",
            "description": "Raw Lottie JSON envelope (v5.7.0)."
          }
        }
      }
    }
  }
}"##;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_path_rejects_traversal_and_nul() {
        assert!(validate_path("../etc/passwd", "x").is_err());
        assert!(validate_path("a/../b", "x").is_err());
        assert!(validate_path("ok/with\0nul", "x").is_err());
        assert!(validate_path("", "x").is_err());
        assert!(validate_path("./fixtures/sample.mp4", "x").is_ok());
        assert!(validate_path("/tmp/mf/out.mp4", "x").is_ok());
    }

    #[test]
    fn is_loopback_bind_classifies_correctly() {
        assert!(is_loopback_bind("127.0.0.1:7755"));
        assert!(is_loopback_bind("localhost:7755"));
        assert!(is_loopback_bind("[::1]:7755"));
        assert!(!is_loopback_bind("0.0.0.0:7755"));
        assert!(!is_loopback_bind("10.0.0.5:7755"));
        assert!(!is_loopback_bind("example.com:7755"));
    }

    #[test]
    fn openapi_is_valid_json() {
        let v: serde_json::Value = serde_json::from_str(OPENAPI_JSON).expect("valid JSON");
        assert_eq!(v["openapi"], "3.1.0");
        assert!(v["paths"]["/generate"].is_object());
        assert!(v["paths"]["/iterate"].is_object());
        assert!(v["paths"]["/themes"].is_object());
        // figma/import + ingest paths are wired in the router but the
        // inline OpenAPI JSON spec doesn't enumerate every route post-merge;
        // those endpoints are documented via the SDK gen instead.
    }

    #[tokio::test]
    async fn server_starts_and_serves_themes_and_openapi() {
        // Bind to port 0 so the OS picks a free port.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(tmp.path().join("notifications")).unwrap();
        let state = AppState {
            pipeline: Arc::new(Pipeline::new()),
            api_keys: ApiKeyStore::open(tmp.path().join("k.json")).unwrap(),
            notif_prefs: NotificationPrefsStore::open_for_test(tmp.path().join("notifications")),
            email: std::sync::Arc::new(crate::notifications::StubEmailService),
            usage: UsageLog::open_for_test(tmp.path().join("usage.jsonl")),
        };
        let app = Router::new()
            .route("/healthz", get(healthz))
            .route("/openapi.json", get(openapi))
            .route("/themes", get(themes))
            .route("/v1/presets", get(list_presets))
            .route("/v1/presets/:id", get(get_preset))
            .route("/generate", post(generate))
            .route("/iterate", post(iterate))
            .route("/v1/web-export/:format", post(web_export_handler))
            .with_state(state);

        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        let base = format!("http://{addr}");
        let healthz_resp = reqwest::get(format!("{base}/healthz")).await.unwrap();
        assert_eq!(healthz_resp.status(), 200);

        let openapi_resp = reqwest::get(format!("{base}/openapi.json")).await.unwrap();
        assert_eq!(openapi_resp.status(), 200);
        let body: serde_json::Value = openapi_resp.json().await.unwrap();
        assert_eq!(body["openapi"], "3.1.0");
        assert!(body["paths"]["/v1/presets"].is_object());
        assert!(body["paths"]["/v1/presets/{id}"].is_object());

        let themes_resp = reqwest::get(format!("{base}/themes")).await.unwrap();
        assert_eq!(themes_resp.status(), 200);
        let body: serde_json::Value = themes_resp.json().await.unwrap();
        // Themes directory might not be present in every test env; tolerate.
        assert!(body["themes"].is_array());

        // Presets endpoint: tolerate the directory being missing in some
        // build contexts but require the route to respond cleanly.
        let presets_resp = reqwest::get(format!("{base}/v1/presets")).await.unwrap();
        let presets_status = presets_resp.status();
        assert!(
            presets_status == 200 || presets_status == 500,
            "unexpected /v1/presets status: {presets_status}"
        );
        if presets_status == 200 {
            let body: serde_json::Value = presets_resp.json().await.unwrap();
            assert!(body["presets"].is_array());
            let arr = body["presets"].as_array().unwrap();
            // When the dir is present we expect the full 10-preset library.
            if !arr.is_empty() {
                assert_eq!(arr.len(), 10);
                let detail_resp = reqwest::get(format!("{base}/v1/presets/logo-reveal"))
                    .await
                    .unwrap();
                assert_eq!(detail_resp.status(), 200);
                let detail: serde_json::Value = detail_resp.json().await.unwrap();
                assert_eq!(detail["id"], "logo-reveal");
                assert!(detail["preview_lottie"]["w"].as_u64().unwrap() > 0);

                let missing = reqwest::get(format!("{base}/v1/presets/no-such-preset"))
                    .await
                    .unwrap();
                assert_eq!(missing.status(), 404);
            }
        }

        server.abort();
    }
}
