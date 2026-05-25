//! Unified ingestion for popular motion-design source formats.
//!
//! Every adapter projects its source format into motion-forge's internal
//! `Composition` (the Lottie-shaped [`LottieTimeline`] the orchestrator
//! already produces). That keeps downstream code (renderer, panelizer,
//! `lottie-gen`) format-agnostic — the only seam each new format must cross
//! is the one in this crate.
//!
//! # Supported source formats
//!
//! | Format            | File extension(s)      | Adapter                    | Status            |
//! |-------------------|------------------------|----------------------------|-------------------|
//! | Lottie            | `.json`                | [`lottie`]                 | full pass-through |
//! | Bodymovin         | `.json` (AE export)    | [`lottie`]                 | full + warnings   |
//! | dotLottie         | `.lottie` (zip)        | [`dotlottie`]              | full              |
//! | Rive              | `.riv` / `.json` text  | [`rive`]                   | text-export only* |
//! | DragonBones       | `_ske.json`            | [`dragonbones`]            | skeleton+anim     |
//! | After Effects JSX | `.jsx` exporter script | [`adobe`] (script shipped) | export tooling    |
//! | MoGRT (Premiere)  | `.mogrt` (zip)         | [`adobe`]                  | full              |
//!
//! \* `rive-rs` is not published to crates.io; the binary `.riv` schema
//! isn't open-source either. We accept Rive's text JSON export instead.
//! Document on the Rive side: `File > Export > Animation Data (JSON)`.
//!
//! # Detection
//!
//! [`detect`] sniffs the first few bytes (magic numbers) and returns a best
//! guess. Bodymovin and Lottie are indistinguishable by content (both are
//! JSON with a `"v"` version key) — detection returns [`SourceFormat::Lottie`]
//! for both; the routing is identical anyway.

#![recursion_limit = "256"]
#![forbid(unsafe_code)]

pub mod adobe;
pub mod dotlottie;
pub mod dragonbones;
pub mod lottie;
pub mod rive;

use anyhow::Result;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub use motion_forge_prompt_orchestrator::LottieTimeline as Composition;

/// All formats this crate can ingest.
///
/// Names match the variants you'd pass at the CLI (`--format=lottie`,
/// `--format=dotlottie`, ...). Bodymovin and Lottie are routed through the
/// same adapter — Bodymovin is a superset of Lottie that may include
/// AE-isms (expressions, time remap) we strip with a warning.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SourceFormat {
    Lottie,
    Bodymovin,
    DotLottie,
    Rive,
    DragonBones,
    AfterEffectsJsx,
    MoGRT,
}

impl SourceFormat {
    /// Best-effort match of a file extension to a [`SourceFormat`]. Returns
    /// `None` for unknown extensions; callers should fall back to
    /// [`detect`] on the bytes.
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.trim_start_matches('.').to_ascii_lowercase().as_str() {
            "json" => Some(SourceFormat::Lottie),
            "lottie" => Some(SourceFormat::DotLottie),
            "riv" => Some(SourceFormat::Rive),
            "mogrt" => Some(SourceFormat::MoGRT),
            "jsx" => Some(SourceFormat::AfterEffectsJsx),
            _ => None,
        }
    }

    /// Human-readable label for logs / UIs.
    pub fn label(self) -> &'static str {
        match self {
            SourceFormat::Lottie => "Lottie",
            SourceFormat::Bodymovin => "Bodymovin (AE)",
            SourceFormat::DotLottie => "dotLottie",
            SourceFormat::Rive => "Rive",
            SourceFormat::DragonBones => "DragonBones",
            SourceFormat::AfterEffectsJsx => "After Effects JSX export",
            SourceFormat::MoGRT => "Premiere Pro MoGRT",
        }
    }
}

#[derive(Error, Debug)]
pub enum IngestError {
    #[error("input is empty")]
    Empty,
    #[error("format not yet supported: {0}")]
    Unsupported(&'static str),
    #[error("malformed {format}: {message}")]
    Malformed {
        format: &'static str,
        message: String,
    },
    #[error("unable to auto-detect source format")]
    UnknownFormat,
}

/// Sniff the first few bytes and return a best-guess [`SourceFormat`].
///
/// - `PK\x03\x04` → zip container; we further peek for a `manifest.json`
///   to distinguish dotLottie (`animations/*.json`) from MoGRT
///   (`Definition.json`). When inconclusive, we return [`SourceFormat::DotLottie`]
///   because it's the more common case and the MoGRT path will fail loudly.
/// - leading `{` → JSON; ambiguous between Lottie, Bodymovin, DragonBones,
///   and Rive's text export. We probe for distinguishing keys.
/// - leading `RIVE` magic (`R`, `I`, `V`, `E`) → binary Rive (unsupported).
/// - leading `//` or `#!` → script source; classify as JSX if the body
///   mentions `app.project` (AE API).
///
/// Returns `None` if nothing matches confidently.
pub fn detect(bytes: &[u8]) -> Option<SourceFormat> {
    if bytes.is_empty() {
        return None;
    }
    // Zip signature.
    if bytes.starts_with(b"PK\x03\x04") {
        return Some(detect_zip_kind(bytes).unwrap_or(SourceFormat::DotLottie));
    }
    // Binary Rive.
    if bytes.starts_with(b"RIVE") {
        return Some(SourceFormat::Rive);
    }
    // Skip leading whitespace/BOM for textual formats.
    let head = trim_leading_text_noise(bytes);
    if head.starts_with(b"{") {
        return Some(detect_json_kind(head).unwrap_or(SourceFormat::Lottie));
    }
    // ExtendScript / JSX export.
    if head.starts_with(b"//") || head.starts_with(b"#!") || head.starts_with(b"/*") {
        let lower = String::from_utf8_lossy(&head[..head.len().min(2048)]).to_ascii_lowercase();
        if lower.contains("app.project")
            || lower.contains("aftereffects")
            || lower.contains("bodymovin")
        {
            return Some(SourceFormat::AfterEffectsJsx);
        }
    }
    None
}

fn trim_leading_text_noise(bytes: &[u8]) -> &[u8] {
    let mut i = 0;
    // UTF-8 BOM.
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        i = 3;
    }
    while i < bytes.len() && bytes[i].is_ascii_whitespace() {
        i += 1;
    }
    &bytes[i..]
}

fn detect_zip_kind(bytes: &[u8]) -> Option<SourceFormat> {
    use std::io::Cursor;
    let reader = Cursor::new(bytes);
    let archive = zip::ZipArchive::new(reader).ok()?;
    // dotLottie ships `manifest.json` + `animations/*.json`.
    let mut has_animations_dir = false;
    let mut has_definition_json = false;
    for name in archive.file_names() {
        if name == "manifest.json" {
            // ambiguous on its own — MoGRT also has a manifest.json
            continue;
        }
        if name.starts_with("animations/") && name.ends_with(".json") {
            has_animations_dir = true;
        }
        if name == "Definition.json" || name.ends_with("/Definition.json") {
            has_definition_json = true;
        }
    }
    if has_animations_dir {
        Some(SourceFormat::DotLottie)
    } else if has_definition_json {
        Some(SourceFormat::MoGRT)
    } else {
        None
    }
}

fn detect_json_kind(bytes: &[u8]) -> Option<SourceFormat> {
    // We only need a shallow parse — peek at top-level keys.
    let value: serde_json::Value = serde_json::from_slice(bytes).ok()?;
    let obj = value.as_object()?;
    // DragonBones: top-level "armature" array.
    if obj.contains_key("armature") && obj.contains_key("name") {
        return Some(SourceFormat::DragonBones);
    }
    // Rive text export: top-level "artboards" array (camelCase per Rive runtime).
    if obj.contains_key("artboards") {
        return Some(SourceFormat::Rive);
    }
    // Bodymovin includes a "meta" object with "g" = "LottieFiles AE ..." or
    // "Adobe After Effects ..." or "Bodymovin ...". Any AE-flavour generator
    // string is enough for us to treat the file as Bodymovin (and warn about
    // AE-isms during ingestion).
    if let Some(meta) = obj.get("meta").and_then(|m| m.as_object()) {
        let generator = meta
            .get("g")
            .and_then(|g| g.as_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if generator.contains("bodymovin")
            || generator.contains("after effects")
            || generator.contains("lottiefiles ae")
            || generator.contains(" ae ")
            || generator.ends_with(" ae")
        {
            return Some(SourceFormat::Bodymovin);
        }
    }
    // Generic Lottie: has "v", "fr", "layers".
    if obj.contains_key("v") && obj.contains_key("layers") {
        return Some(SourceFormat::Lottie);
    }
    None
}

/// Dispatch ingestion to the right adapter.
///
/// The function is `async` for consistency with the rest of the codebase
/// (the HTTP route and pipeline are async), but every adapter currently
/// does its work synchronously — there's no I/O beyond the in-memory
/// buffer the caller provides.
pub async fn ingest(format: SourceFormat, bytes: &[u8]) -> Result<Composition> {
    if bytes.is_empty() {
        return Err(IngestError::Empty.into());
    }
    let format_label = format.label();
    tracing::debug!(
        format = format_label,
        bytes = bytes.len(),
        "ingest: dispatching"
    );
    let result = match format {
        SourceFormat::Lottie | SourceFormat::Bodymovin => lottie::ingest(bytes),
        SourceFormat::DotLottie => dotlottie::ingest(bytes),
        SourceFormat::Rive => rive::ingest(bytes),
        SourceFormat::DragonBones => dragonbones::ingest(bytes),
        SourceFormat::AfterEffectsJsx => adobe::ingest_jsx(bytes),
        SourceFormat::MoGRT => adobe::ingest_mogrt(bytes),
    };
    if let Ok(comp) = &result {
        tracing::info!(
            format = format_label,
            shots = comp.shots.len(),
            width = comp.composition_width,
            height = comp.composition_height,
            duration_s = comp.duration_seconds,
            "ingest: ok"
        );
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_empty_returns_none() {
        assert!(detect(&[]).is_none());
    }

    #[test]
    fn detect_lottie_json() {
        let bytes = br#"{"v":"5.7.0","fr":30,"ip":0,"op":180,"w":1920,"h":1080,"layers":[]}"#;
        assert_eq!(detect(bytes), Some(SourceFormat::Lottie));
    }

    #[test]
    fn detect_dragonbones_json() {
        let bytes = br#"{"name":"db","armature":[{"name":"hero"}],"version":"5.5"}"#;
        assert_eq!(detect(bytes), Some(SourceFormat::DragonBones));
    }

    #[test]
    fn detect_bodymovin_with_meta() {
        let bytes = br#"{"v":"5.7.0","fr":30,"ip":0,"op":180,"w":1920,"h":1080,"layers":[],"meta":{"g":"LottieFiles AE 2.0.0"}}"#;
        assert_eq!(detect(bytes), Some(SourceFormat::Bodymovin));
    }

    #[test]
    fn detect_rive_binary() {
        let bytes = b"RIVE\x00\x00\x00\x07rest of binary file...";
        assert_eq!(detect(bytes), Some(SourceFormat::Rive));
    }

    #[test]
    fn detect_rive_text_export() {
        let bytes = br#"{"artboards":[{"name":"Main"}]}"#;
        assert_eq!(detect(bytes), Some(SourceFormat::Rive));
    }

    #[test]
    fn detect_jsx_extendscript() {
        let bytes = br#"// motion-forge AE export
            // Run in After Effects via File > Scripts > Run.
            var comp = app.project.activeItem;
            "#;
        assert_eq!(detect(bytes), Some(SourceFormat::AfterEffectsJsx));
    }

    #[test]
    fn from_extension_known_cases() {
        assert_eq!(
            SourceFormat::from_extension("json"),
            Some(SourceFormat::Lottie)
        );
        assert_eq!(
            SourceFormat::from_extension(".lottie"),
            Some(SourceFormat::DotLottie)
        );
        assert_eq!(
            SourceFormat::from_extension("riv"),
            Some(SourceFormat::Rive)
        );
        assert_eq!(
            SourceFormat::from_extension(".mogrt"),
            Some(SourceFormat::MoGRT)
        );
        assert_eq!(
            SourceFormat::from_extension("JSX"),
            Some(SourceFormat::AfterEffectsJsx)
        );
        assert_eq!(SourceFormat::from_extension("xyz"), None);
    }

    #[test]
    fn ingest_empty_errors() {
        // Hand-rolled poll: we don't pull tokio in just for this test.
        // The `ingest` function only awaits its synchronous adapters, so a
        // single poll is enough to drive it to completion.
        use std::future::Future;
        use std::pin::Pin;
        use std::task::{Context as TaskContext, Poll, Waker};
        let mut fut = Box::pin(ingest(SourceFormat::Lottie, &[]));
        let waker = Waker::noop();
        let mut cx = TaskContext::from_waker(waker);
        match Pin::new(&mut fut).poll(&mut cx) {
            Poll::Ready(res) => {
                let err = res.unwrap_err();
                assert!(err.to_string().to_lowercase().contains("empty"));
            }
            Poll::Pending => panic!("ingest should be synchronously complete"),
        }
    }
}
