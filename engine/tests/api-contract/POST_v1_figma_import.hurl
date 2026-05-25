# POST /v1/figma/import — pull a Figma frame and convert to scenes.
# Uses a stubbed file key fixture that the test harness pre-registers in MOCK
# mode so we don't need real Figma creds during CI.

POST {{ENGINE_URL}}/v1/figma/import
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "file_key": "TEST_FIXTURE_FILE_KEY_0001",
  "node_ids": ["1:2", "1:3"],
  "import_mode": "frames_as_scenes"
}

HTTP 200
[Asserts]
jsonpath "$.imported_scenes" isCollection
jsonpath "$.imported_scenes" count == 2
jsonpath "$.imported_scenes[0].source.file_key" == "TEST_FIXTURE_FILE_KEY_0001"
jsonpath "$.imported_scenes[0].source.node_id" == "1:2"
jsonpath "$.imported_scenes[0].layers" isCollection
jsonpath "$.warnings" isCollection
duration < 20000


# Error: no token → 401.
POST {{ENGINE_URL}}/v1/figma/import
Content-Type: application/json
{ "file_key": "x", "node_ids": [] }
HTTP 401


# Error: missing file_key → 400.
POST {{ENGINE_URL}}/v1/figma/import
Authorization: Bearer {{token}}
Content-Type: application/json
{ "node_ids": ["1:2"] }
HTTP 400


# Error: unknown file → 404 (figma adapter returns 404 not 502).
POST {{ENGINE_URL}}/v1/figma/import
Authorization: Bearer {{token}}
Content-Type: application/json
{ "file_key": "DOES_NOT_EXIST", "node_ids": ["1:2"] }
HTTP 404


# Error: wrong content-type → 415.
POST {{ENGINE_URL}}/v1/figma/import
Authorization: Bearer {{token}}
Content-Type: text/plain
```
file_key=x
```
HTTP 415
