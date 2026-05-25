#!/usr/bin/env bash
# run.sh — entry point for the motion-forge engine API contract suite.
#
# Phases:
#   1. Wait for engine + keycloak readiness (with timeout).
#   2. Mint an access token via _auth.hurl.
#   3. Generate runtime fixtures (oversized prompt body, etc.).
#   4. Run every public-path .hurl file in declared order, captured-vars
#      flowing from generate → iterate → presets/{id}.
#   5. Run ws_test.sh (WebSocket companion).
#   6. Run schema-check.sh (OpenAPI conformance).
#   7. Aggregate counts, exit non-zero on any fail.
#
# Required env (with sensible defaults for local dev):
#   ENGINE_URL    default: http://localhost:8081
#   KC_URL        default: http://localhost:8080
#   KC_REALM      default: motion-forge
#   KC_CLIENT_ID  default: motion-forge-engine
#   KC_USER       default: contract-test@motion-forge.test
#   KC_PASS       default: contract-test-pass
#
# Designed to be drop-in for CI (single script, exits non-zero on failure).

set -euo pipefail

ENGINE_URL="${ENGINE_URL:-http://localhost:8081}"
KC_URL="${KC_URL:-http://localhost:8080}"
KC_REALM="${KC_REALM:-motion-forge}"
KC_CLIENT_ID="${KC_CLIENT_ID:-motion-forge-engine}"
KC_USER="${KC_USER:-contract-test@motion-forge.test}"
KC_PASS="${KC_PASS:-contract-test-pass}"
READINESS_TIMEOUT="${READINESS_TIMEOUT:-90}"
SKIP_SCHEMA="${SKIP_SCHEMA:-0}"
SKIP_WS="${SKIP_WS:-0}"

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d -t mf-run.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

bold()  { printf '\033[1m%s\033[0m\n' "$*"; }
ok()    { printf '  \033[32mOK\033[0m   %s\n' "$*"; }
fail()  { printf '  \033[31mFAIL\033[0m %s\n' "$*"; }
note()  { printf '  ---- %s\n' "$*"; }

# --- 0. tool check -----------------------------------------------------------
for t in hurl curl jq; do
  command -v "$t" >/dev/null || { echo "missing: $t" >&2; exit 2; }
done

# --- 1. readiness ------------------------------------------------------------
bold "[1/7] wait for engine + keycloak"
wait_for() {
  local url="$1" label="$2"
  local end=$(( SECONDS + READINESS_TIMEOUT ))
  until curl -fsS -o /dev/null "$url"; do
    (( SECONDS > end )) && { fail "$label not ready: $url"; return 1; }
    sleep 1
  done
  ok "$label up: $url"
}
wait_for "$ENGINE_URL/healthz"                                          engine
wait_for "$KC_URL/realms/$KC_REALM/.well-known/openid-configuration"    keycloak

# --- 2. token ----------------------------------------------------------------
bold "[2/7] mint token"
TOKEN_JSON="$WORK/token.json"
hurl --variable KC_URL="$KC_URL" \
     --variable KC_REALM="$KC_REALM" \
     --variable KC_CLIENT_ID="$KC_CLIENT_ID" \
     --variable KC_USER="$KC_USER" \
     --variable KC_PASS="$KC_PASS" \
     --json "$HERE/_auth.hurl" >"$TOKEN_JSON"
TOKEN="$(jq -r '.entries[0].captures[] | select(.name=="token") | .value' "$TOKEN_JSON")"
[[ -n "$TOKEN" && "$TOKEN" != "null" ]] || { fail "could not mint token"; exit 1; }
ok "token ($(echo "$TOKEN" | wc -c) chars)"
export TOKEN

# --- 3. runtime fixtures -----------------------------------------------------
bold "[3/7] generate runtime fixtures"
# Oversized prompt for the 422 case (we don't commit 4 KB of filler to the
# fixtures dir; generate it just-in-time in /tmp instead).
python3 - <<PY > "$HERE/fixtures/oversized_prompt.json"
import json
print(json.dumps({
    "prompt": "x" * 5000,
    "cast": [],
    "brand": {"id": "test-tenant-brand-01"},
    "duration_seconds": 30,
    "aspect_ratio": "16:9"
}))
PY
ok "fixtures ready"

# --- 4. hurl suite -----------------------------------------------------------
bold "[4/7] hurl suite"
# Declared order — captures flow from earlier files into later ones.
ORDER=(
  GET_healthz.hurl
  GET_openapi.hurl
  GET_v1_themes.hurl
  GET_v1_presets.hurl
  GET_v1_presets_id.hurl
  POST_v1_brief_parse.hurl
  POST_v1_brief_synth.hurl
  POST_v1_generate.hurl
  POST_v1_iterate.hurl
  POST_v1_export_format.hurl
  POST_v1_ingest.hurl
  POST_v1_figma_import.hurl
  POST_v1_web_export_format.hurl
)

# Shared capture file — each run rewrites it; later runs `--variables-file` it.
VARS="$WORK/vars.env"
: >"$VARS"

declare -i pass=0 hfail=0
for f in "${ORDER[@]}"; do
  path="$HERE/$f"
  [[ -f "$path" ]] || { note "skip missing: $f"; continue; }
  log="$WORK/${f%.hurl}.json"

  if hurl --test \
        --variable token="$TOKEN" \
        --variable ENGINE_URL="$ENGINE_URL" \
        --variables-file "$VARS" \
        --file-root "$HERE" \
        --json --report-junit "$WORK/${f%.hurl}.junit.xml" \
        "$path" >"$log" 2>&1; then
    pass+=1
    ok "$f"
  else
    hfail+=1
    fail "$f"
    sed 's/^/      /' "$log" | head -40
  fi

  # Propagate captures: scrape captured vars into $VARS for the next file.
  if [[ -s "$log" ]]; then
    jq -r '.entries[]?.captures[]? | "\(.name)=\(.value)"' "$log" 2>/dev/null >>"$VARS" || true
  fi
done

# --- 5. ws ------------------------------------------------------------------
bold "[5/7] websocket suite"
if (( SKIP_WS )); then
  note "SKIP_WS=1 — skipping ws_test.sh"
  ws_status=0
else
  if ENGINE_URL="$ENGINE_URL" TOKEN="$TOKEN" bash "$HERE/ws_test.sh"; then
    ws_status=0; ok "ws_test.sh"
  else
    ws_status=1; fail "ws_test.sh"
  fi
fi

# --- 6. schema ---------------------------------------------------------------
bold "[6/7] openapi schema validation"
if (( SKIP_SCHEMA )); then
  note "SKIP_SCHEMA=1 — skipping schema-check.sh"
  schema_status=0
else
  if ENGINE_URL="$ENGINE_URL" TOKEN="$TOKEN" bash "$HERE/schema-check.sh"; then
    schema_status=0; ok "schema-check.sh"
  else
    schema_status=1; fail "schema-check.sh"
  fi
fi

# --- 7. summary --------------------------------------------------------------
bold "[7/7] summary"
total=$(( pass + hfail ))
echo "  hurl:   $pass / $total passed"
echo "  ws:     $([[ $ws_status -eq 0 ]] && echo PASS || echo FAIL)"
echo "  schema: $([[ $schema_status -eq 0 ]] && echo PASS || echo FAIL)"

exit_code=0
(( hfail > 0 ))      && exit_code=1
(( ws_status > 0 ))  && exit_code=1
(( schema_status > 0 )) && exit_code=1
exit "$exit_code"
