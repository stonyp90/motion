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
    // Temperature 0.35 (was 0.6): scripting still needs creative
    // latitude (concrete examples, customer-flavored language) but
    // 0.6 was high enough to drift on JSON shape with smaller local
    // models. 0.35 keeps voice variety while halving schema-echo
    // failure rate on 7B-class Ollama backends (Jan 2026 .audit runs).
    let req = LlmRequest::new(system, user)
        .with_schema(schema)
        .with_temperature(0.35);

    // Small local models (llava, qwen2.5-7b) occasionally echo the
    // schema definition itself instead of satisfying it. When that
    // happens the tolerant parser in `llm.rs` recovers; when even
    // THAT can't recover, we synthesize a deterministic fallback
    // brief from the user's text so generation never hard-fails.
    // The product's contract is "always produce a Lottie" — going
    // 500 on a model quirk would break that.
    let raw: SynthBrief = match LlmBackendExt::complete_into(llm, &req).await {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!(
                error = %e,
                "LLM script synthesis failed; falling back to a deterministic single-scene brief"
            );
            return Ok(fallback_brief(brief, d));
        }
    };

    let mut scenes: Vec<SceneScript> = raw
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

    // Empty scenes list from the LLM is just as bad as a parse
    // failure — recover the same way.
    if scenes.is_empty() {
        tracing::warn!(
            "LLM returned zero scenes; falling back to deterministic single-scene brief"
        );
        return Ok(fallback_brief(brief, d));
    }

    // Post-process pass 1: enforce a consistent illustration style
    // across every scene by lifting the style modifiers from scene 1
    // and re-appending them to every subsequent scene's prompt. The
    // LLM is told to be consistent in the system prompt but Recraft
    // routinely drifts (scene 3 goes 3d after scenes 1-2 were flat) —
    // this is a deterministic guarantee.
    enforce_style_consistency(&mut scenes);

    Ok(Brief {
        scenes,
        language: raw.language.unwrap_or(Lang::English),
        total_duration_sec: Some(d),
    })
}

/// Style-modifier tokens we look for in scene 1's illustration_prompt
/// and re-apply to every other scene. Lowercased; matched as
/// substrings. Order matters — we preserve the original phrasing.
const STYLE_MODIFIER_PHRASES: &[&str] = &[
    "flat vector illustration",
    "flat vector",
    "vector illustration",
    "isometric flat",
    "isometric",
    "line illustration",
    "3d soft",
    "modern flat illustration",
    "minimal line art",
    "monochrome",
];

/// Color-palette token patterns we lift to keep the palette stable.
/// Looks for phrases like "deep navy + emerald", "warm grey + amber".
const PALETTE_HINTS: &[&str] = &[
    "deep navy",
    "warm grey",
    "warm gray",
    "emerald accent",
    "amber accent",
    "mint accent",
    "teal accent",
    "monochrome with",
];

/// Lift style + palette modifiers from `scenes[0].illustration_prompt`
/// and re-apply them to every other scene's prompt, so Recraft can't
/// drift mid-video. Idempotent — a prompt that already contains the
/// modifier isn't double-stamped.
fn enforce_style_consistency(scenes: &mut [SceneScript]) {
    let Some(first_prompt) = scenes
        .first()
        .and_then(|s| s.illustration_prompt.as_deref())
    else {
        return;
    };
    let style_anchor = extract_style_anchor(first_prompt);
    if style_anchor.is_empty() {
        return;
    }
    for scene in scenes.iter_mut().skip(1) {
        let Some(prompt) = scene.illustration_prompt.as_mut() else {
            continue;
        };
        let lower = prompt.to_ascii_lowercase();
        let mut needs = Vec::new();
        for token in &style_anchor {
            if !lower.contains(&token.to_ascii_lowercase()) {
                needs.push(token.clone());
            }
        }
        if !needs.is_empty() {
            // Append, separated from existing copy with a comma.
            if !prompt.trim_end().ends_with(',') {
                prompt.push(',');
            }
            prompt.push(' ');
            prompt.push_str(&needs.join(", "));
        }
    }
}

/// Pull the distinctive style + palette tokens from a prompt. Returns
/// the substrings in the order they appeared (so we preserve the
/// art director's phrasing rather than a normalized re-write).
fn extract_style_anchor(prompt: &str) -> Vec<String> {
    let lower = prompt.to_ascii_lowercase();
    let mut out: Vec<(usize, String)> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for token in STYLE_MODIFIER_PHRASES.iter().chain(PALETTE_HINTS.iter()) {
        if let Some(pos) = lower.find(token) {
            // Recover the original (cased) substring from the prompt.
            let raw = &prompt[pos..pos + token.len()];
            if seen.insert(token.to_ascii_lowercase()) {
                out.push((pos, raw.to_string()));
            }
        }
    }
    out.sort_by_key(|(pos, _)| *pos);
    out.into_iter().map(|(_, s)| s).collect()
}

/// Apply VO-weighted beat-grid pacing: estimate each scene's duration
/// from the spoken word count (~2.6 words/sec at conversational pace)
/// plus a small tail for breathing room, then scale proportionally to
/// hit the target total. Scenes without VO get a fixed pillow time.
/// Returns the per-scene durations in seconds, indexed parallel to
/// `scenes`. The orchestrator (in `brief_to_timeline`) consumes
/// these to size each scene's shot window.
///
/// Snaps each result to the nearest 0.5s so cuts land on a beat,
/// the way a human editor would cut to a music bed.
pub fn pace_scenes(scenes: &[SceneScript], target_total_sec: f32) -> Vec<f32> {
    if scenes.is_empty() {
        return Vec::new();
    }
    const WORDS_PER_SEC: f32 = 2.6;
    const VO_TAIL_SEC: f32 = 0.5;
    const SILENT_SCENE_SEC: f32 = 2.5;
    const MIN_SCENE_SEC: f32 = 1.0;
    let raw: Vec<f32> = scenes
        .iter()
        .map(|s| match s.vo.as_deref() {
            Some(vo) if !vo.trim().is_empty() => {
                let words = vo.split_whitespace().count().max(1) as f32;
                (words / WORDS_PER_SEC + VO_TAIL_SEC).max(MIN_SCENE_SEC)
            }
            _ => SILENT_SCENE_SEC,
        })
        .collect();
    let raw_total: f32 = raw.iter().sum();
    let target = target_total_sec.max(MIN_SCENE_SEC * scenes.len() as f32);
    let scale = if raw_total > 0.0 {
        target / raw_total
    } else {
        1.0
    };
    raw.into_iter()
        .map(|d| snap_to_beat((d * scale).max(MIN_SCENE_SEC)))
        .collect()
}

/// Snap to the nearest 0.5s. Matches how a human editor cuts to a
/// music bed — beats land on the half-second grid.
fn snap_to_beat(sec: f32) -> f32 {
    (sec * 2.0).round() / 2.0
}

/// Deterministic single-scene brief used when LLM synthesis fails
/// (small local model, schema-echo bug, network glitch). Splits the
/// raw brief text into 3 beats by sentence so the timeline isn't a
/// single flat plate — the user still gets a real motion graphic,
/// just one generated from their text directly instead of through
/// an art-direction LLM pass.
///
/// Detects French via accented characters so Quebec briefs get a
/// French language tag (drives the TTS / kinetic-typo CTA).
pub fn fallback_brief(raw: &str, duration_sec: f32) -> Brief {
    let cleaned = raw.trim();
    let language = if cleaned.chars().any(|c| {
        matches!(
            c,
            'à' | 'â' | 'é' | 'è' | 'ê' | 'ë' | 'î' | 'ï' | 'ô' | 'ù' | 'û' | 'ç'
        )
    }) {
        Lang::French
    } else {
        Lang::English
    };

    // Pull up to 3 sentences from the brief; pad with a CTA if short.
    let sentences: Vec<String> = cleaned
        .split(['.', '!', '?', '\n'])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .take(3)
        .collect();
    let hooks = if sentences.is_empty() {
        vec![cleaned.to_string()]
    } else {
        sentences
    };

    let style_anchor =
        "flat vector illustration, deep navy + emerald accent, soft drop shadows, no text";
    let scenes: Vec<SceneScript> = hooks
        .iter()
        .enumerate()
        .map(|(i, body)| {
            let id = format!("{}.0", i + 1);
            // Truncate VO to keep TTS budget reasonable.
            let vo_body: String = body.chars().take(180).collect();
            SceneScript {
                id,
                vo: Some(vo_body.clone()),
                visual: format!("text + supporting shapes for: {vo_body}"),
                illustration_prompt: Some(format!(
                    "isometric scene illustrating \"{}\", {style_anchor}",
                    vo_body.chars().take(60).collect::<String>()
                )),
                sub_beats: Vec::new(),
            }
        })
        .collect();

    Brief {
        scenes,
        language,
        total_duration_sec: Some(duration_sec.max(3.0)),
    }
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
OUTPUT (STRICT)\n\
- Respond with ONE JSON object only — no prose, no markdown, no ```json fences, no \"Sure, here \
is…\" preamble.\n\
- The object must match the schema in the user message. Emit DATA matching the schema, NEVER the \
schema definition itself (no `\"type\": \"object\"`, no `\"properties\"`, no `\"items\"` envelope).\n\
- Your first character must be `{` and your last character must be `}`.\n\
- Example shape (fill with brief-specific values; this is illustrative, not literal): {\"language\": \
\"english\", \"scenes\": [{\"id\": \"1.0\", \"vo\": \"Your team spends days on SR&ED.\", \"visual\": \
\"calendar pages flip fast across the frame\", \"illustration_prompt\": \"stack of calendar pages \
mid-flight, flat vector illustration, deep navy + emerald accent, soft drop shadows, no text\"}]}";

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

    #[tokio::test]
    async fn enforce_style_consistency_appends_modifiers_from_scene_one() {
        // Scene 1 sets the style; scene 2 has no style tokens; scene 3
        // already has the same tokens — should not get them duplicated.
        let canned = r#"{
            "scenes": [
                { "id": "1.0", "vo": "Open.",  "visual": "x", "illustration_prompt": "isometric SaaS dashboard, flat vector illustration, deep navy + emerald accent" },
                { "id": "2.0", "vo": "Middle.", "visual": "y", "illustration_prompt": "three avatars in a half-circle huddle" },
                { "id": "3.0", "vo": "Close.",  "visual": "z", "illustration_prompt": "Chrono logo lockup, flat vector illustration, deep navy + amber accent" }
            ]
        }"#;
        let backend = MockBackend::new(canned);
        let brief = synthesize_script(&backend, "x", 15.0, 3).await.unwrap();
        // Scene 2 had no style tokens → modifiers from scene 1 appended.
        let s2 = brief.scenes[1].illustration_prompt.as_deref().unwrap();
        assert!(
            s2.contains("flat vector illustration"),
            "scene 2 should inherit scene 1's style: {s2}"
        );
        assert!(s2.contains("deep navy"));
        // Scene 3 already has flat vector — not double-stamped.
        let s3 = brief.scenes[2].illustration_prompt.as_deref().unwrap();
        let occurrences = s3.matches("flat vector illustration").count();
        assert_eq!(
            occurrences, 1,
            "scene 3 should not duplicate the style token: {s3}"
        );
    }

    #[test]
    fn pace_scenes_weights_by_vo_length_and_snaps_to_beat() {
        use crate::brief::SceneScript;
        let scenes = vec![
            // 4 words → ~1.5s + 0.5 tail = ~2.0s raw
            SceneScript {
                id: "1.0".into(),
                vo: Some("Quick punchy opener line.".into()),
                visual: String::new(),
                illustration_prompt: None,
                sub_beats: Vec::new(),
            },
            // 26 words → ~10s + 0.5 tail = ~10.5s raw — gets the lion's share
            SceneScript {
                id: "2.0".into(),
                vo: Some(
                    "Here we walk through the long detailed explanation with all the customer evidence numbers and mechanism details that prove the claim is real."
                        .into(),
                ),
                visual: String::new(),
                illustration_prompt: None,
                sub_beats: Vec::new(),
            },
            // No VO → fixed pillow time.
            SceneScript {
                id: "3.0".into(),
                vo: None,
                visual: String::new(),
                illustration_prompt: None,
                sub_beats: Vec::new(),
            },
        ];
        let paced = pace_scenes(&scenes, 18.0);
        assert_eq!(paced.len(), 3);
        // Long-VO scene should be biggest.
        assert!(
            paced[1] > paced[0] && paced[1] > paced[2],
            "long VO scene should get the most time: {paced:?}"
        );
        // Each value snaps to 0.5s grid.
        for d in &paced {
            assert_eq!(
                (d * 2.0).round() as i32 as f32 / 2.0,
                *d,
                "{d} not on 0.5s beat grid"
            );
        }
        // Total close to target (small drift OK from beat-snap).
        let total: f32 = paced.iter().sum();
        assert!(
            (total - 18.0).abs() < 1.5,
            "total {total} should be ~18s ± 1.5s"
        );
    }
}
