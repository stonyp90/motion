# POST /v1/generate — create a brand-new motion project from a prompt+cast+brand.
# Happy path captures the project_id so the iterate suite can reuse it.

POST {{ENGINE_URL}}/v1/generate
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "prompt": "30-second product reveal for a calm Nordic banking app",
  "cast": [
    { "role": "narrator", "voice_id": "calm-male-01" },
    { "role": "logo", "asset_id": "brand:nordbank:wordmark" }
  ],
  "brand": {
    "id": "test-tenant-brand-01",
    "palette": { "primary": "#0e4f4a", "accent": "#f5b700" },
    "typography": { "heading": "Söhne", "body": "Inter" },
    "motion_profile": "calm"
  },
  "duration_seconds": 30,
  "aspect_ratio": "16:9"
}

HTTP 201
[Asserts]
header "Content-Type" startsWith "application/json"
header "Location" matches /^\/v1\/projects\/[a-f0-9-]+$/
jsonpath "$.project_id" matches /^[a-f0-9-]{36}$/
jsonpath "$.status" matches /^(queued|generating|ready)$/
jsonpath "$.scenes" isCollection
jsonpath "$.scenes" count >= 1
jsonpath "$.scenes[0].id" exists
jsonpath "$.scenes[0].duration_ms" >= 100
jsonpath "$.lottie_url" matches /^https?:\/\//
jsonpath "$.usage.tokens_in" >= 0
jsonpath "$.usage.tokens_out" >= 0
duration < 30000
[Captures]
project_id: jsonpath "$.project_id"
# Persist for downstream — written by run.sh into a shared vars file.


# Error: missing auth → 401.
POST {{ENGINE_URL}}/v1/generate
Content-Type: application/json
{ "prompt": "x", "cast": [], "brand": { "id": "x" } }
HTTP 401


# Error: malformed body (missing required `prompt`) → 400.
POST {{ENGINE_URL}}/v1/generate
Authorization: Bearer {{token}}
Content-Type: application/json
{ "cast": [], "brand": { "id": "x" } }
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_request"
jsonpath "$.error.fields" contains "prompt"


# Error: wrong content-type → 415.
POST {{ENGINE_URL}}/v1/generate
Authorization: Bearer {{token}}
Content-Type: text/plain
```
prompt=hello
```
HTTP 415


# Error: prompt too long (>4096 chars) → 422.
POST {{ENGINE_URL}}/v1/generate
Authorization: Bearer {{token}}
Content-Type: application/json
file,fixtures/oversized_prompt.json;
HTTP 422
[Asserts]
jsonpath "$.error.code" == "validation_failed"
jsonpath "$.error.fields[0].field" == "prompt"
jsonpath "$.error.fields[0].rule" == "max_length"


# Cleanup: delete the created project so the run is idempotent.
DELETE {{ENGINE_URL}}/v1/projects/{{project_id}}
Authorization: Bearer {{token}}
HTTP *
