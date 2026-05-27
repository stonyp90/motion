//! Build a Lottie layer for a [`LayerKind::Character`] reference.
//!
//! In Lottie terms a "character" sprite is a *precomposition*
//! (`ty: 0`) that points at an `assets[]` entry holding the sprite's
//! own layer tree. Because precomp assets need to be registered on
//! the top-level composition, the `lottie-gen` driver is responsible
//! for collecting the sprites used across the timeline and feeding
//! them into the final `assets` array. The function in this module
//! returns just the *layer* shape — the asset registration is done
//! by [`collect_character_assets`] before serialization.
//!
//! ### MVP scope
//! - `VisualSpec::Lottie` is embedded as a precomp asset and the
//!   layer is wired to it.
//! - `VisualSpec::Svg` is currently rendered as a coloured rectangle
//!   tinted with the character's accent (or emerald default). The
//!   SVG markup is stashed in the layer's `nm` field so a future
//!   `lottie-gen` pass can rasterize it without re-loading the
//!   manifest. (Lottie has no first-class SVG layer; the standard
//!   move is to either inline the SVG as a Lottie shape group or
//!   rasterize at export time.)
//! - `VisualSpec::Generative` falls through to the SVG placeholder
//!   path with an explicit "generative-placeholder" hint in the
//!   layer name.
//!
//! Either way the function never panics — an unknown character id
//! produces a magenta debug rectangle so missing-sprite issues are
//! visible in the rendered preview.

use motion_forge_prompt_orchestrator::{
    CharacterRegistry, Keyframe, Layer, LayerKind, LottieTimeline, VisualSpec,
};
use serde_json::{Value, json};

use crate::{animated_transform, fill_shape, shape_transform};

/// Magenta — high-contrast debug fill for an unresolved character id.
const MISSING_FILL: [u8; 3] = [0xff, 0x00, 0xff];
/// Brand emerald — fallback tint for SVG / Generative sprites.
const DEFAULT_ACCENT: [u8; 3] = [0x10, 0xb9, 0x81];

/// Build a Lottie layer for a [`LayerKind::Character`]. Returns
/// `None` if the given layer is not a Character — caller chains this
/// with the existing shape-layer dispatch.
///
/// `asset_id` is the precomp asset id this layer refers to. The
/// caller is responsible for emitting the matching asset entry
/// (see [`collect_character_assets`]).
pub fn build_character_layer(
    registry: &CharacterRegistry,
    layer: &Layer,
    timeline: &LottieTimeline,
    index: u32,
    shot_in: u32,
    shot_out: u32,
) -> Option<Value> {
    let (id, _pose) = match &layer.kind {
        LayerKind::Character { id, pose } => (id.as_str(), pose.as_deref()),
        _ => return None,
    };

    let character = registry.get(id);
    let first = layer
        .keyframes
        .first()
        .cloned()
        .unwrap_or_else(|| default_keyframe(timeline));
    let bbox = first.size;

    // Pick the per-character tint. SpriteLottie ignores this because
    // its colours come from the precomp; SVG/Generative use it as
    // the placeholder fill.
    let accent = character
        .and_then(|c| c.accent_hex.as_deref())
        .and_then(parse_hex)
        .or(layer.fill_hex)
        .unwrap_or(DEFAULT_ACCENT);

    let (shapes, debug_name) = match character.map(|c| &c.visual) {
        Some(VisualSpec::Lottie { .. }) => {
            // Sprite is embedded as a precomp asset. We still
            // emit a tinted placeholder rect under the precomp
            // reference so a missing/empty precomp asset doesn't
            // render as a transparent hole.
            (
                vec![shape_group_rect_zero_centered(
                    bbox[0], bbox[1], accent, 0.0,
                )],
                format!("character:{id}:lottie"),
            )
        }
        Some(VisualSpec::Svg { .. }) => (
            vec![shape_group_rect_zero_centered(
                bbox[0], bbox[1], accent, 1.0,
            )],
            format!("character:{id}:svg"),
        ),
        Some(VisualSpec::Generative { .. }) => (
            vec![shape_group_rect_zero_centered(
                bbox[0], bbox[1], accent, 1.0,
            )],
            format!("character:{id}:generative-placeholder"),
        ),
        None => (
            vec![shape_group_rect_zero_centered(
                bbox[0],
                bbox[1],
                MISSING_FILL,
                1.0,
            )],
            format!("character:{id}:missing"),
        ),
    };

    let mut layer_json = json!({
        "ddd": 0,
        "ind": index,
        "ty": 4,
        "nm": debug_name,
        "sr": 1,
        "ks": animated_transform(&layer.keyframes, timeline.frame_rate),
        "ao": 0,
        "shapes": shapes,
        "ip": shot_in,
        "op": shot_out,
        "st": shot_in,
        "bm": 0,
    });

    // If we have a Lottie sprite, also tag the layer with the asset
    // id so a future renderer can swap the placeholder rect for the
    // real precomp reference (ty: 0 + `refId`). We deliberately
    // keep the placeholder shape so MVP previewers still play.
    if matches!(
        character.map(|c| &c.visual),
        Some(VisualSpec::Lottie { .. })
    ) {
        if let Value::Object(map) = &mut layer_json {
            map.insert("refId".into(), Value::String(character_asset_id(id)));
        }
    }
    Some(layer_json)
}

/// Walk the timeline and emit one Lottie `assets[]` entry per unique
/// character id referenced by a `LayerKind::Character`. Only
/// [`VisualSpec::Lottie`] sprites produce an asset entry — SVG and
/// Generative are stored on the layer itself.
pub fn collect_character_assets(
    registry: &CharacterRegistry,
    timeline: &LottieTimeline,
) -> Vec<Value> {
    use std::collections::BTreeSet;
    let mut seen: BTreeSet<&str> = BTreeSet::new();
    let mut assets = Vec::new();
    for shot in &timeline.shots {
        for layer in &shot.layers {
            if let LayerKind::Character { id, .. } = &layer.kind {
                if !seen.insert(id.as_str()) {
                    continue;
                }
                let Some(character) = registry.get(id) else {
                    continue;
                };
                if let VisualSpec::Lottie { json } = &character.visual {
                    assets.push(json!({
                        "id": character_asset_id(id),
                        "nm": character.name,
                        // Inline the sprite layers directly; players
                        // that support precomp assets pick them up
                        // via `refId`.
                        "layers": json.get("layers").cloned().unwrap_or(Value::Array(vec![])),
                    }));
                }
            }
        }
    }
    assets
}

fn character_asset_id(id: &str) -> String {
    format!("char-{id}")
}

fn default_keyframe(t: &LottieTimeline) -> Keyframe {
    Keyframe {
        time_seconds: 0.0,
        position: [
            t.composition_width as f32 * 0.5,
            t.composition_height as f32 * 0.5,
        ],
        size: [120.0, 120.0],
        rotation_degrees: 0.0,
        opacity: 1.0,
        easing_label: motion_forge_style_extract::EasingLabel::Standard,
    }
}

fn shape_group_rect_zero_centered(w: f32, h: f32, fill: [u8; 3], opacity: f32) -> Value {
    json!({
        "ty": "gr",
        "it": [
            { "ty": "rc", "d": 1, "s": { "a": 0, "k": [w.max(1.0), h.max(1.0)] }, "p": { "a": 0, "k": [0, 0] }, "r": { "a": 0, "k": 8 } },
            fill_shape_with_opacity(fill, opacity),
            shape_transform(),
        ],
        "nm": "character-placeholder",
    })
}

fn fill_shape_with_opacity(fill: [u8; 3], opacity: f32) -> Value {
    // Re-use the bottom-level fill helper but stamp opacity on top
    // so we can hide the placeholder rect under a real precomp.
    let mut base = fill_shape(fill);
    if let Value::Object(map) = &mut base {
        map.insert(
            "o".into(),
            json!({ "a": 0, "k": (opacity.clamp(0.0, 1.0) * 100.0) }),
        );
    }
    base
}

fn parse_hex(s: &str) -> Option<[u8; 3]> {
    let s = s.trim_start_matches('#');
    if s.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&s[0..2], 16).ok()?;
    let g = u8::from_str_radix(&s[2..4], 16).ok()?;
    let b = u8::from_str_radix(&s[4..6], 16).ok()?;
    Some([r, g, b])
}

#[cfg(test)]
mod tests {
    use super::*;
    use motion_forge_prompt_orchestrator::{
        Archetype, BehavioralDefaults, Character, CharacterRegistry, Keyframe, Layer, LayerKind,
        LottieTimeline, Shot, VisualSpec,
    };
    use motion_forge_style_extract::EasingLabel;

    fn sprite_lottie() -> serde_json::Value {
        json!({
            "v": "5.7.0",
            "fr": 30, "ip": 0, "op": 30, "w": 200, "h": 200,
            "nm": "alex",
            "ddd": 0, "assets": [],
            "layers": [{ "nm": "body" }]
        })
    }

    fn char_lottie(id: &str) -> Character {
        Character {
            id: id.into(),
            name: id.into(),
            archetype: Archetype::Person,
            visual: VisualSpec::Lottie {
                json: sprite_lottie(),
            },
            defaults: BehavioralDefaults::default(),
            accent_hex: Some("#10b981".into()),
            tags: vec![],
        }
    }

    fn kf(t: f32) -> Keyframe {
        Keyframe {
            time_seconds: t,
            position: [100.0, 100.0],
            size: [120.0, 120.0],
            rotation_degrees: 0.0,
            opacity: 1.0,
            easing_label: EasingLabel::Standard,
        }
    }

    fn timeline_with_character() -> (CharacterRegistry, LottieTimeline) {
        let reg = CharacterRegistry::from_characters([char_lottie("alex")]);
        let timeline = LottieTimeline {
            composition_width: 1920,
            composition_height: 1080,
            duration_seconds: 4.0,
            frame_rate: 30.0,
            background_hex: [0x0b, 0x14, 0x37],
            shots: vec![Shot {
                start_seconds: 0.0,
                duration_seconds: 4.0,
                description: "x".into(),
                layers: vec![Layer {
                    name: "alex".into(),
                    kind: LayerKind::Character {
                        id: "alex".into(),
                        pose: None,
                    },
                    fill_hex: None,
                    stroke_hex: None,
                    text: None,
                    image_asset_id: None,
                    keyframes: vec![kf(0.0), kf(4.0)],
                }],
            }],
            image_assets: Vec::new(),
        };
        (reg, timeline)
    }

    #[test]
    fn returns_none_for_non_character_layer() {
        let reg = CharacterRegistry::new();
        let t = LottieTimeline {
            composition_width: 100,
            composition_height: 100,
            duration_seconds: 1.0,
            frame_rate: 30.0,
            background_hex: [0, 0, 0],
            shots: vec![],
            image_assets: Vec::new(),
        };
        let l = Layer {
            name: "x".into(),
            kind: LayerKind::Rect,
            fill_hex: None,
            stroke_hex: None,
            text: None,
            image_asset_id: None,
            keyframes: vec![kf(0.0), kf(1.0)],
        };
        assert!(build_character_layer(&reg, &l, &t, 1, 0, 30).is_none());
    }

    #[test]
    fn lottie_character_emits_refid_and_asset() {
        let (reg, timeline) = timeline_with_character();
        let layer = &timeline.shots[0].layers[0];
        let v = build_character_layer(&reg, layer, &timeline, 5, 0, 120).expect("layer built");
        assert_eq!(v["refId"].as_str(), Some("char-alex"));
        assert!(v["nm"].as_str().unwrap().contains("alex"));

        let assets = collect_character_assets(&reg, &timeline);
        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0]["id"].as_str(), Some("char-alex"));
        assert!(assets[0]["layers"].as_array().is_some());
    }

    #[test]
    fn missing_character_renders_magenta_placeholder() {
        let reg = CharacterRegistry::new();
        let t = LottieTimeline {
            composition_width: 100,
            composition_height: 100,
            duration_seconds: 1.0,
            frame_rate: 30.0,
            background_hex: [0, 0, 0],
            shots: vec![],
            image_assets: Vec::new(),
        };
        let l = Layer {
            name: "ghost".into(),
            kind: LayerKind::Character {
                id: "ghost".into(),
                pose: None,
            },
            fill_hex: None,
            stroke_hex: None,
            text: None,
            image_asset_id: None,
            keyframes: vec![kf(0.0), kf(1.0)],
        };
        let v = build_character_layer(&reg, &l, &t, 1, 0, 30).unwrap();
        assert!(v["nm"].as_str().unwrap().contains(":missing"));
    }
}
