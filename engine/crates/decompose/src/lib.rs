//! Scene/shot splitting and sprite decomposition.
//!
//! Two ports, both video-level:
//! - `SceneSplitter::split` — returns shot boundaries.
//! - `SpriteDecomposer::decompose` — consumes a segmentation manifest
//!   from the `segment` crate and produces per-object sprite atlases
//!   with per-frame affine transforms.
//!
//! Default adapter for both: `python_sidecar_adapter` shelling to
//! `scripts/decompose_video.py` (PySceneDetect for scenes, the same
//! script for sprites). Future Rust-native adapters slot in alongside.

use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ShotBoundary {
    pub shot_index: u32,
    pub start_frame: u64,
    pub end_frame: u64,
    pub start_seconds: f32,
    pub end_seconds: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneManifest {
    pub width: u32,
    pub height: u32,
    pub frame_rate: f64,
    pub boundaries: Vec<ShotBoundary>,
}

/// Per-frame affine transform of one sprite into the canvas. Matches the
/// shape that Lottie's transform property consumes downstream.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct AffineKeyframe {
    pub frame_index: u64,
    pub tx: f32,
    pub ty: f32,
    pub sx: f32,
    pub sy: f32,
    pub rotation_deg: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sprite {
    pub object_id: i64,
    /// Path to the PNG atlas relative to the sprites manifest's work dir.
    pub atlas_path: String,
    pub atlas_width: u32,
    pub atlas_height: u32,
    /// Canvas-space origin of the sprite (first-frame top-left).
    pub anchor: [i32; 2],
    pub class_name: String,
    pub track: Vec<AffineKeyframe>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpriteManifest {
    pub width: u32,
    pub height: u32,
    pub frame_rate: f64,
    pub sprite_count: u32,
    pub sprites: Vec<Sprite>,
    #[serde(skip)]
    pub work_dir: std::path::PathBuf,
}

pub trait SceneSplitter {
    fn split(&mut self, video_path: &Path, work_dir: &Path) -> Result<SceneManifest>;
}

pub trait SpriteDecomposer {
    fn decompose(
        &mut self,
        video_path: &Path,
        seg_manifest_path: &Path,
        work_dir: &Path,
    ) -> Result<SpriteManifest>;
}

pub mod python_sidecar_adapter;

pub mod autoshot_adapter {
    //! Future direct-PyO3 binding to AutoShot. See module docs in [`crate`].
    use super::*;

    pub struct AutoShotSplitter;
    impl AutoShotSplitter {
        pub fn load(_model_path: &std::path::Path) -> Result<Self> {
            anyhow::bail!("AutoShot adapter pending; use python_sidecar_adapter for now")
        }
    }
}

pub mod sprite_adapter {
    //! Reserved for the Fast Sprite Decomposition (ECCV 2024) port.
    use super::*;

    pub struct FastSpriteDecomposer;
    impl FastSpriteDecomposer {
        pub fn new() -> Result<Self> {
            anyhow::bail!(
                "Fast Sprite Decomposition adapter pending; the python sidecar ships a simpler bbox-crop adapter"
            )
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scene_manifest_roundtrips_serde() {
        let m = SceneManifest {
            width: 1920,
            height: 1080,
            frame_rate: 24.0,
            boundaries: vec![ShotBoundary {
                shot_index: 0,
                start_frame: 0,
                end_frame: 48,
                start_seconds: 0.0,
                end_seconds: 2.0,
            }],
        };
        let j = serde_json::to_string(&m).unwrap();
        let back: SceneManifest = serde_json::from_str(&j).unwrap();
        assert_eq!(back.boundaries.len(), 1);
    }

    #[test]
    fn sprite_manifest_roundtrips_serde() {
        let m = SpriteManifest {
            width: 640,
            height: 360,
            frame_rate: 30.0,
            sprite_count: 1,
            sprites: vec![Sprite {
                object_id: 7,
                atlas_path: "atlases/obj_000007.png".into(),
                atlas_width: 64,
                atlas_height: 48,
                anchor: [100, 50],
                class_name: "shape".into(),
                track: vec![AffineKeyframe {
                    frame_index: 0,
                    tx: 0.0,
                    ty: 0.0,
                    sx: 1.0,
                    sy: 1.0,
                    rotation_deg: 0.0,
                }],
            }],
            work_dir: std::path::PathBuf::new(),
        };
        let j = serde_json::to_string(&m).unwrap();
        let back: SpriteManifest = serde_json::from_str(&j).unwrap();
        assert_eq!(back.sprites[0].track.len(), 1);
    }
}
