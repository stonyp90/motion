//! Print exported payload size per format for the round-trip fixture.
//! Used for the agent report; not part of the public API.
use motion_forge_web_export::{WebExportFormat, export};

fn main() {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("fixtures/round_trip/segments/segment-001/seg.lottie.json");
    let raw = std::fs::read_to_string(&path).unwrap();
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    println!(
        "Fixture: {} ({} bytes raw lottie)",
        path.display(),
        raw.len()
    );
    for &fmt in WebExportFormat::all() {
        let out = export(fmt, &v).unwrap();
        println!(
            "  {:>16}  {:>6} bytes  ({})",
            fmt.slug(),
            out.len(),
            fmt.mime_type()
        );
    }
}
