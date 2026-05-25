# Keycloak password grant — fetches an access token for the test user.
#
# Required env vars (export before running):
#   KC_URL          e.g. http://localhost:8080
#   KC_REALM        e.g. motion-forge
#   KC_CLIENT_ID    e.g. motion-forge-engine
#   KC_USER         e.g. test-engineer@motion-forge.test
#   KC_PASS         e.g. testpass
#
# Usage (other files import the captured token):
#   hurl --variables-file env.vars _auth.hurl
#   TOKEN=$(hurl ... | jq -r .access_token)
#   hurl --variable token=$TOKEN GET_v1_themes.hurl
#
# The grant is intentionally password grant (RFC 6749 §4.3) so the suite
# can run unattended in CI. Production tokens should never use this flow.

POST {{KC_URL}}/realms/{{KC_REALM}}/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded
[FormParams]
grant_type: password
client_id: {{KC_CLIENT_ID}}
username: {{KC_USER}}
password: {{KC_PASS}}
scope: openid profile email

HTTP 200
[Asserts]
jsonpath "$.access_token" exists
jsonpath "$.token_type" == "Bearer"
jsonpath "$.expires_in" >= 60
jsonpath "$.refresh_token" exists
[Captures]
token: jsonpath "$.access_token"
refresh_token: jsonpath "$.refresh_token"
expires_in: jsonpath "$.expires_in"
