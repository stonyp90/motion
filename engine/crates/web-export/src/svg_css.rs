//! Render the IR into an SVG with a `<style>` block of `@keyframes`
//! rules. Each layer gets a class (`layer-N`) and its own animation.
//!
//! Why CSS instead of SMIL?
//! - SMIL is deprecated in the WHATWG SVG2 draft.
//! - CSS gives us `transform-origin` so rotate/scale around a layer's
//!   own anchor renders identically to a Lottie player.
//! - GPU compositing in browsers tends to be more efficient for CSS
//!   `transform` than for SMIL `<animateTransform>`.
//!
//! Limitations: CSS keyframes don't support per-segment bezier easing —
//! one timing function applies to the whole `@keyframes` rule. We
//! approximate by using the easing of the *second* keyframe (the first
//! segment) and warning consumers in a `<!-- comment -->`.

use anyhow::Result;
use std::fmt::Write as _;

use crate::ir::{Composition, Geometry, Keyframe1, Keyframe2, Layer, PropertyScalar, PropertyVec2};

pub fn render(comp: &Composition) -> Result<String> {
    let mut s = String::new();
    let dur = comp.duration_seconds();

    write!(
        s,
        r#"<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}">
"#,
        w = fmt_num(comp.width),
        h = fmt_num(comp.height),
    )?;

    // <style> block first so animations work even when the SVG is
    // inlined into a host page.
    s.push_str("  <style>\n");
    s.push_str("    <![CDATA[\n");
    s.push_str(&format!(
        "      /* motion-forge web-export — duration {dur:.3}s, infinite loop */\n"
    ));
    for layer in &comp.layers {
        write_layer_animations(&mut s, layer, comp.frame_rate, dur);
    }
    s.push_str("    ]]>\n  </style>\n");

    if let Some(bg) = &comp.background_hex {
        writeln!(
            s,
            r#"  <rect x="0" y="0" width="{w}" height="{h}" fill="{bg}"/>"#,
            w = fmt_num(comp.width),
            h = fmt_num(comp.height),
        )?;
    }

    for layer in &comp.layers {
        render_layer_geometry(&mut s, layer)?;
    }
    writeln!(s, "</svg>")?;
    Ok(s)
}

fn write_layer_animations(s: &mut String, layer: &Layer, fps: f32, comp_dur: f32) {
    let class = format!("layer-{}", layer.rank);
    let dur = comp_dur;

    let mut transform_steps: Vec<(f32, String)> = Vec::new();
    let mut opacity_steps: Vec<(f32, f32)> = Vec::new();

    // Always emit a base `transform-origin` from the layer's anchor.
    let _ = writeln!(
        s,
        "      .{class} {{ transform-origin: {ax}px {ay}px; transform-box: fill-box; }}",
        ax = fmt_num(layer.transform.anchor[0]),
        ay = fmt_num(layer.transform.anchor[1]),
    );

    // Collate keyframes from position / rotation / scale into a single
    // unified set so we can emit one `@keyframes` rule.
    let mut frames: Vec<f32> = Vec::new();
    collect_frames_vec2(&layer.transform.position, &mut frames);
    collect_frames_vec2(&layer.transform.scale, &mut frames);
    collect_frames_scalar(&layer.transform.rotation, &mut frames);
    if frames.is_empty() {
        frames.push(layer.in_frame);
        frames.push(layer.out_frame.max(layer.in_frame + 1.0));
    }
    frames.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    frames.dedup();

    let first = frames[0];
    let last = frames
        .last()
        .copied()
        .unwrap_or(first + 1.0)
        .max(first + 1.0);
    let span = (last - first).max(1.0);

    for f in &frames {
        let t = ((*f - first) / span).clamp(0.0, 1.0);
        let pos = sample_vec2(&layer.transform.position, *f);
        let scl = sample_vec2(&layer.transform.scale, *f);
        let rot = sample_scalar(&layer.transform.rotation, *f);
        // CSS transform: translate to absolute layer position, rotate
        // around anchor (transform-origin handles that), then scale.
        let css = format!(
            "translate({tx}px, {ty}px) rotate({rd}deg) scale({sx}, {sy})",
            tx = fmt_num(pos[0]),
            ty = fmt_num(pos[1]),
            rd = fmt_num(rot),
            sx = fmt_num(scl[0] / 100.0),
            sy = fmt_num(scl[1] / 100.0),
        );
        transform_steps.push((t, css));
        opacity_steps.push((t, sample_scalar(&layer.transform.opacity, *f) / 100.0));
    }

    // @keyframes <class>-transform
    let _ = writeln!(s, "      @keyframes {class}-transform {{");
    for (t, css) in &transform_steps {
        let _ = writeln!(
            s,
            "        {pct}% {{ transform: {css}; }}",
            pct = fmt_pct(*t)
        );
    }
    let _ = writeln!(s, "      }}");

    if matches!(layer.transform.opacity, PropertyScalar::Keyframes(_)) {
        let _ = writeln!(s, "      @keyframes {class}-opacity {{");
        for (t, op) in &opacity_steps {
            let _ = writeln!(
                s,
                "        {pct}% {{ opacity: {op}; }}",
                pct = fmt_pct(*t),
                op = fmt_num(*op),
            );
        }
        let _ = writeln!(s, "      }}");
    }

    // Pick a representative easing — use second-keyframe ease of
    // position if available, else linear.
    let ease = first_segment_ease(&layer.transform.position)
        .or_else(|| first_segment_ease_scalar(&layer.transform.rotation))
        .map(|e| {
            format!(
                "cubic-bezier({}, {}, {}, {})",
                fmt_num(e[0]),
                fmt_num(e[1]),
                fmt_num(e[2]),
                fmt_num(e[3])
            )
        })
        .unwrap_or_else(|| "linear".to_string());

    let mut animations = vec![format!(
        "{class}-transform {dur}s {ease} infinite",
        dur = fmt_num(dur),
        ease = ease,
    )];
    if matches!(layer.transform.opacity, PropertyScalar::Keyframes(_)) {
        animations.push(format!(
            "{class}-opacity {dur}s {ease} infinite",
            dur = fmt_num(dur),
            ease = ease,
        ));
    }
    let _ = writeln!(
        s,
        "      .{class} {{ animation: {}; }}",
        animations.join(", ")
    );

    // Suppress unused-var warnings for fps; CSS exporter is fps-agnostic.
    let _ = fps;
}

fn render_layer_geometry(s: &mut String, layer: &Layer) -> Result<()> {
    let Some(geo) = &layer.geometry else {
        return Ok(());
    };
    let class = format!("layer-{}", layer.rank);
    match geo {
        Geometry::Rect {
            width,
            height,
            rx,
            fill,
        } => {
            writeln!(
                s,
                r#"  <rect class="{class}" x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}"/>"#,
                x = fmt_num(-width * 0.5),
                y = fmt_num(-height * 0.5),
                w = fmt_num(*width),
                h = fmt_num(*height),
                rx = fmt_num(*rx),
                fill = fill_or_default(*fill),
            )?;
        }
        Geometry::Ellipse {
            width,
            height,
            fill,
        } => {
            writeln!(
                s,
                r#"  <ellipse class="{class}" cx="0" cy="0" rx="{rx}" ry="{ry}" fill="{fill}"/>"#,
                rx = fmt_num(width * 0.5),
                ry = fmt_num(height * 0.5),
                fill = fill_or_default(*fill),
            )?;
        }
    }
    Ok(())
}

// ---- sampling --------------------------------------------------------------

fn sample_vec2(prop: &PropertyVec2, frame: f32) -> [f32; 2] {
    match prop {
        PropertyVec2::Static(v) => *v,
        PropertyVec2::Keyframes(kfs) => {
            if frame <= kfs[0].frame {
                return kfs[0].value;
            }
            let last = kfs.last().unwrap();
            if frame >= last.frame {
                return last.value;
            }
            for w in kfs.windows(2) {
                let a = &w[0];
                let b = &w[1];
                if frame >= a.frame && frame <= b.frame {
                    let span = (b.frame - a.frame).max(1e-6);
                    let t = (frame - a.frame) / span;
                    return [
                        a.value[0] + (b.value[0] - a.value[0]) * t,
                        a.value[1] + (b.value[1] - a.value[1]) * t,
                    ];
                }
            }
            last.value
        }
    }
}

fn sample_scalar(prop: &PropertyScalar, frame: f32) -> f32 {
    match prop {
        PropertyScalar::Static(v) => *v,
        PropertyScalar::Keyframes(kfs) => {
            if frame <= kfs[0].frame {
                return kfs[0].value;
            }
            let last = kfs.last().unwrap();
            if frame >= last.frame {
                return last.value;
            }
            for w in kfs.windows(2) {
                let a = &w[0];
                let b = &w[1];
                if frame >= a.frame && frame <= b.frame {
                    let span = (b.frame - a.frame).max(1e-6);
                    let t = (frame - a.frame) / span;
                    return a.value + (b.value - a.value) * t;
                }
            }
            last.value
        }
    }
}

fn collect_frames_vec2(prop: &PropertyVec2, out: &mut Vec<f32>) {
    if let PropertyVec2::Keyframes(kfs) = prop {
        for kf in kfs {
            out.push(kf.frame);
        }
    }
}

fn collect_frames_scalar(prop: &PropertyScalar, out: &mut Vec<f32>) {
    if let PropertyScalar::Keyframes(kfs) = prop {
        for kf in kfs {
            out.push(kf.frame);
        }
    }
}

fn first_segment_ease(prop: &PropertyVec2) -> Option<[f32; 4]> {
    if let PropertyVec2::Keyframes(kfs) = prop {
        // Different Lottie producers put ease on either source or
        // destination keyframe of a segment — scan any keyframe.
        for kf in kfs.iter() {
            if let Some(e) = kf.ease_in {
                return Some(e);
            }
        }
    }
    None
}

fn first_segment_ease_scalar(prop: &PropertyScalar) -> Option<[f32; 4]> {
    if let PropertyScalar::Keyframes(kfs) = prop {
        for kf in kfs.iter() {
            if let Some(e) = kf.ease_in {
                return Some(e);
            }
        }
    }
    None
}

fn fill_or_default(fill: Option<[u8; 3]>) -> String {
    let [r, g, b] = fill.unwrap_or([16, 185, 129]);
    format!("#{r:02x}{g:02x}{b:02x}")
}

fn fmt_num(n: f32) -> String {
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

fn fmt_pct(t: f32) -> String {
    let pct = (t * 100.0).clamp(0.0, 100.0);
    fmt_num(pct)
}

// Re-export to silence dead-code on internal types used only by tests.
#[allow(dead_code)]
fn _force_use(kf: &Keyframe1, kf2: &Keyframe2) -> (f32, [f32; 2]) {
    (kf.value, kf2.value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> Composition {
        Composition::from_lottie(&json!({
            "v":"5.7.0","fr":30,"ip":0,"op":30,"w":300,"h":200,
            "layers":[{
                "ty":4,"ind":1,"nm":"box","ip":0,"op":30,"sr":1,
                "ks":{
                    "o":{"a":0,"k":100},
                    "r":{"a":0,"k":0},
                    "p":{"a":1,"k":[
                        {"t":0,"s":[50,100],"o":{"x":[0.3],"y":[0]},"i":{"x":[0.7],"y":[1]}},
                        {"t":30,"s":[250,100]}
                    ]},
                    "a":{"a":0,"k":[0,0]},
                    "s":{"a":0,"k":[100,100]}
                },
                "shapes":[{"ty":"gr","it":[
                    {"ty":"rc","s":{"a":0,"k":[60,60]},"p":{"a":0,"k":[0,0]},"r":{"a":0,"k":4}},
                    {"ty":"fl","c":{"a":0,"k":[0.1,0.7,0.5,1]}}
                ]}]
            }]
        }))
        .unwrap()
    }

    #[test]
    fn emits_keyframes_and_animation_decl() {
        let svg = render(&fixture()).unwrap();
        assert!(svg.contains("@keyframes layer-0-transform"));
        assert!(svg.contains("animation:"));
        assert!(svg.contains("infinite"));
        assert!(svg.contains("<rect"));
        assert!(svg.contains("cubic-bezier"));
    }
}
