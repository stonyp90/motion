# POST /v1/ingest — multipart upload of source assets (logo, footage, audio).

POST {{ENGINE_URL}}/v1/ingest
Authorization: Bearer {{token}}
[MultipartFormData]
kind: logo
file: file,fixtures/logo_mark.svg; image/svg+xml
metadata: file,fixtures/ingest_metadata.json; application/json

HTTP 201
[Asserts]
jsonpath "$.asset_id" matches /^[a-f0-9-]{36}$/
jsonpath "$.kind" == "logo"
jsonpath "$.url" matches /^https?:\/\//
jsonpath "$.checksum_sha256" matches /^[a-f0-9]{64}$/
jsonpath "$.size_bytes" >= 1
duration < 5000
[Captures]
asset_id: jsonpath "$.asset_id"


# Error: no token → 401.
POST {{ENGINE_URL}}/v1/ingest
[MultipartFormData]
kind: logo
file: file,fixtures/logo_mark.svg; image/svg+xml
HTTP 401


# Error: missing required `kind` part → 400.
POST {{ENGINE_URL}}/v1/ingest
Authorization: Bearer {{token}}
[MultipartFormData]
file: file,fixtures/logo_mark.svg; image/svg+xml
HTTP 400


# Error: wrong outer content-type (json instead of multipart) → 415.
POST {{ENGINE_URL}}/v1/ingest
Authorization: Bearer {{token}}
Content-Type: application/json
{ "kind": "logo" }
HTTP 415


# Error: unsupported mime type for `kind=logo` → 422.
POST {{ENGINE_URL}}/v1/ingest
Authorization: Bearer {{token}}
[MultipartFormData]
kind: logo
file: file,fixtures/ingest_metadata.json; application/json
HTTP 422
[Asserts]
jsonpath "$.error.code" == "unsupported_media"


# Cleanup: delete the asset.
DELETE {{ENGINE_URL}}/v1/assets/{{asset_id}}
Authorization: Bearer {{token}}
HTTP *
