//! Prompt + StyleCard → Lottie-shaped timeline JSON, via any
//! [`llm::LlmBackend`] (Ollama local default, cloud fallback).
//!
//! The orchestrator owns the system prompt and the response shape;
//! the backend is just a JSON-completing wire.

#![recursion_limit = "256"]

pub mod llm;

use anyhow::Result;
use motion_forge_style_extract::{EasingLabel, StyleCard};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum LayerKind {
    Rect,
    Ellipse,
    Text,
    Image,
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

    /// Run the prompt → timeline call.
    pub async fn orchestrate(
        &self,
        user_prompt: &str,
        style: &StyleCard,
    ) -> Result<LottieTimeline> {
        let style_summary = summarize_style(style);
        let user = format!(
            "Generate a motion-design animation timeline for: \"{user_prompt}\"\n\n\
             Reference style:\n{style_summary}\n\n\
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
