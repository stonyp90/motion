//! ControlCraft's per-scene image generation.
//!
//! Closes the asset-library quality gap by generating bespoke
//! illustrations on demand. The LLM scene-decomposer in
//! `prompt-orchestrator` emits one `illustration_prompt` per scene; this
//! crate turns each prompt into an SVG that the Lottie scene templates
//! drop in as the visual layer.
//!
//! Backend hierarchy (preferred → fallback):
//!
//!   1. **Recraft v3** — native SVG output (`vector_illustration` style),
//!      ~$0.04/image, 5-15 s latency. Best fit for motion-graphic
//!      illustrations because the output is already vector so it
//!      animates cleanly without raster→vector loss.
//!   2. **Imagen 4 / DALL-E 3** (not yet implemented) — PNG output,
//!      requires a vectorize pass (potrace or Recraft's vectorize
//!      endpoint) before the Lottie template can use it.
//!
//! Each backend implements the `ImageGen` trait so the engine picks
//! the right one at boot from `MOTION_FORGE_IMAGE_BACKEND`.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

pub mod gemini;
pub mod recraft;
pub mod svg_sanitize;

pub use gemini::GeminiBackend;
pub use recraft::RecraftBackend;

/// What a caller wants generated. Stays minimal on purpose — anything
/// model-specific (e.g. Recraft's `style` field) is set inside the
/// backend so callers don't need to know provider details.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageRequest {
    /// Natural-language description. Should be ≤ 1000 chars; longer
    /// prompts get truncated by most providers and produce mediocre
    /// results.
    pub prompt: String,
    /// Target dimensions. Most providers support a discrete set; the
    /// backend picks the closest supported size. Default is square 1024.
    pub width: u32,
    pub height: u32,
    /// Optional negative prompt — what the model should AVOID. Recraft
    /// ignores this today; OpenAI does too. Reserved for future SDXL
    /// integration.
    pub negative_prompt: Option<String>,
}

impl ImageRequest {
    pub fn new(prompt: impl Into<String>) -> Self {
        Self {
            prompt: prompt.into(),
            width: 1024,
            height: 1024,
            negative_prompt: None,
        }
    }

    pub fn with_dims(mut self, w: u32, h: u32) -> Self {
        self.width = w;
        self.height = h;
        self
    }
}

/// A generated image, returned as bytes. The caller decides what to do
/// with it (write to disk, base64-encode for embedding in a Lottie
/// asset, vectorize via potrace, etc).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneratedImage {
    /// Raw bytes. SVG is UTF-8 text; PNG/JPG are binary.
    pub bytes: Vec<u8>,
    /// MIME type — `image/svg+xml`, `image/png`, etc.
    pub content_type: String,
    /// Provider that produced this image. For analytics + cost tracking.
    pub provider: String,
    /// Per-image cost in USD micros (e.g. $0.04 → 40_000). Used to
    /// charge usage back to the principal in the engine's usage log.
    pub cost_micros: u64,
}

#[derive(Debug, thiserror::Error)]
pub enum ImageGenError {
    #[error("missing config: {0}")]
    MissingConfig(String),
    #[error("provider error: {0}")]
    Provider(String),
    #[error("transport: {0}")]
    Transport(String),
}

#[async_trait]
pub trait ImageGen: Send + Sync {
    /// Short provider identifier — `recraft`, `dalle`, `imagen`.
    fn name(&self) -> &str;

    /// Generate a single image. Should be infallible-recoverable: a 5xx
    /// from the provider returns `ImageGenError::Transport` so the
    /// caller can fall through to a backup backend.
    async fn generate(&self, req: &ImageRequest) -> Result<GeneratedImage, ImageGenError>;
}

/// Boot the configured backend from env.
///
/// Selection order:
///   1. `MOTION_FORGE_IMAGE_BACKEND` explicit override ("recraft" | "gemini")
///   2. Auto-detect from whichever API key is present (Recraft beats Gemini
///      when both are set, because Recraft returns native SVG).
///   3. Error with a clear message if nothing is configured.
///
/// Env:
///   MOTION_FORGE_IMAGE_BACKEND  — "recraft" | "gemini"
///   RECRAFT_API_KEY             — required when backend = "recraft"
///   GEMINI_API_KEY              — required when backend = "gemini"
///   GEMINI_IMAGE_MODEL          — optional Gemini model override
pub fn backend_from_env() -> Result<Box<dyn ImageGen>, ImageGenError> {
    // Empty env vars are treated as unset. Otherwise an unset-with-quotes
    // (`RECRAFT_API_KEY=""`) trips into "key present" and produces a
    // 400 from the provider instead of cleanly falling back to text-only.
    let env_nonempty = |k: &str| {
        std::env::var(k)
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    };

    let pick = env_nonempty("MOTION_FORGE_IMAGE_BACKEND").or_else(|| {
        // Auto-detect: Recraft (SVG) preferred over Gemini (PNG).
        env_nonempty("RECRAFT_API_KEY")
            .map(|_| "recraft".into())
            .or_else(|| env_nonempty("GEMINI_API_KEY").map(|_| "gemini".into()))
    });

    match pick.as_deref() {
        Some("recraft") => {
            let key = env_nonempty("RECRAFT_API_KEY")
                .ok_or_else(|| ImageGenError::MissingConfig("RECRAFT_API_KEY not set".into()))?;
            Ok(Box::new(RecraftBackend::new(key)))
        }
        Some("gemini") | Some("imagen") => {
            let key = env_nonempty("GEMINI_API_KEY")
                .ok_or_else(|| ImageGenError::MissingConfig("GEMINI_API_KEY not set".into()))?;
            Ok(Box::new(GeminiBackend::new(key)))
        }
        Some(other) => Err(ImageGenError::MissingConfig(format!(
            "unknown MOTION_FORGE_IMAGE_BACKEND={other} (supported: recraft, gemini)"
        ))),
        None => Err(ImageGenError::MissingConfig(
            "no image backend configured; set RECRAFT_API_KEY or GEMINI_API_KEY".into(),
        )),
    }
}
