//! Gemini native image generation backend ("Nano Banana").
//!
//! Uses the `generateContent` endpoint with `responseModalities: ["IMAGE"]`
//! — NOT the Imagen `predict` endpoint. This is Google's recommended path
//! for motion-asset generation: the model reasons about the prompt before
//! generating, producing more compositionally coherent illustrations.
//!
//! API reference: https://ai.google.dev/gemini-api/docs/image-generation
//!
//! Endpoint:
//!   POST https://generativelanguage.googleapis.com/v1/models/<model>:generateContent
//!   Header: x-goog-api-key: <GEMINI_API_KEY>
//!
//! Request:
//!   { "contents": [{"parts": [{"text": "..."}]}],
//!     "generationConfig": {
//!       "responseModalities": ["TEXT", "IMAGE"],
//!       "responseFormat": { "image": { "aspectRatio": "16:9", "resolution": "1K" } }
//!     } }
//!
//! Response:
//!   { "candidates": [{ "content": { "parts": [
//!     { "inlineData": { "mimeType": "image/png", "data": "<b64>" } }
//!   ] } }] }
//!
//! Available models (2026):
//!   gemini-2.5-flash-image  — efficient, best default (the "nano banana")
//!   gemini-3.1-flash-image  — fastest, high-volume
//!   gemini-3-pro-image      — highest quality, slower
//!
//! Output is PNG. The engine's Lottie scene builder degrades gracefully
//! from SVG → PNG; a vectorize pass can be layered on later.
//!
//! Env:
//!   GEMINI_API_KEY       — required; Google AI Studio key
//!   GEMINI_IMAGE_MODEL   — optional override; default gemini-2.5-flash-image

use crate::{GeneratedImage, ImageGen, ImageGenError, ImageRequest};
use async_trait::async_trait;
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const BASE_URL: &str = "https://generativelanguage.googleapis.com/v1/models";
const DEFAULT_MODEL: &str = "gemini-2.5-flash-image";

/// ~$0.04 per image in USD micros.
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

    /// Map dimensions to the closest supported Gemini aspect ratio.
    /// Supported: 1:1 | 9:16 | 16:9 | 3:4 | 4:3 | 3:2 | 2:3 | 4:5 | 5:4
    fn aspect_ratio(w: u32, h: u32) -> &'static str {
        let r = w as f32 / h as f32;
        match r {
            r if r >= 1.70 => "16:9",
            r if r >= 1.40 => "3:2",
            r if r >= 1.15 => "4:3",
            r if r >= 0.95 => "1:1",
            r if r >= 0.77 => "5:4",
            r if r >= 0.65 => "4:5",
            r if r >= 0.55 => "3:4",
            r if r >= 0.40 => "2:3",
            _ => "9:16",
        }
    }

    /// Resolution string: motion-graphic assets at 1K is a good default;
    /// bump to 2K for hero frames if latency allows.
    fn resolution(w: u32, h: u32) -> &'static str {
        let px = w.max(h);
        match px {
            p if p >= 3000 => "4K",
            p if p >= 1500 => "2K",
            _ => "1K",
        }
    }
}

// ---- wire types ----

#[derive(Serialize)]
struct GeminiReq<'a> {
    contents: Vec<GeminiContent<'a>>,
    #[serde(rename = "generationConfig")]
    generation_config: GeminiGenConfig<'a>,
}

#[derive(Serialize)]
struct GeminiContent<'a> {
    parts: Vec<GeminiPart<'a>>,
}

#[derive(Serialize)]
struct GeminiPart<'a> {
    text: &'a str,
}

#[derive(Serialize)]
struct GeminiGenConfig<'a> {
    #[serde(rename = "responseModalities")]
    response_modalities: Vec<&'a str>,
    #[serde(rename = "responseFormat")]
    response_format: GeminiResponseFormat<'a>,
}

#[derive(Serialize)]
struct GeminiResponseFormat<'a> {
    image: GeminiImageFormat<'a>,
}

#[derive(Serialize)]
struct GeminiImageFormat<'a> {
    #[serde(rename = "aspectRatio")]
    aspect_ratio: &'a str,
    resolution: &'a str,
}

#[derive(Deserialize)]
struct GeminiResp {
    candidates: Vec<GeminiCandidate>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    content: GeminiRespContent,
}

#[derive(Deserialize)]
struct GeminiRespContent {
    parts: Vec<GeminiRespPart>,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum GeminiRespPart {
    Text { text: String },
    Image { #[serde(rename = "inlineData")] inline_data: GeminiInlineData },
}

#[derive(Deserialize)]
struct GeminiInlineData {
    #[serde(rename = "mimeType")]
    mime_type: String,
    data: String, // base64
}

#[async_trait]
impl ImageGen for GeminiBackend {
    fn name(&self) -> &str {
        "gemini"
    }

    async fn generate(&self, req: &ImageRequest) -> Result<GeneratedImage, ImageGenError> {
        let aspect = Self::aspect_ratio(req.width, req.height);
        let resolution = Self::resolution(req.width, req.height);

        let body = GeminiReq {
            contents: vec![GeminiContent {
                parts: vec![GeminiPart { text: &req.prompt }],
            }],
            generation_config: GeminiGenConfig {
                response_modalities: vec!["TEXT", "IMAGE"],
                response_format: GeminiResponseFormat {
                    image: GeminiImageFormat { aspect_ratio: aspect, resolution },
                },
            },
        };

        let url = format!("{}/{}:generateContent", BASE_URL, self.model);

        let resp = self
            .client
            .post(&url)
            .header("x-goog-api-key", &self.api_key)
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

        // Find the first image part across all candidate parts.
        let image_part = parsed
            .candidates
            .into_iter()
            .next()
            .ok_or_else(|| ImageGenError::Provider("gemini: no candidates".into()))?
            .content
            .parts
            .into_iter()
            .find_map(|p| match p {
                GeminiRespPart::Image { inline_data } => Some(inline_data),
                _ => None,
            })
            .ok_or_else(|| ImageGenError::Provider("gemini: no image part in response".into()))?;

        let bytes = B64
            .decode(&image_part.data)
            .map_err(|e| ImageGenError::Provider(format!("base64 decode: {e}")))?;

        tracing::info!(
            provider = "gemini",
            model = %self.model,
            aspect,
            resolution,
            bytes = bytes.len(),
            "generated image"
        );

        Ok(GeneratedImage {
            bytes,
            content_type: image_part.mime_type,
            provider: format!("gemini/{}", self.model),
            cost_micros: COST_PER_IMAGE_MICROS,
        })
    }
}
