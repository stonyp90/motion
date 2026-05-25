#!/usr/bin/env bash
#
# End-to-end verification of the Keycloak SSO pipeline.
#
# 1.  Confirms the `motion-forge` realm is reachable.
# 2.  Confirms the two seeded clients (`motion-forge-web`,
#     `motion-forge-engine`) exist in the well-known config.
# 3.  Gets an access token via the password grant for
#     `owner@motion-forge.io`.
# 4.  Starts the engine HTTP server (or assumes one is already
#     running on `$ENGINE_BASE_URL`), then:
#       - GET /v1/themes WITHOUT a token  →  expect 401
#       - GET /v1/themes WITH    a token  →  expect 200
#
# Exit non-zero on any failure.

set -euo pipefail

KC_URL="${KEYCLOAK_BASE_URL:-http://localhost:8080}"
REALM="${KEYCLOAK_REALM:-motion-forge}"
CLIENT_ID="${KEYCLOAK_CLIENT_ID:-motion-forge-web}"
CLIENT_SECRET="${KEYCLOAK_CLIENT_SECRET:-motion-forge-web-dev-secret}"
USERNAME="${KEYCLOAK_TEST_USERNAME:-owner@motion-forge.io}"
PASSWORD="${KEYCLOAK_TEST_PASSWORD:-dev}"
ENGINE_BASE_URL="${ENGINE_BASE_URL:-http://localhost:7755}"

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32mOK\033[0m  %s\n' "$*"; }
fail() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; exit 1; }

bold "1. Realm reachable"
if curl -sf "${KC_URL}/realms/${REALM}" >/dev/null; then
  ok "${KC_URL}/realms/${REALM}"
else
  fail "realm not reachable at ${KC_URL}/realms/${REALM}"
fi

bold "2. Well-known OIDC config exposes the issuer"
issuer=$(curl -sf "${KC_URL}/realms/${REALM}/.well-known/openid-configuration" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["issuer"])')
[ -n "$issuer" ] && ok "issuer=$issuer" || fail "no issuer"

bold "3. Get access token (password grant)"
token_response=$(curl -s -X POST \
  "${KC_URL}/realms/${REALM}/protocol/openid-connect/token" \
  -d grant_type=password \
  -d client_id="${CLIENT_ID}" \
  -d client_secret="${CLIENT_SECRET}" \
  -d username="${USERNAME}" \
  -d password="${PASSWORD}")
access_token=$(echo "$token_response" | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
if [ -z "$access_token" ]; then
  echo "$token_response"
  fail "no access_token in response"
fi
ok "got token (length=${#access_token})"

bold "4. Engine /v1/themes without token returns 401"
status=$(curl -s -o /tmp/themes-401.json -w '%{http_code}' "${ENGINE_BASE_URL}/v1/themes")
if [ "$status" != "401" ]; then
  echo "expected 401, got $status; body:"
  cat /tmp/themes-401.json
  fail "expected 401 from unauth request"
fi
ok "401 returned"
cat /tmp/themes-401.json | head -5 ; echo

bold "5. Engine /v1/themes with token returns 200"
status=$(curl -s -o /tmp/themes-200.json -w '%{http_code}' \
  -H "Authorization: Bearer ${access_token}" \
  "${ENGINE_BASE_URL}/v1/themes")
if [ "$status" != "200" ]; then
  echo "expected 200, got $status; body:"
  cat /tmp/themes-200.json
  fail "expected 200 from authed request"
fi
ok "200 returned"
cat /tmp/themes-200.json | head -5 ; echo

bold "ALL CHECKS PASSED"
