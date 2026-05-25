# motion-forge engine — API contract suite integration

This bundle is self-contained. To wire it into the engine repo and CI:

## 1. Copy into the repo

```bash
# from the motion-forge repo root
mkdir -p engine/tests/api-contract
cp -R /tmp/motion-forge-prep/api-tests/. engine/tests/api-contract/
chmod +x engine/tests/api-contract/{run.sh,schema-check.sh,ws_test.sh}
git add engine/tests/api-contract
git commit -m "test(engine): add hurl-based API contract suite"
```

Layout in repo:

```
engine/tests/api-contract/
  _auth.hurl                       # keycloak password grant
  GET_healthz.hurl
  GET_openapi.hurl
  GET_v1_themes.hurl
  GET_v1_presets.hurl
  GET_v1_presets_id.hurl
  POST_v1_brief_parse.hurl
  POST_v1_brief_synth.hurl
  POST_v1_generate.hurl
  POST_v1_iterate.hurl
  POST_v1_export_format.hurl
  POST_v1_ingest.hurl
  POST_v1_figma_import.hurl
  POST_v1_web_export_format.hurl
  ws_test.sh                       # websocat companion for /v1/stt/stream
  schema-check.sh                  # ajv-cli OpenAPI conformance
  run.sh                           # entry point
  fixtures/
    lottie_minimal.json
    brief_chrono.json
    brief_synth_request.json
    logo_mark.svg
    ingest_metadata.json
    oversized_prompt.json          # rewritten at runtime by run.sh
    sample_pcm_16k_mono.raw
  INTEGRATION.md                   # this file
```

## 2. Local invocation

```bash
brew install hurl jq websocat
npm i -g ajv-cli ajv-formats

# Bring up engine + keycloak via the project's docker-compose.
docker compose -f infra/dev/docker-compose.yml up -d engine keycloak postgres redis

# Run.
cd engine/tests/api-contract
ENGINE_URL=http://localhost:8081 \
KC_URL=http://localhost:8080     \
KC_REALM=motion-forge            \
KC_CLIENT_ID=motion-forge-engine \
KC_USER=contract-test@motion-forge.test \
KC_PASS=contract-test-pass       \
./run.sh
```

The script handles readiness polling, token mint, fixture generation, hurl
runs, ws test, and schema validation, then exits non-zero on any failure.

Flags:

| Var            | Default | Purpose                                  |
|----------------|---------|------------------------------------------|
| `READINESS_TIMEOUT` | 90 | Seconds to wait for engine + keycloak    |
| `SKIP_WS`      | 0       | Set to 1 in environments without websocat |
| `SKIP_SCHEMA`  | 0       | Set to 1 to skip ajv schema validation   |

## 3. CI wiring (W25 placeholder)

W25 added the placeholder job — swap its body for:

```yaml
# .github/workflows/api-contract.yml
name: api-contract

on:
  pull_request:
    paths:
      - "engine/**"
      - "engine/tests/api-contract/**"
      - ".github/workflows/api-contract.yml"
  push:
    branches: [main]

jobs:
  contract:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s --health-retries 10
      keycloak:
        image: quay.io/keycloak/keycloak:26.1
        env:
          KEYCLOAK_ADMIN: admin
          KEYCLOAK_ADMIN_PASSWORD: admin
        ports: ["8080:8080"]
        options: --health-cmd "curl -fsS http://localhost:8080/health/ready"

    steps:
      - uses: actions/checkout@v4

      - name: install hurl
        run: |
          curl -fsSL https://github.com/Orange-OpenSource/hurl/releases/download/6.0.0/hurl_6.0.0_amd64.deb -o hurl.deb
          sudo dpkg -i hurl.deb
          hurl --version

      - name: install websocat + ajv
        run: |
          sudo apt-get update && sudo apt-get install -y websocat jq
          npm i -g ajv-cli ajv-formats

      - name: seed keycloak realm
        run: ./scripts/ci/seed-keycloak-test-realm.sh

      - name: start engine
        run: |
          cargo build --release --bin engine
          ./target/release/engine &
          echo $! > engine.pid

      - name: run contract suite
        env:
          ENGINE_URL: http://localhost:8081
          KC_URL: http://localhost:8080
          KC_REALM: motion-forge
          KC_CLIENT_ID: motion-forge-engine
          KC_USER: contract-test@motion-forge.test
          KC_PASS: contract-test-pass
        run: ./engine/tests/api-contract/run.sh

      - name: stop engine
        if: always()
        run: '[[ -f engine.pid ]] && kill "$(cat engine.pid)" || true'

      - name: upload junit
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: api-contract-junit
          path: /tmp/mf-run.*/**/*.junit.xml
```

## 4. Maintenance notes

- **Adding an endpoint**: drop a `METHOD_path.hurl` next to the others, add
  it to the `ORDER=()` array in `run.sh`, and include fixtures under
  `fixtures/`.
- **Capture flow**: variables captured in one hurl file (e.g. `project_id`)
  are propagated by `run.sh` into a shared `--variables-file` for the next
  files in `ORDER`. Keep capture names unique across files.
- **Schema drift**: `schema-check.sh` pulls the *live* `/openapi.json` at run
  time, so the suite always validates against what the engine actually
  serves. If the spec changes, hurl assertions may need updating but schema
  validation will catch the mismatch automatically.
- **Idempotency**: every POST that creates state has a trailing `DELETE …
  HTTP *` step. If you add a new creating endpoint, follow the same pattern.
- **Secrets**: tokens and credentials come from CI env. Never commit
  `KC_PASS` defaults that point at non-test realms.
