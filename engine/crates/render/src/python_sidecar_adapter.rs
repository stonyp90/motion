//! Adapter that shells to `scripts/render_lottie.py`. The script uses
//! the `lottie` Python package + cairo + opencv to rasterize and
//! assemble.

use crate::{RenderConfig, Renderer};
use anyhow::{Context, Result, anyhow};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."))
}

#[derive(Debug, Clone)]
pub struct PythonLottieRenderer {
    pub python_bin: PathBuf,
    pub script_path: PathBuf,
}

impl PythonLottieRenderer {
    pub fn default_in_workspace() -> Self {
        let repo = repo_root();
        Self {
            python_bin: repo.join(".venv/bin/python"),
            script_path: repo.join("scripts/render_lottie.py"),
        }
    }
}

impl Renderer for PythonLottieRenderer {
    fn render(&mut self, lottie: &Path, out: &Path, config: &RenderConfig) -> Result<()> {
        if !self.python_bin.exists() {
            return Err(anyhow!(
                "python interpreter not found at {}; run scripts/setup-python.sh",
                self.python_bin.display()
            ));
        }
        if !self.script_path.exists() {
            return Err(anyhow!(
                "render script not found at {}",
                self.script_path.display()
            ));
        }
        if let Some(parent) = out.parent() {
            std::fs::create_dir_all(parent).context("creating output directory")?;
        }

        let width = config.width.to_string();
        let height = config.height.to_string();
        let fps = format!("{}", config.frame_rate);
        let mut cmd = Command::new(&self.python_bin);
        cmd.arg(&self.script_path)
            .arg("--input")
            .arg(lottie)
            .arg("--output")
            .arg(out)
            .args(["--width", &width, "--height", &height, "--fps", &fps]);

        cmd.stdout(Stdio::null()).stderr(Stdio::inherit());
        tracing::info!(cmd = ?cmd, "spawning render sidecar");
        let status = cmd
            .status()
            .with_context(|| format!("spawning {:?}", self.python_bin))?;
        if !status.success() {
            return Err(anyhow!(
                "render sidecar exited with status {:?}",
                status.code()
            ));
        }
        Ok(())
    }
}
