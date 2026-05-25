//! Persistent character / sprite system for the prompt-orchestrator.
//!
//! A [`Character`] is a named, reusable visual actor that the LLM can
//! refer to from a prompt by name (e.g. "Lucius enters from left").
//! Characters are the orchestrator's analogue of a Lottie named
//! sub-composition: instantiated by reference from one or more shots,
//! their sprite is embedded by `lottie-gen` exactly once and re-used.
//!
//! ### MVP scope
//! Only [`VisualSpec::SpriteLottie`] and [`VisualSpec::SpriteSvg`] are
//! implemented end-to-end. [`VisualSpec::Generative`] is typed (so a
//! manifest can describe an "AI-generated" character placeholder) but
//! the orchestrator + renderer treat it as a deferred / TODO variant.
//!
//! ### Wire format
//! Characters live on disk in a manifest + per-character files. The
//! manifest is a list of [`CharacterManifestEntry`] records pointing at
//! either a Lottie JSON file or an SVG file:
//!
//! ```json
//! {
//!   "characters": [
//!     {
//!       "id": "alex",
//!       "name": "Alex",
//!       "archetype": "Person",
//!       "file": "alex.json",
//!       "format": "lottie"
//!     }
//!   ]
//! }
//! ```
//!
//! Use [`CharacterRegistry::load_from_manifest`] (or
//! [`CharacterRegistry::load_pair`] for the standard
//! `characters/manifest.json` + `integrations/manifest.json` split) to
//! build a registry, then look characters up by id.

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// Coarse semantic role for a character. Used by the orchestrator's
/// summary to give the LLM a hint about how a sprite is usually
/// staged (a `Person` typically enters from a side, an `Icon`
/// pops in centered, a `Logo` lives in a corner).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Archetype {
    Person,
    Mascot,
    Logo,
    ProductIcon,
    Icon,
    Abstract,
}

impl Archetype {
    pub fn as_str(&self) -> &'static str {
        match self {
            Archetype::Person => "person",
            Archetype::Mascot => "mascot",
            Archetype::Logo => "logo",
            Archetype::ProductIcon => "product-icon",
            Archetype::Icon => "icon",
            Archetype::Abstract => "abstract",
        }
    }
}

/// How a character is staged when no per-layer overrides are given.
/// All values are advisory — the orchestrator surfaces them to the
/// LLM in the system prompt as "preferred staging" hints.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct BehavioralDefaults {
    /// Preferred enter direction (`"left"`, `"right"`, `"top"`,
    /// `"bottom"`, `"center"`). Pure hint, not enforced by the
    /// timeline.
    #[serde(default)]
    pub enter_from: Option<String>,
    /// Default scale to render the sprite at, as a fraction of the
    /// composition's short edge (`0.0..=1.0`).
    #[serde(default)]
    pub scale: Option<f32>,
    /// Whether this character usually carries dialog / a label.
    #[serde(default)]
    pub speaks: Option<bool>,
}

/// The asset behind a character. Tagged externally so on-disk
/// manifests use a plain `"format": "lottie" | "svg" | "generative"`
/// instead of the more verbose adjacent-tag default.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "format", rename_all = "kebab-case")]
pub enum VisualSpec {
    /// Inline Lottie sub-composition JSON. Embedded as a precomp asset
    /// by `lottie-gen`.
    Lottie {
        /// Parsed Lottie JSON. Kept as a `serde_json::Value` so we
        /// don't pin to a specific Lottie schema version.
        json: serde_json::Value,
    },
    /// Inline SVG markup. Rasterized / embedded as an image asset by
    /// `lottie-gen` (treated as a static layer in MVP).
    Svg { markup: String },
    /// Generative placeholder. Typed-but-not-implemented. Renderer
    /// falls back to the character's archetype glyph.
    Generative {
        /// Free-form prompt fragment describing the sprite.
        prompt: String,
    },
}

impl VisualSpec {
    pub fn kind(&self) -> &'static str {
        match self {
            VisualSpec::Lottie { .. } => "lottie",
            VisualSpec::Svg { .. } => "svg",
            VisualSpec::Generative { .. } => "generative",
        }
    }
}

/// A reusable visual actor. `id` is the slug used everywhere in the
/// orchestrator / Lottie output; `name` is the human label the LLM
/// can mention from a prompt.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Character {
    pub id: String,
    pub name: String,
    pub archetype: Archetype,
    pub visual: VisualSpec,
    #[serde(default)]
    pub defaults: BehavioralDefaults,
    /// Optional brand color hint (`#rrggbb`). Used to colour the
    /// chip in the web UI and as a tint hint in the orchestrator
    /// prompt.
    #[serde(default)]
    pub accent_hex: Option<String>,
    /// Free-form tags for search / filtering in the UI.
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Light-weight reference used inside a shot's `cast` field. Just
/// names the character and lets the LLM pick a pose name from the
/// character's library.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CharacterRef {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pose: Option<String>,
}

impl CharacterRef {
    pub fn new(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            pose: None,
        }
    }

    pub fn with_pose(mut self, pose: impl Into<String>) -> Self {
        self.pose = Some(pose.into());
        self
    }
}

/// On-disk manifest entry. Manifest files store metadata + a relative
/// `file` pointer; the asset body lives in a sibling file so the
/// manifest stays git-diffable.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterManifestEntry {
    pub id: String,
    pub name: String,
    pub archetype: Archetype,
    /// Relative path (resolved against the manifest's directory) of
    /// the asset file.
    pub file: String,
    /// `"lottie"`, `"svg"`, or `"generative"`. For `"generative"`,
    /// `file` is treated as the prompt fragment instead of a path.
    pub format: String,
    #[serde(default)]
    pub defaults: BehavioralDefaults,
    #[serde(default)]
    pub accent_hex: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterManifest {
    pub characters: Vec<CharacterManifestEntry>,
}

/// Indexed collection of [`Character`]s, queried by id.
#[derive(Debug, Clone, Default)]
pub struct CharacterRegistry {
    by_id: BTreeMap<String, Character>,
}

impl CharacterRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Build a registry from a pre-loaded slice of characters.
    /// Duplicate ids are last-write-wins to keep the call infallible
    /// for callers that compose multiple manifests.
    pub fn from_characters(items: impl IntoIterator<Item = Character>) -> Self {
        let mut reg = Self::new();
        for c in items {
            reg.insert(c);
        }
        reg
    }

    pub fn insert(&mut self, c: Character) {
        self.by_id.insert(c.id.clone(), c);
    }

    pub fn get(&self, id: &str) -> Option<&Character> {
        self.by_id.get(id)
    }

    pub fn iter(&self) -> impl Iterator<Item = &Character> {
        self.by_id.values()
    }

    pub fn len(&self) -> usize {
        self.by_id.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_id.is_empty()
    }

    /// Load a single manifest + its sibling asset files.
    pub fn load_from_manifest(manifest_path: &Path) -> Result<Self> {
        let body = std::fs::read_to_string(manifest_path)
            .with_context(|| format!("reading manifest {}", manifest_path.display()))?;
        let manifest: CharacterManifest = serde_json::from_str(&body)
            .with_context(|| format!("parsing manifest {}", manifest_path.display()))?;

        let base = manifest_path.parent().unwrap_or_else(|| Path::new("."));
        let mut reg = Self::new();
        for entry in manifest.characters {
            let visual = load_visual(&entry, base).with_context(|| {
                format!("loading visual for character `{}`", entry.id)
            })?;
            reg.insert(Character {
                id: entry.id,
                name: entry.name,
                archetype: entry.archetype,
                visual,
                defaults: entry.defaults,
                accent_hex: entry.accent_hex,
                tags: entry.tags,
            });
        }
        Ok(reg)
    }

    /// Load the standard `characters/manifest.json` +
    /// `integrations/manifest.json` pair from a themes root directory.
    /// Both manifests are merged into the same registry — character
    /// ids must be globally unique across the two files.
    pub fn load_pair(themes_root: &Path) -> Result<Self> {
        let mut reg = Self::new();
        for sub in ["characters", "integrations"] {
            let path = themes_root.join(sub).join("manifest.json");
            if !path.exists() {
                continue;
            }
            let part = Self::load_from_manifest(&path)?;
            for c in part.iter().cloned() {
                if reg.by_id.contains_key(&c.id) {
                    return Err(anyhow!(
                        "duplicate character id `{}` across manifests in {}",
                        c.id,
                        themes_root.display()
                    ));
                }
                reg.insert(c);
            }
        }
        Ok(reg)
    }
}

fn load_visual(entry: &CharacterManifestEntry, base: &Path) -> Result<VisualSpec> {
    match entry.format.as_str() {
        "lottie" => {
            let path: PathBuf = base.join(&entry.file);
            let body = std::fs::read_to_string(&path)
                .with_context(|| format!("reading lottie sprite {}", path.display()))?;
            let json: serde_json::Value = serde_json::from_str(&body)
                .with_context(|| format!("parsing lottie sprite {}", path.display()))?;
            Ok(VisualSpec::Lottie { json })
        }
        "svg" => {
            let path: PathBuf = base.join(&entry.file);
            let markup = std::fs::read_to_string(&path)
                .with_context(|| format!("reading svg sprite {}", path.display()))?;
            Ok(VisualSpec::Svg { markup })
        }
        "generative" => Ok(VisualSpec::Generative {
            prompt: entry.file.clone(),
        }),
        other => Err(anyhow!(
            "unknown character format `{}` for `{}`",
            other,
            entry.id
        )),
    }
}

/// Render a compact one-line summary of the registry suitable for
/// injecting into the LLM system prompt. The roster lists each
/// character by name + archetype + id, so the LLM can decide whether
/// to reference one from the user's prompt and emit the right id.
pub fn summarize_cast(reg: &CharacterRegistry, cast: &[CharacterRef]) -> String {
    if cast.is_empty() {
        return "No characters in the current cast. Do not emit Character layers.".to_string();
    }
    let mut parts = Vec::with_capacity(cast.len());
    for cref in cast {
        let label = match reg.get(&cref.id) {
            Some(c) => format!("{} ({}, id={})", c.name, c.archetype.as_str(), c.id),
            None => format!("unknown character id={}", cref.id),
        };
        parts.push(label);
    }
    format!(
        "Available characters: {}. To use one, emit a layer with kind=\"Character\" and \
         set the layer name to the character's id. Each character is rendered as a single \
         reusable sprite — the same id used across shots produces the same on-screen actor.",
        parts.join("; ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write_lottie_sprite(dir: &Path, name: &str) {
        let body = serde_json::json!({
            "v": "5.7.0",
            "fr": 30,
            "ip": 0,
            "op": 30,
            "w": 200,
            "h": 200,
            "nm": name,
            "ddd": 0,
            "assets": [],
            "layers": []
        });
        fs::write(dir.join(format!("{name}.json")), body.to_string()).unwrap();
    }

    #[test]
    fn round_trips_archetype_serde() {
        let raw = serde_json::to_string(&Archetype::Person).unwrap();
        assert_eq!(raw, "\"Person\"");
        let back: Archetype = serde_json::from_str(&raw).unwrap();
        assert_eq!(back, Archetype::Person);
    }

    #[test]
    fn loads_manifest_with_lottie_and_svg_entries() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path();
        write_lottie_sprite(dir, "alex");
        fs::write(
            dir.join("jira.svg"),
            "<svg xmlns='http://www.w3.org/2000/svg'/>",
        )
        .unwrap();
        let manifest = serde_json::json!({
            "characters": [
                {
                    "id": "alex",
                    "name": "Alex",
                    "archetype": "Person",
                    "file": "alex.json",
                    "format": "lottie",
                    "accent_hex": "#10b981"
                },
                {
                    "id": "jira",
                    "name": "Jira",
                    "archetype": "Logo",
                    "file": "jira.svg",
                    "format": "svg"
                }
            ]
        });
        fs::write(dir.join("manifest.json"), manifest.to_string()).unwrap();

        let reg = CharacterRegistry::load_from_manifest(&dir.join("manifest.json")).unwrap();
        assert_eq!(reg.len(), 2);
        assert!(matches!(
            reg.get("alex").unwrap().visual,
            VisualSpec::Lottie { .. }
        ));
        assert!(matches!(
            reg.get("jira").unwrap().visual,
            VisualSpec::Svg { .. }
        ));
    }

    #[test]
    fn summarize_cast_reports_unknown_ids() {
        let reg = CharacterRegistry::from_characters([Character {
            id: "alex".into(),
            name: "Alex".into(),
            archetype: Archetype::Person,
            visual: VisualSpec::Generative {
                prompt: "a smiling person".into(),
            },
            defaults: BehavioralDefaults::default(),
            accent_hex: None,
            tags: vec![],
        }]);
        let summary = summarize_cast(
            &reg,
            &[CharacterRef::new("alex"), CharacterRef::new("ghost")],
        );
        assert!(summary.contains("Alex"));
        assert!(summary.contains("unknown character id=ghost"));
    }

    #[test]
    fn empty_cast_summary_is_explicit() {
        let reg = CharacterRegistry::new();
        let s = summarize_cast(&reg, &[]);
        assert!(s.contains("No characters"));
    }

    /// Smoke-test the real on-disk manifests. Resolved against
    /// `CARGO_MANIFEST_DIR` so it works from any cwd and from
    /// workspace builds.
    #[test]
    fn loads_shipped_character_and_integration_manifests() {
        let crate_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        // crates/prompt-orchestrator/ → engine/themes/
        let themes_root = crate_dir
            .parent()
            .unwrap()
            .parent()
            .unwrap()
            .join("themes");
        if !themes_root.exists() {
            // Tolerate workspace layouts where themes live elsewhere
            // (e.g. when packaged as a crate). The unit tests above
            // still cover the loader behaviour.
            return;
        }
        let reg = CharacterRegistry::load_pair(&themes_root).expect("load_pair");
        // Spec calls for 12 characters + 8 integrations.
        assert_eq!(reg.len(), 20, "expected 12 + 8 = 20 entries");
        for required in [
            "alex",
            "sam",
            "lucius-bot",
            "office-worker",
            "generic-product",
            "arrow",
            "timesheet",
            "calendar",
            "dollar",
            "clock",
            "magnifier",
            "checkmark",
            "jira",
            "github",
            "linear",
            "azure-devops",
            "slack",
            "teams",
            "excel",
            "google-calendar",
        ] {
            assert!(reg.get(required).is_some(), "missing character `{required}`");
        }
    }
}
