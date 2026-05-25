//! Rive ingestion.
//!
//! # Crate availability
//!
//! At the time this crate was authored there is **no published `rive-rs`
//! crate on crates.io** (the GitHub project at `rive-app/rive-rs` is
//! development-only and the binary `.riv` schema isn't open-source). We
//! therefore accept Rive's **text JSON export** instead:
//!
//! > In the Rive editor: `File > Export > Animation Data (JSON)`.
//!
//! The text export contains everything we need to project a Rive composition
//! onto our internal [`Composition`]: artboards (we take the first as our
//! single composition), nested LinearAnimation objects for keyframes, and a
//! palette of fill/stroke colours.
//!
//! If a caller passes a binary `.riv` file we surface a clear error so they
//! know to re-export. Detection (`detect()` in `lib.rs`) already returns
//! `Some(Rive)` for the `RIVE` magic header — the dispatcher then lands here
//! and we explain the situation.

use crate::{Composition, IngestError};
use anyhow::Result;
use motion_forge_prompt_orchestrator::{Keyframe, Layer, LayerKind, Shot};
use motion_forge_style_extract::EasingLabel;
use serde_json::Value;

const FORMAT_LABEL: &str = "Rive";

pub fn ingest(bytes: &[u8]) -> Result<Composition> {
    if bytes.starts_with(b"RIVE") {
        return Err(IngestError::Unsupported(
            "binary .riv files require Rive's proprietary parser. \
             Re-export from the Rive editor via File > Export > Animation Data (JSON) \
             and pass that .json to motion-forge instead.",
        )
        .into());
    }
    let v: Value = serde_json::from_slice(bytes).map_err(|e| IngestError::Malformed {
        format: FORMAT_LABEL,
        message: format!("Rive text export must be JSON: {e}"),
    })?;
    let obj = v.as_object().ok_or_else(|| IngestError::Malformed {
        format: FORMAT_LABEL,
        message: "top-level must be a JSON object".into(),
    })?;
    let artboards = obj
        .get("artboards")
        .and_then(|a| a.as_array())
        .ok_or_else(|| IngestError::Malformed {
            format: FORMAT_LABEL,
            message: "missing \"artboards\" array (is this really a Rive text export?)".into(),
        })?;
    if artboards.len() > 1 {
        tracing::warn!(
            count = artboards.len(),
            "rive: multiple artboards present — only the first is imported"
        );
    }
    let first = artboards.first().ok_or_else(|| IngestError::Malformed {
        format: FORMAT_LABEL,
        message: "\"artboards\" is empty".into(),
    })?;
    let board = first.as_object().ok_or_else(|| IngestError::Malformed {
        format: FORMAT_LABEL,
        message: "artboard must be an object".into(),
    })?;
    let width = read_num(board, "width").unwrap_or(1920.0) as u32;
    let height = read_num(board, "height").unwrap_or(1080.0) as u32;
    let bg = read_color(board.get("color")).unwrap_or([0x0a, 0x0a, 0x0a]);

    // Rive's animations live under `animations[]` with `fps` and `duration`
    // (in frames). Use the first animation's fps/duration as the comp clock.
    let (frame_rate, total_frames) = match board.get("animations").and_then(|a| a.as_array()) {
        Some(arr) if !arr.is_empty() => {
            let a = arr[0].as_object();
            let fps = a.and_then(|o| read_num(o, "fps")).unwrap_or(60.0) as f32;
            let dur = a.and_then(|o| read_num(o, "duration")).unwrap_or(60.0) as f32;
            (fps, dur)
        }
        _ => (60.0, 60.0),
    };
    let duration_seconds = total_frames / frame_rate.max(1.0);

    let layers = extract_layers(board, frame_rate);
    let shots = if layers.is_empty() {
        vec![]
    } else {
        vec![Shot {
            start_seconds: 0.0,
            duration_seconds,
            description: "imported from Rive".into(),
            layers,
        }]
    };

    Ok(Composition {
        composition_width: width,
        composition_height: height,
        duration_seconds,
        frame_rate,
        background_hex: bg,
        shots,
    })
}

fn extract_layers(board: &serde_json::Map<String, Value>, frame_rate: f32) -> Vec<Layer> {
    let mut layers = Vec::new();
    let nodes = match board.get("children").and_then(|c| c.as_array()) {
        Some(c) => c,
        None => return layers,
    };
    for node in nodes {
        let obj = match node.as_object() {
            Some(o) => o,
            None => continue,
        };
        let name = obj
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("rive-node")
            .to_string();
        let kind = match obj.get("type").and_then(|t| t.as_str()) {
            Some("Ellipse") => LayerKind::Ellipse,
            Some("Text") => LayerKind::Text,
            Some("Image") => LayerKind::Image,
            _ => LayerKind::Rect,
        };
        let fill_hex = read_color(obj.get("fill"));
        // Rive keyframes: optional `keyframes` array of {frame, x, y}.
        let mut keyframes: Vec<Keyframe> = obj
            .get("keyframes")
            .and_then(|k| k.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|kf| {
                        let m = kf.as_object()?;
                        let frame = read_num(m, "frame")?;
                        let x = read_num(m, "x").unwrap_or(0.0) as f32;
                        let y = read_num(m, "y").unwrap_or(0.0) as f32;
                        Some(Keyframe {
                            time_seconds: frame as f32 / frame_rate.max(1.0),
                            position: [x, y],
                            size: [
                                read_num(m, "width").unwrap_or(100.0) as f32,
                                read_num(m, "height").unwrap_or(100.0) as f32,
                            ],
                            rotation_degrees: read_num(m, "rotation").unwrap_or(0.0) as f32,
                            opacity: read_num(m, "opacity").unwrap_or(1.0) as f32,
                            easing_label: EasingLabel::Standard,
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        if keyframes.is_empty() {
            // Fall back to a single static keyframe at t=0 using the node's
            // own transform if present.
            let x = read_num(obj, "x").unwrap_or(0.0) as f32;
            let y = read_num(obj, "y").unwrap_or(0.0) as f32;
            keyframes.push(Keyframe {
                time_seconds: 0.0,
                position: [x, y],
                size: [
                    read_num(obj, "width").unwrap_or(100.0) as f32,
                    read_num(obj, "height").unwrap_or(100.0) as f32,
                ],
                rotation_degrees: read_num(obj, "rotation").unwrap_or(0.0) as f32,
                opacity: read_num(obj, "opacity").unwrap_or(1.0) as f32,
                easing_label: EasingLabel::Standard,
            });
        }
        layers.push(Layer {
            name,
            kind,
            fill_hex,
            stroke_hex: read_color(obj.get("stroke")),
            text: obj
                .get("text")
                .and_then(|t| t.as_str())
                .map(|s| s.to_string()),
            keyframes,
        });
    }
    layers
}

fn read_num(obj: &serde_json::Map<String, Value>, key: &str) -> Option<f64> {
    obj.get(key)?
        .as_f64()
        .or_else(|| obj.get(key)?.as_i64().map(|n| n as f64))
}

fn read_color(v: Option<&Value>) -> Option<[u8; 3]> {
    let v = v?;
    // Rive serializes colors as either a `#rrggbb` string OR an object
    // `{r, g, b, a}` with 0-1 floats.
    if let Some(s) = v.as_str() {
        let t = s.trim_start_matches('#');
        if t.len() >= 6 {
            return Some([
                u8::from_str_radix(&t[0..2], 16).ok()?,
                u8::from_str_radix(&t[2..4], 16).ok()?,
                u8::from_str_radix(&t[4..6], 16).ok()?,
            ]);
        }
    }
    if let Some(map) = v.as_object() {
        let r = map.get("r").and_then(|x| x.as_f64()).unwrap_or(0.0);
        let g = map.get("g").and_then(|x| x.as_f64()).unwrap_or(0.0);
        let b = map.get("b").and_then(|x| x.as_f64()).unwrap_or(0.0);
        return Some([
            (r.clamp(0.0, 1.0) * 255.0) as u8,
            (g.clamp(0.0, 1.0) * 255.0) as u8,
            (b.clamp(0.0, 1.0) * 255.0) as u8,
        ]);
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn binary_riv_returns_clear_error() {
        let bytes = b"RIVE\x00\x00\x00\x07restofbinary";
        let err = ingest(bytes).unwrap_err().to_string();
        assert!(err.contains("Re-export"));
        assert!(err.contains("JSON"));
    }

    #[test]
    fn parses_text_export() {
        let json = r##"{
            "artboards":[{
                "name":"Main",
                "width":800,
                "height":600,
                "color":"#101820",
                "animations":[{"name":"idle","fps":60,"duration":120}],
                "children":[
                    {"type":"Rectangle","name":"hero","x":100,"y":200,"width":50,"height":50,"fill":"#10b981"},
                    {"type":"Ellipse","name":"dot","x":400,"y":300,"width":20,"height":20,"fill":{"r":1,"g":0.5,"b":0,"a":1}}
                ]
            }]
        }"##;
        let c = ingest(json.as_bytes()).unwrap();
        assert_eq!(c.composition_width, 800);
        assert_eq!(c.composition_height, 600);
        assert_eq!(c.frame_rate, 60.0);
        assert!((c.duration_seconds - 2.0).abs() < 1e-3);
        assert_eq!(c.background_hex, [0x10, 0x18, 0x20]);
        assert_eq!(c.shots.len(), 1);
        assert_eq!(c.shots[0].layers.len(), 2);
        assert_eq!(c.shots[0].layers[1].kind, LayerKind::Ellipse);
        assert_eq!(c.shots[0].layers[1].fill_hex, Some([255, 127, 0]));
    }

    #[test]
    fn rejects_non_rive_json() {
        assert!(ingest(b"{}").is_err());
    }
}
