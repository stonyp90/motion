//! End-to-end DAG orchestration: reference video + prompt → Lottie + MP4.
//!
//! Two top-level entry points:
//! - [`Pipeline::run_full`] — runs Phase 2-6 from scratch on a reference
//!   video. Persists every intermediate (segmentation, scenes, sprites,
//!   style.json, theme.json) under `work_dir` so iterations can replay.
//! - [`Pipeline::run_iterate`] — skips Phase 2-4 by reading cached state
//!   from a prior `run_full` and only re-runs Phase 5 (LLM) and optionally
//!   Phase 6 (render). Targets sub-30s iteration cycles.

use anyhow::{Context, Result};
use motion_forge_decompose::{
    SceneSplitter, SpriteDecomposer,
    python_sidecar_adapter::{BboxCropSpriteDecomposer, PySceneDetectSplitter},
};
use motion_forge_lottie_gen::{LottieGenerator, SerdeLottieGenerator};
use motion_forge_prompt_orchestrator::{
    LottieTimeline, PromptOrchestrator, fallback_timeline, llm,
};
use motion_forge_render::{RenderConfig, Renderer, python_sidecar_adapter::PythonLottieRenderer};
use motion_forge_segment::Segmenter;
use motion_forge_segment::python_sidecar_adapter::PythonSidecarSegmenter;
use motion_forge_style_extract::{
    StyleCard, StyleExtractor, Theme, oklab_adapter::OklabStyleExtractor, write_card,
};
use motion_forge_video_io::Codec;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct Composition {
    pub width: u32,
    pub height: u32,
    pub frame_rate: f32,
}

impl Default for Composition {
    fn default() -> Self {
        Self {
            width: 1920,
            height: 1080,
            frame_rate: 30.0,
        }
    }
}

#[derive(Debug, Clone)]
pub struct GenerateConfig {
    pub reference_video: PathBuf,
    pub prompt: String,
    pub theme: Option<Theme>,
    pub composition: Composition,
    pub duration_seconds: f32,
    pub work_dir: PathBuf,
    pub output_lottie: PathBuf,
    pub output_video: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct IterateConfig {
    pub work_dir: PathBuf,
    pub prompt: String,
    pub theme: Option<Theme>,
    pub composition_override: Option<Composition>,
    pub duration_seconds: Option<f32>,
    pub output_lottie: PathBuf,
    pub output_video: Option<PathBuf>,
}

#[derive(Debug, Clone)]
pub struct GenerateResult {
    pub timeline: LottieTimeline,
    pub style_card: StyleCard,
    pub work_dir: PathBuf,
    pub output_lottie: PathBuf,
    pub output_video: Option<PathBuf>,
    pub backend_name: String,
}

pub struct Pipeline;

impl Pipeline {
    pub fn new() -> Self {
        Self
    }

    /// Phase 2-6 from a reference video. Persists intermediates so a later
    /// [`Pipeline::run_iterate`] against the same `work_dir` skips Phase 2-4.
    pub async fn run_full(&self, mut config: GenerateConfig) -> Result<GenerateResult> {
        // Theme can override composition + duration if the user didn't pass them.
        if let Some(t) = &config.theme {
            if config.composition.width == 0 {
                config.composition.width = t.composition.width;
            }
            if config.composition.height == 0 {
                config.composition.height = t.composition.height;
            }
            if config.composition.frame_rate == 0.0 {
                config.composition.frame_rate = t.composition.frame_rate;
            }
            if config.duration_seconds == 0.0 {
                config.duration_seconds = t.default_duration_seconds;
            }
        }
        if config.composition.width == 0 {
            config.composition = Composition::default();
        }
        if config.duration_seconds == 0.0 {
            config.duration_seconds = 6.0;
        }

        std::fs::create_dir_all(&config.work_dir)
            .with_context(|| format!("creating work-dir {}", config.work_dir.display()))?;

        let seg_dir = config.work_dir.join("segmentation");
        let scenes_dir = config.work_dir.join("scenes");
        let sprites_dir = config.work_dir.join("sprites");
        let style_path = config.work_dir.join("style.json");
        let theme_path = config.work_dir.join("theme.json");
        let pipeline_meta_path = config.work_dir.join("pipeline.json");

        tracing::info!(
            reference = %config.reference_video.display(),
            work_dir = %config.work_dir.display(),
            duration = config.duration_seconds,
            width = config.composition.width,
            height = config.composition.height,
            fps = config.composition.frame_rate,
            theme = config.theme.as_ref().map(|t| t.slug.as_str()).unwrap_or("none"),
            "starting full pipeline"
        );

        // Phase 2: segmentation
        let mut seg = PythonSidecarSegmenter::default_in_workspace();
        let seg_manifest = seg.segment_video(&config.reference_video, &seg_dir)?;
        tracing::info!(
            masks = seg_manifest.total_masks(),
            "phase 2 (segmentation) ok"
        );

        // Phase 3: scenes + sprites
        let mut splitter = PySceneDetectSplitter::default();
        let scene_manifest = splitter.split(&config.reference_video, &scenes_dir)?;
        tracing::info!(
            shots = scene_manifest.boundaries.len(),
            "phase 3a (scenes) ok"
        );

        let mut decomposer = BboxCropSpriteDecomposer;
        let sprite_manifest = decomposer.decompose(
            &config.reference_video,
            &seg_dir.join("manifest.json"),
            &sprites_dir,
        )?;
        tracing::info!(
            sprites = sprite_manifest.sprite_count,
            "phase 3b (sprites) ok"
        );

        // Phase 4: style extraction (+ theme overlay)
        let mut extractor = OklabStyleExtractor::default();
        let mut card = extractor.extract(&scene_manifest, &sprite_manifest)?;
        if let Some(t) = &config.theme {
            t.overlay(&mut card);
            let body = serde_json::to_string_pretty(t)?;
            std::fs::write(&theme_path, body)
                .with_context(|| format!("writing {}", theme_path.display()))?;
        }
        write_card(&card, &style_path)?;
        tracing::info!(
            swatches = card.palette.len(),
            shots = card.shot_rhythm.shot_count,
            style_path = %style_path.display(),
            "phase 4 (style card) ok"
        );

        // Phase 5: prompt → timeline
        let (timeline, backend_name) = orchestrate(
            &config.prompt,
            &card,
            &PromptParams {
                composition: config.composition.clone(),
                duration_seconds: config.duration_seconds,
                theme_addendum: config
                    .theme
                    .as_ref()
                    .map(|t| t.system_prompt_addendum.clone()),
            },
        )
        .await?;

        // Persist pipeline meta for iterate.
        let meta = PipelineMeta {
            reference_video: config.reference_video.clone(),
            composition: config.composition.clone(),
            duration_seconds: config.duration_seconds,
            backend_name: backend_name.clone(),
        };
        std::fs::write(&pipeline_meta_path, serde_json::to_string_pretty(&meta)?)?;

        SerdeLottieGenerator::new().write(&timeline, &config.output_lottie)?;
        tracing::info!(out = %config.output_lottie.display(), "lottie written");

        let mut output_video: Option<PathBuf> = None;
        if let Some(video_out) = &config.output_video {
            render_to_mp4(&config.output_lottie, video_out, &config.composition)?;
            tracing::info!(out = %video_out.display(), "mp4 rendered");
            output_video = Some(video_out.clone());
        }

        Ok(GenerateResult {
            timeline,
            style_card: card,
            work_dir: config.work_dir,
            output_lottie: config.output_lottie,
            output_video,
            backend_name,
        })
    }

    /// Fast iteration: re-prompt against a cached work-dir, skipping
    /// Phase 2-4 entirely.
    pub async fn run_iterate(&self, config: IterateConfig) -> Result<GenerateResult> {
        let style_path = config.work_dir.join("style.json");
        let meta_path = config.work_dir.join("pipeline.json");
        let theme_path = config.work_dir.join("theme.json");

        if !style_path.exists() {
            anyhow::bail!(
                "no cached style.json in {} — run `generate` first",
                config.work_dir.display()
            );
        }

        let style_body = std::fs::read_to_string(&style_path)
            .with_context(|| format!("reading {}", style_path.display()))?;
        let mut card: StyleCard = serde_json::from_str(&style_body)?;

        let meta: PipelineMeta = if meta_path.exists() {
            serde_json::from_str(&std::fs::read_to_string(&meta_path)?)?
        } else {
            PipelineMeta {
                reference_video: PathBuf::new(),
                composition: Composition::default(),
                duration_seconds: 6.0,
                backend_name: "unknown".into(),
            }
        };

        // Theme precedence for iterate:
        //   - explicit `config.theme` from this call wins
        //   - else cached `theme.json` from the prior generate
        // Composition / duration precedence:
        //   - explicit CLI flags (composition_override / duration_seconds) win
        //   - else, if a NEW theme is being applied this iteration, use the
        //     new theme's composition + default_duration_seconds (so a
        //     `--theme playful` re-frames to 1080x1920@30fps even when the
        //     original generate used a 1920x1080 theme)
        //   - else fall back to cached pipeline.json meta
        let cached_theme: Option<Theme> = if theme_path.exists() {
            serde_json::from_str(&std::fs::read_to_string(&theme_path)?).ok()
        } else {
            None
        };
        let new_theme = config.theme;
        let effective_theme = new_theme.clone().or(cached_theme);

        let composition = if let Some(c) = config.composition_override {
            c
        } else if let Some(t) = &new_theme {
            Composition {
                width: t.composition.width,
                height: t.composition.height,
                frame_rate: t.composition.frame_rate,
            }
        } else {
            meta.composition
        };
        let duration = config
            .duration_seconds
            .or_else(|| new_theme.as_ref().map(|t| t.default_duration_seconds))
            .unwrap_or(meta.duration_seconds);

        if let Some(t) = &effective_theme {
            t.overlay(&mut card);
        }

        let (timeline, backend_name) = orchestrate(
            &config.prompt,
            &card,
            &PromptParams {
                composition: composition.clone(),
                duration_seconds: duration,
                theme_addendum: effective_theme
                    .as_ref()
                    .map(|t| t.system_prompt_addendum.clone()),
            },
        )
        .await?;

        SerdeLottieGenerator::new().write(&timeline, &config.output_lottie)?;
        tracing::info!(out = %config.output_lottie.display(), "iterate: lottie written");

        let mut output_video: Option<PathBuf> = None;
        if let Some(video_out) = &config.output_video {
            render_to_mp4(&config.output_lottie, video_out, &composition)?;
            tracing::info!(out = %video_out.display(), "iterate: mp4 rendered");
            output_video = Some(video_out.clone());
        }

        Ok(GenerateResult {
            timeline,
            style_card: card,
            work_dir: config.work_dir,
            output_lottie: config.output_lottie,
            output_video,
            backend_name,
        })
    }
}

impl Default for Pipeline {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct PipelineMeta {
    reference_video: PathBuf,
    composition: Composition,
    duration_seconds: f32,
    backend_name: String,
}

impl serde::Serialize for Composition {
    fn serialize<S: serde::Serializer>(&self, ser: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = ser.serialize_struct("Composition", 3)?;
        s.serialize_field("width", &self.width)?;
        s.serialize_field("height", &self.height)?;
        s.serialize_field("frame_rate", &self.frame_rate)?;
        s.end()
    }
}

impl<'de> serde::Deserialize<'de> for Composition {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        #[derive(serde::Deserialize)]
        struct Raw {
            width: u32,
            height: u32,
            frame_rate: f32,
        }
        let r = Raw::deserialize(d)?;
        Ok(Self {
            width: r.width,
            height: r.height,
            frame_rate: r.frame_rate,
        })
    }
}

struct PromptParams {
    composition: Composition,
    duration_seconds: f32,
    theme_addendum: Option<String>,
}

async fn orchestrate(
    prompt: &str,
    card: &StyleCard,
    p: &PromptParams,
) -> Result<(LottieTimeline, String)> {
    let canned = serde_json::to_string(&fallback_timeline(
        prompt,
        card,
        p.composition.width,
        p.composition.height,
        p.composition.frame_rate,
        p.duration_seconds,
    ))?;
    let backend = llm::auto_local_first(&canned).await;
    let backend_name = backend.name().to_string();

    let mut orch = PromptOrchestrator::new(Arc::from(backend))
        .with_composition(
            p.composition.width,
            p.composition.height,
            p.composition.frame_rate,
        )
        .with_duration(p.duration_seconds);
    if let Some(addendum) = &p.theme_addendum {
        orch = orch.with_system_addendum(addendum);
    }

    // Cap the LLM call so a slow/broken model can't hold iterate hostage.
    // Default 90s — generous for a quality model, snappy for "Ollama is
    // running but the loaded model produces garbage" failure modes.
    let timeout_secs: u64 = std::env::var("MOTION_FORGE_LLM_TIMEOUT_SEC")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(90);
    let timeout = std::time::Duration::from_secs(timeout_secs);

    let timeline = match tokio::time::timeout(timeout, orch.orchestrate(prompt, card)).await {
        Ok(Ok(t)) => t,
        Ok(Err(e)) => {
            tracing::warn!(
                backend = %backend_name,
                error = %e,
                "LLM call failed; using deterministic fallback"
            );
            fallback_timeline(
                prompt,
                card,
                p.composition.width,
                p.composition.height,
                p.composition.frame_rate,
                p.duration_seconds,
            )
        }
        Err(_elapsed) => {
            tracing::warn!(
                backend = %backend_name,
                timeout_secs,
                "LLM call exceeded MOTION_FORGE_LLM_TIMEOUT_SEC; using deterministic fallback"
            );
            fallback_timeline(
                prompt,
                card,
                p.composition.width,
                p.composition.height,
                p.composition.frame_rate,
                p.duration_seconds,
            )
        }
    };
    Ok((timeline, backend_name))
}

fn render_to_mp4(lottie: &Path, out: &Path, comp: &Composition) -> Result<()> {
    let mut r = PythonLottieRenderer::default_in_workspace();
    let config = RenderConfig {
        width: comp.width,
        height: comp.height,
        frame_rate: comp.frame_rate as f64,
        bitrate_kbps: 6000,
        codec: Codec::H264,
    };
    r.render(lottie, out, &config)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn composition_default_is_1080p_30() {
        let c = Composition::default();
        assert_eq!(c.width, 1920);
        assert_eq!(c.height, 1080);
        assert!((c.frame_rate - 30.0).abs() < 0.01);
    }

    #[test]
    fn pipeline_meta_round_trips_serde() {
        let m = PipelineMeta {
            reference_video: PathBuf::from("ref.mp4"),
            composition: Composition::default(),
            duration_seconds: 12.5,
            backend_name: "mock".into(),
        };
        let j = serde_json::to_string(&m).unwrap();
        let back: PipelineMeta = serde_json::from_str(&j).unwrap();
        assert!((back.duration_seconds - 12.5).abs() < 0.01);
    }
}
