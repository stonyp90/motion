//! LLM-driven scripting: turn a free-form client brief into a
//! structured [`Brief`] of `target_scene_count` scenes.
//!
//! Used when the user pastes a marketing description ("explain
//! Chrono's SR&ED workflow to first-time founders, 60 seconds, friendly
//! tone") rather than a numbered storyboard. The orchestrator calls
//! this first, then drives the resulting Brief through the per-scene
//! generate path the same way it would a hand-authored script.
//!
//! Note: the public trait in `llm.rs` is `LlmBackend` — the spec
//! refers to it as "LlmClient" colloquially; we use the real type so
//! the function plugs into the existing backend picker without
//! adapters.

use crate::brief::{Brief, Lang, SceneScript};
use crate::llm::{LlmBackend, LlmBackendExt, LlmRequest};
use anyhow::Result;
use serde::Deserialize;

/// Schema-constrained LLM call that returns a [`Brief`]. The LLM is
/// asked to produce one VO line + one visual direction per scene; the
/// resulting Brief is fed back into the per-scene orchestrate path.
///
/// `target_scene_count` is a soft target — the LLM is allowed to ship
/// a few more or fewer if the brief naturally fits a different beat
/// count. `target_duration_sec` is communicated to the model so it can
/// pace VO line length appropriately (a 20-scene, 60s video means
/// ~3s per scene; lines should be short).
pub async fn synthesize_script(
    llm: &dyn LlmBackend,
    brief: &str,
    target_duration_sec: f32,
    target_scene_count: u32,
) -> Result<Brief> {
    let n = target_scene_count.max(1);
    let d = target_duration_sec.max(1.0);
    let per_scene = d / n as f32;

    let system = SYSTEM_PROMPT.to_string();
    let user = format!(
        "Client brief:\n{brief}\n\n\
         Produce a {n}-scene script for a B2B explainer video.\n\
         Total runtime ~{d:.1} seconds (about {per_scene:.1}s per scene).\n\
         For each scene, output:\n\
         - id: \"1.0\", \"2.0\", … (numbered N.0)\n\
         - vo: the voice-over line (concise, ~{words} words max so it fits the timing) or null for visual-only beats\n\
         - visual: a one-sentence direction for the on-screen visual\n\
         Output JSON only, matching the provided schema.",
        words = (per_scene * 2.6).round() as u32, // ~2.6 words/sec at conversational pace
    );

    let schema = schema_for(n);
    let req = LlmRequest::new(system, user)
        .with_schema(schema)
        .with_temperature(0.6);
    let raw: SynthBrief = LlmBackendExt::complete_into(llm, &req).await?;

    let scenes: Vec<SceneScript> = raw
        .scenes
        .into_iter()
        .enumerate()
        .map(|(i, s)| SceneScript {
            id: s
                .id
                .filter(|id| !id.is_empty())
                .unwrap_or_else(|| format!("{}.0", i + 1)),
            vo: s.vo.filter(|v| !v.trim().is_empty()),
            visual: s.visual.unwrap_or_default(),
            sub_beats: Vec::new(),
        })
        .collect();

    Ok(Brief {
        scenes,
        language: raw.language.unwrap_or(Lang::English),
        total_duration_sec: Some(d),
    })
}

const SYSTEM_PROMPT: &str = "You are a B2B explainer-video scriptwriter. Convert the user's brief \
into a numbered scene-by-scene script. Each scene has one VO line (or null for visual-only beats) \
and one visual direction. Keep the script tight: short, declarative VO; clear, specific visuals. \
Output ONLY a JSON object matching the schema, no commentary, no markdown.";

#[derive(Debug, Deserialize)]
struct SynthBrief {
    scenes: Vec<SynthScene>,
    #[serde(default)]
    language: Option<Lang>,
}

#[derive(Debug, Deserialize)]
struct SynthScene {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    vo: Option<String>,
    #[serde(default)]
    visual: Option<String>,
}

fn schema_for(target_scene_count: u32) -> serde_json::Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "language": {
                "type": "string",
                "enum": ["english", "french", "unknown"]
            },
            "scenes": {
                "type": "array",
                "minItems": (target_scene_count.saturating_sub(2)).max(1),
                "maxItems": target_scene_count + 4,
                "items": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string", "pattern": "^\\d+\\.\\d+$" },
                        "vo": { "type": ["string", "null"] },
                        "visual": { "type": "string" }
                    },
                    "required": ["id", "visual"]
                }
            }
        },
        "required": ["scenes"]
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::MockBackend;

    #[tokio::test]
    async fn synthesize_script_parses_mock_llm_output() {
        let canned = r#"{
            "language": "english",
            "scenes": [
                { "id": "1.0", "vo": "Your team spends too long on SR&ED claims.", "visual": "an office with a frustrated accountant" },
                { "id": "2.0", "vo": "Chrono cuts that to days.", "visual": "calendar pages flipping fast" },
                { "id": "3.0", "vo": null, "visual": "Chrono logo lockup, tagline fades in" }
            ]
        }"#;
        let backend = MockBackend::new(canned);
        let brief = synthesize_script(&backend, "Explain Chrono to first-time founders, 60s", 60.0, 3)
            .await
            .expect("synth ok");

        assert_eq!(brief.scenes.len(), 3);
        assert_eq!(brief.scenes[0].id, "1.0");
        assert_eq!(
            brief.scenes[0].vo.as_deref(),
            Some("Your team spends too long on SR&ED claims.")
        );
        assert_eq!(brief.scenes[1].id, "2.0");
        // Null VO must round-trip to None.
        assert!(brief.scenes[2].vo.is_none());
        assert!(brief.scenes[2].visual.contains("Chrono logo"));
        assert_eq!(brief.language, Lang::English);
        assert_eq!(brief.total_duration_sec, Some(60.0));
    }

    #[tokio::test]
    async fn synthesize_script_fills_missing_ids_in_order() {
        let canned = r#"{ "scenes": [
            { "id": null, "vo": "First.", "visual": "first" },
            { "id": "", "vo": "Second.", "visual": "second" }
        ] }"#;
        let backend = MockBackend::new(canned);
        let brief = synthesize_script(&backend, "x", 10.0, 2).await.unwrap();
        assert_eq!(brief.scenes[0].id, "1.0");
        assert_eq!(brief.scenes[1].id, "2.0");
        // Default language when LLM omits it.
        assert_eq!(brief.language, Lang::English);
    }

    #[tokio::test]
    async fn synthesize_script_propagates_empty_vo_as_none() {
        let canned = r#"{ "scenes": [
            { "id": "1.0", "vo": "   ", "visual": "silent" }
        ] }"#;
        let backend = MockBackend::new(canned);
        let brief = synthesize_script(&backend, "x", 5.0, 1).await.unwrap();
        assert!(brief.scenes[0].vo.is_none());
    }
}
