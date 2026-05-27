//! Serializes a `LottieTimeline` into a valid Lottie JSON file (the
//! same file is also valid input to a dotLottie packer; we ship raw
//! .json for now to keep dep count low — players accept both).
//!
//! Supports:
//! - Rect, Ellipse layers with keyframed position / size / rotation /
//!   opacity / fill
//! - Background color via a full-frame rect layer at z-bottom
//! - Cubic-bezier easing labels mapped to canonical Material 3 curves
//!
//! Text layers are scaffolded but currently render as a coloured
//! rectangle so the timeline always plays end-to-end.
//!
//! Image layers with an `image_asset_id` reference are emitted as
//! proper Lottie `ty: 2` image layers, with the asset bytes embedded
//! inline in `assets[]` as a base64 data-URI (`data:image/svg+xml;…`).
//! This is what the generative pipeline uses to bake per-scene Recraft
//! SVGs into the rendered Lottie. Image layers WITHOUT an asset id
//! still fall through to the rect placeholder.

#![recursion_limit = "256"]

pub mod character_layer;
pub mod panelize;

use anyhow::{Context, Result};
use motion_forge_prompt_orchestrator::{
    CharacterRegistry, Keyframe, Layer, LayerKind, LottieTimeline, Shot,
};
use motion_forge_style_extract::EasingLabel;
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;

/// Write a pre-built Lottie `serde_json::Value` to disk as pretty JSON.
/// Lets [`panelize`] callers reuse the same on-disk format as
/// [`SerdeLottieGenerator`].
pub fn write_lottie_value(value: &Value, out_path: &Path) -> Result<()> {
    let body = serde_json::to_string_pretty(value).context("serializing lottie value")?;
    std::fs::write(out_path, body).with_context(|| format!("writing {}", out_path.display()))?;
    Ok(())
}

pub trait LottieGenerator {
    fn write(&self, timeline: &LottieTimeline, out_path: &Path) -> Result<()>;
}

pub struct SerdeLottieGenerator {
    pub character_registry: Arc<CharacterRegistry>,
}

impl SerdeLottieGenerator {
    pub fn new() -> Self {
        Self {
            character_registry: Arc::new(CharacterRegistry::new()),
        }
    }

    /// Builder: attach the character registry the generator will use
    /// when resolving [`LayerKind::Character`] layers. Without this
    /// the generator falls back to the empty registry and any
    /// character layer renders as the magenta debug placeholder.
    pub fn with_character_registry(mut self, registry: Arc<CharacterRegistry>) -> Self {
        self.character_registry = registry;
        self
    }
}

impl Default for SerdeLottieGenerator {
    fn default() -> Self {
        Self::new()
    }
}

impl LottieGenerator for SerdeLottieGenerator {
    fn write(&self, timeline: &LottieTimeline, out_path: &Path) -> Result<()> {
        let lottie = build_lottie(timeline, &self.character_registry);
        let body = serde_json::to_string_pretty(&lottie).context("serializing lottie")?;
        std::fs::write(out_path, body)
            .with_context(|| format!("writing {}", out_path.display()))?;
        Ok(())
    }
}

fn build_lottie(t: &LottieTimeline, registry: &CharacterRegistry) -> Value {
    let total_frames = (t.duration_seconds * t.frame_rate).max(1.0).round() as u32;
    let mut layers: Vec<Value> = Vec::new();
    let mut layer_index = 1u32;

    // Background rectangle.
    layers.push(background_layer(t, layer_index, total_frames));
    layer_index += 1;

    for shot in &t.shots {
        let shot_in = (shot.start_seconds * t.frame_rate).round() as u32;
        let shot_out = ((shot.start_seconds + shot.duration_seconds) * t.frame_rate).round() as u32;
        for layer in &shot.layers {
            layers.push(build_shape_layer(
                layer,
                t,
                layer_index,
                shot,
                shot_in,
                shot_out,
                registry,
            ));
            layer_index += 1;
        }
    }

    // Lottie wants the topmost layer first.
    layers.reverse();

    let mut assets = character_layer::collect_character_assets(registry, t);
    for img in &t.image_assets {
        assets.push(json!({
            "id": img.id,
            "w": img.width,
            "h": img.height,
            "u": "",
            "p": format!("data:{};base64,{}", img.mime, img.data_b64),
            "e": 1,
        }));
    }

    json!({
        "v": "5.7.0",
        "fr": t.frame_rate,
        "ip": 0,
        "op": total_frames,
        "w": t.composition_width,
        "h": t.composition_height,
        "nm": "motion-forge",
        "ddd": 0,
        "assets": assets,
        "layers": layers,
    })
}

fn background_layer(t: &LottieTimeline, index: u32, total_frames: u32) -> Value {
    let cx = t.composition_width as f32 * 0.5;
    let cy = t.composition_height as f32 * 0.5;
    json!({
        "ddd": 0,
        "ind": index,
        "ty": 4,
        "nm": "background",
        "sr": 1,
        "ks": static_transform(cx, cy, t.composition_width as f32, t.composition_height as f32),
        "ao": 0,
        "shapes": [
            shape_group_rect(t.composition_width as f32, t.composition_height as f32, t.background_hex)
        ],
        "ip": 0,
        "op": total_frames,
        "st": 0,
        "bm": 0,
    })
}

fn build_shape_layer(
    layer: &Layer,
    t: &LottieTimeline,
    index: u32,
    _shot: &Shot,
    shot_in: u32,
    shot_out: u32,
    registry: &CharacterRegistry,
) -> Value {
    // Character layers go through the dedicated builder so they can
    // emit `refId` + a placeholder rect against the precomp asset.
    if matches!(&layer.kind, LayerKind::Character { .. }) {
        if let Some(v) =
            character_layer::build_character_layer(registry, layer, t, index, shot_in, shot_out)
        {
            return v;
        }
    }

    // Generative image layer: when an Image layer has an attached
    // asset id, emit a Lottie image layer (ty=2) referencing the
    // base64 data-URI asset we appended in `build_lottie`.
    if matches!(layer.kind, LayerKind::Image) {
        if let Some(asset_id) = layer.image_asset_id.as_deref() {
            return image_layer(layer, t, index, shot_in, shot_out, asset_id);
        }
    }

    let first = layer
        .keyframes
        .first()
        .cloned()
        .unwrap_or_else(|| default_keyframe(t));
    let fill_hex = layer.fill_hex.unwrap_or([0x10, 0xb9, 0x81]);

    let shape_bbox = first.size;
    let shape = match layer.kind {
        LayerKind::Ellipse => shape_group_ellipse(shape_bbox[0], shape_bbox[1], fill_hex),
        // Text, Image-without-asset, and any unmatched variant fall
        // through to a coloured rect placeholder.
        _ => shape_group_rect(shape_bbox[0], shape_bbox[1], fill_hex),
    };

    json!({
        "ddd": 0,
        "ind": index,
        "ty": 4,
        "nm": layer.name,
        "sr": 1,
        "ks": animated_transform(&layer.keyframes, t.frame_rate),
        "ao": 0,
        "shapes": [shape],
        "ip": shot_in,
        "op": shot_out,
        "st": shot_in,
        "bm": 0,
    })
}

/// Emit a proper Lottie image layer (`ty: 2`) referencing an asset
/// id appended to the timeline's `assets[]` array. The layer's
/// keyframed transform animates the image — typical use is a slow
/// Ken-Burns zoom over the scene's duration with the generated SVG
/// as the background plate.
fn image_layer(
    layer: &Layer,
    t: &LottieTimeline,
    index: u32,
    shot_in: u32,
    shot_out: u32,
    asset_id: &str,
) -> Value {
    json!({
        "ddd": 0,
        "ind": index,
        "ty": 2,
        "nm": layer.name,
        "refId": asset_id,
        "sr": 1,
        "ks": animated_transform(&layer.keyframes, t.frame_rate),
        "ao": 0,
        "ip": shot_in,
        "op": shot_out,
        "st": shot_in,
        "bm": 0,
    })
}

fn default_keyframe(t: &LottieTimeline) -> Keyframe {
    Keyframe {
        time_seconds: 0.0,
        position: [
            t.composition_width as f32 * 0.5,
            t.composition_height as f32 * 0.5,
        ],
        size: [100.0, 100.0],
        rotation_degrees: 0.0,
        opacity: 1.0,
        easing_label: EasingLabel::Standard,
    }
}

fn static_transform(cx: f32, cy: f32, _w: f32, _h: f32) -> Value {
    json!({
        "o": { "a": 0, "k": 100 },
        "r": { "a": 0, "k": 0 },
        "p": { "a": 0, "k": [cx, cy, 0] },
        "a": { "a": 0, "k": [0, 0, 0] },
        "s": { "a": 0, "k": [100, 100, 100] },
    })
}

pub(crate) fn animated_transform(keyframes: &[Keyframe], fps: f32) -> Value {
    if keyframes.len() < 2 {
        let kf = keyframes.first().cloned().unwrap_or(Keyframe {
            time_seconds: 0.0,
            position: [0.0, 0.0],
            size: [100.0, 100.0],
            rotation_degrees: 0.0,
            opacity: 1.0,
            easing_label: EasingLabel::Standard,
        });
        return json!({
            "o": { "a": 0, "k": kf.opacity * 100.0 },
            "r": { "a": 0, "k": kf.rotation_degrees },
            "p": { "a": 0, "k": [kf.position[0], kf.position[1], 0] },
            "a": { "a": 0, "k": [0, 0, 0] },
            "s": { "a": 0, "k": [100.0, 100.0, 100.0] },
        });
    }
    json!({
        "o": animated_scalar(keyframes, fps, |kf| kf.opacity * 100.0),
        "r": animated_scalar(keyframes, fps, |kf| kf.rotation_degrees),
        "p": animated_vec(keyframes, fps, |kf| [kf.position[0], kf.position[1], 0.0]),
        "a": { "a": 0, "k": [0, 0, 0] },
        "s": animated_vec(keyframes, fps, |kf| {
            let base = kf.size;
            // Lottie scale is in percent; map our absolute size to scale
            // relative to the first keyframe's size.
            let first = keyframes[0].size;
            [
                if first[0].abs() > 1e-3 { base[0] / first[0] * 100.0 } else { 100.0 },
                if first[1].abs() > 1e-3 { base[1] / first[1] * 100.0 } else { 100.0 },
                100.0,
            ]
        }),
    })
}

fn animated_scalar<F: Fn(&Keyframe) -> f32>(keyframes: &[Keyframe], fps: f32, f: F) -> Value {
    let entries: Vec<Value> = keyframes
        .windows(2)
        .map(|w| {
            let from = &w[0];
            let to = &w[1];
            let (i, o) = bezier_handles(to.easing_label);
            json!({
                "t": (from.time_seconds * fps).round(),
                "s": [f(from)],
                "e": [f(to)],
                "i": i,
                "o": o,
            })
        })
        .chain(std::iter::once_with(|| {
            let last = keyframes.last().unwrap();
            json!({
                "t": (last.time_seconds * fps).round(),
                "s": [f(last)],
            })
        }))
        .collect();
    json!({ "a": 1, "k": entries })
}

fn animated_vec<F: Fn(&Keyframe) -> [f32; 3]>(keyframes: &[Keyframe], fps: f32, f: F) -> Value {
    let entries: Vec<Value> = keyframes
        .windows(2)
        .map(|w| {
            let from = &w[0];
            let to = &w[1];
            let (i, o) = bezier_handles(to.easing_label);
            json!({
                "t": (from.time_seconds * fps).round(),
                "s": f(from),
                "e": f(to),
                "i": i,
                "o": o,
            })
        })
        .chain(std::iter::once_with(|| {
            let last = keyframes.last().unwrap();
            json!({
                "t": (last.time_seconds * fps).round(),
                "s": f(last),
            })
        }))
        .collect();
    json!({ "a": 1, "k": entries })
}

fn bezier_handles(label: EasingLabel) -> (Value, Value) {
    let [x1, y1, x2, y2] = label.canonical_bezier();
    (
        json!({ "x": [x1], "y": [y1] }),
        json!({ "x": [x2], "y": [y2] }),
    )
}

fn shape_group_rect(w: f32, h: f32, fill: [u8; 3]) -> Value {
    json!({
        "ty": "gr",
        "it": [
            { "ty": "rc", "d": 1, "s": { "a": 0, "k": [w, h] }, "p": { "a": 0, "k": [0, 0] }, "r": { "a": 0, "k": 0 } },
            fill_shape(fill),
            shape_transform(),
        ],
        "nm": "rect",
    })
}

fn shape_group_ellipse(w: f32, h: f32, fill: [u8; 3]) -> Value {
    json!({
        "ty": "gr",
        "it": [
            { "ty": "el", "d": 1, "s": { "a": 0, "k": [w, h] }, "p": { "a": 0, "k": [0, 0] } },
            fill_shape(fill),
            shape_transform(),
        ],
        "nm": "ellipse",
    })
}

pub(crate) fn fill_shape(fill: [u8; 3]) -> Value {
    json!({
        "ty": "fl",
        "c": { "a": 0, "k": [fill[0] as f32 / 255.0, fill[1] as f32 / 255.0, fill[2] as f32 / 255.0, 1.0] },
        "o": { "a": 0, "k": 100 },
        "r": 1,
        "bm": 0,
    })
}

pub(crate) fn shape_transform() -> Value {
    json!({
        "ty": "tr",
        "p": { "a": 0, "k": [0, 0] },
        "a": { "a": 0, "k": [0, 0] },
        "s": { "a": 0, "k": [100, 100] },
        "r": { "a": 0, "k": 0 },
        "o": { "a": 0, "k": 100 },
        "sk": { "a": 0, "k": 0 },
        "sa": { "a": 0, "k": 0 },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use motion_forge_prompt_orchestrator::fallback_timeline;
    use motion_forge_style_extract::{ShotRhythm, StyleCard};

    fn empty_card() -> StyleCard {
        StyleCard {
            palette: vec![],
            easing_presets: vec![],
            shot_rhythm: ShotRhythm {
                shot_count: 0,
                mean_seconds: 0.0,
                stddev_seconds: 0.0,
            },
            transitions: vec![],
            dominant_classes: vec![],
        }
    }

    #[test]
    fn writes_valid_lottie_for_fallback_timeline() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("out.json");
        let t = fallback_timeline("test", &empty_card(), 1920, 1080, 30.0, 6.0);
        SerdeLottieGenerator::new().write(&t, &path).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(v["v"].as_str(), Some("5.7.0"));
        assert_eq!(v["w"].as_u64(), Some(1920));
        assert!(v["layers"].as_array().unwrap().len() >= 2);
    }

    #[test]
    fn emits_image_layer_and_asset_entry_when_layer_has_asset_id() {
        // Build a minimal timeline with a single shot containing an
        // Image layer that references an asset; confirm the renderer
        // outputs a `ty: 2` layer + a matching `assets[]` entry with
        // an inline data-URI.
        let asset = motion_forge_prompt_orchestrator::ImageAsset {
            id: "scene_1_0".into(),
            mime: "image/svg+xml".into(),
            data_b64: "PHN2Zy8+".into(), // "<svg/>" base64
            width: 1024,
            height: 1024,
        };
        let layer = motion_forge_prompt_orchestrator::Layer {
            name: "bg".into(),
            kind: motion_forge_prompt_orchestrator::LayerKind::Image,
            fill_hex: None,
            stroke_hex: None,
            text: None,
            image_asset_id: Some("scene_1_0".into()),
            keyframes: vec![Keyframe {
                time_seconds: 0.0,
                position: [512.0, 512.0],
                size: [1024.0, 1024.0],
                rotation_degrees: 0.0,
                opacity: 1.0,
                easing_label: EasingLabel::Standard,
            }],
        };
        let shot = motion_forge_prompt_orchestrator::Shot {
            start_seconds: 0.0,
            duration_seconds: 3.0,
            description: "[1.0] hero".into(),
            layers: vec![layer],
        };
        let timeline = motion_forge_prompt_orchestrator::LottieTimeline {
            composition_width: 1024,
            composition_height: 1024,
            duration_seconds: 3.0,
            frame_rate: 30.0,
            background_hex: [0x0a, 0x0a, 0x0a],
            shots: vec![shot],
            image_assets: vec![asset],
        };

        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("out.json");
        SerdeLottieGenerator::new().write(&timeline, &path).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();

        // Asset is present with the right data-URI prefix.
        let assets = v["assets"].as_array().unwrap();
        let img_asset = assets
            .iter()
            .find(|a| a["id"].as_str() == Some("scene_1_0"))
            .expect("image asset missing");
        assert!(
            img_asset["p"]
                .as_str()
                .unwrap()
                .starts_with("data:image/svg+xml;base64,")
        );
        assert_eq!(img_asset["e"].as_u64(), Some(1));

        // The shot's image layer rendered as `ty: 2` with the right refId.
        let layers = v["layers"].as_array().unwrap();
        let image_layer = layers
            .iter()
            .find(|l| l["ty"].as_u64() == Some(2))
            .expect("ty:2 image layer missing");
        assert_eq!(image_layer["refId"].as_str(), Some("scene_1_0"));
    }
}
