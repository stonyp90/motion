//! Starter preset library — the curated set of templates a user can pick
//! from on the home page instead of staring at a blank prompt.
//!
//! Presets live as JSON files under the workspace's
//! `themes/presets/<id>/` directory and are discovered at runtime so
//! adding a new one requires no Rust changes. Each directory contains
//! three files:
//!
//! - `preset.json` — full spec (dimensions, theme, brief skeleton, cast)
//! - `preview.lottie.json` — sample Lottie users see in the picker
//! - `README.md` — one-paragraph creative direction
//!
//! A top-level `themes/presets/manifest.json` indexes the pack so callers
//! can list everything with a single read instead of walking the
//! directory.
//!
//! The location of the `themes/` directory is resolved the same way as
//! [`motion_forge_style_extract::Theme::load_bundled`]:
//! `$MOTION_FORGE_THEMES_DIR`, then `./themes/`, then walking up from
//! `CARGO_MANIFEST_DIR`. This keeps presets and themes co-located so
//! local dev, CI, and packaged binaries all find them.
//!
//! All public functions are synchronous because the on-disk reads are
//! tiny (each preset.json + preview.lottie.json adds up to less than
//! 30 KB) and the orchestrator otherwise needs an async surface only
//! for the LLM call itself.

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Lightweight projection used by `GET /v1/presets` and `presets list`.
///
/// The list endpoint loads every preset's metadata but skips the preview
/// payload so the response stays under a kilobyte per entry.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetSummary {
    pub id: String,
    pub name: String,
    pub tagline: String,
    pub category: String,
    pub duration_sec: f32,
    pub width: u32,
    pub height: u32,
    pub frame_rate: f32,
    pub theme_slug: Option<String>,
    pub brief_skeleton: String,
}

/// Full preset spec returned by `GET /v1/presets/{id}` and `presets show`.
///
/// `preview_lottie` is the raw Lottie JSON parsed into a generic
/// [`serde_json::Value`] — we don't constrain the schema here because
/// downstream players (Lottie-Web, lottie-react, lottie-ios) all accept
/// the standard format and we want to stay decoupled from any particular
/// player's typed model.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub tagline: String,
    pub category: String,
    pub duration_sec: f32,
    pub composition: PresetComposition,
    pub theme_slug: Option<String>,
    #[serde(default)]
    pub transparent_background: bool,
    #[serde(default)]
    pub r#loop: bool,
    #[serde(default)]
    pub sticker_count: Option<u32>,
    #[serde(default)]
    pub export_format: Option<String>,
    pub suggested_cast: Vec<PresetCastEntry>,
    pub brief_skeleton: String,
    #[serde(default)]
    pub placeholders: Vec<PresetPlaceholder>,
    /// Filename of the preview Lottie within the preset directory, as
    /// declared in preset.json. Always loaded into `preview_lottie`
    /// below; surfaced here so callers can correlate the two.
    pub preview: String,
    /// Raw Lottie JSON for the preview, loaded from the file at `preview`.
    pub preview_lottie: Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct PresetComposition {
    pub width: u32,
    pub height: u32,
    pub frame_rate: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetCastEntry {
    pub id: String,
    pub kind: String,
    pub role: String,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PresetPlaceholder {
    pub id: String,
    pub label: String,
    pub r#type: String,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub default: Option<Value>,
}

/// Just the on-disk shape of `preset.json` — `Preset` adds the loaded
/// preview Lottie that doesn't live in the JSON itself.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PresetFile {
    id: String,
    name: String,
    tagline: String,
    category: String,
    duration_sec: f32,
    composition: PresetComposition,
    #[serde(default)]
    theme_slug: Option<String>,
    #[serde(default)]
    transparent_background: bool,
    #[serde(default)]
    r#loop: bool,
    #[serde(default)]
    sticker_count: Option<u32>,
    #[serde(default)]
    export_format: Option<String>,
    suggested_cast: Vec<PresetCastEntry>,
    brief_skeleton: String,
    #[serde(default)]
    placeholders: Vec<PresetPlaceholder>,
    preview: String,
}

/// Shape of `themes/presets/manifest.json`. We load summaries directly
/// from the manifest when it exists (fast path) and fall back to walking
/// the directory if it doesn't (e.g. someone hand-added a preset and
/// forgot to update the index).
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Manifest {
    #[serde(default)]
    schema_version: u32,
    #[serde(default)]
    description: String,
    presets: Vec<ManifestEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ManifestEntry {
    id: String,
    name: String,
    tagline: String,
    #[serde(default)]
    category: String,
    duration_sec: f32,
    width: u32,
    height: u32,
    #[serde(default = "default_fps")]
    frame_rate: f32,
    #[serde(default)]
    theme_slug: Option<String>,
    brief_skeleton: String,
}

fn default_fps() -> f32 {
    30.0
}

/// Return summaries for every preset advertised in the manifest. Falls
/// back to scanning the directory if the manifest is missing.
pub fn all_presets() -> Result<Vec<PresetSummary>> {
    let dir = presets_dir()?;
    let manifest_path = dir.join("manifest.json");
    if manifest_path.exists() {
        let body = std::fs::read_to_string(&manifest_path)
            .with_context(|| format!("reading {}", manifest_path.display()))?;
        let manifest: Manifest = serde_json::from_str(&body)
            .with_context(|| format!("parsing {}", manifest_path.display()))?;
        return Ok(manifest
            .presets
            .into_iter()
            .map(|e| PresetSummary {
                id: e.id,
                name: e.name,
                tagline: e.tagline,
                category: e.category,
                duration_sec: e.duration_sec,
                width: e.width,
                height: e.height,
                frame_rate: e.frame_rate,
                theme_slug: e.theme_slug,
                brief_skeleton: e.brief_skeleton,
            })
            .collect());
    }
    // Fallback: walk the directory.
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir)
        .with_context(|| format!("reading {}", dir.display()))?
        .flatten()
    {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let id = match p.file_name().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        if let Ok(full) = load_preset(&id) {
            out.push(PresetSummary {
                id: full.id,
                name: full.name,
                tagline: full.tagline,
                category: full.category,
                duration_sec: full.duration_sec,
                width: full.composition.width,
                height: full.composition.height,
                frame_rate: full.composition.frame_rate,
                theme_slug: full.theme_slug,
                brief_skeleton: full.brief_skeleton,
            });
        }
    }
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

/// Load a single preset by id, including its preview Lottie.
pub fn load_preset(id: &str) -> Result<Preset> {
    validate_preset_id(id)?;
    let dir = presets_dir()?;
    let preset_dir = dir.join(id);
    if !preset_dir.is_dir() {
        return Err(anyhow!(
            "no preset '{id}' in {} (available: {})",
            dir.display(),
            list_available_ids(&dir).join(", ")
        ));
    }
    let preset_path = preset_dir.join("preset.json");
    let body = std::fs::read_to_string(&preset_path)
        .with_context(|| format!("reading {}", preset_path.display()))?;
    let file: PresetFile = serde_json::from_str(&body)
        .with_context(|| format!("parsing {}", preset_path.display()))?;

    let preview_path = preset_dir.join(&file.preview);
    let preview_body = std::fs::read_to_string(&preview_path)
        .with_context(|| format!("reading {}", preview_path.display()))?;
    let preview_lottie: Value = serde_json::from_str(&preview_body)
        .with_context(|| format!("parsing {}", preview_path.display()))?;

    Ok(Preset {
        id: file.id,
        name: file.name,
        tagline: file.tagline,
        category: file.category,
        duration_sec: file.duration_sec,
        composition: file.composition,
        theme_slug: file.theme_slug,
        transparent_background: file.transparent_background,
        r#loop: file.r#loop,
        sticker_count: file.sticker_count,
        export_format: file.export_format,
        suggested_cast: file.suggested_cast,
        brief_skeleton: file.brief_skeleton,
        placeholders: file.placeholders,
        preview: file.preview,
        preview_lottie,
    })
}

/// Reject ids containing path separators, dots, or whitespace — they
/// would let a caller traverse outside the presets directory.
fn validate_preset_id(id: &str) -> Result<()> {
    if id.is_empty() {
        return Err(anyhow!("preset id is empty"));
    }
    if id
        .chars()
        .any(|c| c == '/' || c == '\\' || c == '.' || c.is_whitespace())
    {
        return Err(anyhow!(
            "preset id '{id}' must be a single path segment (no '/', '\\', '.', or whitespace)"
        ));
    }
    Ok(())
}

fn list_available_ids(dir: &Path) -> Vec<String> {
    let mut ids: Vec<String> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if p.is_dir() {
                p.file_name()
                    .and_then(|s| s.to_str())
                    .map(|s| s.to_string())
            } else {
                None
            }
        })
        .collect();
    ids.sort();
    ids
}

fn presets_dir() -> Result<PathBuf> {
    let themes = themes_dir()?;
    let p = themes.join("presets");
    if p.is_dir() {
        Ok(p)
    } else {
        Err(anyhow!(
            "presets directory not found at {} (set MOTION_FORGE_THEMES_DIR to override)",
            p.display()
        ))
    }
}

fn themes_dir() -> Result<PathBuf> {
    if let Ok(env) = std::env::var("MOTION_FORGE_THEMES_DIR") {
        let p = PathBuf::from(env);
        if p.is_dir() {
            return Ok(p);
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let p = cwd.join("themes");
        if p.is_dir() {
            return Ok(p);
        }
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

    fn skip_if_no_presets() -> Option<PathBuf> {
        match presets_dir() {
            Ok(p) if p.is_dir() => Some(p),
            _ => {
                eprintln!("themes/presets/ not present in this build context; skipping");
                None
            }
        }
    }

    #[test]
    fn manifest_lists_ten_presets() {
        let Some(_) = skip_if_no_presets() else {
            return;
        };
        let summaries = all_presets().expect("all_presets");
        assert_eq!(summaries.len(), 10, "got: {:?}", summaries.len());
        let ids: Vec<&str> = summaries.iter().map(|s| s.id.as_str()).collect();
        for required in [
            "logo-reveal",
            "explainer-60s",
            "social-ad-9x16",
            "social-ad-1x1",
            "lower-thirds",
            "loader",
            "onboarding-sequence",
            "kinetic-typography",
            "sticker-pack-dotlottie",
            "product-launch-teaser",
        ] {
            assert!(ids.contains(&required), "missing {required}: got {ids:?}");
        }
    }

    #[test]
    fn load_preset_returns_preview_lottie() {
        let Some(_) = skip_if_no_presets() else {
            return;
        };
        let p = load_preset("logo-reveal").expect("load logo-reveal");
        assert_eq!(p.id, "logo-reveal");
        assert!((p.duration_sec - 6.0).abs() < 0.01);
        assert_eq!(p.composition.width, 1080);
        assert_eq!(p.composition.height, 1080);
        // The preview is a real Lottie envelope with at least one layer.
        assert_eq!(p.preview_lottie["v"].as_str(), Some("5.7.0"));
        assert!(p.preview_lottie["w"].as_u64().unwrap_or(0) > 0);
        assert!(p.preview_lottie["op"].as_f64().unwrap_or(0.0) > 0.0);
        let layers = p.preview_lottie["layers"].as_array().expect("layers array");
        assert!(!layers.is_empty());
    }

    #[test]
    fn every_preset_loads_with_valid_preview() {
        let Some(_) = skip_if_no_presets() else {
            return;
        };
        for s in all_presets().expect("all_presets") {
            let full = load_preset(&s.id).unwrap_or_else(|e| panic!("load {}: {e}", s.id));
            assert_eq!(full.id, s.id);
            // Spot-check the preview Lottie validates as the envelope we
            // expect: required fields exist and the time window is sane.
            for key in ["v", "fr", "ip", "op", "w", "h", "layers"] {
                assert!(
                    full.preview_lottie.get(key).is_some(),
                    "preset {} missing key {key} in preview",
                    full.id
                );
            }
            let layers = full.preview_lottie["layers"]
                .as_array()
                .unwrap_or_else(|| panic!("{} preview has no layers array", full.id));
            assert!(
                !layers.is_empty(),
                "preset {} has empty preview layers",
                full.id
            );
            assert!(
                full.preview_lottie["op"].as_f64().unwrap_or(0.0) > 0.0,
                "preset {} preview has non-positive op",
                full.id
            );
        }
    }

    #[test]
    fn preview_lottie_files_are_under_30kb() {
        let Some(dir) = skip_if_no_presets() else {
            return;
        };
        for s in all_presets().expect("all_presets") {
            let path = dir.join(&s.id).join("preview.lottie.json");
            let meta = std::fs::metadata(&path).unwrap();
            assert!(
                meta.len() < 30 * 1024,
                "{} preview is {} bytes; target < 30 KB",
                s.id,
                meta.len()
            );
        }
    }

    #[test]
    fn validate_preset_id_rejects_traversal() {
        assert!(validate_preset_id("").is_err());
        assert!(validate_preset_id("../foo").is_err());
        assert!(validate_preset_id("a/b").is_err());
        assert!(validate_preset_id("a\\b").is_err());
        assert!(validate_preset_id("foo.bar").is_err());
        assert!(validate_preset_id("has space").is_err());
        assert!(validate_preset_id("logo-reveal").is_ok());
        assert!(validate_preset_id("explainer-60s").is_ok());
    }

    #[test]
    fn load_preset_rejects_unknown_id() {
        let Some(_) = skip_if_no_presets() else {
            return;
        };
        let err = load_preset("definitely-not-a-real-preset").expect_err("unknown id should fail");
        let s = err.to_string();
        assert!(s.contains("no preset"), "got: {s}");
    }
}
