//! Adapter that shells to `scripts/segment_video.py`.
//!
//! Picked as the default adapter because:
//! - ultralytics (YOLO11 + SAM 2 wrappers) is on PyPI and downloads its
//!   own weights from a trusted CDN.
//! - ort 2.x is still RC with build-blocking dep drift, so an in-process
//!   Rust adapter isn't viable today.
//! - The sidecar process boundary maps cleanly onto our hexagonal port:
//!   the same `Segmenter` trait can later get a `ort_adapter` or
//!   `candle_adapter` without disturbing callers.

use crate::{SegmentationManifest, Segmenter};
use anyhow::{Context, Result, anyhow};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

#[derive(Debug, Clone)]
pub enum Backend {
    /// YOLO11n-seg (or sibling). Fast, COCO-class instance segmentation
    /// with BoT-SORT tracking. Default.
    Yolo { model: String },
    /// SAM 2 Tiny driven by a coarse point-prompt grid per frame.
    /// Class-agnostic; useful for motion design where COCO classes don't
    /// apply.
    Sam2 { model: String, point_grid: u32 },
}

impl Default for Backend {
    fn default() -> Self {
        // SAM 2 Tiny is class-agnostic — better default for motion design
        // where COCO classes don't apply. Switch to YOLO when you need
        // tracked instance IDs for COCO-class subjects.
        // point_grid=6 (36 prompts/frame) keeps inference under a minute
        // on a 60-frame fixture on M3 CPU; bump higher for production.
        Backend::Sam2 {
            model: "sam2.1_t.pt".into(),
            point_grid: 6,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PythonSidecarSegmenter {
    pub python_bin: PathBuf,
    pub script_path: PathBuf,
    pub backend: Backend,
}

impl PythonSidecarSegmenter {
    /// Default-path constructor: assumes the workspace layout
    /// (`.venv/bin/python` + `scripts/segment_video.py`) relative to the
    /// repository root. Resolves the repo root via `CARGO_MANIFEST_DIR`
    /// at build time.
    pub fn default_in_workspace() -> Self {
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));
        Self {
            python_bin: repo.join(".venv/bin/python"),
            script_path: repo.join("scripts/segment_video.py"),
            backend: Backend::default(),
        }
    }

    pub fn with_backend(mut self, backend: Backend) -> Self {
        self.backend = backend;
        self
    }
}

impl Segmenter for PythonSidecarSegmenter {
    fn segment_video(
        &mut self,
        video_path: &Path,
        work_dir: &Path,
    ) -> Result<SegmentationManifest> {
        if !self.python_bin.exists() {
            return Err(anyhow!(
                "python interpreter not found at {}; create the venv (see README)",
                self.python_bin.display()
            ));
        }
        if !self.script_path.exists() {
            return Err(anyhow!(
                "sidecar script not found at {}",
                self.script_path.display()
            ));
        }
        std::fs::create_dir_all(work_dir).context("creating segmentation work dir")?;

        let mut cmd = Command::new(&self.python_bin);
        cmd.arg(&self.script_path)
            .arg("--input")
            .arg(video_path)
            .arg("--out-dir")
            .arg(work_dir);

        match &self.backend {
            Backend::Yolo { model } => {
                cmd.args(["--backend", "yolo", "--model", model]);
            }
            Backend::Sam2 { model, point_grid } => {
                cmd.args(["--backend", "sam2", "--model", model, "--point-grid"]);
                cmd.arg(point_grid.to_string());
            }
        }

        // stderr -> inherit so tqdm progress prints live and doesn't fill
        // a pipe buffer (the cause of the prior 20+ min hangs).
        cmd.stdout(Stdio::null()).stderr(Stdio::inherit());
        tracing::info!(cmd = ?cmd, "spawning segmentation sidecar");
        let status = cmd
            .status()
            .with_context(|| format!("spawning python sidecar: {:?}", self.python_bin))?;
        if !status.success() {
            return Err(anyhow!(
                "segmentation sidecar exited with status {:?}",
                status.code()
            ));
        }

        let manifest_path = work_dir.join("manifest.json");
        let raw = std::fs::read_to_string(&manifest_path)
            .with_context(|| format!("reading manifest {}", manifest_path.display()))?;
        let mut manifest: SegmentationManifest = serde_json::from_str(&raw)
            .with_context(|| format!("parsing manifest {}", manifest_path.display()))?;
        manifest.work_dir = work_dir.to_path_buf();
        Ok(manifest)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_video() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/sample.mp4")
    }

    #[test]
    #[ignore = "needs venv + ultralytics; run with `cargo test -- --ignored`"]
    fn yolo_backend_round_trip() {
        let video = fixture_video();
        if !video.exists() {
            eprintln!("skipping; missing fixture {}", video.display());
            return;
        }
        let mut seg = PythonSidecarSegmenter::default_in_workspace().with_backend(Backend::Yolo {
            model: "yolo11n-seg.pt".into(),
        });
        if !seg.python_bin.exists() {
            eprintln!("skipping; venv not set up at {}", seg.python_bin.display());
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        let manifest = seg
            .segment_video(&video, tmp.path())
            .expect("yolo segmentation");
        assert_eq!(manifest.backend, "yolo");
        assert!(manifest.width > 0 && manifest.height > 0);
        assert!(!manifest.frames.is_empty());
    }
}
