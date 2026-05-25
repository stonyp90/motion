//! Curated theme presets that overlay a [`StyleCard`] before the LLM call.
//!
//! Themes live as JSON files under the workspace's `themes/` directory and
//! can also be loaded from any user-supplied path. Bundled slugs are
//! discovered at runtime so adding a new file requires no Rust changes.

use crate::{EasingLabel, EasingPreset, OklabSwatch, ShotRhythm, StyleCard};
use anyhow::{Context, Result, anyhow};
use palette::{IntoColor, Oklab, Srgb};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Theme {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub composition: ThemeComposition,
    pub default_duration_seconds: f32,
    pub palette_bias: Vec<ThemePaletteEntry>,
    pub easing_bias: EasingLabel,
    /// Theme files only carry mean + stddev; `shot_count` is filled in by
    /// applying the rhythm to the requested total duration.
    pub shot_rhythm_target: ThemeShotRhythm,
    pub system_prompt_addendum: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ThemeShotRhythm {
    pub mean_seconds: f32,
    pub stddev_seconds: f32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ThemeComposition {
    pub width: u32,
    pub height: u32,
    pub frame_rate: f32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ThemePaletteEntry {
    pub hex: [u8; 3],
    pub weight: f32,
}

impl Theme {
    /// Load a theme from any JSON file.
    pub fn from_path(path: &Path) -> Result<Self> {
        let body = std::fs::read_to_string(path)
            .with_context(|| format!("reading theme {}", path.display()))?;
        let theme: Theme = serde_json::from_str(&body)
            .with_context(|| format!("parsing theme {}", path.display()))?;
        Ok(theme)
    }

    /// Load a theme by slug from the workspace's `themes/` directory.
    /// Looks first under `$MOTION_FORGE_THEMES_DIR`, then `./themes/`, then
    /// the workspace root inferred from `CARGO_MANIFEST_DIR`.
    pub fn load_bundled(slug: &str) -> Result<Self> {
        let dir = bundled_dir()?;
        let path = dir.join(format!("{slug}.json"));
        if !path.exists() {
            return Err(anyhow!(
                "no bundled theme '{slug}' in {} (available: {})",
                dir.display(),
                Self::list_bundled_slugs().join(", ")
            ));
        }
        Self::from_path(&path)
    }

    /// Enumerate bundled theme slugs.
    pub fn list_bundled_slugs() -> Vec<String> {
        let Ok(dir) = bundled_dir() else {
            return Vec::new();
        };
        let mut slugs = Vec::new();
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for e in entries.flatten() {
                let p = e.path();
                if p.extension().and_then(|s| s.to_str()) == Some("json")
                    && let Some(stem) = p.file_stem().and_then(|s| s.to_str())
                {
                    slugs.push(stem.to_string());
                }
            }
        }
        slugs.sort();
        slugs
    }

    /// Resolve a slug-or-path: if `s` contains a path separator or ends in
    /// `.json` and exists on disk, treat it as a path; otherwise look it
    /// up in the bundled directory.
    pub fn resolve(s: &str) -> Result<Self> {
        let looks_like_path =
            s.contains('/') || s.contains('\\') || std::path::Path::new(s).exists();
        if looks_like_path {
            Self::from_path(std::path::Path::new(s))
        } else {
            Self::load_bundled(s)
        }
    }

    /// Apply the theme's overrides to a `StyleCard` in place.
    ///
    /// Strategy: theme is treated as a *bias* rather than a hard replace,
    /// so we keep the reference video's dominant_classes and transitions
    /// but swap palette / easing / rhythm.
    pub fn overlay(&self, card: &mut StyleCard) {
        if !self.palette_bias.is_empty() {
            card.palette = self
                .palette_bias
                .iter()
                .map(|e| {
                    let srgb = Srgb::new(
                        e.hex[0] as f32 / 255.0,
                        e.hex[1] as f32 / 255.0,
                        e.hex[2] as f32 / 255.0,
                    );
                    let ok: Oklab = srgb.into_color();
                    OklabSwatch {
                        l: ok.l,
                        a: ok.a,
                        b: ok.b,
                        weight: e.weight,
                        hex: e.hex,
                    }
                })
                .collect();
        }
        let primary = self.easing_bias;
        let bezier = primary.canonical_bezier();
        // Prepend the theme's easing as the dominant preset; keep
        // whatever the extractor found as supporting flavor.
        card.easing_presets.insert(
            0,
            EasingPreset {
                label: primary,
                cubic_bezier: bezier,
                weight: 1.0,
            },
        );
        // Normalize weights so they still look like a probability distribution.
        let total: f32 = card.easing_presets.iter().map(|p| p.weight).sum();
        if total > 0.0 {
            for p in &mut card.easing_presets {
                p.weight /= total;
            }
        }
        // Derive shot_count from the existing rhythm or a sensible default.
        let prior_count = card.shot_rhythm.shot_count.max(1);
        card.shot_rhythm = ShotRhythm {
            shot_count: prior_count,
            mean_seconds: self.shot_rhythm_target.mean_seconds,
            stddev_seconds: self.shot_rhythm_target.stddev_seconds,
        };
    }
}

fn bundled_dir() -> Result<PathBuf> {
    if let Ok(env) = std::env::var("MOTION_FORGE_THEMES_DIR") {
        let p = PathBuf::from(env);
        if p.is_dir() {
            return Ok(p);
        }
    }
    let cwd = std::env::current_dir()?.join("themes");
    if cwd.is_dir() {
        return Ok(cwd);
    }
    // Walk up from this crate's manifest dir to find the workspace `themes/`.
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for _ in 0..5 {
        let candidate = p.join("themes");
        if candidate.is_dir() {
            return Ok(candidate);
        }
        if !p.pop() {
            break;
        }
    }
    Err(anyhow!(
        "could not locate themes/ directory (set MOTION_FORGE_THEMES_DIR to override)"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_bundled_slugs_includes_corporate() {
        let slugs = Theme::list_bundled_slugs();
        if slugs.is_empty() {
            // CI without the themes directory; not a hard failure.
            eprintln!("themes/ not present in this build context; skipping");
            return;
        }
        assert!(slugs.contains(&"corporate".to_string()), "got: {:?}", slugs);
    }

    #[test]
    fn corporate_theme_loads_and_overlays() {
        let theme = match Theme::load_bundled("corporate") {
            Ok(t) => t,
            Err(_) => return,
        };
        let mut card = StyleCard {
            palette: vec![],
            easing_presets: vec![],
            shot_rhythm: ShotRhythm {
                shot_count: 1,
                mean_seconds: 1.0,
                stddev_seconds: 0.0,
            },
            transitions: vec![],
            dominant_classes: vec![],
        };
        theme.overlay(&mut card);
        assert_eq!(card.palette.len(), 4);
        assert_eq!(card.easing_presets[0].label, EasingLabel::Decelerate);
        assert!((card.shot_rhythm.mean_seconds - 3.5).abs() < 0.01);
    }
}
