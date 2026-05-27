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
use crate::{EasingLabel, ImageAsset, Keyframe, Layer, LayerKind, LottieTimeline};
use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
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

/// Maximum length of any prompt we send to the image-gen provider.
/// Recraft truncates very long prompts and produces mediocre output;
/// we also use this as a defense against a prompt-injection attack
/// that nudges the LLM into emitting an enormous denylisted payload.
const MAX_PROMPT_CHARS: usize = 500;

/// Substring patterns we refuse to send upstream. Lowercased; matched
/// case-insensitively. Catches the most common abuse vectors that
/// would get the Recraft account banned (TOS violations: real-person
/// likeness without consent, explicit content, recognizable competitor
/// logos, weapons). Not exhaustive — adding real content moderation
/// is on the SDK provider side; this is a cheap pre-filter.
const ILLUSTRATION_DENYLIST: &[&str] = &[
    "nude",
    "naked",
    "nsfw",
    "explicit",
    "porn",
    "erotic",
    "child",
    "minor",
    "underage",
    "weapon",
    "gun",
    "firearm",
    "rifle",
    "pistol",
    "bomb",
    "explosive",
    "ied",
    "blood",
    "gore",
    "gory",
    "decapitat",
    "mutilat",
    "swastika",
    "nazi",
    "isis",
    "terrorist",
];

/// Scrub + validate an LLM-emitted prompt before it's sent to the
/// image-gen provider. Returns `None` for prompts that should be
/// dropped (denylist hit, empty after trim); returns a length-capped
/// cleaned string otherwise.
fn sanitize_prompt(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    for needle in ILLUSTRATION_DENYLIST {
        if lower.contains(needle) {
            tracing::warn!(
                pattern = needle,
                "illustration prompt hit denylist; dropping scene asset"
            );
            return None;
        }
    }
    if trimmed.chars().count() <= MAX_PROMPT_CHARS {
        return Some(trimmed.to_string());
    }
    // Truncate at a char boundary, not a byte boundary.
    Some(trimmed.chars().take(MAX_PROMPT_CHARS).collect())
}

/// Build the per-scene image request. Prefers `illustration_prompt`
/// (set by the scene decomposer); falls back to `visual` so legacy
/// hand-authored briefs still get an asset even if the user never
/// ran them through the LLM script synth path. Returns `None` if
/// neither field has usable content, or if both fields fail the
/// denylist check.
fn build_request(scene: &SceneScript, comp_w: u32, comp_h: u32) -> Option<ImageRequest> {
    let candidate = scene
        .illustration_prompt
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| {
            let v = scene.visual.trim();
            (!v.is_empty()).then_some(v)
        })?;
    let cleaned = sanitize_prompt(candidate)?;
    Some(ImageRequest::new(cleaned).with_dims(comp_w, comp_h))
}

/// Lottie asset ids must be valid JSON keys and cannot contain dots
/// (Lottie players use dot-paths internally). Scene ids look like
/// `"1.0"`, so we replace `.` with `_` to get `"scene_1_0"`.
fn asset_id_for(scene_id: &str) -> String {
    format!("scene_{}", scene_id.replace('.', "_"))
}

/// Attach a [`SceneAssetsBundle`] to an already-built [`LottieTimeline`]:
///
/// 1. Each `GeneratedImage` becomes an entry in `timeline.image_assets`
///    so the lottie-gen renderer can embed it as a base64 data-URI.
/// 2. Each shot tagged with a recognized scene id (matched on the
///    `[scene_id] …` prefix that [`crate::generate_brief`] adds to
///    every shot description) gets a full-frame Image background layer
///    prepended at z-bottom. The Lottie player composites every other
///    layer on top of it.
///
/// Idempotent on subsequent calls: re-applying the same bundle does
/// not duplicate image_assets entries (matched by id), but a fresh
/// background layer is still prepended each time — callers should
/// apply at most once per timeline.
///
/// Returns the number of shots that successfully had a background
/// layer attached. Shots whose scene id has no matching asset (LLM
/// 5xx'd that scene; or the timeline wasn't produced from a brief)
/// are skipped silently and degrade to text-only.
pub fn attach_to_timeline(timeline: &mut LottieTimeline, bundle: &SceneAssetsBundle) -> usize {
    if bundle.assets.is_empty() {
        return 0;
    }

    // 1. Merge image assets (de-dup by id).
    let existing_ids: std::collections::HashSet<&str> = timeline
        .image_assets
        .iter()
        .map(|a| a.id.as_str())
        .collect::<std::collections::HashSet<_>>();
    let mut to_add: Vec<ImageAsset> = Vec::new();
    let mut scene_to_asset_id: HashMap<String, String> = HashMap::new();
    for (scene_id, img) in &bundle.assets {
        let id = asset_id_for(scene_id);
        scene_to_asset_id.insert(scene_id.clone(), id.clone());
        if existing_ids.contains(id.as_str()) {
            continue;
        }
        // Base64-encode regardless of source: SVG bytes are UTF-8 text
        // but Lottie data-URIs expect base64. The renderer trusts the
        // mime type verbatim.
        let data_b64 = B64.encode(&img.bytes);
        to_add.push(ImageAsset {
            id,
            mime: img.content_type.clone(),
            data_b64,
            width: timeline.composition_width,
            height: timeline.composition_height,
        });
    }
    timeline.image_assets.extend(to_add);

    // 2. Prepend a background image layer to every shot whose
    //    description carries a recognized `[scene_id]` tag.
    let mut attached = 0usize;
    for shot in &mut timeline.shots {
        let Some(scene_id) = extract_scene_id(&shot.description) else {
            continue;
        };
        let Some(asset_id) = scene_to_asset_id.get(&scene_id) else {
            continue;
        };
        let bg = background_image_layer(
            asset_id,
            timeline.composition_width,
            timeline.composition_height,
            shot.duration_seconds,
        );
        shot.layers.insert(0, bg);
        attached += 1;
    }
    attached
}

/// Parse a `[scene_id] …` prefix from a shot description and return
/// the bare scene id. Matches the format that
/// [`crate::generate_brief`] uses to tag per-scene shots.
fn extract_scene_id(description: &str) -> Option<String> {
    let trimmed = description.trim_start();
    let rest = trimmed.strip_prefix('[')?;
    let end = rest.find(']')?;
    Some(rest[..end].trim().to_string())
}

/// Build a full-frame Image layer that fills the composition and
/// keeps the same opacity for the entire shot. Two keyframes so the
/// renderer's `animated_transform` path is exercised (a single
/// keyframe also works but the renderer prefers a span).
fn background_image_layer(asset_id: &str, w: u32, h: u32, duration_sec: f32) -> Layer {
    let cx = w as f32 * 0.5;
    let cy = h as f32 * 0.5;
    let size = [w as f32, h as f32];
    Layer {
        name: format!("bg_{asset_id}"),
        kind: LayerKind::Image,
        fill_hex: None,
        stroke_hex: None,
        text: None,
        image_asset_id: Some(asset_id.to_string()),
        keyframes: vec![
            Keyframe {
                time_seconds: 0.0,
                position: [cx, cy],
                size,
                rotation_degrees: 0.0,
                opacity: 1.0,
                easing_label: EasingLabel::Standard,
            },
            Keyframe {
                time_seconds: duration_sec.max(0.01),
                position: [cx, cy],
                size,
                rotation_degrees: 0.0,
                opacity: 1.0,
                easing_label: EasingLabel::Standard,
            },
        ],
    }
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

    use crate::Shot;

    fn empty_timeline_with_shots(shots: Vec<Shot>) -> LottieTimeline {
        LottieTimeline {
            composition_width: 1024,
            composition_height: 1024,
            duration_seconds: 6.0,
            frame_rate: 30.0,
            background_hex: [0x0a, 0x0a, 0x0a],
            shots,
            image_assets: Vec::new(),
        }
    }

    fn shot_for(scene_id: &str) -> Shot {
        Shot {
            start_seconds: 0.0,
            duration_seconds: 3.0,
            description: format!("[{scene_id}] some motion direction"),
            layers: Vec::new(),
        }
    }

    fn fake_bundle(scene_ids: &[&str]) -> SceneAssetsBundle {
        let mut b = SceneAssetsBundle {
            provider: "stub".into(),
            ..Default::default()
        };
        for id in scene_ids {
            b.assets.insert(
                id.to_string(),
                GeneratedImage {
                    bytes: format!("<svg id={id}/>").into_bytes(),
                    content_type: "image/svg+xml".into(),
                    provider: "stub".into(),
                    cost_micros: 40_000,
                },
            );
            b.total_cost_micros += 40_000;
        }
        b
    }

    #[test]
    fn attach_to_timeline_appends_assets_and_prepends_background_layers() {
        let mut timeline = empty_timeline_with_shots(vec![shot_for("1.0"), shot_for("2.0")]);
        let bundle = fake_bundle(&["1.0", "2.0"]);
        let attached = attach_to_timeline(&mut timeline, &bundle);
        assert_eq!(attached, 2);
        assert_eq!(timeline.image_assets.len(), 2);

        // Each shot has one background layer prepended at index 0.
        for shot in &timeline.shots {
            assert_eq!(shot.layers.len(), 1);
            let bg = &shot.layers[0];
            assert!(matches!(bg.kind, LayerKind::Image));
            assert!(bg.image_asset_id.as_ref().unwrap().starts_with("scene_"));
            // Asset id matches the scene id with dots replaced.
            let scene_id = extract_scene_id(&shot.description).unwrap();
            assert_eq!(
                bg.image_asset_id.as_deref().unwrap(),
                &format!("scene_{}", scene_id.replace('.', "_"))
            );
        }
    }

    #[test]
    fn attach_to_timeline_skips_shots_with_no_matching_asset() {
        // Bundle has scene 1.0 only; shot 2.0 should be left untouched.
        let mut timeline = empty_timeline_with_shots(vec![shot_for("1.0"), shot_for("2.0")]);
        let bundle = fake_bundle(&["1.0"]);
        let attached = attach_to_timeline(&mut timeline, &bundle);
        assert_eq!(attached, 1);
        assert_eq!(timeline.shots[0].layers.len(), 1); // got bg
        assert!(timeline.shots[1].layers.is_empty()); // no bg, degrades gracefully
    }

    #[test]
    fn attach_to_timeline_is_a_noop_on_empty_bundle() {
        let mut timeline = empty_timeline_with_shots(vec![shot_for("1.0")]);
        let bundle = SceneAssetsBundle::default();
        let attached = attach_to_timeline(&mut timeline, &bundle);
        assert_eq!(attached, 0);
        assert!(timeline.image_assets.is_empty());
        assert!(timeline.shots[0].layers.is_empty());
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
