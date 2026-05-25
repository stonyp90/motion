# GET /v1/presets — list curated preset templates.

GET {{ENGINE_URL}}/v1/presets
Authorization: Bearer {{token}}

HTTP 200
[Asserts]
jsonpath "$.presets" isCollection
jsonpath "$.presets" count >= 1
jsonpath "$.presets[0].id" exists
jsonpath "$.presets[0].slug" matches /^[a-z0-9-]+$/
jsonpath "$.presets[0].name" exists
jsonpath "$.presets[0].category" matches /^(social|product|explainer|promo|intro)$/
jsonpath "$.presets[0].duration_seconds" >= 1
jsonpath "$.presets[0].thumbnail_url" matches /^https?:\/\//
duration < 1500
[Captures]
first_preset_id: jsonpath "$.presets[0].id"


# Error: no token → 401.
GET {{ENGINE_URL}}/v1/presets
HTTP 401


# Pagination edge: huge page_size should clamp, not 500.
GET {{ENGINE_URL}}/v1/presets?page_size=99999
Authorization: Bearer {{token}}
HTTP 200
[Asserts]
jsonpath "$.presets" count <= 200


# Bad query param type → 400.
GET {{ENGINE_URL}}/v1/presets?page_size=not-a-number
Authorization: Bearer {{token}}
HTTP 400
