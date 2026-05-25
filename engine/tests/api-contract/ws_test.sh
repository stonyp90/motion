#!/usr/bin/env bash
# WS /v1/stt/stream — websocat-based companion test.
# Hurl has no native WS support, so we stream a fixture PCM file and assert
# the engine emits at least one transcript event before closing.
#
# Required env: ENGINE_URL (http base — we rewrite to ws://) and TOKEN.

set -euo pipefail

: "${ENGINE_URL:?ENGINE_URL required (e.g. http://localhost:8081)}"
: "${TOKEN:?TOKEN required (sourced from _auth.hurl)}"

PCM="$(dirname "$0")/fixtures/sample_pcm_16k_mono.raw"
[[ -f "$PCM" ]] || { echo "missing fixture: $PCM" >&2; exit 2; }

command -v websocat >/dev/null || { echo "websocat not on PATH (brew install websocat)" >&2; exit 2; }
command -v jq >/dev/null || { echo "jq not on PATH" >&2; exit 2; }

# Rewrite http(s) → ws(s).
WS_URL="${ENGINE_URL/http/ws}/v1/stt/stream?sample_rate=16000&encoding=pcm16&lang=en"

OUT="$(mktemp -t mf-stt-out.XXXXXX)"
ERR="$(mktemp -t mf-stt-err.XXXXXX)"
trap 'rm -f "$OUT" "$ERR"' EXIT

run_case() {
  local name="$1" expect_pattern="$2" extra_hdr="${3:-}"
  echo "  [ws] $name"

  # Negative cases (no auth, etc.) shouldn't pump audio.
  if [[ "$name" == "no_auth_401" || "$name" == "bad_token_401" ]]; then
    set +e
    websocat --binary --no-close \
      ${extra_hdr:+-H "$extra_hdr"} \
      "$WS_URL" </dev/null >"$OUT" 2>"$ERR"
    rc=$?
    set -e
    # websocat exits non-zero on handshake reject; require 401 in stderr.
    grep -qE "HTTP/1\.[01] 401" "$ERR" || {
      echo "    FAIL: expected 401 on handshake; got:"
      sed -n 's/^/      /p' "$ERR" | head -20
      return 1
    }
    return 0
  fi

  # Happy path: stream 8 KB of PCM, expect transcript JSON back.
  set +e
  websocat --binary -B 65536 \
    -H "Authorization: Bearer $TOKEN" \
    "$WS_URL" <"$PCM" >"$OUT" 2>"$ERR" &
  ws_pid=$!
  sleep 3
  kill -TERM "$ws_pid" 2>/dev/null || true
  wait "$ws_pid" 2>/dev/null || true
  set -e

  if ! grep -qE "$expect_pattern" "$OUT"; then
    echo "    FAIL: expected pattern /$expect_pattern/ not found in output"
    head -20 "$OUT"
    return 1
  fi

  # Each frame must be valid JSON with a `type` field.
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    echo "$line" | jq -e '.type' >/dev/null || {
      echo "    FAIL: non-conforming frame: $line"
      return 1
    }
  done <"$OUT"
}

fail=0
run_case happy_path '"type":"transcript"|"type":"partial"|"type":"final"' || fail=1
run_case no_auth_401 ''                                                    || fail=1
run_case bad_token_401 '' "Authorization: Bearer not-a-real-token"         || fail=1

if (( fail )); then
  echo "[ws] FAILED"
  exit 1
fi
echo "[ws] OK"
