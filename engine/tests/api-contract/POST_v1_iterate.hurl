# POST /v1/iterate — apply a delta to an existing project.
# Depends on POST_v1_generate.hurl running first; project_id is loaded from
# the shared run.sh vars file.

POST {{ENGINE_URL}}/v1/iterate
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project_id": "{{project_id}}",
  "change": {
    "type": "scene.update",
    "scene_id": "{{first_scene_id}}",
    "patch": {
      "duration_ms": 2400,
      "text": "Banking, designed for stillness."
    }
  }
}

HTTP 200
[Asserts]
jsonpath "$.project_id" == "{{project_id}}"
jsonpath "$.revision" >= 2
jsonpath "$.diff.applied" == true
jsonpath "$.diff.changes" count >= 1
jsonpath "$.lottie_url" matches /^https?:\/\//
duration < 10000


# Error: no token → 401.
POST {{ENGINE_URL}}/v1/iterate
Content-Type: application/json
{ "project_id": "{{project_id}}", "change": { "type": "noop" } }
HTTP 401


# Error: unknown project_id → 404.
POST {{ENGINE_URL}}/v1/iterate
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "project_id": "00000000-0000-0000-0000-000000000000",
  "change": { "type": "scene.update", "scene_id": "x", "patch": {} }
}
HTTP 404
[Asserts]
jsonpath "$.error.code" == "project_not_found"


# Error: malformed change object → 400.
POST {{ENGINE_URL}}/v1/iterate
Authorization: Bearer {{token}}
Content-Type: application/json
{ "project_id": "{{project_id}}", "change": "this should be an object" }
HTTP 400


# Error: wrong content-type → 415.
POST {{ENGINE_URL}}/v1/iterate
Authorization: Bearer {{token}}
Content-Type: application/xml
```
<change/>
```
HTTP 415
