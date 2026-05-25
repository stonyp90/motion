# POST /v1/brief/synth — synthesize N scenes from a parsed brief.
# Chrono fixture targets 21 scenes / 90 s — assert count exactly.

POST {{ENGINE_URL}}/v1/brief/synth
Authorization: Bearer {{token}}
Content-Type: application/json
file,fixtures/brief_synth_request.json;

HTTP 200
[Asserts]
jsonpath "$.scenes" isCollection
jsonpath "$.scenes" count == 21
jsonpath "$.scenes[0].id" exists
jsonpath "$.scenes[0].order" == 0
jsonpath "$.scenes[20].order" == 20
jsonpath "$.scenes[*].duration_ms" includes 4286
jsonpath "$.total_duration_ms" >= 89000
jsonpath "$.total_duration_ms" <= 91000
jsonpath "$.beats" isCollection
jsonpath "$.beats[0].type" matches /^(hook|intro|claim|proof|cta)$/
duration < 15000


# Error: no token → 401.
POST {{ENGINE_URL}}/v1/brief/synth
Content-Type: application/json
{ "brief": {}, "duration": 30, "scene_count": 5 }
HTTP 401


# Error: scene_count out of range → 400.
POST {{ENGINE_URL}}/v1/brief/synth
Authorization: Bearer {{token}}
Content-Type: application/json
{
  "brief": { "title": "x", "summary": "y", "objectives": ["z"] },
  "duration": 30,
  "scene_count": 999
}
HTTP 400
[Asserts]
jsonpath "$.error.fields[0].field" == "scene_count"


# Error: missing brief → 400.
POST {{ENGINE_URL}}/v1/brief/synth
Authorization: Bearer {{token}}
Content-Type: application/json
{ "duration": 30, "scene_count": 5 }
HTTP 400


# Error: wrong content-type → 415.
POST {{ENGINE_URL}}/v1/brief/synth
Authorization: Bearer {{token}}
Content-Type: application/xml
```
<brief/>
```
HTTP 415
