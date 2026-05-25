//! Adobe (After Effects / Premiere) ingestion paths.
//!
//! There are four ways an Adobe user might get a motion-design composition
//! into motion-forge, in order of fidelity:
//!
//! 1. **After Effects via Bodymovin → Lottie JSON.** This is the canonical
//!    path. AE users export their composition with the free **Bodymovin**
//!    plugin, producing a Lottie `.json` file which we ingest in
//!    [`crate::lottie::ingest`]. We don't reach this module on that path —
//!    it's handled by the Lottie adapter directly. The user-facing
//!    instructions live in `engine/crates/ingest/README.md`.
//!
//! 2. **Premiere Pro MoGRT (`.mogrt`).** A `.mogrt` is a zipped folder with
//!    a `Definition.json` manifest, the AE composition, and any required
//!    assets. After Effects 2020+ writes MoGRTs that embed the AE comp as
//!    Bodymovin JSON internally, which lets us treat the unpacked file as
//!    a regular Lottie. Implemented in [`ingest_mogrt`].
//!
//! 3. **AEP binary.** Out of scope. After Effects' native `.aep` project
//!    file is proprietary and has no open-source parser. The user must
//!    re-export via Bodymovin (path #1).
//!
//! 4. **JSX export script.** We ship `engine/scripts/motion-forge-export.jsx`
//!    — a small ExtendScript a user can drop into AE's Scripts folder and
//!    run via `File > Scripts > Run...`. The script dumps a JSON file in
//!    our internal [`Composition`] shape. [`ingest_jsx`] is a thin
//!    pass-through that validates and forwards that JSON.

use crate::{Composition, IngestError};
use anyhow::{Context, Result};
use serde::Deserialize;
use std::io::{Cursor, Read};

const FORMAT_LABEL_MOGRT: &str = "MoGRT";
const FORMAT_LABEL_JSX: &str = "After Effects JSX export";

pub fn ingest_mogrt(bytes: &[u8]) -> Result<Composition> {
    let reader = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| IngestError::Malformed {
        format: FORMAT_LABEL_MOGRT,
        message: format!("not a valid zip: {e}"),
    })?;

    // 1. Read Definition.json — Premiere's manifest. It tells us which AE
    //    composition is the primary one.
    let def: MogrtDefinition = read_zip_json(&mut archive, "Definition.json")?;
    tracing::info!(
        name = %def.name.as_deref().unwrap_or("unnamed"),
        version = %def.version.as_deref().unwrap_or("?"),
        "mogrt: opened"
    );

    // 2. Find the Bodymovin JSON inside the zip. AE 2020+ stores it as
    //    `<compname>.json` next to assets. The Definition.json optionally
    //    points to the file via `embeddedComposition` — fall back to the
    //    first `.json` other than `Definition.json` / `manifest.json`.
    let lottie_path = match def.embedded_composition.as_deref() {
        Some(p) => p.to_string(),
        None => find_first_lottie_json(&mut archive)?,
    };
    let lottie_bytes = read_zip_bytes(&mut archive, &lottie_path)?;
    tracing::info!(path = %lottie_path, "mogrt: extracted embedded composition");
    crate::lottie::ingest(&lottie_bytes)
}

/// Validate a JSX-export JSON payload and forward it to the dispatch.
///
/// A user-saved `.jsx` file is the ExtendScript *source*, not the JSON it
/// produces. We accept either:
/// - The JSON the script writes (top-level object with our `LottieTimeline`
///   field names) — preferred, direct pass-through.
/// - The script source itself (`.jsx`) — we surface an instructional error
///   asking the user to run the script in AE first.
pub fn ingest_jsx(bytes: &[u8]) -> Result<Composition> {
    let head = std::str::from_utf8(&bytes[..bytes.len().min(2048)])
        .unwrap_or("")
        .trim_start();
    if head.starts_with("//") || head.starts_with("/*") || head.starts_with("#!") {
        return Err(IngestError::Unsupported(
            "this looks like the ExtendScript source (.jsx) — open it inside After Effects via \
             File > Scripts > Run Script File... and import the JSON it writes to disk.",
        )
        .into());
    }
    // The script writes a JSON document with the same field names as our
    // `LottieTimeline`, so we can deserialise it directly.
    let composition: Composition =
        serde_json::from_slice(bytes).map_err(|e| IngestError::Malformed {
            format: FORMAT_LABEL_JSX,
            message: format!("not valid motion-forge JSON (was the script edited?): {e}"),
        })?;
    Ok(composition)
}

// ---- mogrt helpers ----

#[derive(Debug, Deserialize)]
struct MogrtDefinition {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    version: Option<String>,
    /// Path inside the zip pointing at the Bodymovin JSON. Optional —
    /// we'll scan for a `.json` if absent.
    #[serde(default, alias = "embeddedComposition")]
    embedded_composition: Option<String>,
}

fn read_zip_json<T: for<'de> serde::Deserialize<'de>>(
    archive: &mut zip::ZipArchive<Cursor<&[u8]>>,
    path: &str,
) -> Result<T> {
    let raw = read_zip_bytes(archive, path)?;
    serde_json::from_slice::<T>(&raw).map_err(|e| {
        IngestError::Malformed {
            format: FORMAT_LABEL_MOGRT,
            message: format!("{path} is not valid JSON: {e}"),
        }
        .into()
    })
}

fn read_zip_bytes(archive: &mut zip::ZipArchive<Cursor<&[u8]>>, path: &str) -> Result<Vec<u8>> {
    let mut entry = archive.by_name(path).map_err(|_| IngestError::Malformed {
        format: FORMAT_LABEL_MOGRT,
        message: format!("missing {path} in archive"),
    })?;
    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry
        .read_to_end(&mut buf)
        .with_context(|| format!("reading {path}"))?;
    Ok(buf)
}

fn find_first_lottie_json(archive: &mut zip::ZipArchive<Cursor<&[u8]>>) -> Result<String> {
    let names: Vec<String> = archive.file_names().map(|s| s.to_string()).collect();
    for name in &names {
        if (name.ends_with(".json")
            && name != "Definition.json"
            && name != "manifest.json"
            && !name.ends_with("/Definition.json"))
            || name.ends_with("composition.json")
        {
            return Ok(name.clone());
        }
    }
    Err(IngestError::Malformed {
        format: FORMAT_LABEL_MOGRT,
        message: "no embedded composition .json found in MoGRT archive".into(),
    }
    .into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn build_mogrt(
        definition_json: &str,
        composition_path: &str,
        composition_json: &str,
    ) -> Vec<u8> {
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(Cursor::new(&mut buf));
            let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            zip.start_file("Definition.json", opts).unwrap();
            zip.write_all(definition_json.as_bytes()).unwrap();
            zip.start_file(composition_path, opts).unwrap();
            zip.write_all(composition_json.as_bytes()).unwrap();
            zip.finish().unwrap();
        }
        buf
    }

    #[test]
    fn mogrt_uses_embedded_composition_pointer() {
        let lottie = r#"{"v":"5.7.0","fr":30,"ip":0,"op":90,"w":1080,"h":1080,"layers":[]}"#;
        let def = r#"{"name":"Promo","version":"1.0","embeddedComposition":"comps/main.json"}"#;
        let bytes = build_mogrt(def, "comps/main.json", lottie);
        let c = ingest_mogrt(&bytes).unwrap();
        assert_eq!(c.composition_width, 1080);
        assert_eq!(c.composition_height, 1080);
    }

    #[test]
    fn mogrt_falls_back_to_first_json() {
        let lottie = r#"{"v":"5.7.0","fr":24,"ip":0,"op":48,"w":640,"h":360,"layers":[]}"#;
        let def = r#"{"name":"Promo","version":"1.0"}"#;
        let bytes = build_mogrt(def, "composition.json", lottie);
        let c = ingest_mogrt(&bytes).unwrap();
        assert_eq!(c.frame_rate, 24.0);
        assert_eq!(c.composition_height, 360);
    }

    #[test]
    fn jsx_source_returns_helpful_error() {
        let src = b"// motion-forge AE exporter\nvar comp = app.project.activeItem;\n";
        let err = ingest_jsx(src).unwrap_err().to_string();
        assert!(err.contains("File > Scripts > Run Script File"));
    }

    #[test]
    fn jsx_output_json_is_passed_through() {
        // Minimal LottieTimeline JSON (no shots = empty timeline).
        let json = br#"{
            "composition_width":1920,
            "composition_height":1080,
            "duration_seconds":3.5,
            "frame_rate":30.0,
            "background_hex":[16,16,16],
            "shots":[]
        }"#;
        let c = ingest_jsx(json).unwrap();
        assert_eq!(c.composition_width, 1920);
        assert!((c.duration_seconds - 3.5).abs() < 1e-3);
        assert_eq!(c.background_hex, [16, 16, 16]);
        assert_eq!(c.shots.len(), 0);
    }
}
