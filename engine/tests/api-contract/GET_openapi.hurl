# GET /openapi.json — schema document, no auth.
# Captures the doc as `openapi_spec` so downstream files can reference it.

GET {{ENGINE_URL}}/openapi.json

HTTP 200
[Asserts]
header "Content-Type" startsWith "application/json"
jsonpath "$.openapi" matches /^3\.[01]\./
jsonpath "$.info.title" == "motion-forge engine"
jsonpath "$.info.version" exists
jsonpath "$.paths./healthz.get" exists
jsonpath "$.paths./v1/themes.get" exists
jsonpath "$.paths./v1/generate.post" exists
jsonpath "$.paths./v1/iterate.post" exists
jsonpath "$.paths./v1/brief/parse.post" exists
jsonpath "$.paths./v1/brief/synth.post" exists
jsonpath "$.paths./v1/presets.get" exists
jsonpath "$.paths./v1/export/{format}.post" exists
jsonpath "$.paths./v1/ingest.post" exists
jsonpath "$.paths./v1/figma/import.post" exists
jsonpath "$.paths./v1/web-export/{format}.post" exists
jsonpath "$.components.securitySchemes.bearerAuth.scheme" == "bearer"
[Captures]
openapi_version: jsonpath "$.openapi"
api_version: jsonpath "$.info.version"
