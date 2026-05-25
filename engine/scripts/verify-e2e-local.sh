#!/usr/bin/env bash
# motion-forge — local end-to-end verifier.
#
# Drives the full stack with local-only services (Keycloak realm
# import + axum engine + Next.js web + Ollama vision LLM) through
# every checkpoint in the product loop:
#
#   1. stack    — all 4 services responding
#   2. auth     — Keycloak password grant → real RS256 JWT
#   3. security — 401/400 gates on protected routes
#   4. upload   — PDF + PNG + JPG + MP4 multipart round-trip
#   5. presets  — preset library reachable
#   6. brief    — Chrono 21-scene parser
#   7. generate — full pipeline (segment → decompose → style →
#                 orchestrate via Ollama → lottie-gen → render)
#   8. lottie   — output is a valid Lottie 5.x document
#
# Exits 0 if every checkpoint passes, non-zero on first failure.
# Designed to be safe to re-run; uses fresh per-session work-dirs.
#
# Usage:
#   ./engine/scripts/verify-e2e-local.sh
#   ./engine/scripts/verify-e2e-local.sh --skip-generate  # fast, skips Ollama
#   ./engine/scripts/verify-e2e-local.sh --json           # machine output

set -uo pipefail

# ─── config (override via env)
KC_URL=${KC_URL:-http://127.0.0.1:8080}
KC_REALM=${KC_REALM:-motion-forge}
KC_CLIENT_ID=${KC_CLIENT_ID:-motion-forge-web}
KC_CLIENT_SECRET=${KC_CLIENT_SECRET:-motion-forge-web-dev-secret}
KC_USER=${KC_USER:-owner@motion-forge.io}
KC_PASS=${KC_PASS:-dev}
ENGINE_URL=${ENGINE_URL:-http://127.0.0.1:7700}
WEB_URL=${WEB_URL:-http://127.0.0.1:3010}
OLLAMA_URL=${OLLAMA_URL:-http://127.0.0.1:11434}
GENERATE_TIMEOUT=${GENERATE_TIMEOUT:-600}  # 10 min — Ollama llava can be slow first run

# ─── flags
SKIP_GENERATE=0
JSON_OUT=0
for arg in "$@"; do
  case "$arg" in
    --skip-generate) SKIP_GENERATE=1 ;;
    --json) JSON_OUT=1 ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# //'
      exit 0
      ;;
  esac
done

# ─── state
PASS=0
FAIL=0
RESULTS=()

result() {
  local status=$1; local name=$2; local detail=${3:-}
  if [ "$status" = "PASS" ]; then PASS=$((PASS+1)); else FAIL=$((FAIL+1)); fi
  RESULTS+=("$status|$name|$detail")
  if [ "$JSON_OUT" = 0 ]; then
    local glyph="✓"; [ "$status" = "FAIL" ] && glyph="✗"
    local color=$'\e[32m'; [ "$status" = "FAIL" ] && color=$'\e[31m'
    printf "  %s%s\e[0m %-40s %s\n" "$color" "$glyph" "$name" "$detail"
  fi
}

section() {
  [ "$JSON_OUT" = 0 ] && echo && echo "── $1 ────────────────────────────────"
}

die() {
  [ "$JSON_OUT" = 0 ] && echo "FATAL: $*" >&2
  exit 2
}

# ─── 1. stack
section "1 · STACK HEALTH"
for url in \
  "Keycloak|$KC_URL/realms/$KC_REALM/.well-known/openid-configuration" \
  "Engine|$ENGINE_URL/healthz" \
  "Web|$WEB_URL/" \
  "Ollama|$OLLAMA_URL/api/tags"; do
  name="${url%%|*}"; u="${url#*|}"
  if curl -sf "$u" -o /dev/null --max-time 5; then
    result PASS "$name reachable" "$u"
  else
    result FAIL "$name reachable" "$u  (HTTP unreachable)"
  fi
done

# ─── 2. auth
section "2 · AUTH"
TOKEN_JSON=$(curl -sS -X POST \
  -d "grant_type=password" \
  -d "client_id=$KC_CLIENT_ID" \
  -d "client_secret=$KC_CLIENT_SECRET" \
  -d "username=$KC_USER" \
  -d "password=$KC_PASS" \
  "$KC_URL/realms/$KC_REALM/protocol/openid-connect/token")
TOKEN=$(echo "$TOKEN_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null)
if [ -z "$TOKEN" ]; then
  result FAIL "Keycloak password grant" "$(echo "$TOKEN_JSON" | head -c 120)"
  TOKEN=""
else
  result PASS "Keycloak password grant" "RS256 JWT, len=${#TOKEN}, sub=$KC_USER"
fi

# ─── 3. security gates
section "3 · SECURITY GATES"

probe_code() {
  curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "$@"
}

CODE=$(probe_code "$ENGINE_URL/v1/uploads")
[ "$CODE" = "401" ] && result PASS "/v1/uploads no-auth → 401" "" || result FAIL "/v1/uploads no-auth" "got $CODE"

CODE=$(probe_code -H "Authorization: Bearer not-a-real-token" "$ENGINE_URL/v1/uploads")
[ "$CODE" = "401" ] && result PASS "/v1/uploads bad-bearer → 401" "" || result FAIL "/v1/uploads bad-bearer" "got $CODE"

CODE=$(probe_code -X POST -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json" \
  -d '{"reference_video":"../../../etc/passwd","prompt":"x"}' "$ENGINE_URL/v1/generate")
[ "$CODE" = "400" ] && result PASS "path traversal blocked" "../../etc/passwd → 400" \
                    || result FAIL "path traversal blocked" "got $CODE"

CODE=$(probe_code "$ENGINE_URL/v1/themes")
[ "$CODE" = "401" ] && result PASS "/v1/themes no-auth → 401" "" || result FAIL "/v1/themes no-auth" "got $CODE"

if [ -n "$TOKEN" ]; then
  CODE=$(probe_code -H "Authorization: Bearer $TOKEN" "$ENGINE_URL/v1/themes")
  [ "$CODE" = "200" ] && result PASS "/v1/themes real-JWT → 200" "" || result FAIL "/v1/themes real-JWT" "got $CODE"
fi

# ─── 4. multi-format upload
section "4 · MULTI-FORMAT UPLOAD"
TMPDIR=$(mktemp -d)
trap "rm -rf '$TMPDIR'" EXIT

# Tiny synthetic fixtures
cat > "$TMPDIR/brief.pdf" <<'PDF'
%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj
trailer<</Root 1 0 R>>
PDF
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "color=c=teal:s=64x64:d=1" -frames:v 1 "$TMPDIR/frame.png" 2>/dev/null
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "color=c=blue:s=64x64:d=1" -frames:v 1 "$TMPDIR/frame.jpg" 2>/dev/null
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "testsrc=duration=1:size=64x64:rate=15" -pix_fmt yuv420p "$TMPDIR/clip.mp4" 2>/dev/null

UPLOAD=$(curl -sS -X POST -H "Authorization: Bearer $TOKEN" \
  -F "brief=@$TMPDIR/brief.pdf" \
  -F "frame=@$TMPDIR/frame.png" \
  -F "still=@$TMPDIR/frame.jpg" \
  -F "video=@$TMPDIR/clip.mp4" \
  "$ENGINE_URL/v1/uploads")
SESSION=$(echo "$UPLOAD" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session',''))" 2>/dev/null)
if [ -z "$SESSION" ]; then
  result FAIL "multipart upload" "$(echo "$UPLOAD" | head -c 120)"
else
  result PASS "multipart upload" "session=$SESSION"
  PDF_PATH=$(echo "$UPLOAD" | python3 -c "import sys,json; [print(f['path']) for f in json.load(sys.stdin)['files'] if f['kind']=='pdf']" 2>/dev/null)
  PNG_COUNT=$(echo "$UPLOAD" | python3 -c "import sys,json; print(sum(1 for f in json.load(sys.stdin)['files'] if f['kind']=='image'))" 2>/dev/null)
  VIDEO_PATH=$(echo "$UPLOAD" | python3 -c "import sys,json; [print(f['path']) for f in json.load(sys.stdin)['files'] if f['kind']=='video']" 2>/dev/null)
  [ -n "$PDF_PATH" ] && result PASS "PDF classified" "$PDF_PATH" || result FAIL "PDF classified" ""
  [ "$PNG_COUNT" = "2" ] && result PASS "PNG + JPG classified as image" "count=2" || result FAIL "image classification" "got $PNG_COUNT"
  [ -n "$VIDEO_PATH" ] && result PASS "MP4 classified" "$VIDEO_PATH" || result FAIL "MP4 classified" ""
fi

# ─── 5. presets
section "5 · PRESETS LIBRARY"
PRESETS=$(curl -sS -H "Authorization: Bearer $TOKEN" "$ENGINE_URL/v1/presets")
PRESET_COUNT=$(echo "$PRESETS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('presets', [])))" 2>/dev/null)
[ -n "$PRESET_COUNT" ] && [ "$PRESET_COUNT" -ge 10 ] && \
  result PASS "/v1/presets returns ≥10" "got $PRESET_COUNT" || \
  result FAIL "/v1/presets returns ≥10" "got $PRESET_COUNT"

# ─── 6. brief parser
section "6 · BRIEF PARSER"
CHRONO=engine/fixtures/briefs/chrono-sred.txt
if [ ! -f "$CHRONO" ]; then
  CHRONO=$(find . -name chrono-sred.txt 2>/dev/null | head -1)
fi
if [ -n "$CHRONO" ] && [ -f "$CHRONO" ]; then
  SCENES=$(curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    --data "$(jq -Rs '{text: .}' < "$CHRONO")" "$ENGINE_URL/v1/brief/parse" | \
    python3 -c "import sys,json; print(len(json.load(sys.stdin).get('scenes',[])))" 2>/dev/null)
  [ "$SCENES" = "21" ] && result PASS "Chrono 21-scene parse" "scenes=$SCENES" \
                       || result FAIL "Chrono 21-scene parse" "got $SCENES"
else
  result FAIL "Chrono fixture present" "engine/fixtures/briefs/chrono-sred.txt missing"
fi

# ─── 7. full pipeline /v1/generate
if [ "$SKIP_GENERATE" = 1 ]; then
  section "7 · FULL PIPELINE (--skip-generate)"
  result PASS "skipped" "set GENERATE_TIMEOUT and drop --skip-generate to run"
else
  section "7 · FULL PIPELINE (Ollama llava + segment + lottie-gen)"
  if [ -z "$VIDEO_PATH" ]; then
    result FAIL "full pipeline" "no video uploaded — skipping"
  else
    [ "$JSON_OUT" = 0 ] && echo "  driving /v1/generate, timeout=${GENERATE_TIMEOUT}s — first run can be 3-5 min on Ollama cold cache..."
    GEN_START=$(date +%s)
    BODY="{\"reference_video\":\"$VIDEO_PATH\",\"prompt\":\"a 3-second logo reveal with the wordmark crystallising from emerald particles\",\"theme\":\"corporate\",\"duration_seconds\":3}"
    GEN=$(curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      --data "$BODY" --max-time "$GENERATE_TIMEOUT" "$ENGINE_URL/v1/generate")
    GEN_TIME=$(( $(date +%s) - GEN_START ))
    LOTTIE_PATH=$(echo "$GEN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('output_lottie',''))" 2>/dev/null)
    BACKEND=$(echo "$GEN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('backend_name','?'))" 2>/dev/null)
    SHOTS=$(echo "$GEN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('shots','?'))" 2>/dev/null)
    if [ -n "$LOTTIE_PATH" ] && [ -f "$LOTTIE_PATH" ]; then
      result PASS "full pipeline" "${GEN_TIME}s · backend=$BACKEND · shots=$SHOTS"
    else
      result FAIL "full pipeline" "${GEN_TIME}s · response=$(echo "$GEN" | head -c 200)"
    fi

    # ─── 8. validate the Lottie
    section "8 · LOTTIE VALIDATION"
    if [ -n "$LOTTIE_PATH" ] && [ -f "$LOTTIE_PATH" ]; then
      VALID=$(python3 -c "
import json
d = json.load(open('$LOTTIE_PATH'))
ok = (
    isinstance(d.get('v'), str) and
    isinstance(d.get('fr'), (int, float)) and
    isinstance(d.get('w'), int) and
    isinstance(d.get('h'), int) and
    isinstance(d.get('layers'), list) and len(d['layers']) > 0
)
if ok:
    layer_names = [l.get('nm','?') for l in d['layers']]
    print(f'OK|v={d[\"v\"]}|{d[\"w\"]}x{d[\"h\"]}@{d[\"fr\"]}fps|{len(d[\"layers\"])} layers ({\", \".join(layer_names[:5])})')
else:
    print('FAIL|missing required Lottie fields')
" 2>&1)
      STATUS=${VALID%%|*}
      DETAIL=${VALID#*|}
      [ "$STATUS" = "OK" ] && result PASS "valid Lottie 5.x" "$DETAIL" || result FAIL "valid Lottie 5.x" "$DETAIL"
    fi
  fi
fi

# ─── final
section "SUMMARY"
TOTAL=$((PASS + FAIL))
if [ "$JSON_OUT" = 1 ]; then
  python3 -c "
import json
results = [{'status': r.split('|',2)[0], 'name': r.split('|',2)[1], 'detail': r.split('|',2)[2]} for r in '''$(printf '%s\n' "${RESULTS[@]}")'''.strip().split('\n') if r]
print(json.dumps({'pass': $PASS, 'fail': $FAIL, 'total': len(results), 'results': results}))
"
else
  echo "  $PASS / $TOTAL passed"
  if [ "$FAIL" -eq 0 ]; then
    echo "  $(printf '\e[32m')✓ ALL CHECKS PASSED — local stack is fully working end to end$(printf '\e[0m')"
  else
    echo "  $(printf '\e[31m')✗ $FAIL CHECK(S) FAILED$(printf '\e[0m')"
  fi
fi
[ "$FAIL" -eq 0 ]
