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

pub mod auth;
pub mod stt_route;

use anyhow::Result;
use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
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

use crate::auth::{KeycloakAuthLayer, KeycloakConfig};
use stt_route::{SttRouteConfig, stt_stream_handler};

#[derive(Clone)]
struct AppState {
    pipeline: Arc<Pipeline>,
}

pub async fn serve(bind: &str) -> Result<()> {
    let state = AppState {
        pipeline: Arc::new(Pipeline::new()),
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

    // Keycloak auth layer for protected routes.
    let auth_cfg = KeycloakConfig::from_env();
    let auth_layer = KeycloakAuthLayer::new(auth_cfg.clone());
    if auth_cfg.issuer.is_empty() {
        tracing::warn!(
            "KEYCLOAK_ISSUER not set — only MOTION_FORGE_AUTH_FALLBACK_KEY tokens will be accepted"
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
        .layer(tower_http::limit::RequestBodyLimitLayer::new(
            32 * 1024 * 1024,
        ))
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
    Json(serde_json::json!({ "status": "ok", "service": "motion-forge" }))
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
    let work_dir = validate_path(&req.work_dir, "work_dir")?;
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
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IterateRequest {
    pub work_dir: String,
    pub prompt: String,
    pub theme: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<f32>,
    pub duration_seconds: Option<f32>,
    pub out_lottie: Option<String>,
    pub out_video: Option<String>,
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
    "title": "motion-forge",
    "version": "0.0.1",
    "description": "Local-first motion-design re-animation pipeline. Generate a Lottie animation from a reference video + text prompt, then iterate quickly by re-prompting against the cached work directory."
  },
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
    }
  },
  "components": {
    "schemas": {
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
        assert!(v["paths"]["/v1/figma/import"].is_object());
        assert!(v["components"]["schemas"]["FigmaImportRequest"].is_object());
    }

    #[tokio::test]
    async fn server_starts_and_serves_themes_and_openapi() {
        // Bind to port 0 so the OS picks a free port.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let state = AppState {
            pipeline: Arc::new(Pipeline::new()),
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
