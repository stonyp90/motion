//! Emit a Theatre.js project state JSON. The output can be passed
//! straight to `getProject('motion-forge', { state })` so the project
//! restores in the consumer's app without any further wiring.
//!
//! Theatre.js state schema (v0.7-ish — the on-disk format is JSON the
//! Studio panel exports). We mirror the minimum needed to round-trip a
//! sheet with one object per layer and tracks per animated property.
//!
//! Reference: https://www.theatrejs.com/docs/latest/manual/projects

use anyhow::Result;
use serde_json::{Map, Value, json};

use crate::ir::{Composition, Keyframe1, Keyframe2, Layer, PropertyScalar, PropertyVec2};

pub fn render(comp: &Composition) -> Result<String> {
    let dur = comp.duration_seconds();
    let mut objects = Map::new();
    let mut tracks = Map::new();

    for layer in &comp.layers {
        let object_key = format!("layer-{}", layer.rank);
        objects.insert(
            object_key.clone(),
            json!({
                "type": "object",
                "displayName": layer.name,
            }),
        );

        // Build the per-object trackData; Theatre groups tracks by prop path.
        let mut object_tracks = Map::new();
        if let PropertyVec2::Keyframes(kfs) = &layer.transform.position {
            object_tracks.insert(
                "position.x".into(),
                track_from_scalar(kfs_to_axis(kfs, 0), comp.frame_rate),
            );
            object_tracks.insert(
                "position.y".into(),
                track_from_scalar(kfs_to_axis(kfs, 1), comp.frame_rate),
            );
        }
        if let PropertyScalar::Keyframes(kfs) = &layer.transform.rotation {
            object_tracks.insert(
                "rotation".into(),
                track_from_scalar(scalar_clone(kfs), comp.frame_rate),
            );
        }
        if let PropertyVec2::Keyframes(kfs) = &layer.transform.scale {
            object_tracks.insert(
                "scale.x".into(),
                track_from_scalar(
                    kfs_to_axis(kfs, 0)
                        .into_iter()
                        .map(|kf| Keyframe1 {
                            frame: kf.frame,
                            value: kf.value / 100.0,
                            ease_in: kf.ease_in,
                        })
                        .collect(),
                    comp.frame_rate,
                ),
            );
            object_tracks.insert(
                "scale.y".into(),
                track_from_scalar(
                    kfs_to_axis(kfs, 1)
                        .into_iter()
                        .map(|kf| Keyframe1 {
                            frame: kf.frame,
                            value: kf.value / 100.0,
                            ease_in: kf.ease_in,
                        })
                        .collect(),
                    comp.frame_rate,
                ),
            );
        }
        if let PropertyScalar::Keyframes(kfs) = &layer.transform.opacity {
            let normalized: Vec<Keyframe1> = kfs
                .iter()
                .map(|kf| Keyframe1 {
                    frame: kf.frame,
                    value: kf.value / 100.0,
                    ease_in: kf.ease_in,
                })
                .collect();
            object_tracks.insert(
                "opacity".into(),
                track_from_scalar(normalized, comp.frame_rate),
            );
        }

        if !object_tracks.is_empty() {
            tracks.insert(object_key, Value::Object(object_tracks));
        }
    }

    let state = json!({
        "definitionVersion": "0.4.0",
        "revisionHistory": ["motion-forge:web-export"],
        "sheetsById": {
            "Composition": {
                "staticOverrides": { "byObject": objects_to_overrides(&comp.layers) },
                "sequence": {
                    "type": "PositionalSequence",
                    "length": dur,
                    "subUnitsPerUnit": 30,
                    "tracksByObject": tracks
                },
                "objects": objects
            }
        }
    });

    Ok(serde_json::to_string_pretty(&state)?)
}

fn objects_to_overrides(layers: &[Layer]) -> Map<String, Value> {
    let mut out = Map::new();
    for layer in layers {
        let key = format!("layer-{}", layer.rank);
        let (px, py) = static_or_first_vec2(&layer.transform.position);
        let (sx, sy) = static_or_first_vec2(&layer.transform.scale);
        let r = static_or_first_scalar(&layer.transform.rotation);
        let o = static_or_first_scalar(&layer.transform.opacity);
        out.insert(
            key,
            json!({
                "position": { "x": px, "y": py },
                "rotation": r,
                "scale": { "x": sx / 100.0, "y": sy / 100.0 },
                "opacity": o / 100.0,
            }),
        );
    }
    out
}

fn static_or_first_vec2(prop: &PropertyVec2) -> (f32, f32) {
    match prop {
        PropertyVec2::Static(v) => (v[0], v[1]),
        PropertyVec2::Keyframes(kfs) => (kfs[0].value[0], kfs[0].value[1]),
    }
}

fn static_or_first_scalar(prop: &PropertyScalar) -> f32 {
    match prop {
        PropertyScalar::Static(v) => *v,
        PropertyScalar::Keyframes(kfs) => kfs[0].value,
    }
}

/// Convert one axis of a vec2 keyframe list into a list of scalar
/// keyframes (Theatre tracks are scalar).
fn kfs_to_axis(kfs: &[Keyframe2], axis: usize) -> Vec<Keyframe1> {
    kfs.iter()
        .map(|kf| Keyframe1 {
            frame: kf.frame,
            value: kf.value[axis],
            ease_in: kf.ease_in,
        })
        .collect()
}

fn scalar_clone(kfs: &[Keyframe1]) -> Vec<Keyframe1> {
    kfs.to_vec()
}

/// Theatre stores a track as a list of keyframes, each with `id`,
/// `position` (seconds), `value`, and `handles` (4-tuple bezier).
fn track_from_scalar(kfs: Vec<Keyframe1>, fps: f32) -> Value {
    let keyframes: Vec<Value> = kfs
        .iter()
        .enumerate()
        .map(|(i, kf)| {
            let pos = kf.frame / fps.max(1.0);
            let [x1, y1, x2, y2] = kf.ease_in.unwrap_or([0.42, 0.0, 0.58, 1.0]);
            json!({
                "id": format!("kf-{i}"),
                "position": pos,
                "connectedRight": true,
                "handles": [x1, y1, x2, y2],
                "type": "bezier",
                "value": kf.value,
            })
        })
        .collect();
    json!({
        "type": "BasicKeyframedTrack",
        "keyframes": keyframes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn emits_parsable_state_with_sequence_and_objects() {
        let v = json!({
            "v":"5.7.0","fr":30,"ip":0,"op":60,"w":640,"h":360,
            "layers":[{
                "ty":4,"ind":1,"nm":"orb","ip":0,"op":60,"sr":1,
                "ks":{
                    "o":{"a":0,"k":100},
                    "r":{"a":1,"k":[
                        {"t":0,"s":[0],"o":{"x":[0.4],"y":[0]},"i":{"x":[0.2],"y":[1]}},
                        {"t":60,"s":[360]}
                    ]},
                    "p":{"a":1,"k":[
                        {"t":0,"s":[100,100],"o":{"x":[0.4],"y":[0]},"i":{"x":[0.2],"y":[1]}},
                        {"t":60,"s":[500,300]}
                    ]},
                    "a":{"a":0,"k":[0,0]},
                    "s":{"a":0,"k":[100,100]}
                },
                "shapes":[{"ty":"gr","it":[
                    {"ty":"el","s":{"a":0,"k":[40,40]},"p":{"a":0,"k":[0,0]}},
                    {"ty":"fl","c":{"a":0,"k":[0,0.5,1,1]}}
                ]}]
            }]
        });
        let comp = Composition::from_lottie(&v).unwrap();
        let out = render(&comp).unwrap();
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(parsed["definitionVersion"], "0.4.0");
        assert!(parsed["sheetsById"]["Composition"]["objects"]["layer-0"].is_object());
        let tracks = &parsed["sheetsById"]["Composition"]["sequence"]["tracksByObject"]["layer-0"];
        assert!(tracks["position.x"]["keyframes"].is_array());
        assert!(tracks["rotation"]["keyframes"].is_array());
    }
}
