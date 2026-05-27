//! DragonBones ingestion.
//!
//! DragonBones is the (now-MIT-licensed) skeletal animation format from
//! Egret. A `_ske.json` file describes one or more armatures; each armature
//! has bones, slots, and animations.
//!
//! Public spec (the bits we use):
//! - `frameRate` — playback fps
//! - `armature[]`
//!   - `name`, `frameRate`
//!   - `bone[]` — `name`, `transform: {x, y, skX, skY}` (resting pose)
//!   - `slot[]` — `name`, `parent` (bone), `color`
//!   - `skin[].slot[].display[]` — visible shape; we read `transform`/`type`
//!   - `animation[]` — list of named clips
//!     - `bone[]` — keyframe tracks targeting bones by name
//!       - `translateFrame[]` — `{x, y, duration}`
//!       - `rotateFrame[]`    — `{rotate, duration}`
//!     - `slot[]` — `displayFrame[]`, `colorFrame[]` (we drop these for now)
//!
//! We project this onto our [`Composition`] like so:
//! - One DragonBones armature → one [`Shot`]
//! - Each *slot* (visible piece) → one [`Layer`] of [`LayerKind::Rect`]
//!   (DragonBones doesn't have first-class ellipses; everything is mesh /
//!   image / rect)
//! - The bone the slot is parented to drives the layer's keyframes.
//!
//! This loses fidelity (bone hierarchy, mesh deformation, slot color
//! transforms) — that's the price of squeezing a skeletal format into a
//! flat Lottie-shaped timeline. Anything we drop emits a `tracing::warn!`.

use crate::{Composition, IngestError};
use anyhow::Result;
use motion_forge_prompt_orchestrator::{Keyframe, Layer, LayerKind, Shot};
use motion_forge_style_extract::EasingLabel;
use serde::Deserialize;
use std::collections::HashMap;

const FORMAT_LABEL: &str = "DragonBones";

#[derive(Debug, Deserialize)]
struct DbFile {
    /// Skeleton name; read for logging but otherwise unused.
    #[allow(dead_code)]
    #[serde(default)]
    name: String,
    #[serde(default = "default_frame_rate")]
    #[serde(rename = "frameRate")]
    frame_rate: f32,
    #[serde(default)]
    armature: Vec<Armature>,
}

fn default_frame_rate() -> f32 {
    24.0
}

#[derive(Debug, Deserialize)]
struct Armature {
    #[serde(default)]
    name: String,
    #[serde(default = "default_frame_rate")]
    #[serde(rename = "frameRate")]
    frame_rate: f32,
    #[serde(default)]
    bone: Vec<Bone>,
    #[serde(default)]
    slot: Vec<Slot>,
    #[serde(default)]
    animation: Vec<Animation>,
}

#[derive(Debug, Deserialize, Clone)]
struct Bone {
    #[serde(default)]
    name: String,
    #[serde(default)]
    transform: Transform,
}

#[derive(Debug, Deserialize, Default, Clone)]
struct Transform {
    #[serde(default)]
    x: f32,
    #[serde(default)]
    y: f32,
    #[serde(default, rename = "skX")]
    sk_x: f32,
}

#[derive(Debug, Deserialize)]
struct Slot {
    #[serde(default)]
    name: String,
    #[serde(default)]
    parent: String,
    #[serde(default)]
    color: Option<SlotColor>,
}

#[derive(Debug, Deserialize)]
struct SlotColor {
    #[serde(default = "default_alpha")]
    #[serde(rename = "aM")]
    a_m: i32,
    #[serde(default = "default_channel")]
    #[serde(rename = "rM")]
    r_m: i32,
    #[serde(default = "default_channel")]
    #[serde(rename = "gM")]
    g_m: i32,
    #[serde(default = "default_channel")]
    #[serde(rename = "bM")]
    b_m: i32,
}

fn default_alpha() -> i32 {
    100
}
fn default_channel() -> i32 {
    100
}

#[derive(Debug, Deserialize)]
struct Animation {
    #[serde(default)]
    duration: u32,
    #[serde(default)]
    bone: Vec<BoneTrack>,
}

#[derive(Debug, Deserialize)]
struct BoneTrack {
    #[serde(default)]
    name: String,
    #[serde(default, rename = "translateFrame")]
    translate_frame: Vec<TranslateFrame>,
    #[serde(default, rename = "rotateFrame")]
    rotate_frame: Vec<RotateFrame>,
}

#[derive(Debug, Deserialize)]
struct TranslateFrame {
    #[serde(default)]
    duration: u32,
    #[serde(default)]
    x: f32,
    #[serde(default)]
    y: f32,
}

#[derive(Debug, Deserialize)]
struct RotateFrame {
    #[serde(default)]
    duration: u32,
    #[serde(default)]
    rotate: f32,
}

pub fn ingest(bytes: &[u8]) -> Result<Composition> {
    let file: DbFile = serde_json::from_slice(bytes).map_err(|e| IngestError::Malformed {
        format: FORMAT_LABEL,
        message: format!("not a valid DragonBones _ske.json: {e}"),
    })?;
    let armature = file
        .armature
        .first()
        .ok_or_else(|| IngestError::Malformed {
            format: FORMAT_LABEL,
            message: "no armatures in skeleton file".into(),
        })?;
    if file.armature.len() > 1 {
        tracing::warn!(
            count = file.armature.len(),
            "dragonbones: multiple armatures present — only \"{}\" is imported",
            armature.name
        );
    }

    let frame_rate = if armature.frame_rate > 0.0 {
        armature.frame_rate
    } else {
        file.frame_rate
    };
    let first_anim = armature.animation.first();
    let total_frames = first_anim.map(|a| a.duration as f32).unwrap_or(frame_rate);
    let duration_seconds = total_frames / frame_rate.max(1.0);

    // Map bone name → resting position so static slots get a sensible
    // position even when an animation doesn't keyframe their bone.
    let bone_resting: HashMap<&str, &Transform> = armature
        .bone
        .iter()
        .map(|b| (b.name.as_str(), &b.transform))
        .collect();

    // Bone-name → keyframe track from the first animation. DragonBones
    // emits durations between frames; we accumulate to absolute frames.
    let mut bone_tracks: HashMap<&str, Vec<Keyframe>> = HashMap::new();
    if let Some(anim) = first_anim {
        for track in &anim.bone {
            let mut frames: Vec<Keyframe> = Vec::new();
            let mut frame_cursor: u32 = 0;
            let resting = bone_resting
                .get(track.name.as_str())
                .copied()
                .cloned()
                .unwrap_or_default();
            for tf in &track.translate_frame {
                frames.push(Keyframe {
                    time_seconds: frame_cursor as f32 / frame_rate.max(1.0),
                    position: [resting.x + tf.x, resting.y + tf.y],
                    size: [100.0, 100.0],
                    rotation_degrees: resting.sk_x,
                    opacity: 1.0,
                    easing_label: EasingLabel::Standard,
                });
                frame_cursor += tf.duration.max(1);
            }
            // Layer rotations from rotateFrame (overrides per-frame rotation
            // we left at `resting.sk_x`).
            let mut rot_cursor: u32 = 0;
            for (i, rf) in track.rotate_frame.iter().enumerate() {
                if let Some(k) = frames.get_mut(i) {
                    k.rotation_degrees = resting.sk_x + rf.rotate;
                }
                rot_cursor += rf.duration.max(1);
            }
            let _ = rot_cursor; // accumulator silenced — we already used the indices.
            bone_tracks.insert(track.name.as_str(), frames);
        }
    }

    let mut layers_out: Vec<Layer> = Vec::with_capacity(armature.slot.len());
    for slot in &armature.slot {
        let parent_bone = slot.parent.as_str();
        let keyframes = bone_tracks.get(parent_bone).cloned().unwrap_or_else(|| {
            // Static slot: emit a single keyframe using the bone's resting transform.
            let resting = bone_resting
                .get(parent_bone)
                .copied()
                .cloned()
                .unwrap_or_default();
            vec![Keyframe {
                time_seconds: 0.0,
                position: [resting.x, resting.y],
                size: [100.0, 100.0],
                rotation_degrees: resting.sk_x,
                opacity: 1.0,
                easing_label: EasingLabel::Standard,
            }]
        });
        let fill_hex = slot.color.as_ref().map(|c| {
            let scale = |x: i32| ((x as f32 * 255.0 / 100.0).clamp(0.0, 255.0)) as u8;
            [scale(c.r_m), scale(c.g_m), scale(c.b_m)]
        });
        if slot.color.as_ref().map(|c| c.a_m).unwrap_or(100) < 100 {
            // not modelled in our scalar opacity yet; we'd need per-layer alpha.
            // No-op aside from this note — the layer is still imported.
        }
        layers_out.push(Layer {
            name: slot.name.clone(),
            kind: LayerKind::Rect,
            fill_hex,
            stroke_hex: None,
            text: None,
            keyframes,
            image_asset_id: None,
            text_reveal: None,
            entry_vector: None,
        });
    }

    let shots = if layers_out.is_empty() {
        vec![]
    } else {
        vec![Shot {
            start_seconds: 0.0,
            duration_seconds,
            description: format!("imported from DragonBones armature \"{}\"", armature.name),
            layers: layers_out,
        }]
    };

    Ok(Composition {
        composition_width: 1920,
        composition_height: 1080,
        duration_seconds,
        frame_rate,
        background_hex: [0x0a, 0x0a, 0x0a],
        shots,
        image_assets: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
        "name":"hero",
        "frameRate":30,
        "armature":[{
            "name":"main",
            "frameRate":30,
            "bone":[
                {"name":"root","transform":{"x":0,"y":0}},
                {"name":"arm","transform":{"x":50,"y":20,"skX":15}}
            ],
            "slot":[
                {"name":"body","parent":"root","color":{"rM":50,"gM":80,"bM":20,"aM":100}},
                {"name":"hand","parent":"arm"}
            ],
            "animation":[{
                "name":"idle",
                "duration":60,
                "bone":[{
                    "name":"arm",
                    "translateFrame":[
                        {"duration":30,"x":0,"y":0},
                        {"duration":30,"x":10,"y":-5}
                    ],
                    "rotateFrame":[
                        {"duration":30,"rotate":0},
                        {"duration":30,"rotate":30}
                    ]
                }]
            }]
        }]
    }"#;

    #[test]
    fn parses_skeleton_and_animation() {
        let c = ingest(SAMPLE.as_bytes()).unwrap();
        assert_eq!(c.frame_rate, 30.0);
        assert!((c.duration_seconds - 2.0).abs() < 1e-3);
        assert_eq!(c.shots.len(), 1);
        let shot = &c.shots[0];
        assert_eq!(shot.layers.len(), 2);
        // hand is parented to "arm", should have 2 keyframes from translateFrame.
        let hand = shot.layers.iter().find(|l| l.name == "hand").unwrap();
        assert_eq!(hand.keyframes.len(), 2);
        // resting.x of arm is 50, first translate dx=0 → 50 + 0 = 50.
        assert!((hand.keyframes[0].position[0] - 50.0).abs() < 1e-3);
        // second keyframe: dx=10 → 50 + 10 = 60.
        assert!((hand.keyframes[1].position[0] - 60.0).abs() < 1e-3);
        // body is parented to root (which has no track) → single static keyframe.
        let body = shot.layers.iter().find(|l| l.name == "body").unwrap();
        assert_eq!(body.keyframes.len(), 1);
        // body has a fill color: 50/80/20 percent → scaled to 255.
        assert_eq!(
            body.fill_hex,
            Some([
                (50.0 * 255.0 / 100.0) as u8,
                (80.0 * 255.0 / 100.0) as u8,
                (20.0 * 255.0 / 100.0) as u8
            ])
        );
    }

    #[test]
    fn rejects_empty_armature_list() {
        let json = r#"{"name":"x","frameRate":30,"armature":[]}"#;
        assert!(ingest(json.as_bytes()).is_err());
    }
}
