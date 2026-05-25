//! Per-frame instance segmentation + temporal tracking.
//!
//! The port is video-level (`segment_video`) so adapters can choose
//! whether to run frame-by-frame (ort, candle, tract) or batch the
//! whole video (python sidecar shelling to ultralytics / SAM 2). Either
//! way the output shape is identical.
//!
//! Default adapter: [`python_sidecar_adapter::PythonSidecarSegmenter`]
//! (YOLO11n-seg with BoT-SORT tracking by default; SAM 2 Tiny via the
//! `--backend sam2` flag).
//! Future adapter slots: [`sam2_adapter`], [`xmem_adapter`] for
//! direct-Rust inference when ort stabilizes.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Stable ID assigned by the tracker; consistent across frames for the same object.
pub type ObjectId = i64;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct BoundingBox {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// Single-object mask in a single frame.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObjectMask {
    pub object_id: ObjectId,
    pub bbox: BoundingBox,
    /// Relative path to a PNG mask file inside the manifest's working directory.
    pub mask_path: String,
    pub confidence: f32,
    pub class_name: String,
}

/// Per-frame collection of masks.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrameMasks {
    #[serde(rename = "index")]
    pub frame_index: u64,
    pub masks: Vec<ObjectMask>,
}

/// Full result of segmenting one video.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SegmentationManifest {
    pub backend: String,
    pub model: String,
    pub width: u32,
    pub height: u32,
    pub frame_rate: f64,
    pub frames: Vec<FrameMasks>,
    /// Absolute directory holding `masks/` referenced by each `ObjectMask`.
    #[serde(skip)]
    pub work_dir: std::path::PathBuf,
}

impl SegmentationManifest {
    pub fn total_masks(&self) -> usize {
        self.frames.iter().map(|f| f.masks.len()).sum()
    }
}

/// Port for video segmentation. Adapters may run any backend (ort,
/// Python sidecar, Apple Vision, Candle) so long as they fill the
/// manifest shape.
pub trait Segmenter {
    fn segment_video(&mut self, video_path: &Path, work_dir: &Path)
    -> Result<SegmentationManifest>;
}

pub mod python_sidecar_adapter;

pub mod sam2_adapter {
    //! Future in-process SAM 2 via `ort` + ONNX. See module docs in [`crate`].
    use super::*;

    pub struct Sam2Segmenter;
    impl Sam2Segmenter {
        pub fn load(_model_path: &std::path::Path) -> Result<Self> {
            anyhow::bail!(
                "ort-based SAM 2 adapter pending ort 2.x stabilization; use python_sidecar_adapter for now"
            )
        }
    }
}

pub mod xmem_adapter {
    //! Future XMem++ tracker for long-form mask propagation.
    use super::*;

    pub struct XMemTracker;
    impl XMemTracker {
        pub fn load(_model_path: &std::path::Path) -> Result<Self> {
            anyhow::bail!(
                "XMem++ tracker pending; the default python_sidecar_adapter relies on BoT-SORT (YOLO) or SAM 2's built-in memory"
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manifest_roundtrips_serde() {
        let m = SegmentationManifest {
            backend: "yolo".into(),
            model: "yolo11n-seg.pt".into(),
            width: 640,
            height: 360,
            frame_rate: 30.0,
            frames: vec![FrameMasks {
                frame_index: 0,
                masks: vec![ObjectMask {
                    object_id: 1,
                    bbox: BoundingBox {
                        x: 0,
                        y: 0,
                        w: 100,
                        h: 50,
                    },
                    mask_path: "masks/frame_000000_obj_0001.png".into(),
                    confidence: 0.9,
                    class_name: "person".into(),
                }],
            }],
            work_dir: std::path::PathBuf::new(),
        };
        let j = serde_json::to_string(&m).unwrap();
        let back: SegmentationManifest = serde_json::from_str(&j).unwrap();
        assert_eq!(back.total_masks(), 1);
        assert_eq!(back.frames[0].masks[0].class_name, "person");
    }
}
