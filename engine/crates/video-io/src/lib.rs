//! Video decode / encode port.
//!
//! Two adapter slots:
//! - `sidecar_adapter` — spawns the FFmpeg CLI and pipes raw frames over
//!   stdio. Working impl today; codec-agnostic; ABI-stable across FFmpeg
//!   point releases. Used by the CLI `transcode` subcommand.
//! - `rsmpeg_adapter` — direct FFmpeg bindings; lower latency, zero-copy
//!   frame buffers. Lands once rsmpeg catches up to FFmpeg 8.1 (or once
//!   the project pins FFmpeg 8.0).

use anyhow::Result;
use std::path::Path;

/// One decoded video frame in a packed pixel format.
#[derive(Debug, Clone)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub pts_micros: i64,
    pub pixel_format: PixelFormat,
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PixelFormat {
    Rgba8,
    Rgb8,
    Nv12,
}

impl PixelFormat {
    pub fn bytes_per_pixel(self) -> usize {
        match self {
            PixelFormat::Rgba8 => 4,
            PixelFormat::Rgb8 => 3,
            PixelFormat::Nv12 => 0, // planar; sized differently
        }
    }
}

/// Frame-by-frame demux + decode.
pub trait Decoder {
    fn width(&self) -> u32;
    fn height(&self) -> u32;
    fn frame_rate(&self) -> f64;
    fn next_frame(&mut self) -> Result<Option<Frame>>;
}

#[derive(Debug, Clone)]
pub struct EncoderConfig {
    pub width: u32,
    pub height: u32,
    pub frame_rate: f64,
    pub bitrate_kbps: u32,
    pub codec: Codec,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Codec {
    H264,
    Hevc,
}

pub trait Encoder {
    fn push_frame(&mut self, frame: &Frame) -> Result<()>;
    fn finish(self: Box<Self>) -> Result<()>;
}

pub mod sidecar_adapter;

pub mod rsmpeg_adapter {
    //! Reserved for the future direct-bindings adapter. See module docs in [`crate`].
    use super::*;

    pub struct RsmpegDecoder;
    impl RsmpegDecoder {
        pub fn open(_path: &Path) -> Result<Self> {
            anyhow::bail!("rsmpeg adapter pending FFmpeg 8.1 support; use sidecar_adapter for now")
        }
    }

    pub struct RsmpegEncoder;
    impl RsmpegEncoder {
        pub fn create(_path: &Path, _config: EncoderConfig) -> Result<Box<dyn Encoder>> {
            anyhow::bail!("rsmpeg adapter pending FFmpeg 8.1 support; use sidecar_adapter for now")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pixel_format_is_copyable() {
        let pf = PixelFormat::Rgba8;
        let _copy = pf;
        assert_eq!(pf, PixelFormat::Rgba8);
        assert_eq!(pf.bytes_per_pixel(), 4);
    }
}
