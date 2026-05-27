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

/// Returns `(i, o)` in the order Lottie keyframes consume them:
///   - `i` (incoming bezier to the NEXT keyframe) uses (x2, y2)
///   - `o` (outgoing bezier from THIS keyframe) uses (x1, y1)
/// Earlier emission swapped these, producing inverted easing curves
/// that some lottie-web builds reject silently (layer disappears).
fn bezier_handles(label: EasingLabel) -> (Value, Value) {
    let [x1, y1, x2, y2] = label.canonical_bezier();
    (
        json!({ "x": [x2], "y": [y2] }), // i — incoming to next keyframe
        json!({ "x": [x1], "y": [y1] }), // o — outgoing from current keyframe
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

    /// Writes the three demo Lottie samples consumed by the marketing
    /// home page (`web/public/lottie/{corporate,playful,minimalist}.json`).
    ///
    /// Each sample exercises the full motion-feature surface — Ken
    /// Burns on the background, real text with kinetic typography,
    /// supporting shapes entering from varied directions with
    /// SpringSoft easing, cross-scene crossfade. That way the empty-
    /// state demo on the home page actually demonstrates what the
    /// product makes, not a 2-rect placeholder loop.
    ///
    /// Run on demand:
    /// `cargo test -p motion-forge-lottie-gen write_brand_samples -- --ignored --nocapture`
    /// then commit the resulting JSON files.
    #[test]
    #[ignore]
    fn write_brand_samples() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let out_dir = std::path::PathBuf::from(manifest_dir)
            .join("../../../web/public/lottie")
            .canonicalize()
            .expect("web/public/lottie must exist");
        let writer = SerdeLottieGenerator::new();
        for sample in brand_samples() {
            let out = out_dir.join(format!("{}.json", sample.name));
            writer
                .write(&sample.timeline, &out)
                .expect("write brand sample");
            eprintln!("wrote {}", out.display());
        }
    }

    struct BrandSample {
        name: &'static str,
        timeline: motion_forge_prompt_orchestrator::LottieTimeline,
    }

    fn brand_samples() -> Vec<BrandSample> {
        vec![
            BrandSample {
                name: "corporate",
                timeline: build_brand_sample(
                    BrandPalette::CORPORATE,
                    "Ship motion design same day",
                ),
            },
            BrandSample {
                name: "playful",
                timeline: build_brand_sample(
                    BrandPalette::PLAYFUL,
                    "Brief to broadcast in minutes",
                ),
            },
            BrandSample {
                name: "minimalist",
                timeline: build_brand_sample(
                    BrandPalette::MINIMALIST,
                    "Less waiting. More making.",
                ),
            },
            // Quebec-flavored sample: French copy on the SR&ED
            // (Recherche scientifique et développement experimental)
            // tax-credit explainer — the canonical Quebec/Ottawa
            // accountant pitch. Demonstrates the product on a
            // real-world bilingual use case.
            BrandSample {
                name: "quebec",
                timeline: build_brand_sample(
                    BrandPalette::QUEBEC,
                    "Vos crédits SR&ED en 60 secondes",
                ),
            },
        ]
    }

    /// (background, accent, text, supporting-card-fill, supporting-card-alt)
    struct BrandPalette {
        bg: [u8; 3],
        accent: [u8; 3],
        text: [u8; 3],
        card_a: [u8; 3],
        card_b: [u8; 3],
    }

    impl BrandPalette {
        // Deep navy + emerald — the default "agency-grade" look.
        const CORPORATE: BrandPalette = BrandPalette {
            bg: [0x0b, 0x14, 0x37],
            accent: [0x10, 0xb9, 0x81],
            text: [0xf5, 0xf7, 0xfa],
            card_a: [0x6e, 0xe7, 0xb7],
            card_b: [0x3b, 0x82, 0xf6],
        };
        // Warm amber + coral — friendlier, playful.
        const PLAYFUL: BrandPalette = BrandPalette {
            bg: [0x1c, 0x10, 0x22],
            accent: [0xf5, 0x9e, 0x0b],
            text: [0xfd, 0xf6, 0xe3],
            card_a: [0xec, 0x4f, 0x8b],
            card_b: [0xfd, 0xba, 0x74],
        };
        // Off-white + black + single emerald dot — minimalist editorial.
        const MINIMALIST: BrandPalette = BrandPalette {
            bg: [0xf7, 0xf5, 0xf0],
            accent: [0x10, 0xb9, 0x81],
            text: [0x0a, 0x0a, 0x0a],
            card_a: [0x1f, 0x1f, 0x1f],
            card_b: [0x3a, 0x3a, 0x3a],
        };
        // Quebec flag-adjacent: deep cobalt + warm gold — reads as
        // institutional / trustworthy, the palette accountants pitching
        // SR&ED claims actually want. Avoids straight national colors
        // so it doesn't read as government communication.
        const QUEBEC: BrandPalette = BrandPalette {
            bg: [0x0a, 0x1a, 0x42],     // deep cobalt
            accent: [0xfd, 0xc0, 0x4b], // warm gold
            text: [0xf8, 0xf6, 0xee],   // warm off-white
            card_a: [0x8a, 0xc7, 0xff], // pale sky
            card_b: [0xff, 0xd9, 0x80], // soft gold
        };
    }

    /// Builds a visually-dense demo Lottie that never reads as
    /// empty — even when fonts don't load or one layer fails to
    /// render, there's always 8+ shapes filling the canvas. The
    /// composition uses agency-grade motion grammar: oversized
    /// background plates that cross-fade, a hero composition with
    /// staggered card entrances from 4 directions, a moving accent
    /// strip, and kinetic text on top.
    ///
    /// French headlines get a French CTA close ("Essayez ControlCraft");
    /// detected heuristically (contains an accented char or a French
    /// stopword) so the writer doesn't need a separate flag.
    fn build_brand_sample(
        p: BrandPalette,
        headline: &str,
    ) -> motion_forge_prompt_orchestrator::LottieTimeline {
        use motion_forge_prompt_orchestrator::{
            Layer, LayerKind, LottieTimeline, Shot, TextReveal,
        };

        let cta_copy = if headline.chars().any(|c| {
            matches!(
                c,
                'à' | 'â' | 'é' | 'è' | 'ê' | 'ë' | 'î' | 'ï' | 'ô' | 'ù' | 'û' | 'ç'
            )
        }) || headline.split_whitespace().any(|w| {
            matches!(
                w.to_lowercase().as_str(),
                "vos" | "en" | "le" | "la" | "les" | "et" | "ou" | "de" | "du" | "des"
            )
        }) {
            "Essayez ControlCraft"
        } else {
            "Try ControlCraft"
        };

        const W: u32 = 1920;
        const H: u32 = 1080;
        let cx = W as f32 * 0.5;
        let cy = H as f32 * 0.5;

        // Helper: a static-during-shot rect layer that animates in
        // from `entry_dir` (unit vector) with a SpringSoft pop. Used
        // for the supporting cards so the composition feels alive
        // without any one layer doing too much.
        let card = |name: &str,
                    pos: [f32; 2],
                    size: [f32; 2],
                    fill: [u8; 3],
                    delay_s: f32,
                    entry_dir: [f32; 2],
                    kind: motion_forge_prompt_orchestrator::LayerKind|
         -> motion_forge_prompt_orchestrator::Layer {
            motion_forge_prompt_orchestrator::Layer {
                name: name.into(),
                kind,
                fill_hex: Some(fill),
                stroke_hex: None,
                text: None,
                image_asset_id: None,
                text_reveal: None,
                entry_vector: Some(entry_dir),
                keyframes: vec![
                    Keyframe {
                        time_seconds: delay_s,
                        position: pos,
                        size,
                        rotation_degrees: 0.0,
                        opacity: 0.0,
                        easing_label: EasingLabel::SpringSoft,
                    },
                    Keyframe {
                        time_seconds: delay_s + 0.6,
                        position: pos,
                        size,
                        rotation_degrees: 0.0,
                        opacity: 1.0,
                        easing_label: EasingLabel::Standard,
                    },
                    Keyframe {
                        time_seconds: 3.0,
                        position: pos,
                        size,
                        rotation_degrees: 0.0,
                        opacity: 1.0,
                        easing_label: EasingLabel::Standard,
                    },
                ],
            }
        };
        use motion_forge_prompt_orchestrator::LayerKind as LK;

        // Scene 1 (0-3s): a busy composition that always reads as
        // motion-graphic, never as a single blank rect. 9 layers:
        //   1. Oversized background panel (off-bg color)
        //   2. Accent diagonal strip (signature device)
        //   3. Far-left tall column
        //   4. Far-right tall column
        //   5. Center hero card (large)
        //   6. Top-left small badge
        //   7. Bottom-right small badge
        //   8. Center ellipse (accent dot, oversized)
        //   9. Hero headline (text on top of everything)
        let scene_a_layers = vec![
            // 1. Off-bg gradient-evoking panel (slightly lighter than
            //    bg, fills 90% of the canvas, slow scale-in).
            card(
                "scene_panel_a",
                [cx, cy],
                [W as f32 * 0.92, H as f32 * 0.86],
                p.card_a,
                0.0,
                [0.0, 0.0],
                LK::Rect,
            ),
            // 2. Diagonal accent strip (Tablix-signature device — a
            //    long thin rect angled across the canvas).
            motion_forge_prompt_orchestrator::Layer {
                name: "accent_strip".into(),
                kind: LK::Rect,
                fill_hex: Some(p.accent),
                stroke_hex: None,
                text: None,
                image_asset_id: None,
                text_reveal: None,
                entry_vector: Some([-1.0, 0.0]),
                keyframes: vec![
                    Keyframe {
                        time_seconds: 0.0,
                        position: [cx - 200.0, cy + 360.0],
                        size: [W as f32 * 1.1, 28.0],
                        rotation_degrees: -8.0,
                        opacity: 0.0,
                        easing_label: EasingLabel::Decelerate,
                    },
                    Keyframe {
                        time_seconds: 0.6,
                        position: [cx, cy + 360.0],
                        size: [W as f32 * 1.1, 28.0],
                        rotation_degrees: -8.0,
                        opacity: 1.0,
                        easing_label: EasingLabel::Standard,
                    },
                    Keyframe {
                        time_seconds: 3.0,
                        position: [cx, cy + 360.0],
                        size: [W as f32 * 1.1, 28.0],
                        rotation_degrees: -8.0,
                        opacity: 1.0,
                        easing_label: EasingLabel::Standard,
                    },
                ],
            },
            // 3-4. Side columns (palette card_b — strong color blocks).
            card(
                "col_left",
                [cx - 720.0, cy],
                [120.0, H as f32 * 0.7],
                p.card_b,
                0.2,
                [-1.0, 0.0],
                LK::Rect,
            ),
            card(
                "col_right",
                [cx + 720.0, cy],
                [120.0, H as f32 * 0.7],
                p.card_b,
                0.25,
                [1.0, 0.0],
                LK::Rect,
            ),
            // 5. Hero card center — the big visual anchor.
            card(
                "hero_card",
                [cx, cy],
                [560.0, 360.0],
                p.accent,
                0.35,
                [0.0, 1.0],
                LK::Rect,
            ),
            // 6-7. Diagonal badges top-left + bottom-right.
            card(
                "badge_tl",
                [cx - 480.0, cy - 280.0],
                [180.0, 180.0],
                p.card_a,
                0.45,
                [0.0, -1.0],
                LK::Ellipse,
            ),
            card(
                "badge_br",
                [cx + 480.0, cy + 240.0],
                [140.0, 140.0],
                p.card_b,
                0.5,
                [1.0, 1.0],
                LK::Ellipse,
            ),
            // 8. Accent dot front-and-center (large).
            card(
                "hero_dot",
                [cx + 180.0, cy - 120.0],
                [80.0, 80.0],
                p.accent,
                0.6,
                [0.7, -0.7],
                LK::Ellipse,
            ),
            // 9. Hero headline — text on top. Even if the font
            //    doesn't load, the 8 shapes below already fill the
            //    canvas with motion.
            motion_forge_prompt_orchestrator::Layer {
                name: "hero_headline".into(),
                kind: LK::Text,
                fill_hex: Some(p.text),
                stroke_hex: None,
                text: Some(headline.to_string()),
                image_asset_id: None,
                text_reveal: Some(motion_forge_prompt_orchestrator::TextReveal::WordByWord {
                    stagger_s: 0.1,
                }),
                entry_vector: None,
                keyframes: vec![
                    Keyframe {
                        time_seconds: 0.0,
                        position: [cx, cy - 240.0],
                        size: [W as f32 * 0.72, 96.0],
                        rotation_degrees: 0.0,
                        opacity: 1.0,
                        easing_label: EasingLabel::SpringSoft,
                    },
                    Keyframe {
                        time_seconds: 3.0,
                        position: [cx, cy - 240.0],
                        size: [W as f32 * 0.72, 96.0],
                        rotation_degrees: 0.0,
                        opacity: 1.0,
                        easing_label: EasingLabel::Standard,
                    },
                ],
            },
        ];

        // Scene 2 (2.7s-6s, with crossfade overlap): CTA close.
        // Also dense — accent panel + 3 corner badges + the text.
        let scene_b_layers = vec![
            // 1. Big accent panel filling most of the canvas.
            card(
                "cta_panel",
                [cx, cy],
                [W as f32 * 0.86, H as f32 * 0.78],
                p.accent,
                0.0,
                [0.0, 1.0],
                LK::Rect,
            ),
            // 2-4. Three corner badges in palette.
            card(
                "cta_tl",
                [cx - 600.0, cy - 280.0],
                [180.0, 180.0],
                p.card_a,
                0.2,
                [-1.0, -1.0],
                LK::Ellipse,
            ),
            card(
                "cta_tr",
                [cx + 600.0, cy - 280.0],
                [180.0, 180.0],
                p.card_b,
                0.25,
                [1.0, -1.0],
                LK::Ellipse,
            ),
            card(
                "cta_bl",
                [cx - 600.0, cy + 280.0],
                [140.0, 140.0],
                p.card_b,
                0.3,
                [-1.0, 1.0],
                LK::Rect,
            ),
            // 5. CTA headline on top.
            Layer {
                name: "cta_headline".into(),
                kind: LayerKind::Text,
                fill_hex: Some(p.text),
                stroke_hex: None,
                text: Some(cta_copy.to_string()),
                image_asset_id: None,
                text_reveal: Some(TextReveal::WordByWord { stagger_s: 0.14 }),
                entry_vector: None,
                keyframes: vec![
                    Keyframe {
                        time_seconds: 0.0,
                        position: [cx, cy],
                        size: [W as f32 * 0.55, 120.0],
                        rotation_degrees: 0.0,
                        opacity: 1.0,
                        easing_label: EasingLabel::SpringSoft,
                    },
                    Keyframe {
                        time_seconds: 3.0,
                        position: [cx, cy],
                        size: [W as f32 * 0.55, 120.0],
                        rotation_degrees: 0.0,
                        opacity: 1.0,
                        easing_label: EasingLabel::Standard,
                    },
                ],
            },
            // Accent dot (the Tablix-signature mark).
            Layer {
                name: "accent_dot".into(),
                kind: LayerKind::Rect,
                fill_hex: Some(p.accent),
                stroke_hex: None,
                text: None,
                image_asset_id: None,
                text_reveal: None,
                entry_vector: Some([0.0, 1.0]),
                keyframes: vec![
                    Keyframe {
                        time_seconds: 0.3,
                        position: [cx, cy + 110.0],
                        size: [18.0, 18.0],
                        rotation_degrees: 0.0,
                        opacity: 0.0,
                        easing_label: EasingLabel::SpringSoft,
                    },
                    Keyframe {
                        time_seconds: 0.8,
                        position: [cx, cy + 110.0],
                        size: [18.0, 18.0],
                        rotation_degrees: 0.0,
                        opacity: 1.0,
                        easing_label: EasingLabel::Standard,
                    },
                    Keyframe {
                        time_seconds: 3.0,
                        position: [cx, cy + 110.0],
                        size: [18.0, 18.0],
                        rotation_degrees: 0.0,
                        opacity: 1.0,
                        easing_label: EasingLabel::Standard,
                    },
                ],
            },
        ];

        LottieTimeline {
            composition_width: W,
            composition_height: H,
            duration_seconds: 5.7, // 3.0 + (3.0 - 0.3 crossfade overlap)
            frame_rate: 30.0,
            background_hex: p.bg,
            shots: vec![
                Shot {
                    start_seconds: 0.0,
                    duration_seconds: 3.0,
                    description: "[hero] open + supporting cards".into(),
                    layers: scene_a_layers,
                },
                Shot {
                    start_seconds: 2.7,
                    duration_seconds: 3.0,
                    description: "[cta] close with brand mark".into(),
                    layers: scene_b_layers,
                },
            ],
            image_assets: vec![],
        }
    }
}
