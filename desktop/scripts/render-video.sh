#!/usr/bin/env bash
# End-to-end MP4 render. Drives the engine through the full brief →
# motion-graphics → audio narration → muxed MP4 pipeline so you get a
# single playable file out the other side.
#
# Stages:
#   1. POST /v1/brief/synth     — structured Brief with per-scene VO text
#   2. POST /v1/brief/generate  — Lottie JSON (motion-graphics composition)
#   3. POST /v1/export/mp4      — Lottie → silent MP4 (python+ffmpeg sidecar)
#   4. TTS                      — concatenated VO → AAC audio
#   5. ffmpeg mux               — silent MP4 + AAC → final MP4
#
# Output lands at OUT_PATH (default ./render-out/<brand>-<timestamp>.mp4).
#
# ─── Required env ───────────────────────────────────────────────────
#   ENGINE_BASE_URL          e.g. http://127.0.0.1:6321
#   ENGINE_AUTH_TOKEN        bearer the engine accepts (in dev: the
#                            MOTION_FORGE_AUTH_FALLBACK_KEY value)
#
# ─── Optional env ───────────────────────────────────────────────────
#   BRIEF_FILE               path to a text brief. Defaults to a built-in
#                            sample ("Lumen" finance-close explainer).
#   DURATION_SECONDS         target total duration. Default 45.
#   SCENE_COUNT              target scene count. Default 6.
#   OUT_PATH                 final MP4 destination. Default
#                            ./render-out/<slug>-<ts>.mp4
#   TTS_BACKEND              one of: say (macOS, default) | openai |
#                            elevenlabs | none
#   TTS_VOICE                voice name (say: "Samantha"; openai: "nova";
#                            elevenlabs: voice id). Backend-specific.
#   OPENAI_API_KEY           required when TTS_BACKEND=openai
#   ELEVENLABS_API_KEY       required when TTS_BACKEND=elevenlabs
#   RECRAFT_API_KEY          pass through to engine; when set, the engine
#                            bakes per-scene illustrations into the
#                            Lottie. Without it the video is text+shape
#                            only (still ships, just sparser).
#
# Requirements (Homebrew):
#   brew install ffmpeg jq curl
#   (and the engine's python+ffmpeg sidecar already configured)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# ─── Pre-flight ─────────────────────────────────────────────────────
require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[render-video] required tool '$1' not on PATH ($2)" >&2
    exit 3
  fi
}
require curl  "brew install curl"
require jq    "brew install jq"
require ffmpeg "brew install ffmpeg"

if [[ -z "${ENGINE_BASE_URL:-}" || -z "${ENGINE_AUTH_TOKEN:-}" ]]; then
  echo "[render-video] set ENGINE_BASE_URL and ENGINE_AUTH_TOKEN" >&2
  exit 2
fi
ENGINE_BASE_URL="${ENGINE_BASE_URL%/}"

DURATION_SECONDS="${DURATION_SECONDS:-45}"
SCENE_COUNT="${SCENE_COUNT:-6}"
TTS_BACKEND="${TTS_BACKEND:-say}"

# ─── Brief: file or built-in default ────────────────────────────────
# The default brief is intentionally *different* from the chrono
# workforce-platform reference: a finance/month-end-close angle for a
# fictional brand "Lumen", with a cooler tone and a different story
# shape (problem → product → result, instead of category → mascot →
# screens). Override with BRIEF_FILE to point at your own.
if [[ -n "${BRIEF_FILE:-}" ]]; then
  if [[ ! -f "$BRIEF_FILE" ]]; then
    echo "[render-video] brief file not found: $BRIEF_FILE" >&2
    exit 4
  fi
  BRIEF_TEXT="$(cat "$BRIEF_FILE")"
  BRAND_SLUG="$(basename "$BRIEF_FILE" .txt)"
else
  BRAND_SLUG="lumen"
  BRIEF_TEXT="Lumen — close the books in four days, not four weeks.

1.0  Open on a wall calendar with the last week of the month circled in red. A finance lead stares at a mountain of spreadsheets — the legacy close.
2.0  Cut to a clean dashboard. Lumen pulls every ledger, bank feed, and ERP into one continuous reconciliation. The numbers reconcile themselves while she watches.
3.0  Variances surface in plain English with the underlying journal entries one click away. No more reverse-engineering pivot tables at midnight.
4.0  The whole team — controllers, AP, AR, FP&A — works in the same view. Comments thread next to each line. The audit trail writes itself.
5.0  Day four. The CFO signs off. Earnings package out the door. Quarter starts on Monday with the team rested for once.
6.0  End card: Lumen — the finance close, finally fast. Cool emerald + ink palette, restrained typography."
fi

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT_PATH_DEFAULT="$REPO_ROOT/render-out/${BRAND_SLUG}-${TIMESTAMP}.mp4"
OUT_PATH="${OUT_PATH:-$OUT_PATH_DEFAULT}"
mkdir -p "$(dirname "$OUT_PATH")"

WORK="$(mktemp -d -t render-video.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

echo "[render-video] brand=${BRAND_SLUG} duration=${DURATION_SECONDS}s scenes=${SCENE_COUNT}"
echo "[render-video] work=${WORK}"
echo "[render-video] out =${OUT_PATH}"

AUTH_HEADER=("-H" "Authorization: Bearer ${ENGINE_AUTH_TOKEN}")
JSON_HEADER=("-H" "Content-Type: application/json")

# ─── 1. Brief synth (structured scenes with VO text) ────────────────
echo "[render-video] (1/5) brief/synth …"
SYNTH_BODY="$(jq -n \
  --arg brief "$BRIEF_TEXT" \
  --argjson duration "$DURATION_SECONDS" \
  --argjson scene_count "$SCENE_COUNT" \
  '{brief: $brief, duration: $duration, scene_count: $scene_count}')"
SYNTH_RESPONSE="$(curl -fsS \
  -X POST "${ENGINE_BASE_URL}/v1/brief/synth" \
  "${JSON_HEADER[@]}" "${AUTH_HEADER[@]}" \
  --data "$SYNTH_BODY")"
echo "$SYNTH_RESPONSE" > "$WORK/brief.json"
SCENE_TOTAL="$(echo "$SYNTH_RESPONSE" | jq '.scenes | length')"
echo "[render-video]   scenes synthesised: ${SCENE_TOTAL}"

# Concatenate VO lines into a single narration. Skip scenes with no vo.
# Fall back to the `visual` field if a scene has no VO — the visual
# direction is still on-brief copy, even if it wasn't tagged for
# voiceover by the LLM. Last-ditch fallback: the raw brief itself.
NARRATION="$(echo "$SYNTH_RESPONSE" | jq -r '
  [.scenes[] | (.vo // .visual // empty) | select(. != null and . != "")] | join(" ")
')"
if [[ -z "$NARRATION" ]]; then
  # Strip numbered-scene prefixes (e.g. "1.0 ") from the brief and use
  # the remaining sentences as a coherent narration body.
  NARRATION="$(echo "$BRIEF_TEXT" | sed -E 's/^[0-9]+\.[0-9]+[[:space:]]+//; /^$/d' | tr '\n' ' ')"
  echo "[render-video]   synth returned no VO — falling back to brief text" >&2
fi
echo "$NARRATION" > "$WORK/narration.txt"
NARRATION_WORDS="$(echo "$NARRATION" | wc -w | tr -d ' ')"
echo "[render-video]   narration: ${NARRATION_WORDS} words"

# ─── 2. Brief generate (Lottie JSON) ────────────────────────────────
echo "[render-video] (2/5) brief/generate …"
GEN_BODY="$(jq -n \
  --arg brief "$BRIEF_TEXT" \
  --argjson duration "$DURATION_SECONDS" \
  --argjson scene_count "$SCENE_COUNT" \
  '{brief: $brief, duration: $duration, scene_count: $scene_count}')"
GEN_T0="$(date +%s)"
GEN_RESPONSE="$(curl -fsS \
  -X POST "${ENGINE_BASE_URL}/v1/brief/generate" \
  "${JSON_HEADER[@]}" "${AUTH_HEADER[@]}" \
  --data "$GEN_BODY")"
GEN_MS=$(( ($(date +%s) - GEN_T0) * 1000 ))
echo "$GEN_RESPONSE" > "$WORK/gen.json"
LOTTIE_PATH="$(echo "$GEN_RESPONSE" | jq -r '.output_lottie')"
SHOTS="$(echo "$GEN_RESPONSE" | jq -r '.shots')"
PROVIDER="$(echo "$GEN_RESPONSE" | jq -r '.asset_provider')"
echo "[render-video]   shots=${SHOTS}  assets=${PROVIDER}  wall=${GEN_MS}ms"
echo "[render-video]   lottie=${LOTTIE_PATH}"
cp "$LOTTIE_PATH" "$WORK/animation.json"

# ─── 3. Export MP4 (video-only) ─────────────────────────────────────
echo "[render-video] (3/5) export/mp4 …"
curl -fsS \
  -X POST "${ENGINE_BASE_URL}/v1/export/mp4" \
  -H "Content-Type: application/json" \
  "${AUTH_HEADER[@]}" \
  --data-binary "@$WORK/animation.json" \
  -o "$WORK/video.mp4"
VIDEO_SIZE_KB=$(du -k "$WORK/video.mp4" | awk '{print $1}')
VIDEO_DURATION="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$WORK/video.mp4" 2>/dev/null | awk '{printf "%.1f", $1}')"
echo "[render-video]   video.mp4 ${VIDEO_SIZE_KB} KB, ${VIDEO_DURATION}s"

# ─── 4. Narration audio ─────────────────────────────────────────────
echo "[render-video] (4/5) tts (${TTS_BACKEND}) …"
AUDIO_FILE="$WORK/narration.m4a"

tts_say() {
  local voice="${TTS_VOICE:-Samantha}"
  # `say` writes AIFF natively; ffmpeg transcodes to AAC in an MP4
  # container so the final mux can stream-copy.
  local aiff="$WORK/narration.aiff"
  say -v "$voice" -o "$aiff" --file-format=AIFF "$NARRATION"
  ffmpeg -y -loglevel error -i "$aiff" \
    -c:a aac -b:a 192k -ar 48000 -movflags +faststart \
    "$AUDIO_FILE"
}

tts_openai() {
  : "${OPENAI_API_KEY:?OPENAI_API_KEY required for TTS_BACKEND=openai}"
  local voice="${TTS_VOICE:-nova}"
  local body
  body="$(jq -n \
    --arg input "$NARRATION" \
    --arg voice "$voice" \
    '{model: "tts-1-hd", input: $input, voice: $voice, response_format: "aac"}')"
  curl -fsS \
    -X POST "https://api.openai.com/v1/audio/speech" \
    -H "Authorization: Bearer ${OPENAI_API_KEY}" \
    -H "Content-Type: application/json" \
    --data "$body" \
    -o "$WORK/narration.aac"
  ffmpeg -y -loglevel error -i "$WORK/narration.aac" \
    -c:a copy -movflags +faststart "$AUDIO_FILE"
}

tts_elevenlabs() {
  : "${ELEVENLABS_API_KEY:?ELEVENLABS_API_KEY required for TTS_BACKEND=elevenlabs}"
  : "${TTS_VOICE:?TTS_VOICE (ElevenLabs voice id) required}"
  local body
  body="$(jq -n \
    --arg text "$NARRATION" \
    '{text: $text, model_id: "eleven_multilingual_v2"}')"
  curl -fsS \
    -X POST "https://api.elevenlabs.io/v1/text-to-speech/${TTS_VOICE}" \
    -H "xi-api-key: ${ELEVENLABS_API_KEY}" \
    -H "Content-Type: application/json" \
    -H "Accept: audio/mpeg" \
    --data "$body" \
    -o "$WORK/narration.mp3"
  ffmpeg -y -loglevel error -i "$WORK/narration.mp3" \
    -c:a aac -b:a 192k -ar 48000 -movflags +faststart "$AUDIO_FILE"
}

tts_silent() {
  # Generate a silent track matching video duration so the final
  # mux still produces a well-formed file with an audio stream.
  ffmpeg -y -loglevel error \
    -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=48000" \
    -t "$VIDEO_DURATION" -c:a aac -b:a 96k "$AUDIO_FILE"
}

if [[ -z "$NARRATION" || "$NARRATION_WORDS" -lt 3 ]]; then
  echo "[render-video]   narration too short — emitting silent audio track"
  tts_silent
else
  case "$TTS_BACKEND" in
    none)       tts_silent ;;
    say)        tts_say ;;
    openai)     tts_openai ;;
    elevenlabs) tts_elevenlabs ;;
    *)
      echo "[render-video] unknown TTS_BACKEND=$TTS_BACKEND" >&2
      exit 5
      ;;
  esac
fi
AUDIO_DURATION="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$AUDIO_FILE" 2>/dev/null | awk '{printf "%.1f", $1}')"
echo "[render-video]   narration.m4a ${AUDIO_DURATION}s"

# ─── 5. Mux ─────────────────────────────────────────────────────────
echo "[render-video] (5/5) mux …"
# Sync rule: the visual is authoritative. If narration is shorter
# than the video, we pad it with trailing silence via `apad` so the
# motion graphics play out to their natural close. If narration is
# longer, we trim it to the video length (rare — usually the LLM
# under-fills VO rather than over-fills). The audio is re-encoded
# (apad needs filter graph), the video is stream-copied.
ffmpeg -y -loglevel error \
  -i "$WORK/video.mp4" \
  -i "$AUDIO_FILE" \
  -map 0:v:0 -map 1:a:0 \
  -af "apad" \
  -c:v copy -c:a aac -b:a 192k -ar 48000 \
  -t "$VIDEO_DURATION" \
  -movflags +faststart \
  "$OUT_PATH"

FINAL_SIZE_MB="$(du -m "$OUT_PATH" | awk '{print $1}')"
FINAL_DURATION="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT_PATH" 2>/dev/null | awk '{printf "%.1f", $1}')"
echo "[render-video] DONE: $OUT_PATH (${FINAL_SIZE_MB} MB, ${FINAL_DURATION}s)"
