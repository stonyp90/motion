#!/usr/bin/env bash
# schema-check.sh — replays each hurl file with --json output, then validates
# every captured response body against the live /openapi.json using ajv-cli.
#
# Why ajv-cli? It's the most boring choice (one `npm i -g ajv-cli ajv-formats`
# and it speaks JSON Schema draft-2020-12, which OpenAPI 3.1 emits directly).
# openapi-spec-validator only validates the spec itself, not responses against
# it, so it's the wrong tool for this layer.
#
# Required env: ENGINE_URL, TOKEN.

set -euo pipefail

: "${ENGINE_URL:?ENGINE_URL required}"
: "${TOKEN:?TOKEN required}"

HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d -t mf-schema.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

command -v hurl >/dev/null || { echo "hurl missing (brew install hurl)" >&2; exit 2; }
command -v jq   >/dev/null || { echo "jq missing"                       >&2; exit 2; }
command -v ajv  >/dev/null || { echo "ajv missing (npm i -g ajv-cli ajv-formats)" >&2; exit 2; }

# 1. Fetch the live OpenAPI doc.
SPEC="$WORK/openapi.json"
curl -fsS "$ENGINE_URL/openapi.json" -o "$SPEC"
echo "[schema] fetched spec: $(jq -r '.info.version' "$SPEC")"

# 2. Split each path/method into its own JSON-Schema file ajv can consume.
#    OpenAPI nests schemas under .components.schemas — we expose those plus
#    each operation's 2xx response schema as top-level $defs.
SCHEMAS_DIR="$WORK/schemas"
mkdir -p "$SCHEMAS_DIR"
jq -c '
  .paths
  | to_entries[]
  | . as $p
  | .value
  | to_entries[]
  | select(.key | IN("get","post","put","patch","delete"))
  | {
      path: $p.key,
      method: .key,
      operation_id: (.value.operationId // ($p.key + "_" + .key)),
      responses: .value.responses
    }
' "$SPEC" > "$WORK/operations.ndjson"

# 3. Replay every hurl file with --json so we get a structured run log.
declare -i pass=0 fail=0
for hurl_file in "$HERE"/*.hurl; do
  [[ "$(basename "$hurl_file")" == _*.hurl ]] && continue
  name="$(basename "$hurl_file" .hurl)"
  log="$WORK/$name.json"

  echo "[schema] replay $name"
  hurl --json --variable token="$TOKEN" \
       --variable ENGINE_URL="$ENGINE_URL" \
       --file-root "$HERE" \
       "$hurl_file" >"$log" || true

  # Pull every successful 2xx body and validate it against the matching
  # operation's response schema.
  jq -c 'select(.entries) | .entries[]
         | select(.response.status >= 200 and .response.status < 300)
         | {
             url:    .request.url,
             method: .request.method,
             status: .response.status,
             body:   (.response.body? // null)
           }' "$log" 2>/dev/null | while IFS= read -r row; do
    method="$(echo "$row" | jq -r '.method | ascii_downcase')"
    url="$(echo "$row" | jq -r '.url')"
    path="$(echo "$url" | sed -E 's|^https?://[^/]+||' | sed -E 's|\?.*$||')"
    # Normalize /v1/presets/abc-123 → /v1/presets/{id} for spec lookup.
    norm_path="$(echo "$path" | sed -E 's|/[a-f0-9-]{36}|/{id}|g; s|/(mp4|gif|webm|html|lottie-web|canvas|png-seq)$|/{format}|')"

    schema_file="$WORK/op_${method}_${norm_path//\//_}.json"
    jq --arg p "$norm_path" --arg m "$method" '
      .paths[$p][$m].responses // {} | to_entries
      | map(select(.key | startswith("2")))[0].value.content["application/json"].schema // {}
    ' "$SPEC" > "$schema_file"

    if [[ "$(jq 'length' "$schema_file")" == "0" ]]; then
      echo "  [skip] $method $norm_path — no 2xx JSON schema in spec"
      continue
    fi

    body_file="$WORK/body.json"
    echo "$row" | jq -c '.body' > "$body_file"

    if ajv validate -c ajv-formats --spec=draft2020 \
        -s "$schema_file" -r "$SPEC" -d "$body_file" >/dev/null 2>&1; then
      pass+=1
      echo "  [ok]   $method $norm_path"
    else
      fail+=1
      echo "  [FAIL] $method $norm_path"
      ajv validate -c ajv-formats --spec=draft2020 \
          -s "$schema_file" -r "$SPEC" -d "$body_file" 2>&1 | sed 's/^/         /'
    fi
  done
done

echo
echo "[schema] pass=$pass fail=$fail"
(( fail == 0 ))
