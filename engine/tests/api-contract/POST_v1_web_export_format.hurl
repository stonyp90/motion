# POST /v1/web-export/{format} — bundle a project as runnable web artifact
# (html / lottie-web / canvas / webm).

POST {{ENGINE_URL}}/v1/web-export/html
Authorization: Bearer {{token}}
Content-Type: application/json
file,fixtures/lottie_minimal.json;

HTTP 202
[Asserts]
jsonpath "$.export_id" matches /^[a-f0-9-]{36}$/
jsonpath "$.format" == "html"
jsonpath "$.bundle_url" matches /^https?:\/\//
jsonpath "$.size_bytes" >= 1
jsonpath "$.includes_runtime" exists
duration < 5000
[Captures]
web_export_id: jsonpath "$.export_id"


# Happy: lottie-web format.
POST {{ENGINE_URL}}/v1/web-export/lottie-web
Authorization: Bearer {{token}}
Content-Type: application/json
file,fixtures/lottie_minimal.json;
HTTP 202
[Asserts]
jsonpath "$.format" == "lottie-web"


# Error: no token → 401.
POST {{ENGINE_URL}}/v1/web-export/html
Content-Type: application/json
file,fixtures/lottie_minimal.json;
HTTP 401


# Error: unsupported format → 404.
POST {{ENGINE_URL}}/v1/web-export/flash
Authorization: Bearer {{token}}
Content-Type: application/json
file,fixtures/lottie_minimal.json;
HTTP 404


# Error: invalid body → 400.
POST {{ENGINE_URL}}/v1/web-export/html
Authorization: Bearer {{token}}
Content-Type: application/json
{}
HTTP 400


# Error: wrong content-type → 415.
POST {{ENGINE_URL}}/v1/web-export/html
Authorization: Bearer {{token}}
Content-Type: text/html
```
<html/>
```
HTTP 415


# Cleanup.
DELETE {{ENGINE_URL}}/v1/web-export/{{web_export_id}}
Authorization: Bearer {{token}}
HTTP *
