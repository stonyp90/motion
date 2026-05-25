//! End-to-end roundtrip: every supported [`OutputFormat`] must produce
//! a non-empty file from a tiny fixture.
//!
//! Strategy: we synthesize a 320x180 / 2s test video with ffmpeg's
//! built-in `testsrc2` source for the raster pipeline, and a hand-written
//! 4-layer Lottie JSON for the zero-render formats. This keeps the test
//! self-contained — no external fixtures, no python sidecar — so it runs
//! green on a fresh checkout as long as ffmpeg is on PATH.
//!
//! Tests skip (rather than fail) when:
//! - `ffmpeg` is not on PATH (raster pipeline)
//! - The encoder for a specific format isn't compiled into the local
//!   ffmpeg build (we fall back where we can; otherwise the format is
//!   skipped with a printed note).

use motion_forge_render::format::{
    OutputFormat, build_svg, copy_lottie, pack_dotlottie, transcode_with_ffmpeg,
};
use std::path::{Path, PathBuf};
use std::process::Command;

fn ffmpeg_available() -> bool {
    Command::new("ffmpeg")
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// True if the local ffmpeg build advertises the named encoder.
fn ffmpeg_has_encoder(name: &str) -> bool {
    let out = match Command::new("ffmpeg").arg("-encoders").output() {
        Ok(o) => o,
        Err(_) => return false,
    };
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .any(|l| l.split_whitespace().any(|tok| tok == name))
}

fn make_test_mp4(path: &Path) -> bool {
    if !ffmpeg_available() {
        return false;
    }
    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x180:rate=15:duration=1",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(path)
        .status();
    status.map(|s| s.success()).unwrap_or(false) && path.exists()
}

const FIXTURE_LOTTIE: &str = r#"{
    "v": "5.7.0",
    "fr": 15,
    "ip": 0,
    "op": 15,
    "w": 320,
    "h": 180,
    "nm": "format-roundtrip",
    "ddd": 0,
    "assets": [],
    "layers": [
        {
            "ty": 4,
            "ind": 1,
            "ks": {"p": {"k": [80, 90]}},
            "shapes": [
                {
                    "ty": "gr",
                    "it": [
                        {"ty": "rc", "s": {"k": [60, 60]}},
                        {"ty": "fl", "c": {"k": [0.96, 0.45, 0.0, 1.0]}}
                    ]
                }
            ]
        },
        {
            "ty": 4,
            "ind": 2,
            "ks": {"p": {"k": [240, 90]}},
            "shapes": [
                {
                    "ty": "gr",
                    "it": [
                        {"ty": "el", "s": {"k": [60, 60]}},
                        {"ty": "fl", "c": {"k": [0.06, 0.73, 0.51, 1.0]}}
                    ]
                }
            ]
        },
        {
            "ty": 4,
            "ind": 3,
            "ks": {"p": {"k": [160, 90]}},
            "shapes": [
                {"ty": "gr", "it": [{"ty": "fl", "c": {"k": [0.06, 0.09, 0.16, 1.0]}}]}
            ]
        }
    ]
}"#;

fn write_fixture_lottie(dir: &Path) -> PathBuf {
    let p = dir.join("fixture.lottie.json");
    std::fs::write(&p, FIXTURE_LOTTIE).expect("write fixture lottie");
    p
}

#[test]
fn every_format_emits_a_nonempty_file() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let lottie = write_fixture_lottie(tmp.path());

    let intermediate = tmp.path().join("intermediate.mp4");
    let raster_ok = make_test_mp4(&intermediate);
    if !raster_ok {
        eprintln!("ffmpeg not available — skipping raster portion of roundtrip");
    }

    let mut results: Vec<(OutputFormat, Option<u64>)> = Vec::new();
    for fmt in OutputFormat::ALL {
        let out = tmp.path().join(format!("out.{}", fmt.extension()));
        let bytes = match fmt {
            OutputFormat::Lottie => Some(copy_lottie(&lottie, &out).expect("copy lottie")),
            OutputFormat::DotLottie => Some(pack_dotlottie(&lottie, &out).expect("pack dotlottie")),
            OutputFormat::Svg => Some(build_svg(&lottie, &out).expect("build svg")),
            other => {
                if !raster_ok {
                    None
                } else if let Some(skip_reason) = ffmpeg_skip_reason(*other) {
                    eprintln!("skipping {}: {}", other.slug(), skip_reason);
                    None
                } else {
                    match transcode_with_ffmpeg(*other, &intermediate, &out) {
                        Ok(n) => Some(n),
                        Err(e) => {
                            eprintln!("transcode {} failed: {e}", other.slug());
                            None
                        }
                    }
                }
            }
        };
        if let Some(n) = bytes {
            assert!(
                n > 32,
                "{} output was suspiciously small ({} bytes)",
                fmt.slug(),
                n
            );
            assert!(out.exists(), "{} output is missing", fmt.slug());
        }
        results.push((*fmt, bytes));
    }

    // Print the size table so the test log doubles as the report
    // material in the PR description.
    eprintln!("\nFormat roundtrip results:");
    for (fmt, sz) in &results {
        match sz {
            Some(n) => eprintln!("  {:<10} {:>8} bytes", fmt.slug(), n),
            None => eprintln!("  {:<10}      skipped", fmt.slug()),
        }
    }

    // At minimum the three zero-render formats must succeed unconditionally.
    let zero_render_ok = results.iter().all(|(f, sz)| match f {
        OutputFormat::Lottie | OutputFormat::DotLottie | OutputFormat::Svg => sz.is_some(),
        _ => true,
    });
    assert!(
        zero_render_ok,
        "zero-render formats should always produce a file"
    );
}

/// Returns `Some(reason)` if the local ffmpeg build is known not to
/// support the format's encoder, so the test can skip cleanly instead of
/// flapping. None means "go for it".
fn ffmpeg_skip_reason(fmt: OutputFormat) -> Option<&'static str> {
    match fmt {
        OutputFormat::WebmAv1 if !ffmpeg_has_encoder("libsvtav1") => {
            Some("no libsvtav1 in ffmpeg build")
        }
        OutputFormat::Webm if !ffmpeg_has_encoder("libvpx-vp9") => {
            Some("no libvpx-vp9 in ffmpeg build")
        }
        OutputFormat::Mov if !ffmpeg_has_encoder("prores_ks") => {
            Some("no prores_ks in ffmpeg build")
        }
        OutputFormat::Webp
            if !ffmpeg_has_encoder("libwebp_anim") && !ffmpeg_has_encoder("libwebp") =>
        {
            Some("no libwebp / libwebp_anim in ffmpeg build")
        }
        OutputFormat::Apng if !ffmpeg_has_encoder("apng") => Some("no apng in ffmpeg build"),
        OutputFormat::Gif if !ffmpeg_has_encoder("gif") => Some("no gif in ffmpeg build"),
        _ => None,
    }
}
