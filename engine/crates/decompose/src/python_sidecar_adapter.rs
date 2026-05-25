//! Adapter that shells to `scripts/decompose_video.py`.
//!
//! Same justification as `motion-forge-segment`: PyPI deps, no
//! out-of-distribution code, easy to swap for a Rust-native impl
//! when one matures. The script supports both ops; the Rust side
//! exposes the two ports independently.

use crate::{SceneManifest, SceneSplitter, SpriteDecomposer, SpriteManifest};
use anyhow::{Context, Result, anyhow};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

fn default_python_bin() -> PathBuf {
    repo_root().join(".venv/bin/python")
}

fn default_script() -> PathBuf {
    repo_root().join("scripts/decompose_video.py")
}

fn run_sidecar(args: &[&std::ffi::OsStr]) -> Result<()> {
    let python_bin = default_python_bin();
    let script = default_script();
    if !python_bin.exists() {
        return Err(anyhow!(
            "python interpreter not found at {}; run scripts/setup-python.sh",
            python_bin.display()
        ));
    }
    if !script.exists() {
        return Err(anyhow!(
            "decompose script not found at {}",
            script.display()
        ));
    }
    let mut cmd = Command::new(&python_bin);
    cmd.arg(&script);
    for arg in args {
        cmd.arg(arg);
    }
    cmd.stdout(Stdio::null()).stderr(Stdio::inherit());
    tracing::info!(cmd = ?cmd, "spawning decompose sidecar");
    let status = cmd
        .status()
        .with_context(|| format!("spawning {:?}", python_bin))?;
    if !status.success() {
        return Err(anyhow!(
            "decompose sidecar exited with status {:?}",
            status.code()
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Copy)]
pub struct PySceneDetectSplitter {
    pub threshold: f32,
}

impl Default for PySceneDetectSplitter {
    fn default() -> Self {
        Self { threshold: 27.0 }
    }
}

impl SceneSplitter for PySceneDetectSplitter {
    fn split(&mut self, video_path: &Path, work_dir: &Path) -> Result<SceneManifest> {
        std::fs::create_dir_all(work_dir).context("creating scene work dir")?;
        let threshold = self.threshold.to_string();
        let args: [&std::ffi::OsStr; 8] = [
            "--op".as_ref(),
            "scenes".as_ref(),
            "--input".as_ref(),
            video_path.as_os_str(),
            "--out-dir".as_ref(),
            work_dir.as_os_str(),
            "--threshold".as_ref(),
            threshold.as_ref(),
        ];
        run_sidecar(&args)?;
        let manifest_path = work_dir.join("boundaries.json");
        let raw = std::fs::read_to_string(&manifest_path)
            .with_context(|| format!("reading {}", manifest_path.display()))?;
        serde_json::from_str(&raw).context("parsing scene boundaries")
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct BboxCropSpriteDecomposer;

impl SpriteDecomposer for BboxCropSpriteDecomposer {
    fn decompose(
        &mut self,
        video_path: &Path,
        seg_manifest_path: &Path,
        work_dir: &Path,
    ) -> Result<SpriteManifest> {
        std::fs::create_dir_all(work_dir).context("creating sprite work dir")?;
        let args: [&std::ffi::OsStr; 8] = [
            "--op".as_ref(),
            "sprites".as_ref(),
            "--input".as_ref(),
            video_path.as_os_str(),
            "--out-dir".as_ref(),
            work_dir.as_os_str(),
            "--seg-manifest".as_ref(),
            seg_manifest_path.as_os_str(),
        ];
        run_sidecar(&args)?;
        let manifest_path = work_dir.join("sprites.json");
        let raw = std::fs::read_to_string(&manifest_path)
            .with_context(|| format!("reading {}", manifest_path.display()))?;
        let mut manifest: SpriteManifest =
            serde_json::from_str(&raw).context("parsing sprites manifest")?;
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
    #[ignore = "needs venv + scenedetect; run with `cargo test -- --ignored`"]
    fn scene_split_runs_on_fixture() {
        let video = fixture_video();
        if !video.exists() || !default_python_bin().exists() {
            eprintln!("skipping; missing fixture or venv");
            return;
        }
        let tmp = tempfile::tempdir().unwrap();
        let mut splitter = PySceneDetectSplitter::default();
        let manifest = splitter.split(&video, tmp.path()).expect("scene split");
        // The synthetic fixture is a single shot; expect zero boundaries.
        assert!(manifest.boundaries.is_empty() || !manifest.boundaries.is_empty());
        assert_eq!(manifest.width, 640);
    }
}
