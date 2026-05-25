//! FFmpeg-CLI-via-stdio adapter. Resilient to FFmpeg point-release ABI
//! drift; sufficient for Phase 1 round-trip and as a fallback for any
//! deployment where linking against `libav*` isn't viable.
//!
//! Decoder pipes raw RGBA out of `ffmpeg -i ... -f rawvideo -pix_fmt rgba -`.
//! Encoder consumes raw RGBA on stdin and emits MP4 via libx264/libx265.

use crate::{Codec, Decoder, Encoder, EncoderConfig, Frame, PixelFormat};
use anyhow::{Context, Result, anyhow};
use ffmpeg_sidecar::child::FfmpegChild;
use ffmpeg_sidecar::command::FfmpegCommand;
use ffmpeg_sidecar::event::FfmpegEvent;
use std::io::Write;
use std::path::Path;
use std::process::ChildStdin;

/// Decoder backed by an FFmpeg subprocess streaming raw RGBA frames.
pub struct SidecarDecoder {
    width: u32,
    height: u32,
    frame_rate: f64,
    iter: ffmpeg_sidecar::iter::FfmpegIterator,
    frame_index: u64,
}

impl SidecarDecoder {
    pub fn open(path: &Path) -> Result<Self> {
        let path_str = path
            .to_str()
            .ok_or_else(|| anyhow!("input path is not valid UTF-8"))?;

        let mut ffmpeg = FfmpegCommand::new()
            .hide_banner()
            .input(path_str)
            .rawvideo()
            .spawn()
            .context("spawning ffmpeg for decode")?;

        let mut iter = ffmpeg.iter().context("iterating ffmpeg events")?;
        let mut width = 0u32;
        let mut height = 0u32;
        let mut frame_rate = 0f64;

        for event in iter.by_ref() {
            match event {
                FfmpegEvent::ParsedInputStream(stream) => {
                    if let Some(v) = stream.video_data() {
                        width = v.width;
                        height = v.height;
                        frame_rate = v.fps as f64;
                        break;
                    }
                }
                FfmpegEvent::Error(e) => {
                    return Err(anyhow!("ffmpeg error during open: {}", e));
                }
                _ => {}
            }
        }

        if width == 0 || height == 0 {
            return Err(anyhow!("could not determine video dimensions"));
        }

        Ok(Self {
            width,
            height,
            frame_rate,
            iter,
            frame_index: 0,
        })
    }
}

impl Decoder for SidecarDecoder {
    fn width(&self) -> u32 {
        self.width
    }
    fn height(&self) -> u32 {
        self.height
    }
    fn frame_rate(&self) -> f64 {
        self.frame_rate
    }

    fn next_frame(&mut self) -> Result<Option<Frame>> {
        for event in self.iter.by_ref() {
            match event {
                FfmpegEvent::OutputFrame(f) => {
                    let pts_micros =
                        ((self.frame_index as f64 / self.frame_rate) * 1_000_000.0) as i64;
                    self.frame_index += 1;
                    return Ok(Some(Frame {
                        width: f.width,
                        height: f.height,
                        pts_micros,
                        pixel_format: PixelFormat::Rgb8,
                        data: f.data,
                    }));
                }
                FfmpegEvent::Error(e) => return Err(anyhow!("ffmpeg decode error: {}", e)),
                _ => {}
            }
        }
        Ok(None)
    }
}

/// Encoder backed by an FFmpeg subprocess consuming raw RGB or RGBA frames on stdin.
pub struct SidecarEncoder {
    child: FfmpegChild,
    stdin: ChildStdin,
    expected_bytes_per_frame: usize,
}

impl SidecarEncoder {
    pub fn create(path: &Path, config: EncoderConfig) -> Result<Box<dyn Encoder>> {
        let path_str = path
            .to_str()
            .ok_or_else(|| anyhow!("output path is not valid UTF-8"))?;

        let codec_arg = match config.codec {
            Codec::H264 => "libx264",
            Codec::Hevc => "libx265",
        };
        let bitrate_arg = format!("{}k", config.bitrate_kbps);
        let size_arg = format!("{}x{}", config.width, config.height);
        let rate_arg = format!("{}", config.frame_rate);

        let mut child = FfmpegCommand::new()
            .hide_banner()
            .args(["-y", "-f", "rawvideo", "-pix_fmt", "rgb24"])
            .args(["-s", &size_arg, "-r", &rate_arg])
            .args(["-i", "-"])
            .args([
                "-c:v",
                codec_arg,
                "-pix_fmt",
                "yuv420p",
                "-b:v",
                &bitrate_arg,
            ])
            .output(path_str)
            .spawn()
            .context("spawning ffmpeg for encode")?;

        let stdin = child
            .take_stdin()
            .ok_or_else(|| anyhow!("ffmpeg encoder did not expose stdin"))?;

        Ok(Box::new(Self {
            child,
            stdin,
            expected_bytes_per_frame: (config.width as usize) * (config.height as usize) * 3,
        }))
    }
}

impl Encoder for SidecarEncoder {
    fn push_frame(&mut self, frame: &Frame) -> Result<()> {
        if frame.data.len() != self.expected_bytes_per_frame {
            return Err(anyhow!(
                "frame byte count {} does not match encoder geometry ({} expected)",
                frame.data.len(),
                self.expected_bytes_per_frame
            ));
        }
        self.stdin
            .write_all(&frame.data)
            .context("writing frame to ffmpeg encoder stdin")
    }

    fn finish(self: Box<Self>) -> Result<()> {
        let Self {
            mut child, stdin, ..
        } = *self;
        drop(stdin);
        let status = child.wait().context("waiting on ffmpeg encoder")?;
        if !status.success() {
            return Err(anyhow!(
                "ffmpeg encoder exited with status {:?}",
                status.code()
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fixture_path() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/sample.mp4")
    }

    #[test]
    fn decode_emits_frames() {
        let path = fixture_path();
        if !path.exists() {
            eprintln!("skipping; missing fixture {}", path.display());
            return;
        }
        let mut dec = SidecarDecoder::open(&path).expect("open decoder");
        assert!(dec.width() > 0 && dec.height() > 0);
        let mut count = 0u32;
        while let Some(_f) = dec.next_frame().expect("frame") {
            count += 1;
        }
        // 2-second fixture at 30 fps → ~60 frames; allow some slack for
        // codec startup / fractional duration.
        assert!(count >= 30, "expected at least 30 frames, got {}", count);
    }

    #[test]
    fn round_trip_transcode() {
        let input = fixture_path();
        if !input.exists() {
            eprintln!("skipping; missing fixture {}", input.display());
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        let output = tmp.path().join("out.mp4");

        let mut dec = SidecarDecoder::open(&input).expect("open decoder");
        let config = EncoderConfig {
            width: dec.width(),
            height: dec.height(),
            frame_rate: dec.frame_rate(),
            bitrate_kbps: 4000,
            codec: Codec::H264,
        };
        let mut enc = SidecarEncoder::create(&output, config).expect("create encoder");
        while let Some(frame) = dec.next_frame().expect("frame") {
            enc.push_frame(&frame).expect("push");
        }
        enc.finish().expect("finish");

        assert!(output.exists(), "output not written");
        let bytes = std::fs::metadata(&output).unwrap().len();
        assert!(bytes > 1024, "output suspiciously small ({} bytes)", bytes);
    }
}
