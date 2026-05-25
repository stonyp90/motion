# POST /v1/brief/parse — extract structured brief from free-form text.

POST {{ENGINE_URL}}/v1/brief/parse
Authorization: Bearer {{token}}
Content-Type: application/json
file,fixtures/brief_chrono.json;

HTTP 200
[Asserts]
jsonpath "$.brief.title" exists
jsonpath "$.brief.summary" exists
jsonpath "$.brief.objectives" isCollection
jsonpath "$.brief.objectives" count >= 1
jsonpath "$.brief.audience" exists
jsonpath "$.brief.tone" exists
jsonpath "$.brief.key_messages" isCollection
jsonpath "$.brief.constraints" exists
jsonpath "$.confidence" >= 0.0
jsonpath "$.confidence" <= 1.0
duration < 8000


# Error: no token → 401.
POST {{ENGINE_URL}}/v1/brief/parse
Content-Type: application/json
{ "text": "hello" }
HTTP 401


# Error: empty text → 400.
POST {{ENGINE_URL}}/v1/brief/parse
Authorization: Bearer {{token}}
Content-Type: application/json
{ "text": "" }
HTTP 400
[Asserts]
jsonpath "$.error.code" == "invalid_request"
jsonpath "$.error.fields" contains "text"


# Error: missing `text` field entirely → 400.
POST {{ENGINE_URL}}/v1/brief/parse
Authorization: Bearer {{token}}
Content-Type: application/json
{}
HTTP 400


# Error: wrong content-type → 415.
POST {{ENGINE_URL}}/v1/brief/parse
Authorization: Bearer {{token}}
Content-Type: text/plain
```
this is plain text not json
```
HTTP 415
