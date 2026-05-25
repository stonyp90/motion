//! Render the IR into a self-contained SVG that uses SMIL elements
//! (`<animate>`, `<animateTransform>`) to drive motion.
//!
//! SMIL is deprecated by the WHATWG SVG2 draft but every major browser
//! (Chrome, Firefox, Safari) still ships it — and unlike CSS keyframes
//! it gives us per-axis bezier easing inside `keySplines`. Consumers
//! who want strict SVG2 compliance can switch to the [`svg_css`]
//! exporter instead.
//!
//! The animation loops indefinitely via `repeatCount="indefinite"`.

use anyhow::Result;
use std::fmt::Write as _;

use crate::ir::{
    Composition, Geometry, Keyframe1, Keyframe2, Layer, PropertyScalar, PropertyVec2, TransformAnim,
};

pub fn render(comp: &Composition) -> Result<String> {
    let mut s = String::new();
    let dur = comp.duration_seconds();
    let bg_attr = comp
        .background_hex
        .as_deref()
        .map(|hex| format!(r#" style="background:{hex}""#))
        .unwrap_or_default();

    write!(
        s,
        r#"<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}"{bg}>
"#,
        w = format_num(comp.width),
        h = format_num(comp.height),
        bg = bg_attr,
    )?;

    // Background rect as <rect> rather than CSS background so consumers
    // who inline the SVG into HTML still get the colour.
    if let Some(bg) = &comp.background_hex {
        writeln!(
            s,
            r#"  <rect x="0" y="0" width="{w}" height="{h}" fill="{bg}"/>"#,
            w = format_num(comp.width),
            h = format_num(comp.height),
        )?;
    }

    for layer in &comp.layers {
        render_layer(&mut s, layer, comp.frame_rate, dur)?;
    }
    writeln!(s, "</svg>")?;
    Ok(s)
}

fn render_layer(s: &mut String, layer: &Layer, fps: f32, dur: f32) -> Result<()> {
    let Some(geo) = &layer.geometry else {
        return Ok(());
    };
    let class = format!("layer-{}", layer.rank);
    // Group transform — SMIL <animateTransform> on a <g> handles
    // translate / rotate / scale; opacity is a separate <animate> on
    // the shape itself.
    writeln!(s, "  <g class=\"{}\" id=\"{}\">", class, layer.name)?;
    render_shape(s, geo, &layer.transform)?;
    render_position_anim(s, &layer.transform.position, fps, dur)?;
    render_rotate_anim(
        s,
        &layer.transform.rotation,
        &layer.transform.position,
        fps,
        dur,
    )?;
    render_scale_anim(
        s,
        &layer.transform.scale,
        &layer.transform.position,
        fps,
        dur,
    )?;
    writeln!(s, "  </g>")?;
    Ok(())
}

fn render_shape(s: &mut String, geo: &Geometry, transform: &TransformAnim) -> Result<()> {
    // Initial position so the shape is visible before SMIL kicks in.
    let (x0, y0) = match &transform.position {
        PropertyVec2::Static(v) => (v[0], v[1]),
        PropertyVec2::Keyframes(kfs) => (kfs[0].value[0], kfs[0].value[1]),
    };
    let opacity_static = match transform.opacity {
        PropertyScalar::Static(v) => v / 100.0,
        PropertyScalar::Keyframes(ref kfs) => kfs[0].value / 100.0,
    };

    match geo {
        Geometry::Rect {
            width,
            height,
            rx,
            fill,
        } => {
            let fill_str = fill_or_default(*fill);
            writeln!(
                s,
                r#"    <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" opacity="{op}">"#,
                x = format_num(x0 - width * 0.5),
                y = format_num(y0 - height * 0.5),
                w = format_num(*width),
                h = format_num(*height),
                rx = format_num(*rx),
                fill = fill_str,
                op = format_num(opacity_static),
            )?;
            render_opacity_anim(s, &transform.opacity, /*fps*/ 0.0, 0.0)?;
            writeln!(s, "    </rect>")?;
        }
        Geometry::Ellipse {
            width,
            height,
            fill,
        } => {
            let fill_str = fill_or_default(*fill);
            writeln!(
                s,
                r#"    <ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{fill}" opacity="{op}">"#,
                cx = format_num(x0),
                cy = format_num(y0),
                rx = format_num(width * 0.5),
                ry = format_num(height * 0.5),
                fill = fill_str,
                op = format_num(opacity_static),
            )?;
            render_opacity_anim(s, &transform.opacity, /*fps*/ 0.0, 0.0)?;
            writeln!(s, "    </ellipse>")?;
        }
    }
    Ok(())
}

fn render_opacity_anim(s: &mut String, prop: &PropertyScalar, _fps: f32, _dur: f32) -> Result<()> {
    if let PropertyScalar::Keyframes(kfs) = prop {
        let (times, values) = scalar_times_values(kfs, |v| v / 100.0);
        let splines = ease_splines(kfs.iter().map(|kf| kf.ease_in).collect::<Vec<_>>());
        writeln!(
            s,
            r#"      <animate attributeName="opacity" values="{values}" keyTimes="{times}" keySplines="{splines}" calcMode="spline" dur="{dur}s" repeatCount="indefinite"/>"#,
            values = values,
            times = times,
            splines = splines,
            dur = format_num(scalar_duration_s(kfs)),
        )?;
    }
    Ok(())
}

fn render_position_anim(s: &mut String, prop: &PropertyVec2, fps: f32, _dur: f32) -> Result<()> {
    if let PropertyVec2::Keyframes(kfs) = prop {
        let total = ((kfs.last().unwrap().frame - kfs.first().unwrap().frame).max(1.0) / fps)
            .max(1.0 / fps);
        let values: String = kfs
            .iter()
            .map(|kf| format!("{} {}", format_num(kf.value[0]), format_num(kf.value[1])))
            .collect::<Vec<_>>()
            .join("; ");
        // Translate via <animateTransform>. We baseline at (0,0) because
        // the underlying shape uses the *first* keyframe as its origin —
        // emit relative motion as additive translate from that origin.
        let (x0, y0) = (kfs[0].value[0], kfs[0].value[1]);
        let relative_values: String = kfs
            .iter()
            .map(|kf| {
                format!(
                    "{} {}",
                    format_num(kf.value[0] - x0),
                    format_num(kf.value[1] - y0)
                )
            })
            .collect::<Vec<_>>()
            .join("; ");
        // Suppress "unused" warning — the absolute values aid debugging
        // and may be enabled with a future `additive="replace"` option.
        let _ = values;
        let times = vec2_keytimes(kfs);
        let splines = ease_splines(kfs.iter().map(|kf| kf.ease_in).collect::<Vec<_>>());
        writeln!(
            s,
            r#"    <animateTransform attributeName="transform" type="translate" values="{values}" keyTimes="{times}" keySplines="{splines}" calcMode="spline" additive="sum" dur="{dur}s" repeatCount="indefinite"/>"#,
            values = relative_values,
            times = times,
            splines = splines,
            dur = format_num(total),
        )?;
    }
    Ok(())
}

fn render_rotate_anim(
    s: &mut String,
    prop: &PropertyScalar,
    position: &PropertyVec2,
    fps: f32,
    _dur: f32,
) -> Result<()> {
    if let PropertyScalar::Keyframes(kfs) = prop {
        let total = ((kfs.last().unwrap().frame - kfs.first().unwrap().frame).max(1.0) / fps)
            .max(1.0 / fps);
        // SMIL animateTransform type="rotate" takes "angle cx cy".
        let pivot = transform_pivot(position);
        let values: String = kfs
            .iter()
            .map(|kf| {
                format!(
                    "{} {} {}",
                    format_num(kf.value),
                    format_num(pivot.0),
                    format_num(pivot.1)
                )
            })
            .collect::<Vec<_>>()
            .join("; ");
        let times = scalar_keytimes(kfs);
        let splines = ease_splines(kfs.iter().map(|kf| kf.ease_in).collect::<Vec<_>>());
        writeln!(
            s,
            r#"    <animateTransform attributeName="transform" type="rotate" values="{values}" keyTimes="{times}" keySplines="{splines}" calcMode="spline" additive="sum" dur="{dur}s" repeatCount="indefinite"/>"#,
            values = values,
            times = times,
            splines = splines,
            dur = format_num(total),
        )?;
    }
    Ok(())
}

fn render_scale_anim(
    s: &mut String,
    prop: &PropertyVec2,
    position: &PropertyVec2,
    fps: f32,
    _dur: f32,
) -> Result<()> {
    if let PropertyVec2::Keyframes(kfs) = prop {
        let total = ((kfs.last().unwrap().frame - kfs.first().unwrap().frame).max(1.0) / fps)
            .max(1.0 / fps);
        // Scale around the same pivot.
        let pivot = transform_pivot(position);
        let values: String = kfs
            .iter()
            .map(|kf| {
                format!(
                    "{} {}",
                    format_num(kf.value[0] / 100.0),
                    format_num(kf.value[1] / 100.0)
                )
            })
            .collect::<Vec<_>>()
            .join("; ");
        let times = vec2_keytimes(kfs);
        let splines = ease_splines(kfs.iter().map(|kf| kf.ease_in).collect::<Vec<_>>());
        // Translate-to-pivot, scale, translate-back can't be expressed
        // in a single SMIL transform, so we approximate by scaling
        // around the SVG origin. Consumers who need pivot-correct
        // scaling should use the CSS exporter (which uses
        // transform-origin).
        let _ = pivot;
        writeln!(
            s,
            r#"    <animateTransform attributeName="transform" type="scale" values="{values}" keyTimes="{times}" keySplines="{splines}" calcMode="spline" additive="sum" dur="{dur}s" repeatCount="indefinite"/>"#,
            values = values,
            times = times,
            splines = splines,
            dur = format_num(total),
        )?;
    }
    Ok(())
}

fn transform_pivot(position: &PropertyVec2) -> (f32, f32) {
    match position {
        PropertyVec2::Static(v) => (v[0], v[1]),
        PropertyVec2::Keyframes(kfs) => (kfs[0].value[0], kfs[0].value[1]),
    }
}

/// Format keyTimes as a space-free `0;0.5;1` string, normalized to [0, 1].
fn vec2_keytimes(kfs: &[Keyframe2]) -> String {
    let first = kfs[0].frame;
    let last = kfs.last().unwrap().frame.max(first + 1.0);
    let span = (last - first).max(1.0);
    kfs.iter()
        .map(|kf| format_num(((kf.frame - first) / span).clamp(0.0, 1.0)))
        .collect::<Vec<_>>()
        .join("; ")
}

fn scalar_keytimes(kfs: &[Keyframe1]) -> String {
    let first = kfs[0].frame;
    let last = kfs.last().unwrap().frame.max(first + 1.0);
    let span = (last - first).max(1.0);
    kfs.iter()
        .map(|kf| format_num(((kf.frame - first) / span).clamp(0.0, 1.0)))
        .collect::<Vec<_>>()
        .join("; ")
}

fn scalar_times_values<F: Fn(f32) -> f32>(kfs: &[Keyframe1], f: F) -> (String, String) {
    (
        scalar_keytimes(kfs),
        kfs.iter()
            .map(|kf| format_num(f(kf.value)))
            .collect::<Vec<_>>()
            .join("; "),
    )
}

fn scalar_duration_s(kfs: &[Keyframe1]) -> f32 {
    // Reasonable default for opacity that lacks a fps reference here.
    let first = kfs[0].frame;
    let last = kfs.last().unwrap().frame.max(first + 1.0);
    (last - first).max(1.0) / 30.0
}

/// Emit SMIL `keySplines` ("x1 y1 x2 y2;..."). N keyframes ⇒ N-1
/// splines. Missing easing falls back to linear (`0 0 1 1`).
fn ease_splines(eases: Vec<Option<[f32; 4]>>) -> String {
    if eases.len() < 2 {
        return String::new();
    }
    let mut out = Vec::with_capacity(eases.len() - 1);
    // Lottie stores easing on the destination keyframe of a segment;
    // mirror that and skip the first.
    for ease in eases.iter().skip(1) {
        let [x1, y1, x2, y2] = ease.unwrap_or([0.42, 0.0, 0.58, 1.0]);
        out.push(format!(
            "{} {} {} {}",
            format_num(x1),
            format_num(y1),
            format_num(x2),
            format_num(y2)
        ));
    }
    out.join("; ")
}

fn fill_or_default(fill: Option<[u8; 3]>) -> String {
    let [r, g, b] = fill.unwrap_or([16, 185, 129]);
    format!("#{r:02x}{g:02x}{b:02x}")
}

fn format_num(n: f32) -> String {
    // Up to three decimal places, no trailing zeros, no scientific
    // notation. Stable text helps snapshot tests.
    if n.abs() < 1e-6 {
        return "0".to_string();
    }
    let s = format!("{n:.3}");
    let trimmed = s.trim_end_matches('0').trim_end_matches('.');
    if trimmed.is_empty() {
        "0".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn parse_fixture() -> Composition {
        let v = json!({
            "v":"5.7.0","fr":30,"ip":0,"op":60,"w":640,"h":360,
            "layers":[{
                "ty":4,"ind":1,"nm":"orb","ip":0,"op":60,"sr":1,
                "ks":{
                    "o":{"a":1,"k":[
                        {"t":0,"s":[0],"o":{"x":[0.4],"y":[0]},"i":{"x":[0.2],"y":[1]}},
                        {"t":60,"s":[100]}
                    ]},
                    "r":{"a":0,"k":0},
                    "p":{"a":1,"k":[
                        {"t":0,"s":[100,100],"o":{"x":[0.4],"y":[0]},"i":{"x":[0.2],"y":[1]}},
                        {"t":60,"s":[500,300]}
                    ]},
                    "a":{"a":0,"k":[0,0]},
                    "s":{"a":0,"k":[100,100]}
                },
                "shapes":[{"ty":"gr","it":[
                    {"ty":"el","s":{"a":0,"k":[80,80]},"p":{"a":0,"k":[0,0]}},
                    {"ty":"fl","c":{"a":0,"k":[1,0.5,0,1]}}
                ]}]
            }]
        });
        Composition::from_lottie(&v).unwrap()
    }

    #[test]
    fn renders_self_contained_svg() {
        let comp = parse_fixture();
        let svg = render(&comp).unwrap();
        assert!(svg.starts_with("<?xml"));
        assert!(svg.contains("<svg"));
        assert!(svg.contains("repeatCount=\"indefinite\""));
        assert!(svg.contains("<ellipse"));
        assert!(svg.contains("<animateTransform"));
        assert!(svg.contains("<animate "));
    }
}
