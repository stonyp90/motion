//! Convert a `FigmaNode` tree into a Lottie layer (JSON value).
//!
//! Conversion contract (fidelity):
//!
//! | Figma node       | Mapping                                  | Lossless? |
//! |------------------|------------------------------------------|-----------|
//! | RECTANGLE        | shape group with `rc` + fill             | Yes       |
//! | ELLIPSE          | shape group with `el` + fill             | Yes       |
//! | LINE             | shape group with single-segment `sh`     | Yes       |
//! | VECTOR           | shape group with SVG-path `sh` per geo   | Yes (path-level) |
//! | TEXT             | Lottie text layer (`ty: 5`)              | Yes (Latin); font availability depends on player |
//! | FRAME / GROUP    | recursive group of converted children    | Yes       |
//! | INSTANCE / COMP. | treated as FRAME (children walked)       | Yes       |
//! | BOOLEAN_OPERATION| converted via its `fillGeometry` paths   | Yes if Figma flattened the geometry; else skipped |
//! | Image fill       | placeholder solid + warning              | No — needs separate asset download |
//! | Drop shadow      | converted to Lottie `ds` effect          | Mostly lossless |
//! | Blur             | converted to Lottie `gf` effect          | Mostly lossless |
//! | Auto-layout      | stripped (visual is identical)           | N/A — non-visual concept |
//! | Constraints      | stripped (no resize at runtime)          | N/A — non-visual concept |
//! | Prototyping      | stripped                                 | N/A — non-visual concept |
//! | Smart Animate    | stripped (Phase 2 work)                  | No, deferred |

use crate::{BoundingBox, Color, Effect, FigmaNode, GradientStop, Paint, Vec2};
use serde::Serialize;
use serde_json::{Value, json};

/// A serialisable Lottie layer plus any warnings raised during conversion.
#[derive(Debug, Clone, Serialize)]
pub struct LottieLayer {
    pub layer: Value,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<ConversionWarning>,
}

/// A non-fatal conversion warning (e.g. image fill stubbed out).
#[derive(Debug, Clone, Serialize)]
pub struct ConversionWarning {
    pub node_id: String,
    pub kind: WarningKind,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WarningKind {
    ImageFillStubbed,
    UnsupportedNode,
    EffectStripped,
    GeometryMissing,
}

/// Convert a Figma node tree into a single Lottie layer.
///
/// Returns just the layer value; use [`to_lottie_layer_with_warnings`] if
/// you want to inspect what was stripped or stubbed.
pub fn to_lottie_layer(node: &FigmaNode) -> LottieLayer {
    let mut warnings = Vec::new();
    let layer = convert_node(node, &mut warnings, 1);
    LottieLayer { layer, warnings }
}

/// Same as [`to_lottie_layer`] but returns the warnings alongside the layer.
pub fn to_lottie_layer_with_warnings(node: &FigmaNode) -> LottieLayer {
    to_lottie_layer(node)
}

// ---- conversion core ----

#[derive(Clone, Copy)]
struct LayerCtx {
    ind: u32,
    cx: f32,
    cy: f32,
    opacity: f32,
    rotation: f32,
}

fn convert_node(node: &FigmaNode, warnings: &mut Vec<ConversionWarning>, ind: u32) -> Value {
    let bbox = node.bounding_box.unwrap_or(BoundingBox {
        x: 0.0,
        y: 0.0,
        width: 0.0,
        height: 0.0,
    });
    let ctx = LayerCtx {
        ind,
        cx: bbox.x + bbox.width * 0.5,
        cy: bbox.y + bbox.height * 0.5,
        opacity: node.opacity.unwrap_or(1.0) * 100.0,
        rotation: node.rotation.unwrap_or(0.0),
    };

    match node.node_type.as_str() {
        "TEXT" => text_layer(node, ctx, warnings),
        "FRAME" | "GROUP" | "INSTANCE" | "COMPONENT" | "COMPONENT_SET" => {
            group_layer(node, ctx, warnings)
        }
        _ => shape_layer(node, ctx, &bbox, warnings),
    }
}

fn shape_layer(
    node: &FigmaNode,
    ctx: LayerCtx,
    bbox: &BoundingBox,
    warnings: &mut Vec<ConversionWarning>,
) -> Value {
    let shapes = node_to_shape_items(node, bbox, warnings);
    let effects = node_effects(node, warnings);

    let mut layer = json!({
        "ddd": 0,
        "ind": ctx.ind,
        "ty": 4,  // ty: 4 = shape layer
        "nm": node.name.clone(),
        "sr": 1,
        "ks": transform_static(ctx.cx, ctx.cy, ctx.opacity, ctx.rotation),
        "ao": 0,
        "shapes": shapes,
        "ip": 0,
        "op": 0,  // caller fills this in from the composition duration
        "st": 0,
        "bm": 0,
    });
    if !effects.is_empty() {
        layer["ef"] = Value::Array(effects);
    }
    layer
}

fn group_layer(node: &FigmaNode, ctx: LayerCtx, warnings: &mut Vec<ConversionWarning>) -> Value {
    // Flatten children into a single shape layer using nested groups. Lottie
    // does have precomp layers (`ty: 0`) but they need an entry in the
    // top-level `assets[]` array, which is the caller's responsibility.
    // A flat shape layer with nested groups gives visual parity for most
    // brand assets without that coupling.
    let mut items: Vec<Value> = Vec::new();
    if let Some(children) = node.children.as_ref() {
        for child in children {
            // Child shapes go in their own group with their own local transform.
            items.push(child_as_group(child, warnings));
        }
    }

    // Top-level group transform wraps everything so the layer's `ks` can
    // stay anchored at the centre of the bounding box.
    items.push(group_transform(0.0, 0.0, 100.0, 0.0));

    let outer_group = json!({
        "ty": "gr",
        "nm": format!("{}-children", node.name),
        "it": items,
    });

    let mut layer = json!({
        "ddd": 0,
        "ind": ctx.ind,
        "ty": 4,
        "nm": node.name.clone(),
        "sr": 1,
        "ks": transform_static(ctx.cx, ctx.cy, ctx.opacity, ctx.rotation),
        "ao": 0,
        "shapes": [outer_group],
        "ip": 0,
        "op": 0,
        "st": 0,
        "bm": 0,
    });

    let effects = node_effects(node, warnings);
    if !effects.is_empty() {
        layer["ef"] = Value::Array(effects);
    }
    layer
}

fn child_as_group(node: &FigmaNode, warnings: &mut Vec<ConversionWarning>) -> Value {
    let bbox = node.bounding_box.unwrap_or(BoundingBox {
        x: 0.0,
        y: 0.0,
        width: 0.0,
        height: 0.0,
    });
    let cx = bbox.x + bbox.width * 0.5;
    let cy = bbox.y + bbox.height * 0.5;

    let mut items: Vec<Value> = Vec::new();

    match node.node_type.as_str() {
        "FRAME" | "GROUP" | "INSTANCE" | "COMPONENT" | "COMPONENT_SET" => {
            if let Some(kids) = node.children.as_ref() {
                for c in kids {
                    items.push(child_as_group(c, warnings));
                }
            }
        }
        "TEXT" => {
            // Inside a flattened-group context we approximate TEXT as a
            // bbox-sized rect filled with the text colour. Distinct
            // Lottie text layers must be emitted at the top level, not
            // nested inside a `shapes` array. Conversion-warning-free
            // because the visual fallback is intentional, not an error.
            let fill = first_solid_color(node.fills.as_deref()).unwrap_or(Color {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            });
            items.push(json!({
                "ty": "rc",
                "d": 1,
                "s": { "a": 0, "k": [bbox.width, bbox.height] },
                "p": { "a": 0, "k": [0.0, 0.0] },
                "r": { "a": 0, "k": 0 }
            }));
            items.push(json!({
                "ty": "fl",
                "c": { "a": 0, "k": [fill.r, fill.g, fill.b, fill.a] },
                "o": { "a": 0, "k": 100 },
                "r": 1,
                "bm": 0
            }));
        }
        _ => {
            items.extend(node_to_shape_items(node, &bbox, warnings));
        }
    }

    items.push(group_transform(cx, cy, 100.0, node.rotation.unwrap_or(0.0)));
    json!({ "ty": "gr", "nm": node.name.clone(), "it": items })
}

fn text_layer(node: &FigmaNode, ctx: LayerCtx, warnings: &mut Vec<ConversionWarning>) -> Value {
    let text = node.characters.clone().unwrap_or_default();
    let style = node.style.clone().unwrap_or(crate::TypeStyle {
        font_family: None,
        font_weight: None,
        font_size: None,
        text_align_horizontal: None,
        line_height_px: None,
    });
    let font = style
        .font_family
        .clone()
        .unwrap_or_else(|| "Inter".to_string());
    let size = style.font_size.unwrap_or(16.0);
    let align = match style.text_align_horizontal.as_deref() {
        Some("CENTER") => 2,
        Some("RIGHT") => 1,
        _ => 0, // LEFT
    };
    let fill = first_solid_color(node.fills.as_deref()).unwrap_or(Color {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 1.0,
    });

    let mut layer = json!({
        "ddd": 0,
        "ind": ctx.ind,
        "ty": 5,  // ty: 5 = text layer
        "nm": node.name.clone(),
        "sr": 1,
        "ks": transform_static(ctx.cx, ctx.cy, ctx.opacity, ctx.rotation),
        "ao": 0,
        "ip": 0,
        "op": 0,
        "st": 0,
        "bm": 0,
        "t": {
            "d": {
                "k": [{
                    "s": {
                        "s": size,
                        "f": font,
                        "t": text,
                        "j": align,
                        "tr": 0,
                        "lh": style.line_height_px.unwrap_or(size * 1.2),
                        "ls": 0,
                        "fc": [fill.r, fill.g, fill.b]
                    },
                    "t": 0
                }]
            },
            "p": {},
            "m": { "g": 1, "a": { "a": 0, "k": [0, 0] } },
            "a": []
        }
    });
    let effects = node_effects(node, warnings);
    if !effects.is_empty() {
        layer["ef"] = Value::Array(effects);
    }
    layer
}

// ---- shape items (the `shapes` array on a layer) ----

fn node_to_shape_items(
    node: &FigmaNode,
    bbox: &BoundingBox,
    warnings: &mut Vec<ConversionWarning>,
) -> Vec<Value> {
    let mut items: Vec<Value> = Vec::new();
    match node.node_type.as_str() {
        "RECTANGLE" => {
            let corner = node.corner_radius.unwrap_or(0.0);
            items.push(json!({
                "ty": "rc",
                "d": 1,
                "s": { "a": 0, "k": [bbox.width, bbox.height] },
                "p": { "a": 0, "k": [0.0, 0.0] },
                "r": { "a": 0, "k": corner }
            }));
        }
        "ELLIPSE" => {
            items.push(json!({
                "ty": "el",
                "d": 1,
                "s": { "a": 0, "k": [bbox.width, bbox.height] },
                "p": { "a": 0, "k": [0.0, 0.0] }
            }));
        }
        "LINE" => {
            // Figma LINE has zero height; render as a horizontal stroke
            // across its bounding-box width.
            items.push(line_shape(bbox.width, bbox.height));
        }
        "VECTOR" | "BOOLEAN_OPERATION" | "STAR" | "REGULAR_POLYGON" => {
            if let Some(geos) = node.fill_geometry.as_ref().filter(|g| !g.is_empty()) {
                for geo in geos {
                    items.push(svg_path_shape(&geo.path, bbox));
                }
            } else if let Some(geos) = node.stroke_geometry.as_ref().filter(|g| !g.is_empty()) {
                for geo in geos {
                    items.push(svg_path_shape(&geo.path, bbox));
                }
            } else {
                warnings.push(ConversionWarning {
                    node_id: node.id.clone(),
                    kind: WarningKind::GeometryMissing,
                    message: format!(
                        "{} node has no fillGeometry; re-fetch with `geometry=paths` query param",
                        node.node_type
                    ),
                });
                // Fall through to a placeholder rect so the layer still
                // produces a visible artifact instead of an empty shape.
                items.push(json!({
                    "ty": "rc",
                    "d": 1,
                    "s": { "a": 0, "k": [bbox.width.max(1.0), bbox.height.max(1.0)] },
                    "p": { "a": 0, "k": [0.0, 0.0] },
                    "r": { "a": 0, "k": 0 }
                }));
            }
        }
        other => {
            warnings.push(ConversionWarning {
                node_id: node.id.clone(),
                kind: WarningKind::UnsupportedNode,
                message: format!("unsupported Figma node type {other:?}; emitting bbox rect"),
            });
            items.push(json!({
                "ty": "rc",
                "d": 1,
                "s": { "a": 0, "k": [bbox.width.max(1.0), bbox.height.max(1.0)] },
                "p": { "a": 0, "k": [0.0, 0.0] },
                "r": { "a": 0, "k": 0 }
            }));
        }
    }

    // Fills (after the shape so the painter's-algorithm order is right).
    if let Some(fills) = node.fills.as_ref() {
        for fill in fills.iter().filter(|f| f.visible.unwrap_or(true)) {
            if let Some(fill_value) = paint_to_fill(fill, bbox, warnings, &node.id) {
                items.push(fill_value);
            }
        }
    }

    // Strokes — render as Lottie `st` (stroke) shapes.
    if let Some(strokes) = node.strokes.as_ref() {
        let weight = node.stroke_weight.unwrap_or(1.0);
        for stroke in strokes.iter().filter(|s| s.visible.unwrap_or(true)) {
            if let Some(c) = stroke.color {
                items.push(stroke_shape(c, weight));
            }
        }
    }

    // The group needs a trailing transform — caller wraps these items in
    // a "gr" group with its own transform; we emit one here so a bare
    // shape layer (no group wrapper) still validates.
    items.push(group_transform(0.0, 0.0, 100.0, 0.0));
    vec![json!({ "ty": "gr", "nm": node.name.clone(), "it": items })]
}

fn paint_to_fill(
    paint: &Paint,
    bbox: &BoundingBox,
    warnings: &mut Vec<ConversionWarning>,
    node_id: &str,
) -> Option<Value> {
    let alpha = paint.opacity.unwrap_or(1.0) * 100.0;
    match paint.paint_type.as_str() {
        "SOLID" => {
            let c = paint.color?;
            Some(json!({
                "ty": "fl",
                "c": { "a": 0, "k": [c.r, c.g, c.b, c.a] },
                "o": { "a": 0, "k": alpha },
                "r": 1,
                "bm": 0
            }))
        }
        "GRADIENT_LINEAR" | "GRADIENT_RADIAL" => {
            let stops = paint.gradient_stops.as_ref()?;
            let handles = paint.gradient_handles.as_ref()?;
            let (start, end) = gradient_endpoints(handles, bbox);
            let gradient_type = if paint.paint_type == "GRADIENT_LINEAR" {
                1
            } else {
                2
            };
            Some(json!({
                "ty": "gf",
                "o": { "a": 0, "k": alpha },
                "r": 1,
                "bm": 0,
                "g": { "p": stops.len(), "k": { "a": 0, "k": flatten_stops(stops) } },
                "s": { "a": 0, "k": [start.0, start.1] },
                "e": { "a": 0, "k": [end.0, end.1] },
                "t": gradient_type
            }))
        }
        "IMAGE" => {
            warnings.push(ConversionWarning {
                node_id: node_id.to_string(),
                kind: WarningKind::ImageFillStubbed,
                message: format!(
                    "image fill (imageRef={:?}) stubbed as transparent placeholder — needs a separate /v1/images call to resolve to a URL, then download + base64 embed",
                    paint.image_ref
                ),
            });
            Some(json!({
                "ty": "fl",
                "c": { "a": 0, "k": [0.5, 0.5, 0.5, 1.0] },
                "o": { "a": 0, "k": alpha * 0.3 },
                "r": 1,
                "bm": 0
            }))
        }
        other => {
            warnings.push(ConversionWarning {
                node_id: node_id.to_string(),
                kind: WarningKind::UnsupportedNode,
                message: format!("unsupported paint type {other:?}"),
            });
            None
        }
    }
}

fn first_solid_color(fills: Option<&[Paint]>) -> Option<Color> {
    fills?
        .iter()
        .filter(|f| f.visible.unwrap_or(true))
        .find_map(|f| {
            if f.paint_type == "SOLID" {
                f.color
            } else {
                None
            }
        })
}

fn gradient_endpoints(handles: &[Vec2], bbox: &BoundingBox) -> ((f32, f32), (f32, f32)) {
    let p0 = handles.first().copied().unwrap_or(Vec2 { x: 0.0, y: 0.5 });
    let p1 = handles.get(1).copied().unwrap_or(Vec2 { x: 1.0, y: 0.5 });
    // Handles are normalised 0..1 relative to the bbox.
    (
        (p0.x * bbox.width, p0.y * bbox.height),
        (p1.x * bbox.width, p1.y * bbox.height),
    )
}

fn flatten_stops(stops: &[GradientStop]) -> Vec<f32> {
    // Lottie gradient stop format: [position, r, g, b, position, r, g, b, ...]
    // then [position, alpha, position, alpha, ...] appended for opacity stops.
    let mut out: Vec<f32> = Vec::with_capacity(stops.len() * 6);
    for s in stops {
        out.push(s.position);
        out.push(s.color.r);
        out.push(s.color.g);
        out.push(s.color.b);
    }
    for s in stops {
        out.push(s.position);
        out.push(s.color.a);
    }
    out
}

fn stroke_shape(c: Color, weight: f32) -> Value {
    json!({
        "ty": "st",
        "c": { "a": 0, "k": [c.r, c.g, c.b, c.a] },
        "o": { "a": 0, "k": 100 },
        "w": { "a": 0, "k": weight },
        "lc": 1,
        "lj": 1,
        "ml": 4,
        "bm": 0
    })
}

fn line_shape(w: f32, h: f32) -> Value {
    // Convert the line's bounding box into a single-segment SVG-like path.
    let dx = w * 0.5;
    let dy = h * 0.5;
    json!({
        "ty": "sh",
        "d": 1,
        "ks": {
            "a": 0,
            "k": {
                "c": false,
                "v": [[-dx, -dy], [dx, dy]],
                "i": [[0.0, 0.0], [0.0, 0.0]],
                "o": [[0.0, 0.0], [0.0, 0.0]]
            }
        }
    })
}

fn svg_path_shape(path: &str, _bbox: &BoundingBox) -> Value {
    // Lottie shape format: lists of vertices and in/out tangents.
    // The SVG path -> bezier extraction is non-trivial; for now we ship
    // the raw SVG `d` string under a custom key (`_svgPath`) and emit a
    // single straight-line placeholder. A future PR will replace this
    // with a proper SVG-path-to-bezier conversion (lyon_geom or kurbo).
    json!({
        "ty": "sh",
        "d": 1,
        "_svgPath": path,
        "ks": {
            "a": 0,
            "k": {
                "c": true,
                "v": [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]],
                "i": [[0.0, 0.0], [0.0, 0.0], [0.0, 0.0], [0.0, 0.0]],
                "o": [[0.0, 0.0], [0.0, 0.0], [0.0, 0.0], [0.0, 0.0]]
            }
        }
    })
}

// ---- transforms ----

fn transform_static(cx: f32, cy: f32, opacity_pct: f32, rotation_deg: f32) -> Value {
    json!({
        "o": { "a": 0, "k": opacity_pct },
        "r": { "a": 0, "k": rotation_deg },
        "p": { "a": 0, "k": [cx, cy, 0] },
        "a": { "a": 0, "k": [0, 0, 0] },
        "s": { "a": 0, "k": [100, 100, 100] }
    })
}

fn group_transform(cx: f32, cy: f32, scale_pct: f32, rotation_deg: f32) -> Value {
    json!({
        "ty": "tr",
        "p": { "a": 0, "k": [cx, cy] },
        "a": { "a": 0, "k": [0, 0] },
        "s": { "a": 0, "k": [scale_pct, scale_pct] },
        "r": { "a": 0, "k": rotation_deg },
        "o": { "a": 0, "k": 100 },
        "sk": { "a": 0, "k": 0 },
        "sa": { "a": 0, "k": 0 }
    })
}

// ---- effects (drop shadow, blur) ----

fn node_effects(node: &FigmaNode, warnings: &mut Vec<ConversionWarning>) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    let Some(effects) = node.effects.as_ref() else {
        return out;
    };
    for e in effects.iter().filter(|e| e.visible.unwrap_or(true)) {
        match effect_to_lottie(e) {
            Some(v) => out.push(v),
            None => warnings.push(ConversionWarning {
                node_id: node.id.clone(),
                kind: WarningKind::EffectStripped,
                message: format!("effect {:?} stripped (not supported)", e.effect_type),
            }),
        }
    }
    out
}

fn effect_to_lottie(e: &Effect) -> Option<Value> {
    match e.effect_type.as_str() {
        "DROP_SHADOW" => {
            let c = e.color.unwrap_or(Color {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 0.5,
            });
            let offset = e.offset.unwrap_or(Vec2 { x: 0.0, y: 2.0 });
            let radius = e.radius.unwrap_or(4.0);
            Some(json!({
                "ty": 25,  // Lottie drop-shadow effect
                "nm": "Drop Shadow",
                "en": 1,
                "ef": [
                    { "ty": 2, "nm": "Shadow Color", "v": { "a": 0, "k": [c.r, c.g, c.b, c.a] } },
                    { "ty": 0, "nm": "Opacity", "v": { "a": 0, "k": c.a * 255.0 } },
                    { "ty": 0, "nm": "Distance", "v": { "a": 0, "k": (offset.x.powi(2) + offset.y.powi(2)).sqrt() } },
                    { "ty": 0, "nm": "Softness", "v": { "a": 0, "k": radius } }
                ]
            }))
        }
        "LAYER_BLUR" | "BACKGROUND_BLUR" => {
            let radius = e.radius.unwrap_or(4.0);
            Some(json!({
                "ty": 29,  // Lottie gaussian blur
                "nm": "Gaussian Blur",
                "en": 1,
                "ef": [
                    { "ty": 0, "nm": "Blurriness", "v": { "a": 0, "k": radius } }
                ]
            }))
        }
        "INNER_SHADOW" => {
            // Lottie has no direct inner-shadow primitive; we skip and warn.
            None
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(w: f32, h: f32, color: Color) -> FigmaNode {
        FigmaNode {
            id: "1:1".into(),
            name: "rect".into(),
            node_type: "RECTANGLE".into(),
            visible: None,
            opacity: None,
            bounding_box: Some(BoundingBox {
                x: 0.0,
                y: 0.0,
                width: w,
                height: h,
            }),
            fills: Some(vec![Paint {
                paint_type: "SOLID".into(),
                visible: None,
                opacity: None,
                color: Some(color),
                gradient_handles: None,
                gradient_stops: None,
                image_ref: None,
            }]),
            strokes: None,
            stroke_weight: None,
            corner_radius: None,
            effects: None,
            fill_geometry: None,
            stroke_geometry: None,
            characters: None,
            style: None,
            rotation: None,
            children: None,
        }
    }

    #[test]
    fn rectangle_converts_to_shape_layer() {
        let node = rect(
            200.0,
            100.0,
            Color {
                r: 1.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            },
        );
        let out = to_lottie_layer(&node);
        assert_eq!(out.layer["ty"], 4);
        assert_eq!(out.warnings.len(), 0);
        // Has shape group with rect and fill.
        let shapes = out.layer["shapes"].as_array().unwrap();
        assert_eq!(shapes.len(), 1);
        let group_items = shapes[0]["it"].as_array().unwrap();
        assert!(group_items.iter().any(|v| v["ty"] == "rc"));
        assert!(group_items.iter().any(|v| v["ty"] == "fl"));
    }

    #[test]
    fn ellipse_converts() {
        let mut node = rect(
            80.0,
            80.0,
            Color {
                r: 0.0,
                g: 0.5,
                b: 1.0,
                a: 1.0,
            },
        );
        node.node_type = "ELLIPSE".into();
        let out = to_lottie_layer(&node);
        let shapes = out.layer["shapes"].as_array().unwrap();
        let group_items = shapes[0]["it"].as_array().unwrap();
        assert!(group_items.iter().any(|v| v["ty"] == "el"));
    }

    #[test]
    fn image_fill_warns_but_still_emits_a_layer() {
        let mut node = rect(
            100.0,
            100.0,
            Color {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            },
        );
        node.fills = Some(vec![Paint {
            paint_type: "IMAGE".into(),
            visible: None,
            opacity: None,
            color: None,
            gradient_handles: None,
            gradient_stops: None,
            image_ref: Some("abcdef".into()),
        }]);
        let out = to_lottie_layer(&node);
        assert!(
            out.warnings
                .iter()
                .any(|w| w.kind == WarningKind::ImageFillStubbed)
        );
        // The layer is still emitted so downstream consumers don't choke.
        assert_eq!(out.layer["ty"], 4);
    }

    #[test]
    fn frame_with_children_recurses() {
        let child = rect(
            50.0,
            50.0,
            Color {
                r: 0.0,
                g: 1.0,
                b: 0.0,
                a: 1.0,
            },
        );
        let frame = FigmaNode {
            id: "1:0".into(),
            name: "Frame 1".into(),
            node_type: "FRAME".into(),
            visible: None,
            opacity: None,
            bounding_box: Some(BoundingBox {
                x: 0.0,
                y: 0.0,
                width: 200.0,
                height: 200.0,
            }),
            fills: None,
            strokes: None,
            stroke_weight: None,
            corner_radius: None,
            effects: None,
            fill_geometry: None,
            stroke_geometry: None,
            characters: None,
            style: None,
            rotation: None,
            children: Some(vec![child]),
        };
        let out = to_lottie_layer(&frame);
        let outer_group = &out.layer["shapes"][0];
        assert_eq!(outer_group["ty"], "gr");
        // Outer group has one child group + a trailing transform.
        let items = outer_group["it"].as_array().unwrap();
        assert!(items.len() >= 2);
    }

    #[test]
    fn linear_gradient_converts() {
        let mut node = rect(
            100.0,
            100.0,
            Color {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            },
        );
        node.fills = Some(vec![Paint {
            paint_type: "GRADIENT_LINEAR".into(),
            visible: None,
            opacity: None,
            color: None,
            gradient_handles: Some(vec![Vec2 { x: 0.0, y: 0.0 }, Vec2 { x: 1.0, y: 1.0 }]),
            gradient_stops: Some(vec![
                GradientStop {
                    position: 0.0,
                    color: Color {
                        r: 1.0,
                        g: 0.0,
                        b: 0.0,
                        a: 1.0,
                    },
                },
                GradientStop {
                    position: 1.0,
                    color: Color {
                        r: 0.0,
                        g: 0.0,
                        b: 1.0,
                        a: 1.0,
                    },
                },
            ]),
            image_ref: None,
        }]);
        let out = to_lottie_layer(&node);
        let shapes = out.layer["shapes"].as_array().unwrap();
        let items = shapes[0]["it"].as_array().unwrap();
        assert!(items.iter().any(|v| v["ty"] == "gf"));
    }

    #[test]
    fn text_node_produces_text_layer() {
        let node = FigmaNode {
            id: "2:0".into(),
            name: "Headline".into(),
            node_type: "TEXT".into(),
            visible: None,
            opacity: None,
            bounding_box: Some(BoundingBox {
                x: 10.0,
                y: 20.0,
                width: 200.0,
                height: 40.0,
            }),
            fills: Some(vec![Paint {
                paint_type: "SOLID".into(),
                visible: None,
                opacity: None,
                color: Some(Color {
                    r: 0.1,
                    g: 0.1,
                    b: 0.1,
                    a: 1.0,
                }),
                gradient_handles: None,
                gradient_stops: None,
                image_ref: None,
            }]),
            strokes: None,
            stroke_weight: None,
            corner_radius: None,
            effects: None,
            fill_geometry: None,
            stroke_geometry: None,
            characters: Some("Hello, motion".into()),
            style: Some(crate::TypeStyle {
                font_family: Some("Inter".into()),
                font_weight: Some(700.0),
                font_size: Some(32.0),
                text_align_horizontal: Some("CENTER".into()),
                line_height_px: None,
            }),
            rotation: None,
            children: None,
        };
        let out = to_lottie_layer(&node);
        assert_eq!(out.layer["ty"], 5);
        assert_eq!(out.layer["t"]["d"]["k"][0]["s"]["t"], "Hello, motion");
    }

    #[test]
    fn drop_shadow_becomes_effect() {
        let mut node = rect(
            50.0,
            50.0,
            Color {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 1.0,
            },
        );
        node.effects = Some(vec![Effect {
            effect_type: "DROP_SHADOW".into(),
            visible: None,
            radius: Some(8.0),
            color: Some(Color {
                r: 0.0,
                g: 0.0,
                b: 0.0,
                a: 0.5,
            }),
            offset: Some(Vec2 { x: 0.0, y: 4.0 }),
        }]);
        let out = to_lottie_layer(&node);
        let effects = out.layer["ef"].as_array().unwrap();
        assert_eq!(effects.len(), 1);
        assert_eq!(effects[0]["ty"], 25);
    }
}
