//! Round-trip tests for each ingest adapter against tiny fixtures stored
//! in `engine/fixtures/ingest/`.
//!
//! These tests are intentionally small and self-contained — every fixture
//! is a hand-crafted minimal valid file. Real-world fidelity tests live in
//! their respective adapter `#[cfg(test)]` modules.

use motion_forge_ingest::{SourceFormat, detect, ingest};
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll, Waker};

fn block_on<F: Future>(mut fut: F) -> F::Output {
    // The ingest pipeline never actually yields (every adapter is sync), so
    // a single `poll` is always enough.
    let waker = Waker::noop();
    let mut cx = Context::from_waker(waker);
    // SAFETY: we never move `fut` after pinning.
    let pinned = unsafe { Pin::new_unchecked(&mut fut) };
    match pinned.poll(&mut cx) {
        Poll::Ready(v) => v,
        Poll::Pending => panic!("ingest unexpectedly yielded"),
    }
}

fn fixtures_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("fixtures")
        .join("ingest")
}

fn load(name: &str) -> Vec<u8> {
    let path = fixtures_dir().join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("read fixture {}: {e}", path.display()))
}

#[test]
fn lottie_fixture_round_trips() {
    let bytes = load("minimal.lottie.json");
    assert_eq!(detect(&bytes), Some(SourceFormat::Lottie));
    let c = block_on(ingest(SourceFormat::Lottie, &bytes)).unwrap();
    assert_eq!(c.composition_width, 800);
    assert_eq!(c.composition_height, 600);
    assert_eq!(c.frame_rate, 30.0);
    assert!(
        c.shots
            .first()
            .map(|s| !s.layers.is_empty())
            .unwrap_or(false)
    );
}

#[test]
fn bodymovin_fixture_routes_through_lottie_adapter() {
    let bytes = load("bodymovin-with-meta.json");
    assert_eq!(detect(&bytes), Some(SourceFormat::Bodymovin));
    let c = block_on(ingest(SourceFormat::Bodymovin, &bytes)).unwrap();
    assert_eq!(c.composition_width, 1280);
    assert!(c.duration_seconds > 0.0);
}

#[test]
fn dotlottie_fixture_extracts_active_animation() {
    let bytes = load("minimal.lottie");
    assert_eq!(detect(&bytes), Some(SourceFormat::DotLottie));
    let c = block_on(ingest(SourceFormat::DotLottie, &bytes)).unwrap();
    assert_eq!(c.composition_width, 640);
    assert_eq!(c.composition_height, 480);
}

#[test]
fn rive_text_fixture_imports() {
    let bytes = load("rive-text-export.json");
    assert_eq!(detect(&bytes), Some(SourceFormat::Rive));
    let c = block_on(ingest(SourceFormat::Rive, &bytes)).unwrap();
    assert_eq!(c.composition_width, 800);
    assert!(
        c.shots
            .first()
            .map(|s| !s.layers.is_empty())
            .unwrap_or(false)
    );
}

#[test]
fn rive_binary_fixture_returns_helpful_error() {
    let bytes = load("rive-binary-stub.riv");
    let err = block_on(ingest(SourceFormat::Rive, &bytes))
        .unwrap_err()
        .to_string();
    assert!(err.contains("Re-export"), "got error: {err}");
}

#[test]
fn dragonbones_fixture_imports_skeleton() {
    let bytes = load("dragonbones_ske.json");
    assert_eq!(detect(&bytes), Some(SourceFormat::DragonBones));
    let c = block_on(ingest(SourceFormat::DragonBones, &bytes)).unwrap();
    assert_eq!(c.frame_rate, 30.0);
    assert_eq!(c.shots.len(), 1);
    assert!(!c.shots[0].layers.is_empty());
}

#[test]
fn mogrt_fixture_imports_embedded_lottie() {
    let bytes = load("minimal.mogrt");
    let c = block_on(ingest(SourceFormat::MoGRT, &bytes)).unwrap();
    assert_eq!(c.composition_width, 1080);
}

#[test]
fn jsx_output_fixture_passes_through() {
    let bytes = load("jsx-export-output.json");
    let c = block_on(ingest(SourceFormat::AfterEffectsJsx, &bytes)).unwrap();
    assert_eq!(c.composition_width, 1920);
    assert_eq!(c.frame_rate, 30.0);
    assert_eq!(c.background_hex, [16, 18, 32]);
}

#[test]
fn jsx_source_fixture_returns_helpful_error() {
    let bytes = load("motion-forge-export.jsx");
    let err = block_on(ingest(SourceFormat::AfterEffectsJsx, &bytes))
        .unwrap_err()
        .to_string();
    assert!(
        err.contains("File > Scripts > Run Script File"),
        "got error: {err}"
    );
}
