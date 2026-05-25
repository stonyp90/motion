/**
 * Client-side mirror of the Rust brief parser in
 * `engine/crates/prompt-orchestrator/src/brief.rs`.
 *
 * The UI uses this to decide — without a server round-trip — whether
 * the pasted text is a structured "N.0 ..." storyboard (in which case
 * we show a per-scene editor) or a free-form brief (in which case we
 * show a "synthesizing script via LLM..." spinner and call
 * `/v1/brief/synth`). The two parsers MUST stay in sync; if you change
 * the heuristic in one, change it in the other.
 *
 * Detection rule: ≥2 scene-header lines (`N.K <body>`) → structured.
 */

import type { Brief, ClientParseResult, Lang, SceneScript } from "./types";

/**
 * Run the same parse the server-side `parse_brief` does. Returns a
 * tagged result the UI can switch on directly.
 */
export function parseBriefClient(text: string): ClientParseResult {
  if (!looksLikeStructuredScript(text)) {
    return { kind: "free-form" };
  }
  return { kind: "structured", brief: parseBrief(text) };
}

/**
 * Cheap structural check. Mirrors the Rust
 * `looks_like_structured_script` (≥2 scene headers).
 */
export function looksLikeStructuredScript(text: string): boolean {
  let hits = 0;
  for (const line of text.split(/\r?\n/)) {
    if (parseSceneHeader(line.trimStart()) !== null) {
      hits += 1;
      if (hits >= 2) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Parse a structured, numbered storyboard script into a `Brief`. If
 * no scene headers are found, returns an empty `Brief` (we let the
 * caller decide whether that's an error — `parseBriefClient` already
 * routed those to the free-form path).
 */
export function parseBrief(text: string): Brief {
  const rawBeats = collectRawBeats(text);
  const scenes = nestSubBeats(rawBeats);
  return {
    scenes,
    language: detectLanguage(text),
    total_duration_sec: parseDurationHint(text),
  };
}

// ----------------------------- internals -----------------------------

interface RawBeat {
  id: string;
  headBody: string;
  visualLine: string | null;
}

function collectRawBeats(text: string): RawBeat[] {
  const out: RawBeat[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const hdr = parseSceneHeader(trimmed);
    if (hdr === null) continue;
    const [id, body] = hdr;
    let visualLine: string | null = null;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j].trim();
      if (next === "") continue;
      if (parseSceneHeader(next) !== null) break;
      const v = parseVisualLine(next);
      if (v !== null) visualLine = v;
      // Stop after the first non-empty line either way.
      break;
    }
    out.push({ id, headBody: body, visualLine });
  }
  return out;
}

/**
 * Recognise `"N.K <body>"`. Mirrors Rust `parse_scene_header`.
 * Returns `[id, body]` or `null`.
 */
export function parseSceneHeader(s: string): [string, string] | null {
  let i = 0;
  while (i < s.length && isAsciiDigit(s.charCodeAt(i))) i++;
  if (i === 0 || i >= s.length || s.charCodeAt(i) !== 46 /* . */) {
    return null;
  }
  const dot = i;
  i++;
  const minorStart = i;
  while (i < s.length && isAsciiDigit(s.charCodeAt(i))) i++;
  if (i === minorStart) return null;
  // After the number we need whitespace or end-of-line.
  if (i < s.length && !isAsciiWhitespace(s.charCodeAt(i))) return null;
  const id = `${s.slice(0, dot)}.${s.slice(minorStart, i)}`;
  const body = s.slice(i).trim();
  return [id, body];
}

/**
 * Recognise `"Visual : ..."` / `"Visuel : ..."` / `"Visual: ..."`.
 * Mirrors Rust `parse_visual_line`.
 */
export function parseVisualLine(s: string): string | null {
  const trimmed = s.trimStart();
  // Find the first separator: ':' or '-' or '—'.
  let sepIdx = -1;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (c === ":" || c === "-" || c === "—") {
      sepIdx = i;
      break;
    }
  }
  if (sepIdx === -1) return null;
  const head = trimmed.slice(0, sepIdx).trim().toLowerCase();
  if (head === "visual" || head === "visuel" || head === "visuals" || head === "visuels") {
    return trimmed.slice(sepIdx + 1).trim();
  }
  return null;
}

function nestSubBeats(raw: RawBeat[]): SceneScript[] {
  const out: SceneScript[] = [];
  for (const beat of raw) {
    const { vo, visual } = splitVoAndVisual(beat);
    const scene: SceneScript = {
      id: beat.id,
      vo,
      visual,
      sub_beats: [],
    };
    if (isSubBeat(beat.id)) {
      const parentMajor = majorOf(beat.id);
      // Find the most recent top-level beat with the same major.
      let parent: SceneScript | undefined;
      for (let k = out.length - 1; k >= 0; k--) {
        if (majorOf(out[k].id) === parentMajor) {
          parent = out[k];
          break;
        }
      }
      if (parent) {
        parent.sub_beats!.push(scene);
        continue;
      }
    }
    out.push(scene);
  }
  // Drop empty sub_beats arrays so the JSON shape matches the engine
  // (which uses `skip_serializing_if = "Vec::is_empty"`). Walk the
  // whole tree so nested sub-beats are cleaned up too.
  for (const s of out) stripEmptySubBeats(s);
  return out;
}

function stripEmptySubBeats(scene: SceneScript): void {
  if (scene.sub_beats) {
    if (scene.sub_beats.length === 0) {
      delete scene.sub_beats;
    } else {
      for (const child of scene.sub_beats) stripEmptySubBeats(child);
    }
  }
}

function splitVoAndVisual(beat: RawBeat): { vo: string | null; visual: string } {
  const head = beat.headBody.trim();
  const headIsNa = isNotApplicable(head);
  const vo = headIsNa || head === "" ? null : head;

  let visual: string;
  if (beat.visualLine !== null) {
    visual = beat.visualLine;
  } else if (isSubBeat(beat.id) || vo === null) {
    visual = head;
  } else {
    visual = "";
  }

  // Sub-beat with no Visual line: use body as visual, clear VO.
  if (isSubBeat(beat.id) && beat.visualLine === null && vo !== null) {
    return { vo: null, visual };
  }
  return { vo, visual };
}

function isNotApplicable(s: string): boolean {
  const t = s.trim().toLowerCase();
  return t === "n/a" || t === "na" || t === "n.a." || t === "none" || t === "-" || t === "—";
}

function isSubBeat(id: string): boolean {
  const dot = id.indexOf(".");
  if (dot === -1) return false;
  const minor = Number.parseInt(id.slice(dot + 1), 10);
  return Number.isFinite(minor) && minor > 0;
}

function majorOf(id: string): string {
  const dot = id.indexOf(".");
  return dot === -1 ? id : id.slice(0, dot);
}

const FR_WORDS = new Set([
  "le", "la", "les", "un", "une", "des", "et", "ou", "avec", "pour", "dans", "sur", "voit",
  "même", "scène", "écran", "représentant", "ensuite", "qui", "que", "vous", "votre", "est",
  "plan", "précédent", "réponse",
]);
const EN_WORDS = new Set([
  "the", "and", "or", "with", "for", "in", "on", "your", "you", "company", "what", "if",
  "could", "do", "faster", "every", "year", "claim", "claims", "credit", "credits", "scene",
  "shot",
]);

function detectLanguage(text: string): Lang {
  let fr = 0;
  let en = 0;
  for (const raw of text.split(/[^\p{L}]+/u)) {
    if (raw === "") continue;
    const lower = raw.toLowerCase();
    if (FR_WORDS.has(lower)) fr++;
    if (EN_WORDS.has(lower)) en++;
  }
  if (fr === 0 && en === 0) return "unknown";
  return fr > en ? "french" : "english";
}

function parseDurationHint(text: string): number | null {
  const lower = text.toLowerCase();
  // Greedy regex: numbers followed by an optional space + unit.
  const re = /(\d+(?:\.\d+)?)\s*(seconds?|secs?|s\b|min(?:utes?)?|m\b)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower)) !== null) {
    const n = Number.parseFloat(m[1]);
    if (!Number.isFinite(n)) continue;
    const unit = m[2];
    if (unit.startsWith("s")) {
      if (n >= 1 && n <= 600) return n;
    } else if (unit.startsWith("m")) {
      const secs = n * 60;
      if (secs >= 1 && secs <= 3600) return secs;
    }
  }
  return null;
}

function isAsciiDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

function isAsciiWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}
