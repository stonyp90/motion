//! Emit a vanilla Motion (`framer-motion`'s tree-shakeable `motion`
//! function) snippet. Each animated layer becomes its own
//! `animate(...)` call; we sequence them by passing explicit `delay`
//! options so the consumer doesn't need a custom orchestrator.
//!
//! `animate('.layer-0', { x: [0, 100], y: [0, 200] }, { duration: 1, ease: [...], repeat: Infinity })`

use anyhow::Result;
use std::fmt::Write as _;

use crate::ir::{Composition, Layer, PropertyScalar, PropertyVec2};

pub fn render(comp: &Composition) -> Result<String> {
    let mut s = String::new();
    let dur = comp.duration_seconds();
    write!(
        s,
        "// motion-forge web-export — Motion (vanilla) sequence\n\
         // Composition: {w}x{h} @ {fps}fps, duration {dur}s\n\
         // `motion` import path is the tree-shakeable build:\n\
         //   import {{ animate }} from 'motion';\n\
         import {{ animate }} from 'motion';\n\n\
         export function play() {{\n\
         \x20\x20const controls = [];\n",
        w = comp.width as i32,
        h = comp.height as i32,
        fps = fmt(comp.frame_rate),
        dur = fmt(dur),
    )?;

    for layer in &comp.layers {
        emit_layer(&mut s, layer, comp.frame_rate, dur)?;
    }

    write!(
        s,
        "  return {{\n\
         \x20\x20\x20\x20stop: () => controls.forEach((c) => c.stop()),\n\
         \x20\x20\x20\x20controls,\n\
         \x20\x20}};\n}}\n",
    )?;
    Ok(s)
}

fn emit_layer(s: &mut String, layer: &Layer, fps: f32, comp_dur: f32) -> Result<()> {
    let sel = format!(".layer-{}", layer.rank);
    writeln!(s, "  // Layer {} — \"{}\"", layer.rank, layer.name)?;

    if let PropertyVec2::Keyframes(kfs) = &layer.transform.position {
        let xs: Vec<String> = kfs.iter().map(|kf| fmt(kf.value[0])).collect();
        let ys: Vec<String> = kfs.iter().map(|kf| fmt(kf.value[1])).collect();
        let (offsets, ease) =
            offsets_and_ease(kfs.iter().map(|kf| (kf.frame, kf.ease_in)).collect());
        let total = ((kfs.last().unwrap().frame - kfs[0].frame).max(1.0) / fps.max(1.0)).max(0.001);
        writeln!(
            s,
            "  controls.push(animate('{sel}', {{ x: [{xs}], y: [{ys}] }}, {{ duration: {dur}, offset: [{ofs}], ease: [{ease}], repeat: Infinity }}));",
            xs = xs.join(", "),
            ys = ys.join(", "),
            ofs = offsets,
            ease = ease,
            dur = fmt(total),
        )?;
    }

    if let PropertyScalar::Keyframes(kfs) = &layer.transform.rotation {
        let vals: Vec<String> = kfs.iter().map(|kf| fmt(kf.value)).collect();
        let (offsets, ease) =
            offsets_and_ease(kfs.iter().map(|kf| (kf.frame, kf.ease_in)).collect());
        let total = ((kfs.last().unwrap().frame - kfs[0].frame).max(1.0) / fps.max(1.0)).max(0.001);
        writeln!(
            s,
            "  controls.push(animate('{sel}', {{ rotate: [{vals}] }}, {{ duration: {dur}, offset: [{ofs}], ease: [{ease}], repeat: Infinity }}));",
            vals = vals.join(", "),
            ofs = offsets,
            ease = ease,
            dur = fmt(total),
        )?;
    }

    if let PropertyVec2::Keyframes(kfs) = &layer.transform.scale {
        let xs: Vec<String> = kfs.iter().map(|kf| fmt(kf.value[0] / 100.0)).collect();
        let ys: Vec<String> = kfs.iter().map(|kf| fmt(kf.value[1] / 100.0)).collect();
        let (offsets, ease) =
            offsets_and_ease(kfs.iter().map(|kf| (kf.frame, kf.ease_in)).collect());
        let total = ((kfs.last().unwrap().frame - kfs[0].frame).max(1.0) / fps.max(1.0)).max(0.001);
        writeln!(
            s,
            "  controls.push(animate('{sel}', {{ scaleX: [{xs}], scaleY: [{ys}] }}, {{ duration: {dur}, offset: [{ofs}], ease: [{ease}], repeat: Infinity }}));",
            xs = xs.join(", "),
            ys = ys.join(", "),
            ofs = offsets,
            ease = ease,
            dur = fmt(total),
        )?;
    }

    if let PropertyScalar::Keyframes(kfs) = &layer.transform.opacity {
        let vals: Vec<String> = kfs.iter().map(|kf| fmt(kf.value / 100.0)).collect();
        let (offsets, ease) =
            offsets_and_ease(kfs.iter().map(|kf| (kf.frame, kf.ease_in)).collect());
        let total = ((kfs.last().unwrap().frame - kfs[0].frame).max(1.0) / fps.max(1.0)).max(0.001);
        writeln!(
            s,
            "  controls.push(animate('{sel}', {{ opacity: [{vals}] }}, {{ duration: {dur}, offset: [{ofs}], ease: [{ease}], repeat: Infinity }}));",
            vals = vals.join(", "),
            ofs = offsets,
            ease = ease,
            dur = fmt(total),
        )?;
    }

    // Suppress unused warning if no keyframed properties on this layer.
    let _ = comp_dur;
    Ok(())
}

/// Return (`"0, 0.5, 1"`, `"[0.4,0,0.2,1], [0.4,0,0.2,1]"`).
fn offsets_and_ease(kfs: Vec<(f32, Option<[f32; 4]>)>) -> (String, String) {
    if kfs.is_empty() {
        return ("0".to_string(), "[0.42,0,0.58,1]".to_string());
    }
    let first = kfs[0].0;
    let last = kfs.last().unwrap().0.max(first + 1.0);
    let span = (last - first).max(1.0);
    let offsets = kfs
        .iter()
        .map(|(f, _)| fmt(((f - first) / span).clamp(0.0, 1.0)))
        .collect::<Vec<_>>()
        .join(", ");
    // N keyframes need N-1 easing arrays.
    let mut eases = Vec::with_capacity(kfs.len().saturating_sub(1));
    for (_, ease) in kfs.iter().skip(1) {
        let [x1, y1, x2, y2] = ease.unwrap_or([0.42, 0.0, 0.58, 1.0]);
        eases.push(format!("[{},{},{},{}]", fmt(x1), fmt(y1), fmt(x2), fmt(y2)));
    }
    if eases.is_empty() {
        eases.push("[0.42,0,0.58,1]".to_string());
    }
    (offsets, eases.join(", "))
}

fn fmt(n: f32) -> String {
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
    fn emits_animate_calls_per_animated_property() {
        let v = json!({
            "v":"5.7.0","fr":30,"ip":0,"op":30,"w":640,"h":360,
            "layers":[{
                "ty":4,"ind":1,"nm":"orb","ip":0,"op":30,"sr":1,
                "ks":{
                    "o":{"a":1,"k":[
                        {"t":0,"s":[0],"o":{"x":[0.3],"y":[0]},"i":{"x":[0.7],"y":[1]}},
                        {"t":30,"s":[100]}
                    ]},
                    "r":{"a":0,"k":0},
                    "p":{"a":1,"k":[
                        {"t":0,"s":[0,0],"o":{"x":[0.3],"y":[0]},"i":{"x":[0.7],"y":[1]}},
                        {"t":30,"s":[200,200]}
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
        let js = render(&comp).unwrap();
        assert!(js.contains("from 'motion'"));
        assert!(js.contains("animate('.layer-0', { x:"));
        assert!(js.contains("animate('.layer-0', { opacity:"));
        assert!(js.contains("repeat: Infinity"));
    }
}
