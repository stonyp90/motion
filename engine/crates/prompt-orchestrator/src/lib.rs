//! Prompt + StyleCard → Lottie-shaped timeline JSON, via any
//! [`llm::LlmBackend`] (Ollama local default, cloud fallback).
//!
//! The orchestrator owns the system prompt and the response shape;
//! the backend is just a JSON-completing wire.

#![recursion_limit = "256"]

pub mod brief;
pub mod characters;
pub mod llm;
pub mod script_synth;

// W4's brief_to_timeline takes the same character reference shape W2
// owns in `characters` — re-export so the public API stays single-named.
pub use characters::CharacterRef;

use anyhow::Result;
use motion_forge_style_extract::{EasingLabel, StyleCard};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

pub use characters::{
    Archetype, BehavioralDefaults, Character, CharacterRef, CharacterRegistry, VisualSpec,
};

/// A Lottie-shaped timeline emitted by the orchestrator before
/// `lottie-gen` serializes it to disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LottieTimeline {
    pub composition_width: u32,
    pub composition_height: u32,
    pub duration_seconds: f32,
    pub frame_rate: f32,
    pub background_hex: [u8; 3],
    pub shots: Vec<Shot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Shot {
    pub start_seconds: f32,
    pub duration_seconds: f32,
    pub description: String,
    pub layers: Vec<Layer>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Layer {
    pub name: String,
    pub kind: LayerKind,
    pub fill_hex: Option<[u8; 3]>,
    pub stroke_hex: Option<[u8; 3]>,
    pub text: Option<String>,
    pub keyframes: Vec<Keyframe>,
}

/// Type of a [`Layer`]. The four simple variants (Rect, Ellipse,
/// Text, Image) keep the original string-enum wire format
/// (`"kind": "Rect"`) so the LLM-facing JSON schema is unchanged.
/// The `Character` variant carries fields and therefore serializes
/// as `"kind": {"Character": {"id": "...", "pose": "..."}}` —
/// character layers are injected by the orchestrator from the
/// cast roster, not authored by the LLM, so the heterogeneous shape
/// is not user-facing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum LayerKind {
    Rect,
    Ellipse,
    Text,
    Image,
    /// A reference to a [`characters::Character`] resolved at render
    /// time by `motion_forge_lottie_gen::character_layer`. `id` MUST
    /// match an entry in the orchestrator's [`CharacterRegistry`];
    /// `pose` is an optional named-pose hint (currently advisory —
    /// typed for the future "pose library" UX).
    Character {
        id: String,
        #[serde(default)]
        pose: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keyframe {
    pub time_seconds: f32,
    pub position: [f32; 2],
    pub size: [f32; 2],
    pub rotation_degrees: f32,
    pub opacity: f32,
    pub easing_label: EasingLabel,
}

pub struct PromptOrchestrator {
    pub backend: Arc<dyn llm::LlmBackend>,
    pub composition_width: u32,
    pub composition_height: u32,
    pub frame_rate: f32,
    pub duration_seconds: f32,
    pub system_prompt_addendum: Option<String>,
    /// Character roster the orchestrator can reference from a prompt.
    /// Default is an empty registry; populate with
    /// [`PromptOrchestrator::with_cast_registry`] to give the LLM a
    /// list of named actors to mention by name.
    pub cast_registry: Arc<CharacterRegistry>,
    /// The subset of [`Self::cast_registry`] the LLM may use for this
    /// particular orchestration. Empty = no characters.
    pub cast: Vec<CharacterRef>,
}

impl PromptOrchestrator {
    pub fn new(backend: Arc<dyn llm::LlmBackend>) -> Self {
        Self {
            backend,
            composition_width: 1920,
            composition_height: 1080,
            frame_rate: 30.0,
            duration_seconds: 6.0,
            system_prompt_addendum: None,
            cast_registry: Arc::new(CharacterRegistry::new()),
            cast: Vec::new(),
        }
    }

    /// Builder: set composition dimensions and fps.
    pub fn with_composition(mut self, w: u32, h: u32, fps: f32) -> Self {
        self.composition_width = w;
        self.composition_height = h;
        self.frame_rate = fps;
        self
    }

    /// Builder: set output duration target (seconds).
    pub fn with_duration(mut self, seconds: f32) -> Self {
        self.duration_seconds = seconds.max(0.5);
        self
    }

    /// Builder: append theme-specific guidance to the system prompt.
    pub fn with_system_addendum(mut self, addendum: impl Into<String>) -> Self {
        self.system_prompt_addendum = Some(addendum.into());
        self
    }

    /// Builder: install the character registry the orchestrator will
    /// resolve [`CharacterRef`]s against.
    pub fn with_cast_registry(mut self, registry: Arc<CharacterRegistry>) -> Self {
        self.cast_registry = registry;
        self
    }

    /// Builder: set the cast the LLM is allowed to mention for this
    /// orchestration. Any id not in [`Self::cast_registry`] will be
    /// surfaced as `"unknown character id=…"` in the system prompt
    /// so the LLM doesn't silently hallucinate a sprite.
    pub fn with_cast(mut self, cast: Vec<CharacterRef>) -> Self {
        self.cast = cast;
        self
    }

    /// Run the prompt → timeline call.
    pub async fn orchestrate(
        &self,
        user_prompt: &str,
        style: &StyleCard,
    ) -> Result<LottieTimeline> {
        let style_summary = summarize_style(style);
        let cast_summary = characters::summarize_cast(&self.cast_registry, &self.cast);
        let user = format!(
            "Generate a motion-design animation timeline for: \"{user_prompt}\"\n\n\
             Reference style:\n{style_summary}\n\n\
             Cast:\n{cast_summary}\n\n\
             Constraints:\n\
             - Composition: {w}x{h} at {fps} fps.\n\
             - Total duration: exactly {dur:.2} seconds.\n\
             - Use only the easing labels: Linear, Standard, Decelerate, Accelerate, Sharp, Bounce.\n\
             - Shots should follow the reference rhythm where possible.\n\
             - Each layer must have at least 2 keyframes covering its shot.\n\
             - Layer kinds: Rect, Ellipse, Text, Image. For Text layers set the `text` field.\n\
             - All shot start_seconds + duration_seconds must stay within [0, {dur:.2}].",
            w = self.composition_width,
            h = self.composition_height,
            fps = self.frame_rate,
            dur = self.duration_seconds,
        );

        let mut system = SYSTEM_PROMPT.to_string();
        if let Some(addendum) = &self.system_prompt_addendum {
            system.push_str("\n\nAdditional theme guidance: ");
            system.push_str(addendum);
        }

        let schema = timeline_schema(
            self.composition_width,
            self.composition_height,
            self.frame_rate,
            self.duration_seconds,
        );
        let req = llm::LlmRequest::new(system, user).with_schema(schema);
        let timeline: LottieTimeline =
            llm::LlmBackendExt::complete_into(&*self.backend, &req).await?;
        Ok(timeline)
    }
}

const SYSTEM_PROMPT: &str = "You are a motion-design director. Given a prompt and a reference \
style descriptor, you emit a JSON timeline that a renderer turns into a Lottie animation. Be \
specific with positions, sizes, and easings. Prefer short shots (1-3 seconds) and clear, readable \
motion. Output ONLY the JSON object, no commentary.";

fn summarize_style(s: &StyleCard) -> String {
    let palette = if s.palette.is_empty() {
        "neutral palette".to_string()
    } else {
        s.palette
            .iter()
            .take(6)
            .map(|sw| {
                format!(
                    "#{:02x}{:02x}{:02x} ({:.0}%)",
                    sw.hex[0],
                    sw.hex[1],
                    sw.hex[2],
                    sw.weight * 100.0
                )
            })
            .collect::<Vec<_>>()
            .join(", ")
    };
    let easings = if s.easing_presets.is_empty() {
        "standard easing".to_string()
    } else {
        s.easing_presets
            .iter()
            .take(3)
            .map(|e| format!("{:?} ({:.0}%)", e.label, e.weight * 100.0))
            .collect::<Vec<_>>()
            .join(", ")
    };
    format!(
        "palette: {palette}\neasing tendencies: {easings}\nshot rhythm: {} shots, mean {:.2}s ± {:.2}s\ndominant subjects: {}",
        s.shot_rhythm.shot_count,
        s.shot_rhythm.mean_seconds,
        s.shot_rhythm.stddev_seconds,
        s.dominant_classes.join(", ")
    )
}

fn timeline_schema(w: u32, h: u32, fps: f32, duration: f32) -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "composition_width": { "type": "integer", "const": w },
            "composition_height": { "type": "integer", "const": h },
            "duration_seconds": { "type": "number", "const": duration },
            "frame_rate": { "type": "number", "const": fps },
            "background_hex": {
                "type": "array",
                "items": { "type": "integer", "minimum": 0, "maximum": 255 },
                "minItems": 3, "maxItems": 3
            },
            "shots": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "start_seconds": { "type": "number" },
                        "duration_seconds": { "type": "number" },
                        "description": { "type": "string" },
                        "layers": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "name": { "type": "string" },
                                    "kind": { "type": "string", "enum": ["Rect", "Ellipse", "Text", "Image"] },
                                    "fill_hex": {
                                        "type": ["array", "null"],
                                        "items": { "type": "integer" },
                                        "minItems": 3, "maxItems": 3
                                    },
                                    "stroke_hex": {
                                        "type": ["array", "null"],
                                        "items": { "type": "integer" },
                                        "minItems": 3, "maxItems": 3
                                    },
                                    "text": { "type": ["string", "null"] },
                                    "keyframes": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "time_seconds": { "type": "number" },
                                                "position": {
                                                    "type": "array",
                                                    "items": { "type": "number" },
                                                    "minItems": 2, "maxItems": 2
                                                },
                                                "size": {
                                                    "type": "array",
                                                    "items": { "type": "number" },
                                                    "minItems": 2, "maxItems": 2
                                                },
                                                "rotation_degrees": { "type": "number" },
                                                "opacity": { "type": "number" },
                                                "easing_label": {
                                                    "type": "string",
                                                    "enum": ["Linear", "Standard", "Decelerate", "Accelerate", "Sharp", "Bounce"]
                                                }
                                            },
                                            "required": ["time_seconds", "position", "size", "rotation_degrees", "opacity", "easing_label"]
                                        }
                                    }
                                },
                                "required": ["name", "kind", "keyframes"]
                            }
                        }
                    },
                    "required": ["start_seconds", "duration_seconds", "description", "layers"]
                }
            }
        },
        "required": ["composition_width", "composition_height", "duration_seconds", "frame_rate", "background_hex", "shots"]
    })
}

/// Deterministic fallback used by the Mock backend (and when an LLM call
/// fails). Generates a multi-shot timeline that fills `duration_seconds`
/// using the style card's palette + easing + rhythm so the rendered
/// preview is still recognizably "motion design" even without a live LLM.
pub fn fallback_timeline(
    prompt: &str,
    style: &StyleCard,
    w: u32,
    h: u32,
    fps: f32,
    duration_seconds: f32,
) -> LottieTimeline {
    let duration = duration_seconds.max(0.5);
    let mean_shot = style.shot_rhythm.mean_seconds.max(1.0);
    let shot_count = ((duration / mean_shot).round() as usize).max(1);
    let shot_dur = duration / shot_count as f32;

    let bg = pick_background(style);
    let easing = style
        .easing_presets
        .first()
        .map(|p| p.label)
        .unwrap_or(EasingLabel::Standard);

    let palette: Vec<[u8; 3]> = if style.palette.is_empty() {
        vec![[0x10, 0xb9, 0x81], [0xff, 0xff, 0xff], [0xfb, 0xbf, 0x24]]
    } else {
        style.palette.iter().map(|s| s.hex).collect()
    };

    let mut shots = Vec::with_capacity(shot_count);
    for i in 0..shot_count {
        let start = i as f32 * shot_dur;
        let fill = palette[i % palette.len()];
        let alt = palette[(i + 1) % palette.len()];
        let phase = i as f32 / shot_count as f32;
        let cx = w as f32 * (0.3 + 0.4 * phase);
        let cy = h as f32 * 0.5;
        let big = (w.min(h) as f32) * 0.45;
        let small = big * 0.4;

        let mut layers = vec![Layer {
            name: format!("shot_{i:02}_hero"),
            kind: if i % 3 == 1 {
                LayerKind::Ellipse
            } else {
                LayerKind::Rect
            },
            fill_hex: Some(fill),
            stroke_hex: None,
            text: None,
            keyframes: vec![
                Keyframe {
                    time_seconds: start,
                    position: [cx, cy],
                    size: [small, small],
                    rotation_degrees: 0.0,
                    opacity: 0.0,
                    easing_label: easing,
                },
                Keyframe {
                    time_seconds: start + shot_dur * 0.3,
                    position: [cx, cy],
                    size: [big, big],
                    rotation_degrees: 0.0,
                    opacity: 1.0,
                    easing_label: easing,
                },
                Keyframe {
                    time_seconds: start + shot_dur,
                    position: [cx, cy],
                    size: [big, big],
                    rotation_degrees: 360.0 * (i as f32 % 2.0),
                    opacity: 1.0,
                    easing_label: easing,
                },
            ],
        }];

        // Last shot: drop a text layer so the preview ends with something readable.
        if i + 1 == shot_count {
            layers.push(Layer {
                name: "outro_text".into(),
                kind: LayerKind::Text,
                fill_hex: Some(alt),
                stroke_hex: None,
                text: Some(prompt.to_string()),
                keyframes: vec![
                    Keyframe {
                        time_seconds: start + shot_dur * 0.5,
                        position: [w as f32 * 0.5, h as f32 * 0.85],
                        size: [w as f32 * 0.8, 96.0],
                        rotation_degrees: 0.0,
                        opacity: 0.0,
                        easing_label: easing,
                    },
                    Keyframe {
                        time_seconds: start + shot_dur,
                        position: [w as f32 * 0.5, h as f32 * 0.85],
                        size: [w as f32 * 0.8, 96.0],
                        rotation_degrees: 0.0,
                        opacity: 1.0,
                        easing_label: easing,
                    },
                ],
            });
        }

        shots.push(Shot {
            start_seconds: start,
            duration_seconds: shot_dur,
            description: format!("shot {} / {}", i + 1, shot_count),
            layers,
        });
    }

    LottieTimeline {
        composition_width: w,
        composition_height: h,
        duration_seconds: duration,
        frame_rate: fps,
        background_hex: bg,
        shots,
    }
}

fn pick_background(style: &StyleCard) -> [u8; 3] {
    // Pick the darkest swatch as background; fall back to near-black.
    style
        .palette
        .iter()
        .min_by_key(|s| s.hex[0] as u32 + s.hex[1] as u32 + s.hex[2] as u32)
        .map(|s| s.hex)
        .unwrap_or([12, 12, 16])
}

// =====================================================================
// W4 — brief intake → multi-scene timeline.
//
// Everything below this line is wired up by the brief-intake worker and
// stays in its own section to avoid collisions with W2's character-cast
// edits (which add a `characters` module and a `LayerKind::Character`
// variant above this line). Merge order does not matter as long as the
// `pub mod` declarations at the top of the file are unioned.
// =====================================================================

// CharacterRef now comes from `characters` (W2's real implementation);
// see the `pub use characters::CharacterRef;` re-export at the top of
// this file. The W4 stub that lived here is gone post-merge.

/// Drive the per-scene generate path across every beat in a [`Brief`]
/// and stitch the per-scene timelines into a single [`LottieTimeline`]
/// the renderer can ingest as one composition.
///
/// This is the minimum delta to the existing public API: it composes
/// the existing single-scene `PromptOrchestrator::orchestrate` rather
/// than introducing a new orchestration path. Per-scene duration is
/// taken from `brief.total_duration_sec` if set, else falls back to a
/// fixed `default_per_scene_sec` budget.
///
/// Sub-beats are inlined into their parent scene's prompt so the
/// renderer still sees one logical shot per parent — the orchestrator
/// can decide later to split them out.
pub async fn brief_to_timeline(
    brief: brief::Brief,
    cast: Vec<CharacterRef>,
    style: StyleCard,
) -> Result<LottieTimeline> {
    let backend = llm::auto_local_first(canned_fallback_for_brief(&brief)).await;
    let backend: Arc<dyn llm::LlmBackend> = Arc::from(backend);

    let scene_count = brief.scenes.len().max(1) as f32;
    let total = brief
        .total_duration_sec
        .filter(|d| *d > 0.0)
        .unwrap_or(scene_count * 3.0);
    let per_scene = (total / scene_count).max(0.5);

    let cast_header = if cast.is_empty() {
        String::new()
    } else {
        let names: Vec<String> = cast
            .iter()
            .map(|c| match &c.pose {
                Some(p) => format!("{} ({})", c.id, p),
                None => c.id.clone(),
            })
            .collect();
        format!("Recurring cast: {}.\n", names.join(", "))
    };

    // Reuse the first scene's composition defaults; the renderer needs
    // a single canvas size across the whole timeline.
    let orch = PromptOrchestrator::new(backend.clone()).with_duration(per_scene);
    let comp_w = orch.composition_width;
    let comp_h = orch.composition_height;
    let fps = orch.frame_rate;
    let bg = first_palette(&style);

    let mut all_shots: Vec<Shot> = Vec::with_capacity(brief.scenes.len());
    let mut cursor = 0.0_f32;
    for (i, scene) in brief.scenes.iter().enumerate() {
        let prompt = build_scene_prompt(scene, &brief, &cast_header, i);
        let per = PromptOrchestrator::new(backend.clone())
            .with_composition(comp_w, comp_h, fps)
            .with_duration(per_scene);

        let scene_timeline = match per.orchestrate(&prompt, &style).await {
            Ok(t) => t,
            Err(e) => {
                tracing::warn!(
                    scene_id = %scene.id,
                    error = %e,
                    "scene generate failed; using fallback timeline for this beat"
                );
                fallback_timeline(&prompt, &style, comp_w, comp_h, fps, per_scene)
            }
        };

        // Re-base shot timestamps onto the global cursor and absorb
        // them into the master timeline.
        for mut shot in scene_timeline.shots {
            let scene_start = shot.start_seconds;
            shot.start_seconds = cursor + scene_start;
            for layer in &mut shot.layers {
                for kf in &mut layer.keyframes {
                    kf.time_seconds = cursor + (kf.time_seconds - scene_start) + scene_start;
                }
            }
            // Tag the shot with its source beat for downstream tooling.
            shot.description = format!("[{}] {}", scene.id, shot.description);
            all_shots.push(shot);
        }
        cursor += per_scene;
    }

    Ok(LottieTimeline {
        composition_width: comp_w,
        composition_height: comp_h,
        duration_seconds: cursor,
        frame_rate: fps,
        background_hex: bg,
        shots: all_shots,
    })
}

fn build_scene_prompt(
    scene: &brief::SceneScript,
    brief_ctx: &brief::Brief,
    cast_header: &str,
    idx: usize,
) -> String {
    let mut s = String::with_capacity(256);
    s.push_str(cast_header);
    s.push_str(&format!(
        "Scene {} of {} (beat {}). ",
        idx + 1,
        brief_ctx.scenes.len(),
        scene.id
    ));
    s.push_str(&format!("Visual direction: {}.", scene.visual));
    if let Some(vo) = &scene.vo {
        s.push_str(&format!(" VO: \"{vo}\"."));
    }
    for sb in &scene.sub_beats {
        s.push_str(&format!(" Sub-beat {}: {}.", sb.id, sb.visual));
        if let Some(vo) = &sb.vo {
            s.push_str(&format!(" Sub-VO: \"{vo}\"."));
        }
    }
    s
}

fn canned_fallback_for_brief(_brief: &brief::Brief) -> &'static str {
    // The auto-picker only uses this string when no backend is
    // reachable AND the MockBackend would otherwise be picked. We let
    // `fallback_timeline` (which the per-scene loop falls back to on
    // error) carry the real visual; this stub just needs to be
    // syntactically valid JSON that the per-scene parser will reject
    // and trigger the fallback.
    "{\"composition_width\":1920,\"composition_height\":1080,\"duration_seconds\":3.0,\"frame_rate\":30.0,\"background_hex\":[0,0,0],\"shots\":[]}"
}

fn first_palette(style: &StyleCard) -> [u8; 3] {
    style
        .palette
        .iter()
        .min_by_key(|s| s.hex[0] as u32 + s.hex[1] as u32 + s.hex[2] as u32)
        .map(|s| s.hex)
        .unwrap_or([12, 12, 16])
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn fallback_timeline_has_layers() {
        let t = fallback_timeline("test prompt", &empty_card(), 1920, 1080, 30.0, 6.0);
        assert!(!t.shots.is_empty());
        assert!(t.shots[0].layers[0].keyframes.len() >= 2);
    }

    #[test]
    fn fallback_timeline_fills_requested_duration() {
        for d in [2.0_f32, 6.0, 15.0, 30.0, 45.0] {
            let t = fallback_timeline("x", &empty_card(), 1920, 1080, 30.0, d);
            assert!(
                (t.duration_seconds - d).abs() < 0.01,
                "got {} expected {}",
                t.duration_seconds,
                d,
            );
            let total: f32 = t.shots.iter().map(|s| s.duration_seconds).sum();
            assert!(
                (total - d).abs() < 0.05,
                "shots sum {} != duration {}",
                total,
                d,
            );
        }
    }

    #[test]
    fn timeline_roundtrips_serde() {
        let t = fallback_timeline("x", &empty_card(), 640, 360, 30.0, 4.0);
        let j = serde_json::to_string(&t).unwrap();
        let back: LottieTimeline = serde_json::from_str(&j).unwrap();
        assert_eq!(back.composition_width, 640);
    }

    #[tokio::test]
    async fn mock_backend_round_trips_a_canned_timeline() {
        let canned =
            serde_json::to_string(&fallback_timeline("x", &empty_card(), 800, 600, 24.0, 5.0))
                .unwrap();
        let backend: Arc<dyn llm::LlmBackend> = Arc::new(llm::MockBackend::new(canned));
        let orch = PromptOrchestrator::new(backend)
            .with_composition(800, 600, 24.0)
            .with_duration(5.0);
        let t = orch.orchestrate("x", &empty_card()).await.unwrap();
        assert_eq!(t.composition_width, 800);
        assert!((t.duration_seconds - 5.0).abs() < 0.01);
    }
}
