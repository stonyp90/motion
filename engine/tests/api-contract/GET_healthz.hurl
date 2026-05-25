# GET /healthz — liveness probe, no auth.
# Hit anonymously and assert the well-known shape.

GET {{ENGINE_URL}}/healthz

HTTP 200
[Asserts]
header "Content-Type" startsWith "application/json"
jsonpath "$.status" == "ok"
jsonpath "$.version" matches /^\d+\.\d+\.\d+/
jsonpath "$.uptime_seconds" >= 0
jsonpath "$.checks.db" == "ok"
jsonpath "$.checks.redis" == "ok"
duration < 500


# Error path: wrong method should 405.
POST {{ENGINE_URL}}/healthz
HTTP 405


# Error path: trailing junk path should 404, not match.
GET {{ENGINE_URL}}/healthz/does-not-exist
HTTP 404
