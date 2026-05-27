//! Batch-generate per-scene illustration assets via the `image-gen`
//! backend.
//!
//! Given a [`Brief`] whose scenes have an `illustration_prompt`
//! (typically populated by [`script_synth::synthesize_script`]), this
//! module fans out one Recraft v3 call per scene, capped at a small
//! concurrency limit so we don't hammer the provider's rate ceiling.
//!
//! Failures are intentionally non-fatal: a single scene that 5xx's
//! does not poison the whole brief. The result is a
//! [`SceneAssetsBundle`] of `(scene_id → GeneratedImage)` for the
//! scenes that succeeded, plus the total cost in USD micros (so the
//! engine's usage log can charge the principal once for the whole
//! bundle), plus a list of `(scene_id → ImageGenError)` for the
//! orchestrator to log + degrade-gracefully on (text-only scene).
//!
//! Sub-beats reuse their parent's asset — we don't generate one image
//! per sub-beat because they're framed against the same plate by
//! design (see [`brief::SceneScript::sub_beats`] docs).
//!
//! ```ignore
//! use std::sync::Arc;
//! use motion_forge_image_gen::backend_from_env;
//! use motion_forge_prompt_orchestrator::{
//!     brief::Brief,
//!     scene_assets::generate_scene_assets,
//! };
//!
//! let image_gen = backend_from_env()?;
//! let assets = generate_scene_assets(&brief, image_gen.as_ref(), 1820, 1024).await;
//! tracing::info!(cost = assets.total_cost_micros, "scene assets ready");
//! ```
//!
//! ## Why fan-out (not sequential)?
//!
//! Recraft v3 takes 5-15 s per image. A 12-scene brief sequential is
//! ~2 minutes of wall time; concurrent-4 brings that to ~30 s. The
//! cap of 4 keeps us well under Recraft's 60 req/min rate ceiling
//! with room for retries.
//!
//! ## Sizing
//!
//! Composition dims (`comp_w` × `comp_h`) are passed through to
//! Recraft so the asset matches the target Lottie canvas aspect.
//! Recraft snaps to a discrete supported size (handled inside the
//! backend).

use crate::brief::{Brief, SceneScript};
use futures::stream::{self, StreamExt};
use motion_forge_image_gen::{GeneratedImage, ImageGen, ImageGenError, ImageRequest};
use std::collections::HashMap;

/// Per-brief concurrency cap for image-gen fan-out. Tuned for Recraft
/// v3's ~60 req/min ceiling — 4 concurrent leaves headroom for retries
/// and other concurrent briefs from the same key.
const DEFAULT_CONCURRENCY: usize = 4;

/// Result of generating a full brief's illustration bundle.
#[derive(Debug, Default)]
pub struct SceneAssetsBundle {
    /// `scene_id → GeneratedImage` for the scenes that succeeded.
    pub assets: HashMap<String, GeneratedImage>,
    /// `scene_id → error message` for the scenes that failed. The
    /// orchestrator should fall back to a text-only render for these.
    pub errors: HashMap<String, String>,
    /// Sum of `cost_micros` across every successful generation. The
    /// engine logs this once per brief so the principal is charged
    /// atomically rather than per scene.
    pub total_cost_micros: u64,
    /// Provider that produced these assets (`"recraft"` etc). Same
    /// for the whole bundle since we only run one backend at a time.
    pub provider: String,
}

impl SceneAssetsBundle {
    /// True when at least one scene has a generated illustration.
    /// Lets the orchestrator pick the generative path vs the legacy
    /// LLM-only path without a separate flag.
    pub fn has_any(&self) -> bool {
        !self.assets.is_empty()
    }
}

/// Generate one illustration per top-level scene that has an
/// `illustration_prompt` (or `visual` as fallback when the LLM didn't
/// supply a polished prompt). Returns a [`SceneAssetsBundle`].
pub async fn generate_scene_assets(
    brief: &Brief,
    image_gen: &dyn ImageGen,
    comp_w: u32,
    comp_h: u32,
) -> SceneAssetsBundle {
    generate_scene_assets_with_concurrency(brief, image_gen, comp_w, comp_h, DEFAULT_CONCURRENCY)
        .await
}

/// Same as [`generate_scene_assets`] but lets the caller override the
/// fan-out cap (useful for tests that want sequential execution).
pub async fn generate_scene_assets_with_concurrency(
    brief: &Brief,
    image_gen: &dyn ImageGen,
    comp_w: u32,
    comp_h: u32,
    concurrency: usize,
) -> SceneAssetsBundle {
    let jobs: Vec<(String, ImageRequest)> = brief
        .scenes
        .iter()
        .filter_map(|s| build_request(s, comp_w, comp_h).map(|r| (s.id.clone(), r)))
        .collect();

    if jobs.is_empty() {
        return SceneAssetsBundle {
            provider: image_gen.name().into(),
            ..Default::default()
        };
    }

    let results: Vec<(String, Result<GeneratedImage, ImageGenError>)> = stream::iter(jobs)
        .map(|(id, req)| async move {
            let res = image_gen.generate(&req).await;
            (id, res)
        })
        .buffer_unordered(concurrency.max(1))
        .collect()
        .await;

    let mut bundle = SceneAssetsBundle {
        provider: image_gen.name().into(),
        ..Default::default()
    };
    for (id, res) in results {
        match res {
            Ok(img) => {
                bundle.total_cost_micros = bundle.total_cost_micros.saturating_add(img.cost_micros);
                bundle.assets.insert(id, img);
            }
            Err(e) => {
                tracing::warn!(scene_id = %id, error = %e, "scene illustration failed; will degrade to text-only");
                bundle.errors.insert(id, e.to_string());
            }
        }
    }

    tracing::info!(
        scenes_total = brief.scenes.len(),
        assets_generated = bundle.assets.len(),
        assets_failed = bundle.errors.len(),
        cost_micros = bundle.total_cost_micros,
        provider = %bundle.provider,
        "scene assets bundle ready"
    );

    bundle
}

/// Build the per-scene image request. Prefers `illustration_prompt`
/// (set by the scene decomposer); falls back to `visual` so legacy
/// hand-authored briefs still get an asset even if the user never
/// ran them through the LLM script synth path. Returns `None` if
/// neither field has usable content.
fn build_request(scene: &SceneScript, comp_w: u32, comp_h: u32) -> Option<ImageRequest> {
    let prompt = scene
        .illustration_prompt
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            let v = scene.visual.trim();
            (!v.is_empty()).then_some(v)
        })?;
    Some(ImageRequest::new(prompt).with_dims(comp_w, comp_h))
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;

    /// Stub backend that returns a canned SVG and records every call.
    struct StubBackend {
        calls: Mutex<Vec<String>>,
        // When set, the Nth call (0-indexed) returns Err to exercise
        // the error path without poisoning the bundle.
        fail_nth: Option<usize>,
    }

    impl StubBackend {
        fn new() -> Self {
            Self {
                calls: Mutex::new(Vec::new()),
                fail_nth: None,
            }
        }
        fn with_failure_at(mut self, n: usize) -> Self {
            self.fail_nth = Some(n);
            self
        }
    }

    #[async_trait]
    impl ImageGen for StubBackend {
        fn name(&self) -> &str {
            "stub"
        }
        async fn generate(&self, req: &ImageRequest) -> Result<GeneratedImage, ImageGenError> {
            let mut calls = self.calls.lock().unwrap();
            let idx = calls.len();
            calls.push(req.prompt.clone());
            if Some(idx) == self.fail_nth {
                return Err(ImageGenError::Provider("synthetic failure".into()));
            }
            Ok(GeneratedImage {
                bytes: b"<svg/>".to_vec(),
                content_type: "image/svg+xml".into(),
                provider: "stub".into(),
                cost_micros: 40_000,
            })
        }
    }

    fn brief_with(prompts: &[(&str, Option<&str>, &str)]) -> Brief {
        Brief {
            scenes: prompts
                .iter()
                .map(|(id, ill, vis)| SceneScript {
                    id: (*id).into(),
                    vo: None,
                    visual: (*vis).into(),
                    illustration_prompt: ill.map(|s| s.to_string()),
                    sub_beats: Vec::new(),
                })
                .collect(),
            language: crate::brief::Lang::English,
            total_duration_sec: Some(15.0),
        }
    }

    #[tokio::test]
    async fn happy_path_generates_one_asset_per_scene_and_sums_cost() {
        let brief = brief_with(&[
            (
                "1.0",
                Some("isometric office, flat vector"),
                "wide shot of office",
            ),
            (
                "2.0",
                Some("calendar pages flying, flat vector"),
                "calendar montage",
            ),
        ]);
        let backend = StubBackend::new();
        let bundle = generate_scene_assets_with_concurrency(&brief, &backend, 1024, 1024, 2).await;
        assert_eq!(bundle.assets.len(), 2);
        assert!(bundle.errors.is_empty());
        assert_eq!(bundle.total_cost_micros, 80_000);
        assert_eq!(bundle.provider, "stub");
        assert!(bundle.has_any());
    }

    #[tokio::test]
    async fn falls_back_to_visual_when_illustration_prompt_missing() {
        let brief = brief_with(&[("1.0", None, "wide shot of a desk")]);
        let backend = StubBackend::new();
        let bundle = generate_scene_assets_with_concurrency(&brief, &backend, 1024, 1024, 1).await;
        assert_eq!(bundle.assets.len(), 1);
        let calls = backend.calls.lock().unwrap();
        assert_eq!(calls[0], "wide shot of a desk");
    }

    #[tokio::test]
    async fn skips_scenes_with_no_prompt_and_no_visual() {
        let brief = brief_with(&[("1.0", None, "")]);
        let backend = StubBackend::new();
        let bundle = generate_scene_assets_with_concurrency(&brief, &backend, 1024, 1024, 1).await;
        assert!(bundle.assets.is_empty());
        assert!(bundle.errors.is_empty());
        assert_eq!(bundle.total_cost_micros, 0);
        assert!(!bundle.has_any());
    }

    #[tokio::test]
    async fn one_failure_does_not_poison_the_other_scenes() {
        let brief = brief_with(&[
            ("1.0", Some("a"), ""),
            ("2.0", Some("b"), ""),
            ("3.0", Some("c"), ""),
        ]);
        // Force the 2nd call (idx=1) to fail.
        let backend = StubBackend::new().with_failure_at(1);
        // Sequential so the failure index is deterministic.
        let bundle = generate_scene_assets_with_concurrency(&brief, &backend, 1024, 1024, 1).await;
        assert_eq!(bundle.assets.len(), 2);
        assert_eq!(bundle.errors.len(), 1);
        assert_eq!(bundle.total_cost_micros, 80_000); // 2 successes × 40_000
        // The failure was recorded against scene 2.0 in this ordering.
        assert!(bundle.errors.contains_key("2.0"));
    }
}
