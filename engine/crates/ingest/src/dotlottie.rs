//! dotLottie ingestion.
//!
//! `.lottie` is a zip container with this layout (per the open spec):
//!
//! ```text
//! manifest.json
//! animations/
//!   anim-1.json     <- a regular Lottie file
//!   anim-2.json
//! images/                 (optional asset bundle)
//!   image_0.png
//!   ...
//! ```
//!
//! `manifest.json` declares the animations and which one is the default
//! (`activeAnimationId` or first in `animations[]`). We pull that single
//! Lottie JSON out and hand it to [`crate::lottie::ingest`].
//!
//! We don't use the `dotlottie-rs` crate (only published as an alpha at the
//! time of writing) — the format is simple enough to read with the `zip`
//! crate directly, which we already need for [`crate::adobe::ingest_mogrt`].

use crate::{Composition, IngestError};
use anyhow::{Context, Result};
use std::io::{Cursor, Read};

const FORMAT_LABEL: &str = "dotLottie";

pub fn ingest(bytes: &[u8]) -> Result<Composition> {
    let reader = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| IngestError::Malformed {
        format: FORMAT_LABEL,
        message: format!("not a valid zip: {e}"),
    })?;

    let manifest = read_manifest(&mut archive)?;
    let active_id = manifest.active_animation_id.unwrap_or_else(|| {
        manifest
            .animations
            .first()
            .map(|a| a.id.clone())
            .unwrap_or_default()
    });
    if active_id.is_empty() {
        return Err(IngestError::Malformed {
            format: FORMAT_LABEL,
            message: "manifest.json declares no animations".into(),
        }
        .into());
    }

    let json_path = format!("animations/{active_id}.json");
    let mut entry = archive
        .by_name(&json_path)
        .map_err(|_| IngestError::Malformed {
            format: FORMAT_LABEL,
            message: format!("animation \"{active_id}\" not found at {json_path}"),
        })?;
    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut buf)
        .with_context(|| format!("reading {json_path}"))?;

    tracing::info!(
        active_animation = %active_id,
        other_animations = manifest.animations.len().saturating_sub(1),
        "dotlottie: extracted primary animation"
    );
    crate::lottie::ingest(&buf)
}

#[derive(Debug, Clone, serde::Deserialize)]
struct Manifest {
    /// dotLottie spec: optional pointer to the default animation. Fall back
    /// to `animations[0].id`.
    #[serde(rename = "activeAnimationId", default)]
    active_animation_id: Option<String>,
    /// List of animations bundled inside.
    #[serde(default)]
    animations: Vec<AnimationEntry>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct AnimationEntry {
    id: String,
}

fn read_manifest(archive: &mut zip::ZipArchive<Cursor<&[u8]>>) -> Result<Manifest> {
    let mut entry = archive
        .by_name("manifest.json")
        .map_err(|_| IngestError::Malformed {
            format: FORMAT_LABEL,
            message: "missing manifest.json".into(),
        })?;
    let mut buf = String::with_capacity(entry.size() as usize);
    entry
        .read_to_string(&mut buf)
        .context("reading manifest.json")?;
    let manifest: Manifest = serde_json::from_str(&buf).map_err(|e| IngestError::Malformed {
        format: FORMAT_LABEL,
        message: format!("manifest.json is not valid JSON: {e}"),
    })?;
    Ok(manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn build_dotlottie(animation_id: &str, animation_json: &str) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(Cursor::new(&mut buf));
            let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            let manifest = format!(
                r#"{{"activeAnimationId":"{animation_id}","animations":[{{"id":"{animation_id}"}}]}}"#
            );
            zip.start_file("manifest.json", opts).unwrap();
            zip.write_all(manifest.as_bytes()).unwrap();
            zip.start_file(format!("animations/{animation_id}.json"), opts)
                .unwrap();
            zip.write_all(animation_json.as_bytes()).unwrap();
            zip.finish().unwrap();
        }
        buf
    }

    #[test]
    fn extracts_active_animation() {
        let lottie = r#"{"v":"5.7.0","fr":30,"ip":0,"op":60,"w":640,"h":480,"layers":[]}"#;
        let bytes = build_dotlottie("hero", lottie);
        let c = ingest(&bytes).unwrap();
        assert_eq!(c.composition_width, 640);
        assert_eq!(c.composition_height, 480);
    }

    #[test]
    fn rejects_missing_manifest() {
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(Cursor::new(&mut buf));
            zip.start_file(
                "animations/hero.json",
                zip::write::SimpleFileOptions::default(),
            )
            .unwrap();
            zip.write_all(b"{}").unwrap();
            zip.finish().unwrap();
        }
        assert!(ingest(&buf).is_err());
    }
}
