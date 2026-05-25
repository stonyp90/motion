//! Shared internal representation for all web-export targets.
//!
//! Parsing the Lottie blob once and projecting it into a stable Rust
//! struct keeps each per-format renderer small. The IR loses
//! information on purpose: only fields we can faithfully reproduce in
//! every web target survive. Anything more exotic (masks, mattes,
//! expressions, text on a path) is dropped at parse time.
//!
//! The IR is `pub` only to its sibling modules — it is not a stable
//! public API.

use anyhow::{Context, Result, anyhow};
use serde_json::Value;

/// Top-level composition extracted from a Lottie JSON document.
#[derive(Debug, Clone)]
pub struct Composition {
    pub width: f32,
    pub height: f32,
    pub frame_rate: f32,
    /// `in` point in frames — first frame the composition is visible.
    pub in_frame: f32,
    /// `out` point in frames — one past the last visible frame.
    pub out_frame: f32,
    /// Background-color hint (Lottie `bg`). `None` means transparent.
    pub background_hex: Option<String>,
    /// Layers in painter order (back to front). The Lottie file lists
    /// the topmost layer first; we reverse on parse so `[0]` is the
    /// bottom and `[len-1]` is the top.
    pub layers: Vec<Layer>,
}

#[derive(Debug, Clone)]
pub struct Layer {
    /// 1-based index assigned during parse (mirrors Lottie `ind` when
    /// the source provides one, otherwise auto-assigned).
    pub index: u32,
    /// Sanitized name; safe to use as a CSS class or JS identifier
    /// suffix. Always non-empty.
    pub name: String,
    /// Painter-order rank used by SVG / CSS class names (`layer-0`,
    /// `layer-1`, …). Distinct from `index`, which can be sparse.
    pub rank: u32,
    pub kind: LayerKind,
    /// Layer `in` frame.
    pub in_frame: f32,
    /// Layer `out` frame.
    pub out_frame: f32,
    pub transform: TransformAnim,
    /// First shape's geometry, if the layer is a shape layer. None for
    /// unsupported layer kinds — the parser still records the layer so
    /// timing / transforms map cleanly to z-order.
    pub geometry: Option<Geometry>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LayerKind {
    Shape,
    Solid,
    Other,
}

#[derive(Debug, Clone)]
pub enum Geometry {
    Rect {
        width: f32,
        height: f32,
        rx: f32,
        fill: Option<[u8; 3]>,
    },
    Ellipse {
        width: f32,
        height: f32,
        fill: Option<[u8; 3]>,
    },
}

/// Property animations for a layer transform.
#[derive(Debug, Clone)]
pub struct TransformAnim {
    /// Anchor point in layer-local pixels (Lottie `a`). Used as the
    /// transform origin in SVG/CSS.
    pub anchor: [f32; 2],
    pub position: PropertyVec2,
    pub scale: PropertyVec2,
    pub rotation: PropertyScalar,
    /// Opacity in percent (0–100), matching Lottie semantics. Web
    /// renderers map this to 0–1 themselves.
    pub opacity: PropertyScalar,
}

/// Either a single static value or a list of [`Keyframe2`] samples.
#[derive(Debug, Clone)]
pub enum PropertyVec2 {
    Static([f32; 2]),
    Keyframes(Vec<Keyframe2>),
}

#[derive(Debug, Clone)]
pub enum PropertyScalar {
    Static(f32),
    Keyframes(Vec<Keyframe1>),
}

#[derive(Debug, Clone, Copy)]
pub struct Keyframe2 {
    pub frame: f32,
    pub value: [f32; 2],
    /// Cubic-bezier easing handles for the segment ending at this
    /// keyframe. None means the previous segment held.
    pub ease_in: Option<[f32; 4]>,
}

#[derive(Debug, Clone, Copy)]
pub struct Keyframe1 {
    pub frame: f32,
    pub value: f32,
    pub ease_in: Option<[f32; 4]>,
}

impl Composition {
    /// Parse a Lottie JSON document into the shared IR. Best-effort —
    /// the IR will silently skip layer types we don't model.
    pub fn from_lottie(v: &Value) -> Result<Self> {
        let width = read_f32(v, "w").ok_or_else(|| anyhow!("missing composition width `w`"))?;
        let height = read_f32(v, "h").ok_or_else(|| anyhow!("missing composition height `h`"))?;
        let frame_rate =
            read_f32(v, "fr").ok_or_else(|| anyhow!("missing composition frame rate `fr`"))?;
        let in_frame = read_f32(v, "ip").unwrap_or(0.0);
        let out_frame =
            read_f32(v, "op").ok_or_else(|| anyhow!("missing composition out point `op`"))?;
        let background_hex = v.get("bg").and_then(|x| x.as_str()).map(str::to_owned);

        let mut raw_layers: Vec<&Value> = v
            .get("layers")
            .and_then(|l| l.as_array())
            .map(|arr| arr.iter().collect())
            .unwrap_or_default();
        // Lottie lists top layer first; we want painter order (bottom
        // first) so later renderers can iterate naturally.
        raw_layers.reverse();

        let mut layers = Vec::with_capacity(raw_layers.len());
        for (rank, lyr) in raw_layers.into_iter().enumerate() {
            if let Some(layer) = Layer::from_lottie(lyr, rank as u32)
                .with_context(|| format!("layer rank {rank}"))?
            {
                layers.push(layer);
            }
        }

        Ok(Self {
            width,
            height,
            frame_rate,
            in_frame,
            out_frame,
            background_hex,
            layers,
        })
    }

    /// Total duration in seconds, ≥ 1 frame.
    pub fn duration_seconds(&self) -> f32 {
        let frames = (self.out_frame - self.in_frame).max(1.0);
        frames / self.frame_rate.max(1.0)
    }
}

impl Layer {
    fn from_lottie(v: &Value, rank: u32) -> Result<Option<Self>> {
        let ty = v.get("ty").and_then(|t| t.as_u64()).unwrap_or(99);
        let kind = match ty {
            4 => LayerKind::Shape,
            1 => LayerKind::Solid,
            // 0 = pre-comp, 2 = image, 3 = null, 5 = text, ...
            _ => LayerKind::Other,
        };
        // Drop layer kinds we don't model — they'd render as static
        // boxes in every web target, which is worse than nothing.
        if !matches!(kind, LayerKind::Shape | LayerKind::Solid) {
            return Ok(None);
        }

        let index = v.get("ind").and_then(|i| i.as_u64()).unwrap_or(0) as u32;
        let raw_name = v.get("nm").and_then(|n| n.as_str()).unwrap_or("layer");
        let name = sanitize_name(raw_name, rank);

        let in_frame = read_f32(v, "ip").unwrap_or(0.0);
        let out_frame = read_f32(v, "op").unwrap_or(0.0);

        let ks = v.get("ks").cloned().unwrap_or(Value::Null);
        let transform = TransformAnim::from_ks(&ks)?;

        let geometry = match kind {
            LayerKind::Shape => parse_first_shape_geometry(v),
            LayerKind::Solid => parse_solid_geometry(v),
            _ => None,
        };

        Ok(Some(Self {
            index,
            name,
            rank,
            kind,
            in_frame,
            out_frame,
            transform,
            geometry,
        }))
    }
}

impl TransformAnim {
    fn from_ks(ks: &Value) -> Result<Self> {
        let anchor = read_vec2(ks.get("a")).unwrap_or([0.0, 0.0]);
        let position = read_property_vec2(ks.get("p")).unwrap_or(PropertyVec2::Static([0.0, 0.0]));
        let scale = read_property_vec2(ks.get("s")).unwrap_or(PropertyVec2::Static([100.0, 100.0]));
        let rotation = read_property_scalar(ks.get("r")).unwrap_or(PropertyScalar::Static(0.0));
        let opacity = read_property_scalar(ks.get("o")).unwrap_or(PropertyScalar::Static(100.0));
        Ok(Self {
            anchor,
            position,
            scale,
            rotation,
            opacity,
        })
    }
}

// ---- Lottie parsing helpers ------------------------------------------------

fn read_f32(v: &Value, key: &str) -> Option<f32> {
    v.get(key).and_then(|x| x.as_f64()).map(|f| f as f32)
}

fn read_vec2(v: Option<&Value>) -> Option<[f32; 2]> {
    let v = v?;
    // Static vector property: { a: 0, k: [x, y, ...] }
    let k = v.get("k").or(Some(v))?;
    match k {
        Value::Array(arr) => {
            let x = arr.first().and_then(|v| v.as_f64())? as f32;
            let y = arr.get(1).and_then(|v| v.as_f64())? as f32;
            Some([x, y])
        }
        _ => None,
    }
}

fn read_property_vec2(v: Option<&Value>) -> Option<PropertyVec2> {
    let v = v?;
    let animated = v
        .get("a")
        .and_then(|a| a.as_u64())
        .map(|n| n == 1)
        .unwrap_or(false);
    let k = v.get("k")?;
    if !animated {
        return read_vec2_value(k).map(PropertyVec2::Static);
    }
    let arr = k.as_array()?;
    let mut out = Vec::with_capacity(arr.len());
    for entry in arr {
        if let Some(kf) = parse_keyframe2(entry) {
            out.push(kf);
        }
    }
    if out.is_empty() {
        return None;
    }
    // Lottie's last keyframe often only has `t` + `s` (no segment after
    // it). If only one frame is present, treat as static.
    if out.len() == 1 {
        return Some(PropertyVec2::Static(out[0].value));
    }
    Some(PropertyVec2::Keyframes(out))
}

fn read_property_scalar(v: Option<&Value>) -> Option<PropertyScalar> {
    let v = v?;
    let animated = v
        .get("a")
        .and_then(|a| a.as_u64())
        .map(|n| n == 1)
        .unwrap_or(false);
    let k = v.get("k")?;
    if !animated {
        return read_scalar_value(k).map(PropertyScalar::Static);
    }
    let arr = k.as_array()?;
    let mut out = Vec::with_capacity(arr.len());
    for entry in arr {
        if let Some(kf) = parse_keyframe1(entry) {
            out.push(kf);
        }
    }
    if out.is_empty() {
        return None;
    }
    if out.len() == 1 {
        return Some(PropertyScalar::Static(out[0].value));
    }
    Some(PropertyScalar::Keyframes(out))
}

fn read_vec2_value(v: &Value) -> Option<[f32; 2]> {
    match v {
        Value::Array(arr) => {
            let x = arr.first().and_then(|v| v.as_f64())? as f32;
            let y = arr.get(1).and_then(|v| v.as_f64())? as f32;
            Some([x, y])
        }
        Value::Number(n) => n.as_f64().map(|f| [f as f32, f as f32]),
        _ => None,
    }
}

fn read_scalar_value(v: &Value) -> Option<f32> {
    match v {
        // Lottie sometimes wraps scalars in `[value]`.
        Value::Array(arr) => arr.first().and_then(|x| x.as_f64()).map(|f| f as f32),
        Value::Number(n) => n.as_f64().map(|f| f as f32),
        _ => None,
    }
}

fn parse_keyframe2(entry: &Value) -> Option<Keyframe2> {
    let frame = entry.get("t").and_then(|t| t.as_f64())? as f32;
    let s = entry.get("s")?;
    let value = read_vec2_value(s)?;
    let ease_in = parse_ease(entry);
    Some(Keyframe2 {
        frame,
        value,
        ease_in,
    })
}

fn parse_keyframe1(entry: &Value) -> Option<Keyframe1> {
    let frame = entry.get("t").and_then(|t| t.as_f64())? as f32;
    let s = entry.get("s")?;
    let value = read_scalar_value(s)?;
    let ease_in = parse_ease(entry);
    Some(Keyframe1 {
        frame,
        value,
        ease_in,
    })
}

/// Extract a cubic-bezier `[x1, y1, x2, y2]` from a Lottie keyframe.
/// Lottie stores in/out separately under `o` (outgoing handle from
/// previous segment, x ∈ [0,1]) and `i` (incoming handle, x ∈ [0,1]).
/// Each can be a scalar or an array; we read index 0.
fn parse_ease(entry: &Value) -> Option<[f32; 4]> {
    let o = entry.get("o")?;
    let i = entry.get("i")?;
    let ox = first_axis_value(o.get("x"))?;
    let oy = first_axis_value(o.get("y"))?;
    let ix = first_axis_value(i.get("x"))?;
    let iy = first_axis_value(i.get("y"))?;
    Some([ox, oy, ix, iy])
}

fn first_axis_value(v: Option<&Value>) -> Option<f32> {
    let v = v?;
    match v {
        Value::Array(arr) => arr.first().and_then(|x| x.as_f64()).map(|f| f as f32),
        Value::Number(n) => n.as_f64().map(|f| f as f32),
        _ => None,
    }
}

/// Parse the first shape group inside a shape layer (`ty: 4`) into a
/// concrete geometry. We only look at the first group — extra shapes
/// would need separate `<rect>` / `<ellipse>` SVG elements and the
/// translate-to-CSS classes only model one per layer anyway.
fn parse_first_shape_geometry(layer: &Value) -> Option<Geometry> {
    let shapes = layer.get("shapes")?.as_array()?;
    for shape in shapes {
        if let Some(g) = parse_shape_node(shape) {
            return Some(g);
        }
    }
    None
}

fn parse_shape_node(shape: &Value) -> Option<Geometry> {
    let ty = shape.get("ty")?.as_str()?;
    match ty {
        // Rect group: dive into `it` for the rect + fill.
        "gr" => parse_group(shape),
        "rc" => parse_rect(shape, None),
        "el" => parse_ellipse(shape, None),
        _ => None,
    }
}

fn parse_group(group: &Value) -> Option<Geometry> {
    let it = group.get("it")?.as_array()?;
    let mut fill: Option<[u8; 3]> = None;
    let mut geo: Option<Geometry> = None;
    for item in it {
        let ty = item.get("ty").and_then(|t| t.as_str()).unwrap_or("");
        match ty {
            "fl" => {
                fill = parse_fill(item);
            }
            "rc" => {
                geo = parse_rect(item, fill);
            }
            "el" => {
                geo = parse_ellipse(item, fill);
            }
            _ => {}
        }
    }
    // Attach the fill if the rect/ellipse was parsed before the fill node.
    geo.map(|g| match g {
        Geometry::Rect {
            width,
            height,
            rx,
            fill: None,
        } => Geometry::Rect {
            width,
            height,
            rx,
            fill,
        },
        Geometry::Ellipse {
            width,
            height,
            fill: None,
        } => Geometry::Ellipse {
            width,
            height,
            fill,
        },
        other => other,
    })
}

fn parse_rect(node: &Value, fill: Option<[u8; 3]>) -> Option<Geometry> {
    let size = read_vec2(node.get("s"))?;
    let rx = node
        .get("r")
        .and_then(|r| r.get("k"))
        .and_then(|k| k.as_f64())
        .unwrap_or(0.0) as f32;
    Some(Geometry::Rect {
        width: size[0],
        height: size[1],
        rx,
        fill,
    })
}

fn parse_ellipse(node: &Value, fill: Option<[u8; 3]>) -> Option<Geometry> {
    let size = read_vec2(node.get("s"))?;
    Some(Geometry::Ellipse {
        width: size[0],
        height: size[1],
        fill,
    })
}

fn parse_fill(node: &Value) -> Option<[u8; 3]> {
    let k = node.get("c")?.get("k")?;
    let arr = k.as_array()?;
    let r = arr.first().and_then(|v| v.as_f64())?;
    let g = arr.get(1).and_then(|v| v.as_f64())?;
    let b = arr.get(2).and_then(|v| v.as_f64())?;
    Some([
        (r * 255.0).round().clamp(0.0, 255.0) as u8,
        (g * 255.0).round().clamp(0.0, 255.0) as u8,
        (b * 255.0).round().clamp(0.0, 255.0) as u8,
    ])
}

/// Solid layer (`ty: 1`) carries `sw`, `sh`, and a CSS-style `sc`
/// colour string ("#rrggbb"). Render it as a coloured rect.
fn parse_solid_geometry(layer: &Value) -> Option<Geometry> {
    let width = read_f32(layer, "sw").unwrap_or(0.0);
    let height = read_f32(layer, "sh").unwrap_or(0.0);
    let fill = layer
        .get("sc")
        .and_then(|s| s.as_str())
        .and_then(parse_hex_string);
    Some(Geometry::Rect {
        width,
        height,
        rx: 0.0,
        fill,
    })
}

fn parse_hex_string(s: &str) -> Option<[u8; 3]> {
    let s = s.trim().trim_start_matches('#');
    if s.len() != 6 {
        return None;
    }
    let r = u8::from_str_radix(&s[0..2], 16).ok()?;
    let g = u8::from_str_radix(&s[2..4], 16).ok()?;
    let b = u8::from_str_radix(&s[4..6], 16).ok()?;
    Some([r, g, b])
}

/// Sanitize a layer name into a CSS class / JS-identifier-friendly
/// suffix. Strips non-alphanumeric characters and lower-cases.
pub(crate) fn sanitize_name(raw: &str, rank: u32) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_ascii_lowercase();
    if cleaned.is_empty() {
        format!("layer-{rank}")
    } else {
        cleaned
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> Value {
        json!({
            "v": "5.7.0", "fr": 30, "ip": 0, "op": 60,
            "w": 1920, "h": 1080,
            "layers": [
                {
                    "ddd": 0, "ind": 1, "ty": 4, "nm": "Bouncing Ball", "sr": 1,
                    "ks": {
                        "o": { "a": 0, "k": 100 },
                        "r": { "a": 1, "k": [
                            { "t": 0, "s": [0], "o": {"x":[0.4],"y":[0.0]}, "i": {"x":[0.2],"y":[1.0]} },
                            { "t": 60, "s": [360] }
                        ] },
                        "p": { "a": 1, "k": [
                            { "t": 0, "s": [100, 100], "o": {"x":[0.4],"y":[0.0]}, "i": {"x":[0.2],"y":[1.0]} },
                            { "t": 60, "s": [500, 800] }
                        ] },
                        "a": { "a": 0, "k": [0, 0] },
                        "s": { "a": 0, "k": [100, 100] }
                    },
                    "shapes": [
                        {
                            "ty": "gr", "nm": "ellipse",
                            "it": [
                                { "ty": "el", "s": { "a": 0, "k": [200, 200] }, "p": { "a": 0, "k": [0, 0] } },
                                { "ty": "fl", "c": { "a": 0, "k": [1.0, 0.5, 0.0, 1.0] } }
                            ]
                        }
                    ],
                    "ip": 0, "op": 60, "st": 0, "bm": 0, "ao": 0
                }
            ]
        })
    }

    #[test]
    fn parses_basic_lottie() {
        let comp = Composition::from_lottie(&fixture()).unwrap();
        assert_eq!(comp.width, 1920.0);
        assert_eq!(comp.height, 1080.0);
        assert_eq!(comp.frame_rate, 30.0);
        assert_eq!(comp.layers.len(), 1);
        let layer = &comp.layers[0];
        assert!(matches!(layer.geometry, Some(Geometry::Ellipse { .. })));
        assert!(matches!(
            layer.transform.position,
            PropertyVec2::Keyframes(_)
        ));
        assert!(matches!(
            layer.transform.rotation,
            PropertyScalar::Keyframes(_)
        ));
    }

    #[test]
    fn sanitize_handles_unicode_and_emptiness() {
        assert_eq!(sanitize_name("My Layer!", 3), "my-layer");
        assert_eq!(sanitize_name("", 7), "layer-7");
        assert_eq!(sanitize_name("###", 2), "layer-2");
    }

    #[test]
    fn hex_parsing_round_trips() {
        assert_eq!(parse_hex_string("#10b981"), Some([0x10, 0xb9, 0x81]));
        assert_eq!(parse_hex_string("10b981"), Some([0x10, 0xb9, 0x81]));
        assert_eq!(parse_hex_string("nope"), None);
    }
}
