//! Emit a GSAP timeline as a tree-shakeable JS module.
//!
//! The output assumes:
//! - `gsap` is on the import map / bundler as `import { gsap } from 'gsap'`.
//! - The DOM has elements with class `.layer-N` matching our painter order.
//!
//! The whole composition becomes one `gsap.timeline({ repeat: -1 })`
//! with `.to(...)` calls sequenced at absolute times (`<` / `+=`).
//! That keeps the snippet readable and tunable by a human consumer.

use anyhow::Result;
use std::fmt::Write as _;

use crate::ir::{Composition, Layer, PropertyScalar, PropertyVec2};

pub fn render(comp: &Composition) -> Result<String> {
    let mut s = String::new();
    let dur = comp.duration_seconds();
    write!(
        s,
        "// motion-forge web-export — GSAP timeline\n\
         // Composition: {w}x{h} @ {fps}fps, duration {dur}s, {n} layer(s)\n\
         // Targets DOM nodes with classes `.layer-0`, `.layer-1`, ...\n\
         import {{ gsap }} from 'gsap';\n\n\
         export const timeline = gsap.timeline({{ repeat: -1, defaults: {{ ease: 'power2.inOut' }} }});\n\n",
        w = comp.width as i32,
        h = comp.height as i32,
        fps = format_num(comp.frame_rate),
        dur = format_num(dur),
        n = comp.layers.len(),
    )?;

    if comp.layers.is_empty() {
        writeln!(s, "// (no animated layers)")?;
        return Ok(s);
    }

    for layer in &comp.layers {
        emit_layer(&mut s, layer, comp.frame_rate)?;
    }
    Ok(s)
}

fn emit_layer(s: &mut String, layer: &Layer, fps: f32) -> Result<()> {
    let class = format!(".layer-{}", layer.rank);
    let initial = initial_set(layer);
    writeln!(s, "// Layer {} — \"{}\"", layer.rank, layer.name)?;
    writeln!(s, "timeline.set('{class}', {{ {} }}, 0);", initial)?;

    // Walk each animated property; emit one `.to()` per segment.
    if let PropertyVec2::Keyframes(kfs) = &layer.transform.position {
        for w in kfs.windows(2) {
            let a = &w[0];
            let b = &w[1];
            let start = a.frame / fps.max(1.0);
            let duration = ((b.frame - a.frame).max(1.0)) / fps.max(1.0);
            let ease = ease_or_default(b.ease_in);
            writeln!(
                s,
                "timeline.to('{class}', {{ x: {x}, y: {y}, duration: {dur}, ease: {ease} }}, {start});",
                x = format_num(b.value[0]),
                y = format_num(b.value[1]),
                dur = format_num(duration),
                ease = ease,
                start = format_num(start),
            )?;
        }
    }

    if let PropertyScalar::Keyframes(kfs) = &layer.transform.rotation {
        for w in kfs.windows(2) {
            let a = &w[0];
            let b = &w[1];
            let start = a.frame / fps.max(1.0);
            let duration = ((b.frame - a.frame).max(1.0)) / fps.max(1.0);
            let ease = ease_or_default(b.ease_in);
            writeln!(
                s,
                "timeline.to('{class}', {{ rotation: {r}, duration: {dur}, ease: {ease} }}, {start});",
                r = format_num(b.value),
                dur = format_num(duration),
                ease = ease,
                start = format_num(start),
            )?;
        }
    }

    if let PropertyVec2::Keyframes(kfs) = &layer.transform.scale {
        for w in kfs.windows(2) {
            let a = &w[0];
            let b = &w[1];
            let start = a.frame / fps.max(1.0);
            let duration = ((b.frame - a.frame).max(1.0)) / fps.max(1.0);
            let ease = ease_or_default(b.ease_in);
            writeln!(
                s,
                "timeline.to('{class}', {{ scaleX: {sx}, scaleY: {sy}, duration: {dur}, ease: {ease} }}, {start});",
                sx = format_num(b.value[0] / 100.0),
                sy = format_num(b.value[1] / 100.0),
                dur = format_num(duration),
                ease = ease,
                start = format_num(start),
            )?;
        }
    }

    if let PropertyScalar::Keyframes(kfs) = &layer.transform.opacity {
        for w in kfs.windows(2) {
            let a = &w[0];
            let b = &w[1];
            let start = a.frame / fps.max(1.0);
            let duration = ((b.frame - a.frame).max(1.0)) / fps.max(1.0);
            let ease = ease_or_default(b.ease_in);
            writeln!(
                s,
                "timeline.to('{class}', {{ opacity: {o}, duration: {dur}, ease: {ease} }}, {start});",
                o = format_num(b.value / 100.0),
                dur = format_num(duration),
                ease = ease,
                start = format_num(start),
            )?;
        }
    }

    writeln!(s)?;
    Ok(())
}

/// Emit an initial `.set()` so static properties land before any tweens.
fn initial_set(layer: &Layer) -> String {
    let (x, y) = match &layer.transform.position {
        PropertyVec2::Static(v) => (v[0], v[1]),
        PropertyVec2::Keyframes(kfs) => (kfs[0].value[0], kfs[0].value[1]),
    };
    let r = match &layer.transform.rotation {
        PropertyScalar::Static(v) => *v,
        PropertyScalar::Keyframes(kfs) => kfs[0].value,
    };
    let (sx, sy) = match &layer.transform.scale {
        PropertyVec2::Static(v) => (v[0], v[1]),
        PropertyVec2::Keyframes(kfs) => (kfs[0].value[0], kfs[0].value[1]),
    };
    let o = match &layer.transform.opacity {
        PropertyScalar::Static(v) => *v,
        PropertyScalar::Keyframes(kfs) => kfs[0].value,
    };
    format!(
        "x: {x}, y: {y}, rotation: {r}, scaleX: {sx}, scaleY: {sy}, opacity: {o}, transformOrigin: '{ax}px {ay}px'",
        x = format_num(x),
        y = format_num(y),
        r = format_num(r),
        sx = format_num(sx / 100.0),
        sy = format_num(sy / 100.0),
        o = format_num(o / 100.0),
        ax = format_num(layer.transform.anchor[0]),
        ay = format_num(layer.transform.anchor[1]),
    )
}

fn ease_or_default(ease: Option<[f32; 4]>) -> String {
    let [x1, y1, x2, y2] = ease.unwrap_or([0.42, 0.0, 0.58, 1.0]);
    // GSAP supports CustomEase but only after registerPlugin; a plain
    // cubic-bezier is conveyed via `"power2.inOut"` etc. We emit the
    // raw bezier via CSS so the consumer can swap it for a built-in.
    format!(
        "'cubic-bezier({}, {}, {}, {})'",
        format_num(x1),
        format_num(y1),
        format_num(x2),
        format_num(y2)
    )
}

fn format_num(n: f32) -> String {
    if n.abs() < 1e-6 {
        return "0".to_string();
    }
    let s = format!("{n:.3}");
    let t = s.trim_end_matches('0').trim_end_matches('.');
    if t.is_empty() {
        "0".to_string()
    } else {
        t.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn emits_one_timeline_and_layer_set() {
        let v = json!({
            "v":"5.7.0","fr":30,"ip":0,"op":30,"w":640,"h":360,
            "layers":[{
                "ty":4,"ind":1,"nm":"chip","ip":0,"op":30,"sr":1,
                "ks":{
                    "o":{"a":0,"k":100},"r":{"a":0,"k":0},
                    "p":{"a":1,"k":[
                        {"t":0,"s":[0,0],"o":{"x":[0.3],"y":[0]},"i":{"x":[0.7],"y":[1]}},
                        {"t":30,"s":[100,200]}
                    ]},
                    "a":{"a":0,"k":[0,0]},"s":{"a":0,"k":[100,100]}
                },
                "shapes":[{"ty":"gr","it":[
                    {"ty":"rc","s":{"a":0,"k":[40,40]},"p":{"a":0,"k":[0,0]}},
                    {"ty":"fl","c":{"a":0,"k":[1,0,0,1]}}
                ]}]
            }]
        });
        let comp = Composition::from_lottie(&v).unwrap();
        let js = render(&comp).unwrap();
        assert!(js.contains("gsap.timeline"));
        assert!(js.contains("timeline.set('.layer-0'"));
        assert!(js.contains("timeline.to('.layer-0'"));
        assert!(js.contains("repeat: -1"));
    }
}
