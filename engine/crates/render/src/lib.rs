//! Lottie → {MP4, MOV, WebM, GIF, WebP, APNG, .lottie, SVG}.
//!
//! Two entry points:
//!
//! - The legacy [`Renderer`] trait + [`python_sidecar_adapter`] still
//!   exists for callers that just want a raw MP4 from a Lottie. It is
//!   what the pipeline composes today.
//! - The new [`render_to_format`] dispatches through [`format::OutputFormat`]
//!   to produce any of the 10 supported formats. For raster targets it
//!   composes the python renderer (Lottie → MP4) with an ffmpeg
//!   transcode (MP4 → final codec). For DotLottie / SVG / plain Lottie
//!   it skips rasterization entirely.
//!
//! Default format is MP4 for backward-compat with the historical
//! `RenderConfig::default()` shape.

use anyhow::Result;
use motion_forge_video_io::Codec;
use std::path::Path;

pub mod format;

pub use format::OutputFormat;

#[derive(Debug, Clone)]
pub struct RenderConfig {
    pub width: u32,
    pub height: u32,
    pub frame_rate: f64,
    pub bitrate_kbps: u32,
    pub codec: Codec,
    /// Target output format. Defaults to MP4 so existing callers keep
    /// the historical behaviour.
    pub format: OutputFormat,
}

impl Default for RenderConfig {
    fn default() -> Self {
        Self {
            width: 1920,
            height: 1080,
            frame_rate: 30.0,
            bitrate_kbps: 4000,
            codec: Codec::H264,
            format: OutputFormat::Mp4,
        }
    }
}

pub trait Renderer {
    fn render(&mut self, lottie: &Path, out: &Path, config: &RenderConfig) -> Result<()>;
}

pub mod python_sidecar_adapter;

pub mod dotlottie_adapter {
    //! Future Rust-native renderer slot.
    use super::*;

    pub struct DotLottieRenderer;
    impl DotLottieRenderer {
        pub fn new() -> Self {
            Self
        }
    }
    impl Default for DotLottieRenderer {
        fn default() -> Self {
            Self::new()
        }
    }
    impl Renderer for DotLottieRenderer {
        fn render(&mut self, _lottie: &Path, _out: &Path, _config: &RenderConfig) -> Result<()> {
            anyhow::bail!("native dotlottie renderer pending; use python_sidecar_adapter for now")
        }
    }
}

/// High-level entry: render a Lottie JSON file to any [`OutputFormat`].
///
/// Strategy per format:
/// - `Lottie` → copy the JSON (pretty-printed).
/// - `DotLottie` → pack source JSON into a `.lottie` zip with a manifest.
/// - `Svg` → emit a SMIL-animated SVG (degraded fallback; see
///   [`format::build_svg`]).
/// - Anything else → render an intermediate MP4 with `intermediate_renderer`
///   and transcode to the target codec via ffmpeg using
///   [`format::transcode_with_ffmpeg`].
///
/// Returns the number of bytes written to `output_path` so callers can
/// log file sizes / estimate bandwidth without re-statting.
pub fn render_to_format<R: Renderer>(
    intermediate_renderer: &mut R,
    lottie_path: &Path,
    output_path: &Path,
    config: &RenderConfig,
) -> Result<u64> {
    use format::{OutputFormat::*, build_svg, copy_lottie, pack_dotlottie, transcode_with_ffmpeg};

    match config.format {
        Lottie => copy_lottie(lottie_path, output_path),
        DotLottie => pack_dotlottie(lottie_path, output_path),
        Svg => build_svg(lottie_path, output_path),
        Mp4 | Mov | Webm | WebmAv1 | Gif | Webp | Apng => {
            // Stage 1: rasterize Lottie → MP4. The python sidecar writes
            // whatever container the output extension suggests; we always
            // ask it for an .mp4 intermediate so the ffmpeg post-process
            // has a known input codec.
            let intermediate = scratch_mp4(output_path)?;
            let mp4_config = RenderConfig {
                format: OutputFormat::Mp4,
                ..config.clone()
            };
            intermediate_renderer.render(lottie_path, &intermediate, &mp4_config)?;

            // Stage 2: transcode to the requested format.
            let bytes = if matches!(config.format, OutputFormat::Mp4) {
                // No transcode needed. Move the intermediate into place.
                if intermediate != output_path {
                    std::fs::rename(&intermediate, output_path)
                        .or_else(|_| std::fs::copy(&intermediate, output_path).map(|_| ()))?;
                }
                std::fs::metadata(output_path)?.len()
            } else {
                let n = transcode_with_ffmpeg(config.format, &intermediate, output_path)?;
                let _ = std::fs::remove_file(&intermediate);
                n
            };
            Ok(bytes)
        }
    }
}

/// Build a sibling scratch path (`<stem>.intermediate.mp4`) next to
/// `output_path`. Lets us keep tmp files in the same filesystem as the
/// final output so the eventual rename stays atomic.
fn scratch_mp4(output_path: &Path) -> Result<std::path::PathBuf> {
    let parent = output_path
        .parent()
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    std::fs::create_dir_all(&parent)?;
    let stem = output_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("motion-forge");
    Ok(parent.join(format!("{stem}.intermediate.mp4")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_config_default_is_1080p30_mp4() {
        let c = RenderConfig::default();
        assert_eq!(c.width, 1920);
        assert_eq!(c.height, 1080);
        assert_eq!(c.codec, Codec::H264);
        assert_eq!(c.format, OutputFormat::Mp4);
    }

    #[test]
    fn scratch_mp4_lands_in_output_parent() {
        let p = scratch_mp4(std::path::Path::new("/tmp/out.gif")).unwrap();
        assert_eq!(p, std::path::PathBuf::from("/tmp/out.intermediate.mp4"));
    }
}
