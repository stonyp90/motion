# GET /v1/themes — list available themes for the authenticated tenant.

GET {{ENGINE_URL}}/v1/themes
Authorization: Bearer {{token}}

HTTP 200
[Asserts]
header "Content-Type" startsWith "application/json"
jsonpath "$.themes" isCollection
jsonpath "$.themes" count >= 1
jsonpath "$.themes[0].id" exists
jsonpath "$.themes[0].name" exists
jsonpath "$.themes[0].palette.primary" matches /^#[0-9a-fA-F]{6}$/
jsonpath "$.themes[0].palette.accent" matches /^#[0-9a-fA-F]{6}$/
jsonpath "$.themes[0].typography.heading" exists
jsonpath "$.themes[0].typography.body" exists
jsonpath "$.themes[0].motion_profile" matches /^(calm|punchy|snappy|cinematic)$/
duration < 1000


# Error path: no token → 401.
GET {{ENGINE_URL}}/v1/themes
HTTP 401
[Asserts]
jsonpath "$.error" exists
jsonpath "$.error.code" == "unauthorized"


# Error path: bogus token → 401.
GET {{ENGINE_URL}}/v1/themes
Authorization: Bearer not-a-real-jwt
HTTP 401


# Error path: wrong scheme → 401.
GET {{ENGINE_URL}}/v1/themes
Authorization: Basic Zm9vOmJhcg==
HTTP 401
