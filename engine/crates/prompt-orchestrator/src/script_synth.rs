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
         - visual: a one-sentence direction for the on-screen motion (\"camera dollies across icons\", \"chart bar grows from 0 to 90%\"). Tells the motion engine WHAT MOVES.\n\
         - illustration_prompt: a polished still-image art prompt for a vector image generator. Concrete subjects + spatial composition + art-direction modifiers (\"isometric SaaS dashboard, three KPI cards stacked left-to-right, flat vector illustration, deep navy + emerald accent, soft drop shadows, no text\"). NEVER includes text overlays (the motion engine adds copy as a separate layer). Aim for 20-40 words. Tells the image model WHAT IT LOOKS LIKE.\n\
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
            illustration_prompt: s.illustration_prompt.filter(|p| !p.trim().is_empty()),
            sub_beats: Vec::new(),
        })
        .collect();

    Ok(Brief {
        scenes,
        language: raw.language.unwrap_or(Lang::English),
        total_duration_sec: Some(d),
    })
}

const SYSTEM_PROMPT: &str = "You are a B2B explainer-video scriptwriter AND an art director who has \
written for product-led companies pitching to CFOs, ops leads, and board-level audiences. Convert \
the user's brief into a numbered scene-by-scene script with both motion direction and \
art-direction for a vector image generator.\n\n\
EACH SCENE\n\
- vo: one short voice-over line (or null for visual-only beats). Concrete numbers + concrete \
nouns over abstract claims.\n\
- visual: one-sentence MOTION direction — what moves, in what direction, on what beat. Examples: \
\"chart bar grows from 0 to 90% over 2 seconds\", \"three logo cards slide in left-to-right\", \
\"camera dolly across a stage of icons\". Names the focal point and the action.\n\
- illustration_prompt: a polished STILL-IMAGE art prompt for a vector image generator (Recraft \
v3 vector_illustration style). 20-40 words. Format: subject + spatial composition + art-direction \
modifiers. Examples: \"isometric SaaS dashboard with three KPI cards stacked left-to-right, flat \
vector illustration, deep navy background, emerald accents, soft long shadows, no text\"; \"three \
business avatars in a half-circle huddle, modern flat illustration, monochrome with a single \
amber accent on the central avatar, transparent background\". Rules: never request text overlays \
(motion engine adds copy as a separate layer); name a color palette using either brand colors or \
\"deep navy + emerald\" / \"warm grey + amber\" defaults; specify composition (\"isometric\", \
\"side view\", \"top-down grid\"); pick ONE illustration style and stay consistent across scenes.\n\n\
STRUCTURE\n\
- Open on a relatable pain or surprising fact (no \"In today's world…\").\n\
- Middle scenes prove the claim with evidence (numbers, mechanism, customer name).\n\
- Close on one takeaway + a single CTA. Never two CTAs in the same script.\n\
- Keep the illustration style consistent across every scene — pick one (\"isometric flat\", \
\"line illustration\", \"3d soft\") and stick with it so the video feels like one piece.\n\n\
NEVER\n\
- Marketing buzzwords: \"leverage\", \"synergy\", \"seamlessly\", \"unlock\", \"revolutionize\", \
\"game-changer\", \"world-class\", \"best-in-class\".\n\
- Rhetorical questions in VO (\"What if you could…?\"). They read as filler.\n\
- Two scenes that say the same thing differently.\n\
- Scenes that recap what was just shown.\n\
- Text inside the illustration_prompt (no \"with the word 'fast' written on it\").\n\n\
OUTPUT\n\
Return ONLY a JSON object matching the schema. No prose, no markdown, no code fences.";

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
    #[serde(default)]
    illustration_prompt: Option<String>,
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
                        "visual": { "type": "string" },
                        "illustration_prompt": { "type": "string" }
                    },
                    "required": ["id", "visual", "illustration_prompt"]
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
                { "id": "1.0", "vo": "Your team spends too long on SR&ED claims.", "visual": "an office with a frustrated accountant", "illustration_prompt": "isometric office desk with a stressed accountant surrounded by paperwork, flat vector, deep navy + amber accents, no text" },
                { "id": "2.0", "vo": "Chrono cuts that to days.", "visual": "calendar pages flipping fast", "illustration_prompt": "stack of calendar pages flying off in motion, flat vector, deep navy background, emerald accent on the topmost page, no text" },
                { "id": "3.0", "vo": null, "visual": "Chrono logo lockup, tagline fades in", "illustration_prompt": "centered Chrono logo lockup on a clean gradient panel, flat vector, deep navy + emerald, no text" }
            ]
        }"#;
        let backend = MockBackend::new(canned);
        let brief = synthesize_script(
            &backend,
            "Explain Chrono to first-time founders, 60s",
            60.0,
            3,
        )
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

        // Illustration prompts must round-trip through the LLM contract
        // so the downstream image-gen step has a prompt to work with.
        let prompts: Vec<&str> = brief
            .scenes
            .iter()
            .map(|s| s.illustration_prompt.as_deref().unwrap_or(""))
            .collect();
        assert!(prompts[0].contains("isometric"));
        assert!(prompts[1].contains("calendar"));
        assert!(prompts[2].contains("logo"));
    }

    #[tokio::test]
    async fn synthesize_script_treats_missing_illustration_prompt_as_none() {
        // Older mock backends won't emit illustration_prompt; verify the
        // deserializer tolerates it and the orchestrator falls back to
        // None (caller can auto-derive a prompt from `visual`).
        let canned = r#"{ "scenes": [
            { "id": "1.0", "vo": "Hello.", "visual": "wave" }
        ] }"#;
        let backend = MockBackend::new(canned);
        let brief = synthesize_script(&backend, "x", 5.0, 1).await.unwrap();
        assert!(brief.scenes[0].illustration_prompt.is_none());
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
