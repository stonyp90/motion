//! Round-trip + snapshot tests for each web-export format. Driven by
//! a single Lottie fixture that exercises every supported property
//! kind: keyframed position, rotation, scale, and opacity, plus a
//! static layer underneath.
//!
//! The "snapshot" is structural — we assert the presence of the
//! load-bearing tokens (no exact-byte comparison), so unrelated
//! formatting tweaks don't cause noise.

use motion_forge_web_export::{WebExportFormat, export};
use serde_json::Value;
use std::path::PathBuf;

fn fixture_path() -> PathBuf {
    let mut p = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    // Walk up two levels: crates/web-export -> engine.
    p.pop();
    p.pop();
    p.push("fixtures/round_trip/segments/segment-001/seg.lottie.json");
    p
}

fn load_fixture() -> Value {
    let path = fixture_path();
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read fixture {}: {e}", path.display()));
    serde_json::from_str(&raw).expect("valid lottie json")
}

#[test]
fn fixture_loads_and_parses() {
    let v = load_fixture();
    assert_eq!(v["w"].as_u64(), Some(640));
    assert_eq!(v["h"].as_u64(), Some(360));
}

#[test]
fn svg_smil_contains_smil_elements_and_loops() {
    let v = load_fixture();
    let out = export(WebExportFormat::SvgSmil, &v).unwrap();
    assert!(out.starts_with("<?xml"));
    assert!(out.contains("<svg"));
    assert!(out.contains("viewBox=\"0 0 640 360\""));
    assert!(out.contains("<ellipse"));
    assert!(out.contains("<rect"));
    assert!(out.contains("<animateTransform"));
    assert!(out.contains("repeatCount=\"indefinite\""));
    assert!(out.contains("keySplines"));
}

#[test]
fn svg_css_contains_keyframes_and_class_selectors() {
    let v = load_fixture();
    let out = export(WebExportFormat::SvgCssKeyframes, &v).unwrap();
    // layer-0 is the bottom (static "card"), layer-1 is the animated
    // spinner. Both get @keyframes blocks (the static layer just
    // keyframes once to the same value).
    assert!(out.contains("@keyframes layer-0-transform"));
    assert!(out.contains("@keyframes layer-1-transform"));
    assert!(out.contains("@keyframes layer-1-opacity"));
    assert!(out.contains(".layer-0 {"));
    assert!(out.contains(".layer-1 {"));
    assert!(out.contains("transform-origin"));
    assert!(out.contains("infinite"));
    assert!(out.contains("cubic-bezier"));
}

#[test]
fn gsap_emits_timeline_with_set_and_to_calls() {
    let v = load_fixture();
    let out = export(WebExportFormat::GsapTimeline, &v).unwrap();
    assert!(out.contains("import { gsap } from 'gsap';"));
    assert!(out.contains("gsap.timeline({ repeat: -1"));
    // Both layers get a .set(); only the animated spinner (layer-1) gets .to().
    assert!(out.contains("timeline.set('.layer-0'"));
    assert!(out.contains("timeline.set('.layer-1'"));
    assert!(out.contains("timeline.to('.layer-1'"));
    // Per-property tweens for the animated layer.
    assert!(out.contains("x:"));
    assert!(out.contains("rotation:"));
    assert!(out.contains("scaleX:"));
    assert!(out.contains("opacity:"));
}

#[test]
fn motion_js_emits_animate_calls_per_property() {
    let v = load_fixture();
    let out = export(WebExportFormat::MotionJs, &v).unwrap();
    assert!(out.contains("import { animate } from 'motion';"));
    assert!(out.contains("export function play()"));
    assert!(out.contains("animate('.layer-1', { x:"));
    assert!(out.contains("animate('.layer-1', { rotate:"));
    assert!(out.contains("animate('.layer-1', { scaleX:"));
    assert!(out.contains("animate('.layer-1', { opacity:"));
    assert!(out.contains("repeat: Infinity"));
}

#[test]
fn theatre_json_is_parsable_and_has_sheet_objects() {
    let v = load_fixture();
    let out = export(WebExportFormat::TheatreJson, &v).unwrap();
    let parsed: Value = serde_json::from_str(&out).expect("output is JSON");
    // layer-0 is the static card; layer-1 is the animated spinner.
    assert!(parsed["sheetsById"]["Composition"]["objects"]["layer-0"].is_object());
    assert!(parsed["sheetsById"]["Composition"]["objects"]["layer-1"].is_object());
    let tracks = &parsed["sheetsById"]["Composition"]["sequence"]["tracksByObject"]["layer-1"];
    assert!(tracks["position.x"]["keyframes"].is_array());
    assert!(tracks["position.y"]["keyframes"].is_array());
    assert!(tracks["rotation"]["keyframes"].is_array());
    assert!(tracks["scale.x"]["keyframes"].is_array());
    assert!(tracks["opacity"]["keyframes"].is_array());
    // Theatre handle format check.
    let first = &tracks["position.x"]["keyframes"][0];
    assert!(first["handles"].is_array());
    assert_eq!(first["handles"].as_array().unwrap().len(), 4);
}

#[test]
fn framer_variants_emit_object_per_layer() {
    let v = load_fixture();
    let out = export(WebExportFormat::FramerMotionVariants, &v).unwrap();
    let parsed: Value = serde_json::from_str(&out).expect("output is JSON");
    assert_eq!(parsed["__meta"]["loop"], "infinite");
    // Animated layer's `to` arrays.
    assert!(parsed["layer-1"]["from"].is_object());
    assert!(parsed["layer-1"]["to"]["x"].is_array());
    assert!(parsed["layer-1"]["to"]["rotate"].is_array());
    assert!(parsed["layer-1"]["to"]["opacity"].is_array());
    assert_eq!(parsed["layer-1"]["__transition"]["repeat"], "Infinity");
    // Static layer's properties should be scalars, not arrays.
    assert!(parsed["layer-0"]["to"]["x"].is_number());
}

#[test]
fn every_format_produces_non_trivial_output() {
    let v = load_fixture();
    for &fmt in WebExportFormat::all() {
        let out = export(fmt, &v).unwrap_or_else(|e| panic!("format {:?}: {e}", fmt));
        assert!(
            out.len() > 100,
            "format {:?} produced suspiciously small output ({} bytes)",
            fmt,
            out.len(),
        );
    }
}

#[test]
fn output_sizes_are_recorded() {
    // Print sizes for visibility in `cargo test -- --nocapture` and for
    // the agent's final report.
    let v = load_fixture();
    for &fmt in WebExportFormat::all() {
        let out = export(fmt, &v).unwrap();
        eprintln!("web-export[{:>16}] = {:>6} bytes", fmt.slug(), out.len());
    }
}
