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
//! Text layers with non-empty copy now emit a real Lottie text layer
//! (`ty: 5`) carrying a text document with the font face + size + fill,
//! plus a top-level `fonts.list` block so players can resolve the
//! face. Default font is Inter (bundled on every modern OS; web
//! players fall back to system sans-serif). Empty Text layers still
//! fall through to the coloured rect placeholder.
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
        "fonts": fonts_block_for(t),
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

    // Real text layer (ty=5) when the layer is Text AND has actual
    // copy. We render via Lottie's native text document so the
    // glyphs scale + animate cleanly; players that can't resolve
    // the font fall back to system fonts (Inter is bundled on most
    // modern OSes; web players fall back to sans-serif gracefully).
    if matches!(layer.kind, LayerKind::Text) {
        if let Some(copy) = layer.text.as_deref().filter(|s| !s.is_empty()) {
            return text_layer(layer, t, index, shot_in, shot_out, copy);
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
        // Text-without-copy, Image-without-asset, and any unmatched
        // variant fall through to a coloured rect placeholder.
        _ => shape_group_rect(shape_bbox[0], shape_bbox[1], fill_hex),
    };

    json!({
        "ddd": 0,
        "ind": index,
        "ty": 4,
        "nm": layer.name,
        "sr": 1,
        "ks": animated_transform_with_entry(layer, t),
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

/// The font face every text layer renders with. Hardcoded to Inter
/// (the de-facto modern UI font: GitHub, Linear, Vercel, Stripe).
/// Players that can't resolve "Inter" fall back to system sans-serif,
/// which still reads better than the rect placeholder we used to ship.
const DEFAULT_FONT_FAMILY: &str = "Inter";
const DEFAULT_FONT_NAME: &str = "Inter-Bold";

/// Emit a Lottie text layer (`ty: 5`). Renders the copy at the size
/// derived from the layer's first keyframe (using the keyframe's
/// height as the font pixel size — fits the "design a layer rectangle
/// to fit the text" convention the LLM already follows). Color uses
/// the layer's `fill_hex`, falling back to a soft white so text is
/// always legible against typical dark backgrounds.
///
/// When the layer carries a `text_reveal`, this emits a Lottie text
/// range animator alongside the document so individual words /
/// characters / lines stagger in — the agency convention for
/// kinetic typography.
fn text_layer(
    layer: &Layer,
    t: &LottieTimeline,
    index: u32,
    shot_in: u32,
    shot_out: u32,
    copy: &str,
) -> Value {
    let first = layer
        .keyframes
        .first()
        .cloned()
        .unwrap_or_else(|| default_keyframe(t));
    // Font size: use the keyframe height directly. The LLM sizes the
    // bounding box to "feel right" so reusing it for the glyph size
    // produces consistent layouts without a separate field.
    let font_size = first.size[1].clamp(16.0, 420.0);
    let fill = layer.fill_hex.unwrap_or([0xf5, 0xf5, 0xf5]);
    let fill_rgb_normalized = [
        fill[0] as f32 / 255.0,
        fill[1] as f32 / 255.0,
        fill[2] as f32 / 255.0,
    ];

    let animators = build_text_animators(layer.text_reveal.as_ref(), copy, t.frame_rate, font_size);

    json!({
        "ddd": 0,
        "ind": index,
        "ty": 5,
        "nm": layer.name,
        "sr": 1,
        "ks": animated_transform_with_entry(layer, t),
        "ao": 0,
        "t": {
            // Text document — single keyframe with the full string.
            "d": {
                "k": [{
                    "t": 0,
                    "s": {
                        "s": font_size,
                        "f": DEFAULT_FONT_NAME,
                        "t": copy,
                        // 2 = center justify so the bounding box maths
                        // already align by midpoint (matches the
                        // existing `position` semantics).
                        "j": 2,
                        "tr": 0,
                        "lh": font_size * 1.15,
                        "ls": 0,
                        "fc": fill_rgb_normalized,
                        "ca": 0,
                    }
                }]
            },
            "p": {},
            "m": { "g": 1, "a": { "a": 0, "k": [0, 0] } },
            "a": animators
        },
        "ip": shot_in,
        "op": shot_out,
        "st": shot_in,
        "bm": 0,
    })
}

/// Build the Lottie text-animator block from a [`TextReveal`].
/// Returns an empty array when no reveal is configured, which keeps
/// the wire format identical to the pre-kinetic baseline.
///
/// Mechanics: a text range animator selects words / characters /
/// lines based on a percentage range `[ne%, xe%]`. We animate the
/// range start (`ne`) from 0 → 100 over `total_reveal_sec`, and
/// attach an `a` (animator) block that sets opacity 0 + a Y-offset
/// for whichever units are currently inside the range. As the
/// range slides forward, each unit gets revealed in turn — the
/// standard agency "rise + fade in" cadence.
///
/// `t: 0` = per-character, `t: 1` = per-word, `t: 2` = per-line.
fn build_text_animators(
    reveal: Option<&motion_forge_prompt_orchestrator::TextReveal>,
    copy: &str,
    fps: f32,
    font_size: f32,
) -> Value {
    use motion_forge_prompt_orchestrator::TextReveal;
    let (range_kind, unit_count, stagger_s) = match reveal {
        None => return json!([]),
        Some(TextReveal::WordByWord { stagger_s }) => {
            (1u8, copy.split_whitespace().count().max(1), *stagger_s)
        }
        Some(TextReveal::CharByChar { stagger_s }) => (
            0u8,
            copy.chars().filter(|c| !c.is_whitespace()).count().max(1),
            *stagger_s,
        ),
        Some(TextReveal::LineByLine { stagger_s }) => {
            (2u8, copy.lines().count().max(1), *stagger_s)
        }
    };
    // Total reveal time: stagger per unit, capped so very long copy
    // doesn't take all day to land. Each unit also gets ~stagger time
    // to fade in (so consecutive units overlap by ~50%, the natural
    // "rolling wave" feel).
    let total_reveal_sec = (unit_count as f32 * stagger_s).min(5.0);
    let end_frame = (total_reveal_sec * fps).round() as i64;
    // Range slides from -100% (everything still un-revealed) to 100%
    // (everything past, fully visible). We move `ne` over time; `xe`
    // stays parked at 100. The width of the range — the "moving
    // window of in-progress units" — is implicit at 100%, which means
    // exactly one stagger-width is animating at any moment.
    json!([
        {
            "nm": "kinetic-reveal",
            "s": {
                "t": range_kind,
                "xe": { "a": 0, "k": 100, "ix": 2 },
                "ne": {
                    "a": 1,
                    "k": [
                        {
                            "t": 0,
                            "s": [0],
                            "h": 0,
                            "o": { "x": [0.16], "y": [0.0] },
                            "i": { "x": [0.84], "y": [1.0] },
                        },
                        { "t": end_frame, "s": [100] }
                    ],
                    "ix": 1
                },
                "a": { "a": 0, "k": 100, "ix": 4 },
                "b": 1,
                "rn": 0,
                "sh": 1,
                "sm": { "a": 0, "k": 100, "ix": 9 },
                "ix": 1
            },
            // Properties applied to whatever's inside the active range.
            // As the range slides, each unit transitions OUT of these
            // values into the document defaults — i.e. fades in + slides
            // up to its resting position.
            "a": {
                "p": { "a": 0, "k": [0, font_size * 0.35, 0], "ix": 2 },
                "o": { "a": 0, "k": 0, "ix": 4 }
            }
        }
    ])
}

/// Variant of `animated_transform` that bakes in an entry-vector
/// offset on the first keyframe: the layer enters from `entry_vector
/// × ENTRY_TRAVEL_PX` away from its authored position and slides to
/// rest. None = no offset (same as `animated_transform`).
fn animated_transform_with_entry(layer: &Layer, t: &LottieTimeline) -> Value {
    const ENTRY_TRAVEL_PX: f32 = 180.0;
    let Some(vec) = layer.entry_vector else {
        return animated_transform(&layer.keyframes, t.frame_rate);
    };
    if layer.keyframes.is_empty() {
        return animated_transform(&layer.keyframes, t.frame_rate);
    }
    // Clamp magnitude to 1.0 so the LLM can't fling layers off-screen.
    let mag = (vec[0] * vec[0] + vec[1] * vec[1]).sqrt().max(0.001);
    let unit = [vec[0] / mag, vec[1] / mag];
    let mut frames = layer.keyframes.clone();
    if let Some(first) = frames.first_mut() {
        first.position[0] += unit[0] * ENTRY_TRAVEL_PX;
        first.position[1] += unit[1] * ENTRY_TRAVEL_PX;
    }
    animated_transform(&frames, t.frame_rate)
}

/// Registry block for the fonts every text layer references. Lottie
/// players read this to resolve `f` (font name) in text documents to
/// an actual face — when the font isn't bundled, web players fall
/// through to system sans-serif, native players to the OS font.
fn fonts_block_for(_t: &LottieTimeline) -> Value {
    json!({
        "list": [
            {
                "origin": 0,
                "fPath": "",
                "fClass": "",
                "fFamily": DEFAULT_FONT_FAMILY,
                "fWeight": "700",
                "fStyle": "Bold",
                "fName": DEFAULT_FONT_NAME,
                "ascent": 60,
            }
        ]
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
    fn text_layer_with_word_by_word_reveal_emits_text_animator() {
        let layer = motion_forge_prompt_orchestrator::Layer {
            name: "hero".into(),
            kind: motion_forge_prompt_orchestrator::LayerKind::Text,
            fill_hex: Some([0xff, 0xff, 0xff]),
            stroke_hex: None,
            text: Some("Ship faster every quarter".into()),
            image_asset_id: None,
            text_reveal: Some(motion_forge_prompt_orchestrator::TextReveal::WordByWord {
                stagger_s: 0.1,
            }),
            entry_vector: None,
            keyframes: vec![Keyframe {
                time_seconds: 0.0,
                position: [960.0, 540.0],
                size: [800.0, 96.0],
                rotation_degrees: 0.0,
                opacity: 1.0,
                easing_label: EasingLabel::Standard,
            }],
        };
        let shot = motion_forge_prompt_orchestrator::Shot {
            start_seconds: 0.0,
            duration_seconds: 3.0,
            description: "hero".into(),
            layers: vec![layer],
        };
        let timeline = motion_forge_prompt_orchestrator::LottieTimeline {
            composition_width: 1920,
            composition_height: 1080,
            duration_seconds: 3.0,
            frame_rate: 30.0,
            background_hex: [0x0a, 0x0a, 0x0a],
            shots: vec![shot],
            image_assets: vec![],
        };

        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("out.json");
        SerdeLottieGenerator::new().write(&timeline, &path).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();

        // Text layer landed.
        let text = v["layers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|l| l["ty"].as_u64() == Some(5))
            .expect("text layer missing");

        // Animator block present with range type 1 = per-word.
        let animators = text["t"]["a"]
            .as_array()
            .expect("animators must be an array");
        assert_eq!(animators.len(), 1, "expected one kinetic animator");
        let an = &animators[0];
        assert_eq!(
            an["s"]["t"].as_u64(),
            Some(1),
            "range type should be per-word (1)"
        );
        // Selector range start animates (i.e. is a keyframe array).
        assert!(an["s"]["ne"]["a"].as_u64() == Some(1));
        // The "a" sub-object animates opacity (to 0) + Y position offset.
        assert_eq!(an["a"]["o"]["k"].as_f64(), Some(0.0));
        let p_offset = an["a"]["p"]["k"].as_array().unwrap();
        assert!(
            p_offset[1].as_f64().unwrap() > 0.0,
            "y-offset should rise into place"
        );
    }

    #[test]
    fn rect_layer_with_entry_vector_offsets_first_keyframe() {
        // Layer authored at center; entry_vector [-1, 0] means it
        // enters from the left. First keyframe's x should be < the
        // authored x by ENTRY_TRAVEL_PX (180).
        let layer = motion_forge_prompt_orchestrator::Layer {
            name: "card".into(),
            kind: motion_forge_prompt_orchestrator::LayerKind::Rect,
            fill_hex: Some([0x10, 0xb9, 0x81]),
            stroke_hex: None,
            text: None,
            image_asset_id: None,
            text_reveal: None,
            entry_vector: Some([-1.0, 0.0]),
            keyframes: vec![
                Keyframe {
                    time_seconds: 0.0,
                    position: [960.0, 540.0],
                    size: [400.0, 200.0],
                    rotation_degrees: 0.0,
                    opacity: 0.0,
                    easing_label: EasingLabel::Decelerate,
                },
                Keyframe {
                    time_seconds: 0.6,
                    position: [960.0, 540.0],
                    size: [400.0, 200.0],
                    rotation_degrees: 0.0,
                    opacity: 1.0,
                    easing_label: EasingLabel::Standard,
                },
            ],
        };
        let shot = motion_forge_prompt_orchestrator::Shot {
            start_seconds: 0.0,
            duration_seconds: 1.5,
            description: "card".into(),
            layers: vec![layer],
        };
        let timeline = motion_forge_prompt_orchestrator::LottieTimeline {
            composition_width: 1920,
            composition_height: 1080,
            duration_seconds: 1.5,
            frame_rate: 30.0,
            background_hex: [0x0a, 0x0a, 0x0a],
            shots: vec![shot],
            image_assets: vec![],
        };

        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("out.json");
        SerdeLottieGenerator::new().write(&timeline, &path).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();

        // Find the card layer (ty=4) and inspect the first position
        // keyframe — it should sit 180 px to the LEFT of the
        // authored 960 (i.e. x ≈ 780).
        let card = v["layers"]
            .as_array()
            .unwrap()
            .iter()
            .find(|l| l["nm"].as_str() == Some("card"))
            .expect("card layer");
        let p_keyframes = card["ks"]["p"]["k"].as_array().unwrap();
        let first_x = p_keyframes[0]["s"][0].as_f64().unwrap();
        assert!(
            (first_x - 780.0).abs() < 0.5,
            "entry_vector [-1,0] should offset x to ~780, got {first_x}"
        );
    }

    #[test]
    fn text_layer_with_copy_renders_as_real_lottie_text() {
        let layer = motion_forge_prompt_orchestrator::Layer {
            name: "headline".into(),
            kind: motion_forge_prompt_orchestrator::LayerKind::Text,
            fill_hex: Some([0x10, 0xb9, 0x81]),
            stroke_hex: None,
            text: Some("Ship faster".into()),
            image_asset_id: None,
            text_reveal: None,
            entry_vector: None,
            keyframes: vec![Keyframe {
                time_seconds: 0.0,
                position: [960.0, 540.0],
                size: [800.0, 96.0],
                rotation_degrees: 0.0,
                opacity: 1.0,
                easing_label: EasingLabel::Standard,
            }],
        };
        let shot = motion_forge_prompt_orchestrator::Shot {
            start_seconds: 0.0,
            duration_seconds: 2.0,
            description: "headline".into(),
            layers: vec![layer],
        };
        let timeline = motion_forge_prompt_orchestrator::LottieTimeline {
            composition_width: 1920,
            composition_height: 1080,
            duration_seconds: 2.0,
            frame_rate: 30.0,
            background_hex: [0x0a, 0x0a, 0x0a],
            shots: vec![shot],
            image_assets: vec![],
        };

        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("out.json");
        SerdeLottieGenerator::new().write(&timeline, &path).unwrap();
        let raw = std::fs::read_to_string(&path).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();

        // ty: 5 text layer landed (not the rect placeholder).
        let layers = v["layers"].as_array().unwrap();
        let text = layers
            .iter()
            .find(|l| l["ty"].as_u64() == Some(5))
            .expect("text layer (ty=5) missing");
        // Text document carries the actual copy.
        assert_eq!(
            text["t"]["d"]["k"][0]["s"]["t"].as_str(),
            Some("Ship faster")
        );
        // Font face wired through.
        assert_eq!(
            text["t"]["d"]["k"][0]["s"]["f"].as_str(),
            Some("Inter-Bold")
        );
        // Fill color normalized from rgb 0-255 → 0-1.
        let fc = text["t"]["d"]["k"][0]["s"]["fc"].as_array().unwrap();
        assert!((fc[0].as_f64().unwrap() - 0.0625).abs() < 0.01);

        // Fonts block registered at the top level.
        let fonts = v["fonts"]["list"].as_array().unwrap();
        assert!(
            fonts
                .iter()
                .any(|f| f["fName"].as_str() == Some("Inter-Bold"))
        );
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
            text_reveal: None,
            entry_vector: None,
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
