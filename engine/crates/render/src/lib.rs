//! Lottie → MP4 render.
//!
//! Default adapter: `python_sidecar_adapter` shelling to
//! `scripts/render_lottie.py` (uses the `lottie` Python package +
//! cairo + opencv). Future slot for a Rust-native renderer (vello,
//! skia-safe, or dotlottie-rs once its dep chain is friendlier).

use anyhow::Result;
use motion_forge_video_io::Codec;
use std::path::Path;

#[derive(Debug, Clone)]
pub struct RenderConfig {
    pub width: u32,
    pub height: u32,
    pub frame_rate: f64,
    pub bitrate_kbps: u32,
    pub codec: Codec,
}

impl Default for RenderConfig {
    fn default() -> Self {
        Self {
            width: 1920,
            height: 1080,
            frame_rate: 30.0,
            bitrate_kbps: 4000,
            codec: Codec::H264,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_config_default_is_1080p30() {
        let c = RenderConfig::default();
        assert_eq!(c.width, 1920);
        assert_eq!(c.height, 1080);
        assert_eq!(c.codec, Codec::H264);
    }
}
