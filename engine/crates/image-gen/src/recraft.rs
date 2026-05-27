//! Recraft v3 backend.
//!
//! Recraft is the only major image-gen provider with native SVG output.
//! That matters here because:
//!   * Lottie consumes SVG paths directly — no vectorization round-trip.
//!   * Vector output scales cleanly to any aspect (16:9, 9:16, etc).
//!   * File size is a fraction of equivalent-quality PNG (~5-20 kB vs
//!     ~500 kB), so the Lottie bundle stays light.
//!
//! API reference: https://www.recraft.ai/docs/api/images-generations
//!
//! Request:  POST https://external.api.recraft.ai/v1/images/generations
//! Auth:     Authorization: Bearer ${RECRAFT_API_KEY}
//! Body:     { "prompt", "style", "model", "size", "response_format" }
//! Response: { "created": <unix>, "data": [{ "url": "...", "b64_json": null }] }
//!
//! Cost (2026): $0.04 per `recraftv3` image. Free tier 50 generations.

use crate::{GeneratedImage, ImageGen, ImageGenError, ImageRequest};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const ENDPOINT: &str = "https://external.api.recraft.ai/v1/images/generations";

/// Cost per Recraft v3 image in USD micros ($0.04 → 40_000).
const COST_PER_IMAGE_MICROS: u64 = 40_000;

pub struct RecraftBackend {
    api_key: String,
    client: reqwest::Client,
    style: String,
}

impl RecraftBackend {
    /// Default style is `vector_illustration` — flat, designer-grade
    /// vector art that matches the chrono_platform reference aesthetic.
    /// Override via `with_style` if you want photorealistic or a
    /// different illustration style.
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(60)) // Recraft generations take 5-15 s
                .build()
                .expect("reqwest client"),
            style: "vector_illustration".into(),
        }
    }

    pub fn with_style(mut self, style: impl Into<String>) -> Self {
        self.style = style.into();
        self
    }
}

#[derive(Serialize)]
struct RecraftReq<'a> {
    prompt: &'a str,
    style: &'a str,
    model: &'a str,
    size: String,
    response_format: &'a str,
}

#[derive(Deserialize)]
struct RecraftResp {
    data: Vec<RecraftImage>,
}

#[derive(Deserialize)]
struct RecraftImage {
    url: Option<String>,
    b64_json: Option<String>,
}

#[async_trait]
impl ImageGen for RecraftBackend {
    fn name(&self) -> &str {
        "recraft"
    }

    async fn generate(&self, req: &ImageRequest) -> Result<GeneratedImage, ImageGenError> {
        // Recraft supports a discrete set of sizes. Pick the closest
        // supported one. Most motion-design scenes are 16:9 or 1:1.
        let size = match (req.width, req.height) {
            (w, h) if w == h => "1024x1024",
            (w, h) if w > h => "1820x1024",
            _ => "1024x1820",
        };

        let body = RecraftReq {
            prompt: &req.prompt,
            style: &self.style,
            model: "recraftv3",
            size: size.into(),
            // `b64_json` returns the SVG inline so we don't need a
            // second round-trip to fetch from the CDN URL.
            response_format: "b64_json",
        };

        let resp = self
            .client
            .post(ENDPOINT)
            .bearer_auth(&self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|e| ImageGenError::Transport(format!("recraft request: {e}")))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ImageGenError::Provider(format!(
                "recraft {status}: {}",
                body.chars().take(300).collect::<String>()
            )));
        }

        let parsed: RecraftResp = resp
            .json()
            .await
            .map_err(|e| ImageGenError::Provider(format!("parse recraft response: {e}")))?;

        let first = parsed
            .data
            .into_iter()
            .next()
            .ok_or_else(|| ImageGenError::Provider("recraft returned no images".into()))?;

        let bytes = if let Some(b64) = first.b64_json {
            use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
            B64.decode(b64)
                .map_err(|e| ImageGenError::Provider(format!("base64 decode: {e}")))?
        } else if let Some(url) = first.url {
            // Fallback if the API ignored `response_format`.
            self.client
                .get(&url)
                .send()
                .await
                .map_err(|e| ImageGenError::Transport(format!("fetch image url: {e}")))?
                .bytes()
                .await
                .map_err(|e| ImageGenError::Transport(format!("read image body: {e}")))?
                .to_vec()
        } else {
            return Err(ImageGenError::Provider(
                "recraft data had neither url nor b64_json".into(),
            ));
        };

        // vector_illustration → SVG; other styles → PNG.
        let content_type = if self.style == "vector_illustration" {
            "image/svg+xml".to_string()
        } else {
            "image/png".to_string()
        };

        tracing::info!(
            provider = "recraft",
            style = %self.style,
            size = %size,
            bytes = bytes.len(),
            "generated image"
        );

        Ok(GeneratedImage {
            bytes,
            content_type,
            provider: "recraft".into(),
            cost_micros: COST_PER_IMAGE_MICROS,
        })
    }
}
