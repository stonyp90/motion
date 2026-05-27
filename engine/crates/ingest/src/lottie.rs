//! Lottie / Bodymovin JSON ingestion.
//!
//! Both formats share the same wire schema (Lottie 5.x JSON). Bodymovin —
//! the After Effects exporter that produced most of the Lottie files in the
//! wild — sometimes leaves AE-specific features in the file that no Lottie
//! player handles uniformly: text/property *expressions* (`tm`, `tx.x`),
//! time-remap layers, AE effects (`ef`). We strip those with a warning so
//! the result plays everywhere.
//!
//! Output is a [`Composition`] (alias for `LottieTimeline`) — the
//! orchestrator's native shape. We don't have a way to recover *every* AE
//! nicety, so the conversion is a best-effort projection onto the
//! orchestrator's rectangle/ellipse/text/image vocabulary. Anything we
//! can't represent (precomps, masks beyond simple opacity, mattes) is
//! dropped with a `tracing::warn!` so the operator knows what was lost.

use crate::{Composition, IngestError};
use anyhow::{Context, Result};
use motion_forge_prompt_orchestrator::{Keyframe, Layer, LayerKind, Shot};
use motion_forge_style_extract::EasingLabel;
use serde_json::Value;

const FORMAT_LABEL: &str = "Lottie";

pub fn ingest(bytes: &[u8]) -> Result<Composition> {
    let v: Value = serde_json::from_slice(bytes).map_err(|e| IngestError::Malformed {
        format: FORMAT_LABEL,
        message: format!("not valid JSON: {e}"),
    })?;
    let obj = v.as_object().ok_or_else(|| IngestError::Malformed {
        format: FORMAT_LABEL,
        message: "top-level must be a JSON object".into(),
    })?;

    let width = read_u32(obj, "w").context("missing \"w\" (composition width)")?;
    let height = read_u32(obj, "h").context("missing \"h\" (composition height)")?;
    let frame_rate = read_f32(obj, "fr").context("missing \"fr\" (frame rate)")?;
    let ip = read_f32(obj, "ip").unwrap_or(0.0);
    let op = read_f32(obj, "op").context("missing \"op\" (out-point)")?;
    let total_frames = (op - ip).max(1.0);
    let duration_seconds = total_frames / frame_rate.max(1.0);
    let background_hex = read_background(obj);

    warn_about_bodymovin_isms(obj);

    let mut layers_out: Vec<Layer> = Vec::new();
    let mut earliest_in: f32 = f32::INFINITY;
    let mut latest_out: f32 = 0.0;
    if let Some(layers) = obj.get("layers").and_then(|l| l.as_array()) {
        // Lottie stores topmost layer first; the orchestrator's `Layer` order
        // is bottom-up. Reverse so the front-to-back order is preserved when
        // we round-trip through `lottie-gen`.
        for layer_json in layers.iter().rev() {
            if let Some(layer) = convert_layer(layer_json, frame_rate) {
                let lin = read_f32(layer_json.as_object().unwrap_or(&Default::default()), "ip")
                    .unwrap_or(ip);
                let lout = read_f32(layer_json.as_object().unwrap_or(&Default::default()), "op")
                    .unwrap_or(op);
                earliest_in = earliest_in.min(lin);
                latest_out = latest_out.max(lout);
                layers_out.push(layer);
            }
        }
    }
    if earliest_in.is_infinite() {
        earliest_in = ip;
    }
    if latest_out <= 0.0 {
        latest_out = op;
    }

    // Single shot covering the whole composition. We don't try to chunk
    // Lottie files into shots — that's a creative-direction decision that
    // belongs in the orchestrator, not the importer.
    let shots = if layers_out.is_empty() {
        vec![]
    } else {
        vec![Shot {
            start_seconds: (earliest_in - ip).max(0.0) / frame_rate.max(1.0),
            duration_seconds: ((latest_out - earliest_in).max(1.0)) / frame_rate.max(1.0),
            description: "imported".into(),
            layers: layers_out,
        }]
    };

    Ok(Composition {
        composition_width: width,
        composition_height: height,
        duration_seconds,
        frame_rate,
        background_hex,
        shots,
        image_assets: Vec::new(),
    })
}

fn read_u32(obj: &serde_json::Map<String, Value>, key: &str) -> Option<u32> {
    obj.get(key)?.as_u64().map(|n| n as u32).or_else(|| {
        obj.get(key)
            .and_then(|v| v.as_f64())
            .map(|f| f.round() as u32)
    })
}

fn read_f32(obj: &serde_json::Map<String, Value>, key: &str) -> Option<f32> {
    obj.get(key)?.as_f64().map(|f| f as f32)
}

/// Read the background colour from the optional `bg` field. Lottie stores
/// background as a CSS-style `#rrggbb` string when present.
fn read_background(obj: &serde_json::Map<String, Value>) -> [u8; 3] {
    let default = [0x0a, 0x0a, 0x0a];
    let hex = match obj.get("bg").and_then(|b| b.as_str()) {
        Some(s) => s,
        None => return default,
    };
    let trimmed = hex.trim_start_matches('#');
    if trimmed.len() < 6 {
        return default;
    }
    let r = u8::from_str_radix(&trimmed[0..2], 16).unwrap_or(default[0]);
    let g = u8::from_str_radix(&trimmed[2..4], 16).unwrap_or(default[1]);
    let b = u8::from_str_radix(&trimmed[4..6], 16).unwrap_or(default[2]);
    [r, g, b]
}

/// Lottie layer type code → our [`LayerKind`].
///
/// Lottie codes:
/// - 0: precomp           (dropped — we'd need to flatten; warn)
/// - 1: solid             → Rect
/// - 2: image             → Image
/// - 3: null              (dropped — invisible transform-only layer)
/// - 4: shape             → Rect (or Ellipse if we can sniff it)
/// - 5: text              → Text
fn convert_layer(layer: &Value, frame_rate: f32) -> Option<Layer> {
    let obj = layer.as_object()?;
    let ty = obj.get("ty").and_then(|t| t.as_u64()).unwrap_or(4);
    let kind = match ty {
        1 => LayerKind::Rect,
        2 => LayerKind::Image,
        4 => sniff_shape_kind(obj),
        5 => LayerKind::Text,
        0 => {
            tracing::warn!("lottie: dropping precomp layer (not flattenable)");
            return None;
        }
        3 => return None, // null layer — invisible.
        other => {
            tracing::warn!(ty = other, "lottie: unknown layer type — dropping");
            return None;
        }
    };
    let name = obj
        .get("nm")
        .and_then(|n| n.as_str())
        .unwrap_or("layer")
        .to_string();
    let fill_hex = sniff_fill(obj);
    let text = obj
        .get("t")
        .and_then(|t| t.get("d"))
        .and_then(|d| d.get("k"))
        .and_then(|k| k.as_array())
        .and_then(|arr| arr.first())
        .and_then(|first| first.get("s"))
        .and_then(|s| s.get("t"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string());
    let keyframes = extract_position_keyframes(obj, frame_rate);
    Some(Layer {
        name,
        kind,
        fill_hex,
        stroke_hex: None,
        text,
        keyframes,
        image_asset_id: None,
        text_reveal: None,
        entry_vector: None,
    })
}

fn sniff_shape_kind(obj: &serde_json::Map<String, Value>) -> LayerKind {
    // Walk the first shape group looking for "el" (ellipse) or "rc" (rect).
    let groups = obj.get("shapes").and_then(|s| s.as_array());
    if let Some(groups) = groups {
        for group in groups {
            if let Some(items) = group.get("it").and_then(|i| i.as_array()) {
                for item in items {
                    if let Some(ty) = item.get("ty").and_then(|t| t.as_str()) {
                        match ty {
                            "el" => return LayerKind::Ellipse,
                            "rc" => return LayerKind::Rect,
                            _ => {}
                        }
                    }
                }
            }
        }
    }
    LayerKind::Rect
}

fn sniff_fill(obj: &serde_json::Map<String, Value>) -> Option<[u8; 3]> {
    let groups = obj.get("shapes")?.as_array()?;
    for group in groups {
        let items = group.get("it")?.as_array()?;
        for item in items {
            if item.get("ty").and_then(|t| t.as_str()) == Some("fl") {
                let k = item.get("c")?.get("k")?.as_array()?;
                if k.len() >= 3 {
                    let r = (k[0].as_f64().unwrap_or(0.0) * 255.0) as u8;
                    let g = (k[1].as_f64().unwrap_or(0.0) * 255.0) as u8;
                    let b = (k[2].as_f64().unwrap_or(0.0) * 255.0) as u8;
                    return Some([r, g, b]);
                }
            }
        }
    }
    None
}

fn extract_position_keyframes(
    obj: &serde_json::Map<String, Value>,
    frame_rate: f32,
) -> Vec<Keyframe> {
    let ks = match obj.get("ks") {
        Some(k) => k,
        None => return vec![],
    };
    let position = ks.get("p");
    let opacity = ks.get("o");
    let rotation = ks.get("r");

    // Animated property in Lottie is `{ "a": 1, "k": [ {t, s, e, i, o}, ...] }`,
    // static is `{ "a": 0, "k": [x, y, z] }`.
    let pos_keys = sample_value(position, &["x", "y"]);
    let opacity_keys = sample_value(opacity, &["o"]);
    let rotation_keys = sample_value(rotation, &["r"]);

    // Merge time-ordered: union of all property timestamps.
    let mut times: Vec<f32> = pos_keys
        .iter()
        .chain(opacity_keys.iter())
        .chain(rotation_keys.iter())
        .map(|(t, _)| *t)
        .collect();
    times.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    times.dedup_by(|a, b| (*a - *b).abs() < 1e-3);
    if times.is_empty() {
        times.push(0.0);
    }

    times
        .into_iter()
        .map(|t| Keyframe {
            time_seconds: t / frame_rate.max(1.0),
            position: [
                interpolate(&pos_keys, t, 0).unwrap_or(0.0),
                interpolate(&pos_keys, t, 1).unwrap_or(0.0),
            ],
            size: [100.0, 100.0],
            rotation_degrees: interpolate(&rotation_keys, t, 0).unwrap_or(0.0),
            opacity: interpolate(&opacity_keys, t, 0).unwrap_or(100.0) / 100.0,
            easing_label: EasingLabel::Standard,
        })
        .collect()
}

/// Returns a list of `(frame_time, [components...])` samples extracted from
/// a Lottie animated or static value. Components are stored as a `Vec<f32>`
/// so callers can index by dimension.
fn sample_value(prop: Option<&Value>, _component_names: &[&str]) -> Vec<(f32, Vec<f32>)> {
    let prop = match prop {
        Some(p) => p,
        None => return vec![],
    };
    let animated = prop.get("a").and_then(|a| a.as_u64()).unwrap_or(0) == 1;
    let k = match prop.get("k") {
        Some(k) => k,
        None => return vec![],
    };
    if !animated {
        let comps = scalar_or_vec(k);
        return vec![(0.0, comps)];
    }
    let arr = match k.as_array() {
        Some(a) => a,
        None => return vec![],
    };
    arr.iter()
        .filter_map(|kf| {
            let t = kf.get("t")?.as_f64()? as f32;
            let s = kf.get("s").map(scalar_or_vec).unwrap_or_default();
            Some((t, s))
        })
        .collect()
}

fn scalar_or_vec(v: &Value) -> Vec<f32> {
    if let Some(arr) = v.as_array() {
        arr.iter()
            .filter_map(|x| x.as_f64().map(|f| f as f32))
            .collect()
    } else if let Some(n) = v.as_f64() {
        vec![n as f32]
    } else {
        vec![]
    }
}

/// Linear interpolation of a single component across the (sparse) keyframe
/// list. Returns the nearest value at `t` for components that don't change.
fn interpolate(keys: &[(f32, Vec<f32>)], t: f32, component: usize) -> Option<f32> {
    if keys.is_empty() {
        return None;
    }
    // Before first / after last → clamp.
    if t <= keys[0].0 {
        return keys[0].1.get(component).copied();
    }
    if t >= keys.last().unwrap().0 {
        return keys.last().unwrap().1.get(component).copied();
    }
    for w in keys.windows(2) {
        let (t0, v0) = (&w[0].0, &w[0].1);
        let (t1, v1) = (&w[1].0, &w[1].1);
        if t >= *t0 && t <= *t1 {
            let alpha = if (t1 - t0).abs() > 1e-6 {
                (t - t0) / (t1 - t0)
            } else {
                0.0
            };
            let a = v0.get(component).copied().unwrap_or(0.0);
            let b = v1.get(component).copied().unwrap_or(a);
            return Some(a + (b - a) * alpha);
        }
    }
    keys[0].1.get(component).copied()
}

fn warn_about_bodymovin_isms(obj: &serde_json::Map<String, Value>) {
    // Expression presence: any layer with `"x"` keyframe values (string
    // expressions) or top-level `"exp"` => 1.
    let mut expressions = 0usize;
    let mut effects = 0usize;
    let mut time_remap = 0usize;
    if let Some(layers) = obj.get("layers").and_then(|l| l.as_array()) {
        for layer in layers {
            if layer.get("ef").is_some() {
                effects += 1;
            }
            if layer.get("tm").is_some() {
                time_remap += 1;
            }
            if has_expression(layer) {
                expressions += 1;
            }
        }
    }
    if expressions + effects + time_remap > 0 {
        tracing::warn!(
            expressions,
            effects,
            time_remap,
            "lottie: Bodymovin-isms detected and stripped (expressions/effects/time-remap aren't portable; output will play but won't match AE preview exactly)"
        );
    }
}

fn has_expression(v: &Value) -> bool {
    match v {
        Value::Object(map) => {
            if map.get("x").map(|x| x.is_string()).unwrap_or(false) {
                return true;
            }
            map.values().any(has_expression)
        }
        Value::Array(arr) => arr.iter().any(has_expression),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN_LOTTIE: &str = r##"{
        "v":"5.7.0","fr":30,"ip":0,"op":90,"w":1280,"h":720,"bg":"#202020",
        "layers":[
            {"ty":4,"nm":"box","ks":{
                "o":{"a":0,"k":100},
                "r":{"a":0,"k":0},
                "p":{"a":1,"k":[
                    {"t":0,"s":[100,200,0]},
                    {"t":60,"s":[400,200,0]}
                ]},
                "a":{"a":0,"k":[0,0,0]},
                "s":{"a":0,"k":[100,100,100]}
            },"shapes":[{"ty":"gr","it":[
                {"ty":"rc","d":1,"s":{"a":0,"k":[100,100]},"p":{"a":0,"k":[0,0]},"r":{"a":0,"k":0}},
                {"ty":"fl","c":{"a":0,"k":[0.5,1.0,0.0,1.0]},"o":{"a":0,"k":100},"r":1,"bm":0}
            ]}]}
        ]
    }"##;

    #[test]
    fn parses_minimum_lottie() {
        let c = ingest(MIN_LOTTIE.as_bytes()).unwrap();
        assert_eq!(c.composition_width, 1280);
        assert_eq!(c.composition_height, 720);
        assert_eq!(c.frame_rate, 30.0);
        assert!((c.duration_seconds - 3.0).abs() < 1e-3);
        assert_eq!(c.background_hex, [0x20, 0x20, 0x20]);
        assert_eq!(c.shots.len(), 1);
        assert_eq!(c.shots[0].layers.len(), 1);
        let layer = &c.shots[0].layers[0];
        assert_eq!(layer.kind, LayerKind::Rect);
        assert!(layer.keyframes.len() >= 2);
        assert!((layer.keyframes[0].position[0] - 100.0).abs() < 1e-3);
        // Fill colour is sniffed from the first fl shape.
        assert_eq!(layer.fill_hex, Some([127, 255, 0]));
    }

    #[test]
    fn rejects_non_json() {
        assert!(ingest(b"not json").is_err());
    }

    #[test]
    fn rejects_missing_required_fields() {
        // No "w"/"h"/"fr"/"op".
        assert!(ingest(b"{}").is_err());
    }
}
