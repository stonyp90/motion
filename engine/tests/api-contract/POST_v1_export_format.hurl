# POST /v1/export/{format} — render Lottie → mp4 / gif / webm / png-seq.
# Tests `mp4` as the canonical happy path; error paths cover other formats.

POST {{ENGINE_URL}}/v1/export/mp4
Authorization: Bearer {{token}}
Content-Type: application/json
file,fixtures/lottie_minimal.json;

HTTP 202
[Asserts]
jsonpath "$.export_id" matches /^[a-f0-9-]{36}$/
jsonpath "$.status" matches /^(queued|rendering|ready)$/
jsonpath "$.format" == "mp4"
jsonpath "$.poll_url" matches /^\/v1\/export\/[a-f0-9-]+\/status$/
duration < 5000
[Captures]
export_id: jsonpath "$.export_id"


# Happy: gif format works too.
POST {{ENGINE_URL}}/v1/export/gif
Authorization: Bearer {{token}}
Content-Type: application/json
file,fixtures/lottie_minimal.json;
HTTP 202
[Asserts]
jsonpath "$.format" == "gif"


# Error: no token → 401.
POST {{ENGINE_URL}}/v1/export/mp4
Content-Type: application/json
file,fixtures/lottie_minimal.json;
HTTP 401


# Error: unsupported format → 404 (no route).
POST {{ENGINE_URL}}/v1/export/holographic
Authorization: Bearer {{token}}
Content-Type: application/json
file,fixtures/lottie_minimal.json;
HTTP 404


# Error: invalid Lottie body → 400.
POST {{ENGINE_URL}}/v1/export/mp4
Authorization: Bearer {{token}}
Content-Type: application/json
{ "this": "is not a lottie doc" }
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_lottie"


# Error: wrong content-type → 415.
POST {{ENGINE_URL}}/v1/export/mp4
Authorization: Bearer {{token}}
Content-Type: application/octet-stream
```
not json
```
HTTP 415


# Cleanup: cancel the queued export.
DELETE {{ENGINE_URL}}/v1/export/{{export_id}}
Authorization: Bearer {{token}}
HTTP *
