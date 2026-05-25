//! Emit a Framer Motion `variants` object as JSON. React consumers
//! wire it up like:
//!
//! ```jsx
//! import { motion } from 'framer-motion';
//! import variants from './anim.json' assert { type: 'json' };
//!
//! <motion.div className="layer-0" variants={variants['layer-0']}
//!             initial="from" animate="to" transition={variants['layer-0'].__transition} />
//! ```
//!
//! Each layer is keyed by `layer-N` and yields:
//! - `from` — initial keyframe value (frame 0).
//! - `to` — full keyframe array per property; Framer interpolates
//!   when the array is passed to `animate`.
//! - `__transition` — `duration`, `times`, `ease`, `repeat: Infinity`.
//!
//! This is intentionally an "object" file, not a `.js` module — that
//! way it's importable from JS, TS, or directly via `fetch()`.

use anyhow::Result;
use serde_json::{Map, Value, json};

use crate::ir::{Composition, Keyframe1, Keyframe2, PropertyScalar, PropertyVec2};

pub fn render(comp: &Composition) -> Result<String> {
    let dur = comp.duration_seconds();
    let mut out = Map::new();

    out.insert(
        "__meta".into(),
        json!({
            "source": "motion-forge",
            "width": comp.width,
            "height": comp.height,
            "frameRate": comp.frame_rate,
            "duration": dur,
            "loop": "infinite",
        }),
    );

    for layer in &comp.layers {
        let key = format!("layer-{}", layer.rank);

        let mut from = Map::new();
        let mut to = Map::new();
        let mut times: Option<Vec<f32>> = None;
        let mut eases: Option<Vec<Value>> = None;

        // position
        match &layer.transform.position {
            PropertyVec2::Static(v) => {
                from.insert("x".into(), json!(v[0]));
                from.insert("y".into(), json!(v[1]));
                to.insert("x".into(), json!(v[0]));
                to.insert("y".into(), json!(v[1]));
            }
            PropertyVec2::Keyframes(kfs) => {
                from.insert("x".into(), json!(kfs[0].value[0]));
                from.insert("y".into(), json!(kfs[0].value[1]));
                to.insert(
                    "x".into(),
                    json!(kfs.iter().map(|kf| kf.value[0]).collect::<Vec<_>>()),
                );
                to.insert(
                    "y".into(),
                    json!(kfs.iter().map(|kf| kf.value[1]).collect::<Vec<_>>()),
                );
                if times.is_none() {
                    times = Some(normalized_times(kfs.iter().map(|kf| kf.frame).collect()));
                    eases = Some(eases_from_vec2(kfs));
                }
            }
        }

        // rotation
        match &layer.transform.rotation {
            PropertyScalar::Static(v) => {
                from.insert("rotate".into(), json!(v));
                to.insert("rotate".into(), json!(v));
            }
            PropertyScalar::Keyframes(kfs) => {
                from.insert("rotate".into(), json!(kfs[0].value));
                to.insert(
                    "rotate".into(),
                    json!(kfs.iter().map(|kf| kf.value).collect::<Vec<_>>()),
                );
                if times.is_none() {
                    times = Some(normalized_times(kfs.iter().map(|kf| kf.frame).collect()));
                    eases = Some(eases_from_scalar(kfs));
                }
            }
        }

        // scale
        match &layer.transform.scale {
            PropertyVec2::Static(v) => {
                from.insert("scaleX".into(), json!(v[0] / 100.0));
                from.insert("scaleY".into(), json!(v[1] / 100.0));
                to.insert("scaleX".into(), json!(v[0] / 100.0));
                to.insert("scaleY".into(), json!(v[1] / 100.0));
            }
            PropertyVec2::Keyframes(kfs) => {
                from.insert("scaleX".into(), json!(kfs[0].value[0] / 100.0));
                from.insert("scaleY".into(), json!(kfs[0].value[1] / 100.0));
                to.insert(
                    "scaleX".into(),
                    json!(kfs.iter().map(|kf| kf.value[0] / 100.0).collect::<Vec<_>>()),
                );
                to.insert(
                    "scaleY".into(),
                    json!(kfs.iter().map(|kf| kf.value[1] / 100.0).collect::<Vec<_>>()),
                );
                if times.is_none() {
                    times = Some(normalized_times(kfs.iter().map(|kf| kf.frame).collect()));
                    eases = Some(eases_from_vec2(kfs));
                }
            }
        }

        // opacity
        match &layer.transform.opacity {
            PropertyScalar::Static(v) => {
                from.insert("opacity".into(), json!(v / 100.0));
                to.insert("opacity".into(), json!(v / 100.0));
            }
            PropertyScalar::Keyframes(kfs) => {
                from.insert("opacity".into(), json!(kfs[0].value / 100.0));
                to.insert(
                    "opacity".into(),
                    json!(kfs.iter().map(|kf| kf.value / 100.0).collect::<Vec<_>>()),
                );
                if times.is_none() {
                    times = Some(normalized_times(kfs.iter().map(|kf| kf.frame).collect()));
                    eases = Some(eases_from_scalar(kfs));
                }
            }
        }

        let transition = json!({
            "duration": dur,
            "times": times.clone().unwrap_or_else(|| vec![0.0, 1.0]),
            "ease": eases.clone().unwrap_or_else(|| vec![json!([0.42, 0.0, 0.58, 1.0])]),
            "repeat": "Infinity",
            "repeatType": "loop",
        });

        out.insert(
            key,
            json!({
                "from": Value::Object(from),
                "to": Value::Object(to),
                "__transition": transition,
                "__transformOrigin": {
                    "x": layer.transform.anchor[0],
                    "y": layer.transform.anchor[1],
                }
            }),
        );
    }

    Ok(serde_json::to_string_pretty(&Value::Object(out))?)
}

fn normalized_times(frames: Vec<f32>) -> Vec<f32> {
    if frames.is_empty() {
        return vec![0.0, 1.0];
    }
    let first = frames[0];
    let last = frames
        .last()
        .copied()
        .unwrap_or(first + 1.0)
        .max(first + 1.0);
    let span = (last - first).max(1.0);
    frames
        .iter()
        .map(|f| ((f - first) / span).clamp(0.0, 1.0))
        .collect()
}

fn eases_from_vec2(kfs: &[Keyframe2]) -> Vec<Value> {
    if kfs.len() < 2 {
        return vec![json!([0.42, 0.0, 0.58, 1.0])];
    }
    kfs.iter()
        .skip(1)
        .map(|kf| {
            let [x1, y1, x2, y2] = kf.ease_in.unwrap_or([0.42, 0.0, 0.58, 1.0]);
            json!([x1, y1, x2, y2])
        })
        .collect()
}

fn eases_from_scalar(kfs: &[Keyframe1]) -> Vec<Value> {
    if kfs.len() < 2 {
        return vec![json!([0.42, 0.0, 0.58, 1.0])];
    }
    kfs.iter()
        .skip(1)
        .map(|kf| {
            let [x1, y1, x2, y2] = kf.ease_in.unwrap_or([0.42, 0.0, 0.58, 1.0]);
            json!([x1, y1, x2, y2])
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn emits_variants_keyed_by_layer() {
        let v = json!({
            "v":"5.7.0","fr":30,"ip":0,"op":60,"w":640,"h":360,
            "layers":[{
                "ty":4,"ind":1,"nm":"orb","ip":0,"op":60,"sr":1,
                "ks":{
                    "o":{"a":0,"k":100},
                    "r":{"a":0,"k":0},
                    "p":{"a":1,"k":[
                        {"t":0,"s":[0,0],"o":{"x":[0.3],"y":[0]},"i":{"x":[0.7],"y":[1]}},
                        {"t":60,"s":[200,200]}
                    ]},
                    "a":{"a":0,"k":[0,0]},
                    "s":{"a":0,"k":[100,100]}
                },
                "shapes":[{"ty":"gr","it":[
                    {"ty":"el","s":{"a":0,"k":[40,40]},"p":{"a":0,"k":[0,0]}},
                    {"ty":"fl","c":{"a":0,"k":[1,0,0,1]}}
                ]}]
            }]
        });
        let comp = Composition::from_lottie(&v).unwrap();
        let out = render(&comp).unwrap();
        let parsed: Value = serde_json::from_str(&out).unwrap();
        assert!(parsed["layer-0"]["from"].is_object());
        assert!(parsed["layer-0"]["to"]["x"].is_array());
        assert_eq!(parsed["layer-0"]["__transition"]["repeat"], "Infinity");
    }
}
