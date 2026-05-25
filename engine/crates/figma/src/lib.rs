//! Ingest Figma frames as motion-forge characters / scene backgrounds.
//!
//! ```no_run
//! # async fn run() -> anyhow::Result<()> {
//! use motion_forge_figma::{fetch_frame, to_lottie_layer, url_parse::parse_figma_url};
//!
//! let parsed = parse_figma_url("https://www.figma.com/design/abc/Brief?node-id=1-2")?;
//! let node_id = parsed.node_id.unwrap();
//! let node = fetch_frame(&parsed.file_key, &node_id, "figd_TOKEN").await?;
//! let layer = to_lottie_layer(&node);
//! # let _ = layer; Ok(()) }
//! ```
//!
//! Two surfaces:
//!   - [`fetch_frame`] — async REST call against the Figma `/v1/files` API.
//!   - [`to_lottie_layer`] — pure conversion from a parsed `FigmaNode` to
//!     a serialisable Lottie layer (a Lottie precomp full of shape groups
//!     for FRAME/GROUP, a single shape layer for atoms).
//!
//! See [`convert`] for the conversion logic and the lossy-vs-lossless
//! contract; see [`url_parse`] for the share-URL parser.

#![recursion_limit = "256"]

pub mod convert;
pub mod url_parse;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

pub use convert::{ConversionWarning, LottieLayer, to_lottie_layer, to_lottie_layer_with_warnings};
pub use url_parse::{ParseError, ParsedFigmaUrl, parse_figma_url};

/// Base URL for the public Figma REST API.
pub const FIGMA_API_BASE: &str = "https://api.figma.com";

/// Whether the ingested frame should land as a character sprite or as a
/// full scene background. Drives downstream lottie-gen wiring.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImportKind {
    /// Treat the frame as a character sprite — centered, transparent
    /// background, no full-bleed shapes.
    Character,
    /// Treat the frame as a scene background — full-bleed, behind any
    /// foreground characters.
    Scene,
}

/// Fetch a single frame (node) from a Figma file via the REST API.
///
/// `file_key` and `node_id` are as returned by [`parse_figma_url`].
/// `token` is a personal-access or OAuth bearer token; we send it via the
/// `X-Figma-Token` header (the Figma-blessed transport for PATs).
pub async fn fetch_frame(file_key: &str, node_id: &str, token: &str) -> Result<FigmaNode> {
    let client = reqwest::Client::builder()
        .user_agent("motion-forge/0.0.1 (+https://motion.ursly.io)")
        .build()
        .context("building reqwest client")?;
    fetch_frame_with(&client, FIGMA_API_BASE, file_key, node_id, token).await
}

/// Same as [`fetch_frame`] but injectable for tests (mock base URL +
/// client). Not normally needed by callers.
pub async fn fetch_frame_with(
    client: &reqwest::Client,
    base_url: &str,
    file_key: &str,
    node_id: &str,
    token: &str,
) -> Result<FigmaNode> {
    let url = format!(
        "{base}/v1/files/{file}/nodes?ids={id}",
        base = base_url.trim_end_matches('/'),
        file = file_key,
        id = node_id,
    );
    tracing::debug!(file_key, node_id, "fetching figma node");
    let resp = client
        .get(&url)
        .header("X-Figma-Token", token)
        .send()
        .await
        .with_context(|| format!("GET {url}"))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        anyhow::bail!("Figma API {status}: {body}");
    }
    let envelope: FigmaNodesResponse = resp
        .json()
        .await
        .context("decoding Figma /v1/files/{key}/nodes response")?;
    let node = envelope
        .nodes
        .into_iter()
        .next()
        .map(|(_, v)| v.document)
        .ok_or_else(|| anyhow::anyhow!("Figma response had no nodes for id={node_id}"))?;
    Ok(node)
}

// ---- Figma API types (subset) ----
//
// Pulled directly from the public Figma REST docs. We only model the
// fields we actually use; everything else lands in `extra` so we don't
// break when Figma adds new properties.

/// Top-level shape returned by `GET /v1/files/{key}/nodes`.
#[derive(Debug, Clone, Deserialize)]
pub struct FigmaNodesResponse {
    pub nodes: std::collections::HashMap<String, FigmaNodeEnvelope>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FigmaNodeEnvelope {
    pub document: FigmaNode,
}

/// A Figma scene-graph node. Recursive; FRAME/GROUP nodes carry
/// `children`.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FigmaNode {
    pub id: String,
    pub name: String,
    /// One of: `FRAME`, `GROUP`, `RECTANGLE`, `ELLIPSE`, `VECTOR`, `LINE`,
    /// `TEXT`, `INSTANCE`, `COMPONENT`, `BOOLEAN_OPERATION`, etc.
    #[serde(rename = "type")]
    pub node_type: String,

    #[serde(default)]
    pub visible: Option<bool>,
    #[serde(default)]
    pub opacity: Option<f32>,
    #[serde(default, rename = "absoluteBoundingBox")]
    pub bounding_box: Option<BoundingBox>,
    #[serde(default)]
    pub fills: Option<Vec<Paint>>,
    #[serde(default)]
    pub strokes: Option<Vec<Paint>>,
    #[serde(default, rename = "strokeWeight")]
    pub stroke_weight: Option<f32>,
    #[serde(default, rename = "cornerRadius")]
    pub corner_radius: Option<f32>,
    #[serde(default)]
    pub effects: Option<Vec<Effect>>,
    #[serde(default, rename = "fillGeometry")]
    pub fill_geometry: Option<Vec<Geometry>>,
    #[serde(default, rename = "strokeGeometry")]
    pub stroke_geometry: Option<Vec<Geometry>>,
    /// TEXT only — the rendered string.
    #[serde(default)]
    pub characters: Option<String>,
    #[serde(default)]
    pub style: Option<TypeStyle>,
    #[serde(default)]
    pub rotation: Option<f32>,
    #[serde(default)]
    pub children: Option<Vec<FigmaNode>>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
pub struct BoundingBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Paint {
    #[serde(rename = "type")]
    pub paint_type: String,
    #[serde(default)]
    pub visible: Option<bool>,
    #[serde(default)]
    pub opacity: Option<f32>,
    /// SOLID only.
    #[serde(default)]
    pub color: Option<Color>,
    /// GRADIENT_* — the two endpoints of the gradient in normalised
    /// 0-1 coordinates relative to the node's bounding box.
    #[serde(default, rename = "gradientHandlePositions")]
    pub gradient_handles: Option<Vec<Vec2>>,
    /// GRADIENT_* — color stops along the gradient.
    #[serde(default, rename = "gradientStops")]
    pub gradient_stops: Option<Vec<GradientStop>>,
    /// IMAGE — Figma image hash. Resolving to a URL is a separate call.
    #[serde(default, rename = "imageRef")]
    pub image_ref: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
pub struct Color {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    #[serde(default = "default_alpha")]
    pub a: f32,
}

fn default_alpha() -> f32 {
    1.0
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
pub struct Vec2 {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct GradientStop {
    pub position: f32,
    pub color: Color,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Effect {
    #[serde(rename = "type")]
    pub effect_type: String,
    #[serde(default)]
    pub visible: Option<bool>,
    #[serde(default)]
    pub radius: Option<f32>,
    #[serde(default)]
    pub color: Option<Color>,
    #[serde(default)]
    pub offset: Option<Vec2>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Geometry {
    pub path: String,
    #[serde(default, rename = "windingRule")]
    pub winding_rule: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct TypeStyle {
    #[serde(default, rename = "fontFamily")]
    pub font_family: Option<String>,
    #[serde(default, rename = "fontWeight")]
    pub font_weight: Option<f32>,
    #[serde(default, rename = "fontSize")]
    pub font_size: Option<f32>,
    #[serde(default, rename = "textAlignHorizontal")]
    pub text_align_horizontal: Option<String>,
    #[serde(default, rename = "lineHeightPx")]
    pub line_height_px: Option<f32>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialise_minimal_rect_node() {
        let raw = r#"{
            "id": "1:2",
            "name": "Test Rect",
            "type": "RECTANGLE",
            "absoluteBoundingBox": { "x": 10.0, "y": 20.0, "width": 100.0, "height": 50.0 },
            "fills": [{ "type": "SOLID", "color": { "r": 0.5, "g": 0.6, "b": 0.7, "a": 1.0 } }]
        }"#;
        let node: FigmaNode = serde_json::from_str(raw).unwrap();
        assert_eq!(node.node_type, "RECTANGLE");
        assert_eq!(node.bounding_box.unwrap().width, 100.0);
        assert_eq!(node.fills.as_ref().unwrap().len(), 1);
    }

    #[test]
    fn deserialise_envelope() {
        let raw = r#"{
            "nodes": {
                "1:2": { "document": { "id": "1:2", "name": "x", "type": "FRAME" } }
            }
        }"#;
        let env: FigmaNodesResponse = serde_json::from_str(raw).unwrap();
        assert_eq!(env.nodes.len(), 1);
    }
}
