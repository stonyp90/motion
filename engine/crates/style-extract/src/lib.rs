//! Distills a reference video's "motion grammar" into a compact JSON
//! `StyleCard`. Pure Rust — no model weights, no network.
//!
//! Three independent extractors compose into the card:
//! - palette: Oklab k-means on per-sprite atlas pixels
//! - easing: classify per-sprite-track velocity profiles into Material 3
//!   presets (standard / decelerate / accelerate / sharp / bounce)
//! - rhythm: shot count + mean/stddev shot duration from the scene manifest
//!
//! The card is the LLM's view of the reference video in Phase 5.

use anyhow::{Context, Result};
use motion_forge_decompose::{SceneManifest, SpriteManifest};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub mod oklab_adapter;
pub mod theme;

pub use theme::{Theme, ThemeComposition, ThemePaletteEntry};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StyleCard {
    pub palette: Vec<OklabSwatch>,
    pub easing_presets: Vec<EasingPreset>,
    pub shot_rhythm: ShotRhythm,
    pub transitions: Vec<TransitionKind>,
    pub dominant_classes: Vec<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct OklabSwatch {
    pub l: f32,
    pub a: f32,
    pub b: f32,
    pub weight: f32,
    /// sRGB representation for the LLM / preview UIs.
    pub hex: [u8; 3],
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct EasingPreset {
    pub label: EasingLabel,
    pub cubic_bezier: [f32; 4],
    pub weight: f32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum EasingLabel {
    Linear,
    Standard,
    Decelerate,
    Accelerate,
    Sharp,
    Bounce,
}

impl EasingLabel {
    /// Canonical Material Design 3 cubic-bezier control points.
    pub fn canonical_bezier(self) -> [f32; 4] {
        match self {
            EasingLabel::Linear => [0.0, 0.0, 1.0, 1.0],
            EasingLabel::Standard => [0.4, 0.0, 0.2, 1.0],
            EasingLabel::Decelerate => [0.0, 0.0, 0.2, 1.0],
            EasingLabel::Accelerate => [0.4, 0.0, 1.0, 1.0],
            EasingLabel::Sharp => [0.4, 0.0, 0.6, 1.0],
            EasingLabel::Bounce => [0.68, -0.55, 0.27, 1.55],
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ShotRhythm {
    pub shot_count: u32,
    pub mean_seconds: f32,
    pub stddev_seconds: f32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum TransitionKind {
    Cut,
    CrossFade,
    Wipe,
    MorphCut,
}

pub trait StyleExtractor {
    fn extract(&mut self, scene: &SceneManifest, sprites: &SpriteManifest) -> Result<StyleCard>;
}

/// Convenience: write `card` to `path` as pretty JSON.
pub fn write_card(card: &StyleCard, path: &Path) -> Result<()> {
    let body = serde_json::to_string_pretty(card).context("serializing style card")?;
    std::fs::write(path, body).with_context(|| format!("writing {}", path.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn easing_presets_have_unique_beziers() {
        let mut seen = std::collections::HashSet::new();
        for label in [
            EasingLabel::Linear,
            EasingLabel::Standard,
            EasingLabel::Decelerate,
            EasingLabel::Accelerate,
            EasingLabel::Sharp,
            EasingLabel::Bounce,
        ] {
            let b = label.canonical_bezier();
            let key = format!("{:?}", b.map(|f| (f * 1000.0) as i32));
            assert!(seen.insert(key), "duplicate bezier for {:?}", label);
        }
    }

    #[test]
    fn style_card_roundtrips_serde() {
        let card = StyleCard {
            palette: vec![OklabSwatch {
                l: 0.6,
                a: 0.05,
                b: -0.05,
                weight: 0.5,
                hex: [120, 150, 200],
            }],
            easing_presets: vec![EasingPreset {
                label: EasingLabel::Standard,
                cubic_bezier: EasingLabel::Standard.canonical_bezier(),
                weight: 0.8,
            }],
            shot_rhythm: ShotRhythm {
                shot_count: 4,
                mean_seconds: 1.5,
                stddev_seconds: 0.3,
            },
            transitions: vec![TransitionKind::Cut, TransitionKind::CrossFade],
            dominant_classes: vec!["person".into()],
        };
        let j = serde_json::to_string(&card).unwrap();
        let back: StyleCard = serde_json::from_str(&j).unwrap();
        assert_eq!(back.palette[0].hex, [120, 150, 200]);
    }
}
