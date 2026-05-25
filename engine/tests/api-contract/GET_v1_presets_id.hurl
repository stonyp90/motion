# GET /v1/presets/{id} — fetch one preset by id.
# `first_preset_id` is captured by GET_v1_presets.hurl and exposed via run.sh.

GET {{ENGINE_URL}}/v1/presets/{{first_preset_id}}
Authorization: Bearer {{token}}

HTTP 200
[Asserts]
jsonpath "$.id" == "{{first_preset_id}}"
jsonpath "$.name" exists
jsonpath "$.slug" matches /^[a-z0-9-]+$/
jsonpath "$.scenes" isCollection
jsonpath "$.scenes" count >= 1
jsonpath "$.lottie_template" exists
jsonpath "$.brand_slots" isCollection
duration < 1000


# Error: no token → 401.
GET {{ENGINE_URL}}/v1/presets/{{first_preset_id}}
HTTP 401


# Error: unknown id → 404.
GET {{ENGINE_URL}}/v1/presets/00000000-0000-0000-0000-000000000000
Authorization: Bearer {{token}}
HTTP 404
[Asserts]
jsonpath "$.error.code" == "preset_not_found"


# Error: malformed id (not a uuid/slug) → 400.
GET {{ENGINE_URL}}/v1/presets/!!!@@@###
Authorization: Bearer {{token}}
HTTP 400
