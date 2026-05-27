//! Brief intake: parse a pasted, numbered storyboard script into a
//! structured [`Brief`] that the orchestrator can drive scene-by-scene.
//!
//! The format we target is the one we see in real-world client docs
//! (e.g. the Chrono SR&ED storyboard the user pasted in): a sequence
//! of scenes numbered `N.0`, with optional sub-beats `N.1`, `N.2`,
//! …, each with a VO line on the number line and a visual direction
//! on the next non-empty line prefixed with `Visual :` or `Visuel :`.
//!
//! ```text
//! 1.0 Your company claims SR&ED credits every year.
//! Visual : an office building, representing a tech company...
//!
//! 2.0 What if you could do it faster
//! Visual : transition; the word "faster" appears in bold...
//!
//! 12.0 Plus, collaborate with Chrono's AI assistant
//! Visual : same plate as before, but the chrono logo in the bubble...
//! 12.1 Same plate as before, but we see the user's reply...
//! 12.2 Lucius "swallows" the 4 files, then a loading state.
//! ```
//!
//! Sub-beats (`N.K` where `K > 0`) attach to their parent `N.0`. When a
//! sub-beat has no `Visual :` line, the body text after the number is
//! treated as the visual direction (the sample doc uses this for 12.1
//! and 12.2). VO `"N/A"` (case-insensitive, with or without slashes) is
//! mapped to `None`.
//!
//! Language detection is a small bag-of-words heuristic: we count
//! occurrences of a curated French/English stopword list and pick the
//! winner. Reliable enough for short scripts; never panics.

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};

/// Detected primary language of a brief. Used downstream to seed the
/// VO TTS voice and to keep generated frame copy in the same language.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    English,
    French,
    Unknown,
}

/// A single beat of a scene. `id` is the original numeric label
/// (`"1.0"`, `"12.1"`, …) so the UI can show it 1:1 with the source doc.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SceneScript {
    pub id: String,
    /// Voice-over line. `None` for `N/A` beats and silent visuals.
    pub vo: Option<String>,
    pub visual: String,
    /// Optional art-direction prompt tuned for a vector image generator
    /// (Recraft v3 etc). Distinct from `visual` because `visual` is the
    /// on-screen direction for motion ("camera dollies across icons"),
    /// while this is the polished still-image art prompt ("isometric SaaS
    /// dashboard, flat vector, dark navy + emerald accent, no text"). The
    /// scene-decomposer LLM populates it; hand-authored scripts leave it
    /// `None`, in which case the orchestrator may auto-derive one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub illustration_prompt: Option<String>,
    /// Sub-beats (`N.1`, `N.2`, …) keep the same framing as their
    /// parent `N.0` — they're stored nested so the orchestrator can
    /// decide whether to render them as one shot or several.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sub_beats: Vec<SceneScript>,
}

/// A parsed brief — top-level scenes plus the detected language and
/// (if computable) a rough total duration target.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Brief {
    pub scenes: Vec<SceneScript>,
    pub language: Lang,
    pub total_duration_sec: Option<f32>,
}

impl Brief {
    /// Total number of beats including sub-beats — handy for sanity
    /// checks against the source doc.
    pub fn beat_count(&self) -> usize {
        self.scenes.iter().map(|s| 1 + s.sub_beats.len()).sum()
    }
}

/// Parse a structured, numbered storyboard script into a [`Brief`].
///
/// Errors only when *no* scenes can be found — we'd rather return a
/// partial brief than fail, since real-world docs have weird whitespace
/// and the orchestrator can degrade gracefully on a near-empty result.
pub fn parse_brief(text: &str) -> Result<Brief> {
    // Pass 1: walk lines, group each scene-header line with the
    // subsequent visual line (if any) into a `RawBeat`.
    let raw_beats = collect_raw_beats(text);
    if raw_beats.is_empty() {
        return Err(anyhow!(
            "no scene headers (N.K pattern) found — input does not look like a structured script"
        ));
    }

    // Pass 2: roll sub-beats (`N.K` with K>0) into the most recent
    // top-level beat (`N.0`).
    let scenes = nest_sub_beats(raw_beats);

    let language = detect_language(text);
    let total_duration_sec = parse_duration_hint(text);

    Ok(Brief {
        scenes,
        language,
        total_duration_sec,
    })
}

/// Cheap structural check the UI can use to decide "structured script
/// vs free-form brief" without parsing the whole thing.
pub fn looks_like_structured_script(text: &str) -> bool {
    let mut hits = 0u32;
    for line in text.lines() {
        if parse_scene_header(line.trim_start()).is_some() {
            hits += 1;
            if hits >= 2 {
                return true;
            }
        }
    }
    false
}

// ----------------------------- internals -----------------------------

#[derive(Debug)]
struct RawBeat {
    id: String,
    /// First-line body after the number. May be empty.
    head_body: String,
    /// Body of the next non-empty `Visual : …` / `Visuel : …` line, if any.
    visual_line: Option<String>,
}

fn collect_raw_beats(text: &str) -> Vec<RawBeat> {
    let mut out: Vec<RawBeat> = Vec::new();
    let lines: Vec<&str> = text.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();
        if let Some((id, body)) = parse_scene_header(trimmed) {
            // Look ahead for a Visual line, skipping blanks but stopping
            // at the next scene header (so we don't borrow another
            // scene's Visual line).
            let mut visual_line = None;
            let mut j = i + 1;
            while j < lines.len() {
                let next = lines[j].trim();
                if next.is_empty() {
                    j += 1;
                    continue;
                }
                if parse_scene_header(next).is_some() {
                    break;
                }
                if let Some(v) = parse_visual_line(next) {
                    visual_line = Some(v);
                }
                // Whether or not it's a Visual line, we stop after the
                // first non-empty line: a Visual block is single-line
                // in the source doc; anything else is either prose for
                // the next scene or a sub-beat we'll pick up next pass.
                break;
            }
            out.push(RawBeat {
                id,
                head_body: body,
                visual_line,
            });
        }
        i += 1;
    }
    out
}

/// Recognise `"N.K <body>"` where N and K are non-negative integers.
fn parse_scene_header(s: &str) -> Option<(String, String)> {
    // Walk integer.major
    let mut idx = 0;
    let bytes = s.as_bytes();
    while idx < bytes.len() && bytes[idx].is_ascii_digit() {
        idx += 1;
    }
    if idx == 0 || idx >= bytes.len() || bytes[idx] != b'.' {
        return None;
    }
    let dot = idx;
    idx += 1;
    let minor_start = idx;
    while idx < bytes.len() && bytes[idx].is_ascii_digit() {
        idx += 1;
    }
    if idx == minor_start {
        return None;
    }
    // After the number, require whitespace (or end-of-line) so we don't
    // match version strings like "v1.0.0".
    if idx < bytes.len() && !bytes[idx].is_ascii_whitespace() {
        return None;
    }
    let id = format!("{}.{}", &s[..dot], &s[minor_start..idx]);
    let body = s[idx..].trim().to_string();
    Some((id, body))
}

/// Recognise `"Visual : …"` / `"Visuel : …"` / `"Visual: …"` etc.
/// Case-insensitive on the keyword, tolerates an em-dash separator.
fn parse_visual_line(s: &str) -> Option<String> {
    // Lowercase only the first word for the check so we don't allocate
    // for the whole line.
    let trimmed = s.trim_start();
    let (head, rest) = trimmed.split_once([':', '-', '—'])?;
    let key = head.trim().to_ascii_lowercase();
    if key == "visual" || key == "visuel" || key == "visuals" || key == "visuels" {
        Some(rest.trim().to_string())
    } else {
        None
    }
}

fn nest_sub_beats(raw: Vec<RawBeat>) -> Vec<SceneScript> {
    let mut out: Vec<SceneScript> = Vec::new();
    for beat in raw {
        let (vo, visual) = split_vo_and_visual(&beat);
        let scene = SceneScript {
            id: beat.id.clone(),
            vo,
            visual,
            illustration_prompt: None,
            sub_beats: Vec::new(),
        };
        if is_sub_beat(&beat.id) {
            // Attach to last top-level beat with the same major number,
            // if there is one — otherwise promote to top level (defensive
            // fallback for malformed docs).
            let parent_major = major_of(&beat.id);
            if let Some(parent) = out
                .iter_mut()
                .rev()
                .find(|p| major_of(&p.id) == parent_major)
            {
                parent.sub_beats.push(scene);
                continue;
            }
        }
        out.push(scene);
    }
    out
}

fn split_vo_and_visual(beat: &RawBeat) -> (Option<String>, String) {
    // `"N/A"` (with or without slashes / spaces) means "no VO".
    let head = beat.head_body.trim();
    let vo = if is_not_applicable(head) || head.is_empty() {
        None
    } else {
        Some(head.to_string())
    };

    let visual = match &beat.visual_line {
        Some(v) => v.clone(),
        None => {
            // Sub-beats often only carry a visual direction on the head
            // line (e.g. 12.1, 12.2 in the sample). If we have no VO
            // (head was N/A or empty) we'd lose the only content;
            // otherwise we use the head body as visual fallback for
            // sub-beats specifically — top-level beats keep an empty
            // visual so the schema reflects "missing".
            if is_sub_beat(&beat.id) || vo.is_none() {
                head.to_string()
            } else {
                String::new()
            }
        }
    };

    // If sub-beat and we used the body as visual, drop the VO so we
    // don't duplicate the same text in both fields.
    if is_sub_beat(&beat.id) && beat.visual_line.is_none() && vo.is_some() {
        return (None, visual);
    }

    (vo, visual)
}

fn is_not_applicable(s: &str) -> bool {
    let t = s.trim().to_ascii_lowercase();
    matches!(t.as_str(), "n/a" | "na" | "n.a." | "none" | "-" | "—")
}

fn is_sub_beat(id: &str) -> bool {
    id.split_once('.')
        .and_then(|(_, m)| m.parse::<u32>().ok())
        .map(|m| m > 0)
        .unwrap_or(false)
}

fn major_of(id: &str) -> &str {
    id.split_once('.').map(|(m, _)| m).unwrap_or(id)
}

/// Tiny bag-of-words language detector. Counts hits of common French
/// and English stopwords (whole-word, case-insensitive); whichever
/// scores higher wins. Returns `Unknown` if both are zero.
fn detect_language(text: &str) -> Lang {
    const FR: &[&str] = &[
        "le",
        "la",
        "les",
        "un",
        "une",
        "des",
        "et",
        "ou",
        "avec",
        "pour",
        "dans",
        "sur",
        "voit",
        "même",
        "scène",
        "écran",
        "représentant",
        "ensuite",
        "qui",
        "que",
        "vous",
        "votre",
        "est",
        "plan",
        "précédent",
        "réponse",
    ];
    const EN: &[&str] = &[
        "the", "and", "or", "with", "for", "in", "on", "your", "you", "company", "what", "if",
        "could", "do", "faster", "every", "year", "claim", "claims", "credit", "credits", "scene",
        "shot",
    ];

    let mut fr = 0u32;
    let mut en = 0u32;
    for raw in text.split(|c: char| !c.is_alphabetic()) {
        if raw.is_empty() {
            continue;
        }
        let lower = raw.to_lowercase();
        if FR.iter().any(|w| *w == lower) {
            fr += 1;
        }
        if EN.iter().any(|w| *w == lower) {
            en += 1;
        }
    }
    if fr == 0 && en == 0 {
        Lang::Unknown
    } else if fr > en {
        Lang::French
    } else {
        Lang::English
    }
}

/// If the brief mentions a duration like `"60s"` / `"30 seconds"` /
/// `"1m"`, return it. Returns `None` for ambiguous or missing hints.
fn parse_duration_hint(text: &str) -> Option<f32> {
    let lower = text.to_ascii_lowercase();
    // Look for "<number> seconds" / "<number>s"
    for line in lower.lines() {
        let bytes = line.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i].is_ascii_digit() {
                let start = i;
                while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
                    i += 1;
                }
                let num_str = &line[start..i];
                // Skip optional whitespace.
                let mut j = i;
                while j < bytes.len() && bytes[j] == b' ' {
                    j += 1;
                }
                let rest = &line[j..];
                if rest.starts_with("seconds")
                    || rest.starts_with("second")
                    || rest.starts_with("secs")
                    || rest.starts_with("sec")
                    || rest.starts_with("s ")
                    || rest == "s"
                    || rest.starts_with("s.")
                {
                    if let Ok(n) = num_str.parse::<f32>() {
                        if (1.0..=600.0).contains(&n) {
                            return Some(n);
                        }
                    }
                }
                if rest.starts_with("min") || rest.starts_with('m') && !rest.starts_with("ms") {
                    if let Ok(n) = num_str.parse::<f32>() {
                        let secs = n * 60.0;
                        if (1.0..=3600.0).contains(&secs) {
                            return Some(secs);
                        }
                    }
                }
            } else {
                i += 1;
            }
        }
    }
    None
}

// ----------------------------- tests -----------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// The real Chrono SR&ED storyboard the user pasted. 21 scenes,
    /// English VO + (mostly) French visual directions, with sub-beats
    /// at 12.1 and 12.2. This is the gold reference — if the parser
    /// can roundtrip this we trust it on similar client docs.
    const CHRONO_BRIEF: &str = "\
Chrono SR&ED — 60 second explainer

1.0 Your company claim SR&ED credits every year.
Visual : voit un immeuble, représentant une entreprise dans les tech

2.0 What if you could do it faster
Visual : change de scène ; faster apparaît en bold à l'écran

3.0 What if you could do it cheaper
Visual : change de scène ; cheaper apparaît en bold à l'écran

4.0 What if you could do it with confidence
Visual : change de scène ; confidence apparaît en bold à l'écran

5.0 Chrono is the AI co-pilot for SR&ED preparers.
Visual : on voit le logo de Chrono apparaître au centre de l'écran

6.0 Upload your data once.
Visual : un utilisateur drag-and-drop des fichiers vers Chrono

7.0 Chrono extracts every eligible expense automatically.
Visual : zoom sur les fichiers ; petites icônes vertes apparaissent

8.0 Drafts the technical narrative in your voice.
Visual : un document apparaît ; le texte se tape tout seul

9.0 N/A
Visual : transition rapide vers la vue dashboard

10.0 Track every claim across every project.
Visual : un dashboard apparaît, multiple projets visibles

11.0 Built-in compliance with the latest CRA guidelines.
Visual : un sceau d'approbation apparaît à côté du dashboard

12.0 Plus, collaborate with Chrono's AI assistant
Visual : même plan que précédemment, mais le logo chrono dans la bulle
12.1 Même plan que précédent, mais on voit la réponse de l'utilisateur dans une bulle
12.2 Lucius «avale» les 4 dossiers, ensuite faite un loading.

13.0 Get your claim filed in days, not months.
Visual : un calendrier qui se réduit visuellement

14.0 Trusted by hundreds of Canadian tech companies.
Visual : logos de clients défilent à l'écran

15.0 From early-stage startups to enterprise R&D teams.
Visual : montage rapide de différents environnements de travail

16.0 SOC 2 compliant. Your data stays your data.
Visual : icône de cadenas apparaît, badge SOC 2

17.0 No long contracts. No setup fees.
Visual : deux X biffent ces deux concepts à l'écran

18.0 Start with a free claim review.
Visual : bouton CTA apparaît, animation pulse subtile

19.0 See what Chrono finds — risk-free.
Visual : flèche pointe vers le bouton

20.0 Visit chronosred.com today.
Visual : URL apparaît grande à l'écran, fade out

21.0 N/A
Visual : logo Chrono final, tagline en dessous
";

    #[test]
    fn parses_chrono_brief_with_21_scenes_and_sub_beats() {
        let brief = parse_brief(CHRONO_BRIEF).expect("parses");
        assert_eq!(
            brief.scenes.len(),
            21,
            "expected 21 top-level scenes, got {}: {:?}",
            brief.scenes.len(),
            brief.scenes.iter().map(|s| &s.id).collect::<Vec<_>>()
        );

        // Scene 1.0 — VO + Visual on its own line.
        let s1 = &brief.scenes[0];
        assert_eq!(s1.id, "1.0");
        assert_eq!(
            s1.vo.as_deref(),
            Some("Your company claim SR&ED credits every year.")
        );
        assert!(s1.visual.contains("immeuble"));
        assert!(s1.sub_beats.is_empty());

        // Scene 9.0 — N/A VO should map to None.
        let s9 = brief.scenes.iter().find(|s| s.id == "9.0").unwrap();
        assert!(
            s9.vo.is_none(),
            "9.0 VO is 'N/A' so should be None, got {:?}",
            s9.vo
        );
        assert!(s9.visual.contains("dashboard"));

        // Scene 12.0 — should carry 12.1 and 12.2 as sub-beats.
        let s12 = brief.scenes.iter().find(|s| s.id == "12.0").unwrap();
        assert_eq!(
            s12.sub_beats.len(),
            2,
            "12.0 should have 2 sub-beats, got {}: {:?}",
            s12.sub_beats.len(),
            s12.sub_beats.iter().map(|s| &s.id).collect::<Vec<_>>()
        );
        assert_eq!(s12.sub_beats[0].id, "12.1");
        assert_eq!(s12.sub_beats[1].id, "12.2");
        // Sub-beats use the body line as visual direction.
        assert!(s12.sub_beats[0].visual.contains("réponse"));
        assert!(s12.sub_beats[1].visual.contains("Lucius"));
        // And don't double up the same text in VO.
        assert!(s12.sub_beats[0].vo.is_none());
        assert!(s12.sub_beats[1].vo.is_none());

        // Scene 21.0 — N/A again.
        let s21 = brief.scenes.iter().find(|s| s.id == "21.0").unwrap();
        assert!(s21.vo.is_none());

        // Beat count: 21 top + 2 sub = 23.
        assert_eq!(brief.beat_count(), 23);

        // Language: English wins (Chrono VO lines are English).
        assert_eq!(brief.language, Lang::English);
    }

    #[test]
    fn parse_scene_header_only_matches_numbered_lines() {
        assert!(parse_scene_header("1.0 hello").is_some());
        assert!(parse_scene_header("12.3 something").is_some());
        assert!(parse_scene_header("21.0 N/A").is_some());
        // No body — still a valid header.
        assert!(parse_scene_header("5.0").is_some());
        // Not a header.
        assert!(parse_scene_header("Visual : foo").is_none());
        assert!(parse_scene_header("hello 1.0").is_none());
        assert!(parse_scene_header("v1.0.0").is_none());
        assert!(parse_scene_header("").is_none());
    }

    #[test]
    fn parse_visual_line_handles_french_and_english() {
        assert_eq!(
            parse_visual_line("Visual : a building").as_deref(),
            Some("a building")
        );
        assert_eq!(
            parse_visual_line("Visuel : un immeuble").as_deref(),
            Some("un immeuble")
        );
        assert_eq!(
            parse_visual_line("visual: lowercase ok").as_deref(),
            Some("lowercase ok")
        );
        assert_eq!(
            parse_visual_line("VISUAL — em dash").as_deref(),
            Some("em dash")
        );
        assert!(parse_visual_line("Not a visual line").is_none());
    }

    #[test]
    fn looks_like_structured_script_needs_two_headers() {
        assert!(!looks_like_structured_script(""));
        assert!(!looks_like_structured_script("just some free-form prose."));
        assert!(!looks_like_structured_script("1.0 lonely scene"));
        assert!(looks_like_structured_script(
            "1.0 first\nVisual: a\n2.0 second\nVisual: b"
        ));
    }

    #[test]
    fn detect_language_picks_french_over_english_when_dominant() {
        assert_eq!(
            detect_language("Le chat est sur la table avec un livre dans la cuisine."),
            Lang::French
        );
        assert_eq!(
            detect_language("The cat sat on the table with a book in the kitchen."),
            Lang::English
        );
        assert_eq!(detect_language("12345 !!!"), Lang::Unknown);
    }

    #[test]
    fn parse_duration_hint_recognises_common_forms() {
        assert_eq!(parse_duration_hint("Make me a 60s explainer"), Some(60.0));
        assert_eq!(
            parse_duration_hint("Total duration: 90 seconds"),
            Some(90.0)
        );
        assert_eq!(parse_duration_hint("about 2 minutes"), Some(120.0));
        assert_eq!(parse_duration_hint("no duration here"), None);
    }

    #[test]
    fn parse_brief_errors_on_unstructured_input() {
        let r = parse_brief("Just a free-form paragraph with no scene numbers at all.");
        assert!(r.is_err());
    }
}
