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
//! Text and Image layers are scaffolded but currently render as a
//! coloured rectangle so the timeline always plays end-to-end.

#![recursion_limit = "256"]

pub mod panelize;

use anyhow::{Context, Result};
use motion_forge_prompt_orchestrator::{Keyframe, Layer, LayerKind, LottieTimeline, Shot};
use motion_forge_style_extract::EasingLabel;
use serde_json::{Value, json};
use std::path::Path;

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

pub struct SerdeLottieGenerator;

impl SerdeLottieGenerator {
    pub fn new() -> Self {
        Self
    }
}

impl Default for SerdeLottieGenerator {
    fn default() -> Self {
        Self::new()
    }
}

impl LottieGenerator for SerdeLottieGenerator {
    fn write(&self, timeline: &LottieTimeline, out_path: &Path) -> Result<()> {
        let lottie = build_lottie(timeline);
        let body = serde_json::to_string_pretty(&lottie).context("serializing lottie")?;
        std::fs::write(out_path, body)
            .with_context(|| format!("writing {}", out_path.display()))?;
        Ok(())
    }
}

fn build_lottie(t: &LottieTimeline) -> Value {
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
            ));
            layer_index += 1;
        }
    }

    // Lottie wants the topmost layer first.
    layers.reverse();

    json!({
        "v": "5.7.0",
        "fr": t.frame_rate,
        "ip": 0,
        "op": total_frames,
        "w": t.composition_width,
        "h": t.composition_height,
        "nm": "motion-forge",
        "ddd": 0,
        "assets": [],
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
) -> Value {
    let first = layer
        .keyframes
        .first()
        .cloned()
        .unwrap_or_else(|| default_keyframe(t));
    let fill_hex = layer.fill_hex.unwrap_or([0x10, 0xb9, 0x81]);

    let shape_bbox = first.size;
    let shape = match layer.kind {
        LayerKind::Ellipse => shape_group_ellipse(shape_bbox[0], shape_bbox[1], fill_hex),
        // Text and Image fall through to a coloured rect placeholder.
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

fn animated_transform(keyframes: &[Keyframe], fps: f32) -> Value {
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

fn fill_shape(fill: [u8; 3]) -> Value {
    json!({
        "ty": "fl",
        "c": { "a": 0, "k": [fill[0] as f32 / 255.0, fill[1] as f32 / 255.0, fill[2] as f32 / 255.0, 1.0] },
        "o": { "a": 0, "k": 100 },
        "r": 1,
        "bm": 0,
    })
}

fn shape_transform() -> Value {
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
}
