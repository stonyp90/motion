//! Gemini Imagen 4 backend (Google AI Studio).
//!
//! Uses the `generativelanguage.googleapis.com` REST API — the same
//! key that works in Google AI Studio, no Vertex AI project needed.
//!
//! API reference:
//!   https://ai.google.dev/api/generate-content#v1beta.models.generateContent
//!   (imagen endpoint mirrors the same key + base URL)
//!
//! Request:
//!   POST https://generativelanguage.googleapis.com/v1beta/models/<model>:predict?key=KEY
//!   { "instances": [{"prompt": "..."}],
//!     "parameters": { "sampleCount": 1, "aspectRatio": "16:9",
//!                     "outputMimeType": "image/png" } }
//!
//! Response:
//!   { "predictions": [{ "bytesBase64Encoded": "...", "mimeType": "image/png" }] }
//!
//! Output is PNG — raster, not vector. The engine degrades gracefully
//! from SVG to PNG in the Lottie scene builder; a vectorize pass
//! (potrace or Recraft's /v1/images/vectorize) can be layered on top
//! later if full-vector output is required.
//!
//! Cost (2026): ~$0.03–0.04 per image depending on resolution.
//!
//! Env:
//!   GEMINI_API_KEY               — required; Google AI Studio key
//!   GEMINI_IMAGE_MODEL           — optional; default imagen-4.0-generate-preview-06-06

use crate::{GeneratedImage, ImageGen, ImageGenError, ImageRequest};
use async_trait::async_trait;
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL: &str = "imagen-4.0-generate-preview-06-06";

/// Cost per image in USD micros (~$0.04 → 40_000).
const COST_PER_IMAGE_MICROS: u64 = 40_000;

pub struct GeminiBackend {
    api_key: String,
    model: String,
    client: reqwest::Client,
}

impl GeminiBackend {
    pub fn new(api_key: impl Into<String>) -> Self {
        let model = std::env::var("GEMINI_IMAGE_MODEL")
            .ok()
            .filter(|v| !v.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_MODEL.into());

        Self {
            api_key: api_key.into(),
            model,
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(90))
                .build()
                .expect("reqwest client"),
        }
    }

    /// Map request dimensions to the closest Imagen aspect ratio string.
    /// Supported: "1:1" | "9:16" | "16:9" | "3:4" | "4:3"
    fn aspect_ratio(w: u32, h: u32) -> &'static str {
        let ratio = w as f32 / h as f32;
        match ratio {
            r if r >= 1.6 => "16:9",
            r if r >= 1.2 => "4:3",
            r if r >= 0.85 => "1:1",
            r if r >= 0.65 => "3:4",
            _ => "9:16",
        }
    }
}

// ---- request / response shapes ----

#[derive(Serialize)]
struct GeminiReq<'a> {
    instances: Vec<GeminiInstance<'a>>,
    parameters: GeminiParams<'a>,
}

#[derive(Serialize)]
struct GeminiInstance<'a> {
    prompt: &'a str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GeminiParams<'a> {
    sample_count: u32,
    aspect_ratio: &'a str,
    output_mime_type: &'a str,
    /// Conservative filter — leaves enough creative latitude for
    /// motion-graphic / explainer content while blocking explicit material.
    safety_filter_level: &'a str,
}

#[derive(Deserialize)]
struct GeminiResp {
    predictions: Vec<GeminiPrediction>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GeminiPrediction {
    bytes_base64_encoded: Option<String>,
    mime_type: Option<String>,
}

#[async_trait]
impl ImageGen for GeminiBackend {
    fn name(&self) -> &str {
        "gemini"
    }

    async fn generate(&self, req: &ImageRequest) -> Result<GeneratedImage, ImageGenError> {
        let aspect = Self::aspect_ratio(req.width, req.height);

        let body = GeminiReq {
            instances: vec![GeminiInstance { prompt: &req.prompt }],
            parameters: GeminiParams {
                sample_count: 1,
                aspect_ratio: aspect,
                output_mime_type: "image/png",
                safety_filter_level: "block_only_high",
            },
        };

        let url = format!(
            "{}/{}:predict?key={}",
            BASE_URL, self.model, self.api_key
        );

        let resp = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| ImageGenError::Transport(format!("gemini request: {e}")))?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(ImageGenError::Provider(format!(
                "gemini {status}: {}",
                text.chars().take(300).collect::<String>()
            )));
        }

        let parsed: GeminiResp = resp
            .json()
            .await
            .map_err(|e| ImageGenError::Provider(format!("parse gemini response: {e}")))?;

        let pred = parsed
            .predictions
            .into_iter()
            .next()
            .ok_or_else(|| ImageGenError::Provider("gemini returned no predictions".into()))?;

        let b64 = pred.bytes_base64_encoded.ok_or_else(|| {
            ImageGenError::Provider("gemini prediction missing bytesBase64Encoded".into())
        })?;

        let bytes = B64
            .decode(b64)
            .map_err(|e| ImageGenError::Provider(format!("base64 decode: {e}")))?;

        let mime = pred
            .mime_type
            .unwrap_or_else(|| "image/png".into());

        tracing::info!(
            provider = "gemini",
            model = %self.model,
            aspect = %aspect,
            bytes = bytes.len(),
            "generated image"
        );

        Ok(GeneratedImage {
            bytes,
            content_type: mime,
            provider: format!("gemini/{}", self.model),
            cost_micros: COST_PER_IMAGE_MICROS,
        })
    }
}
