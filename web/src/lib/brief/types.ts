/**
 * Mirrors the engine-side `Brief` / `SceneScript` types defined in
 * `engine/crates/prompt-orchestrator/src/brief.rs`. Keep these in sync
 * with that file — they are wire-format types for `/v1/brief/parse`
 * and `/v1/brief/synth`.
 */

/** Detected primary language of a brief. */
export type Lang = "english" | "french" | "unknown";

/**
 * A single beat of a scene. `id` is the original numeric label
 * (`"1.0"`, `"12.1"`, ...) so the UI can show it 1:1 with the source
 * doc. Sub-beats are nested under their parent `N.0` scene.
 */
export interface SceneScript {
  id: string;
  vo: string | null;
  visual: string;
  sub_beats?: SceneScript[];
}

/** A parsed brief — top-level scenes plus the detected language. */
export interface Brief {
  scenes: SceneScript[];
  language: Lang;
  total_duration_sec: number | null;
}

/**
 * What the client-side parser returns. The UI uses `kind` to decide
 * whether to enter "structured script" mode (show a per-scene editor)
 * or "free-form" mode (show a "generating script..." spinner then
 * call `/v1/brief/synth`).
 */
export type ClientParseResult =
  | { kind: "structured"; brief: Brief }
  | { kind: "free-form" };
