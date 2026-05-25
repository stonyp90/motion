# Keycloak — motion-forge SSO

The web UI signs users in against a [Keycloak 26](https://www.keycloak.org)
realm called `motion-forge`. The engine validates every incoming JWT
against the same realm via JWKS.

This directory holds:

| File | Purpose |
|---|---|
| `realm-export.json` | Pre-baked realm with clients, roles, and dev users. Auto-imported by `docker compose up keycloak`. |
| `README.md` | This file. |

---

## Run it locally

From the repo root:

```bash
cd engine
docker compose up -d keycloak

# Wait for it to be ready (about 30-60 s on first run):
until curl -sf http://localhost:8080/realms/motion-forge >/dev/null; do
  echo "waiting for keycloak..."
  sleep 2
done

echo "Keycloak admin console: http://localhost:8080/admin"
echo "Admin user: admin / admin"
echo "Realm:      motion-forge"
```

### Default dev users

| Username | Password | Roles |
|---|---|---|
| `owner@motion-forge.io` | `dev` | `owner`, `member`, `viewer` |
| `member@motion-forge.io` | `dev` | `member`, `viewer` |
| `viewer@motion-forge.io` | `dev` | `viewer` |

### Default clients

| Client ID | Type | Use |
|---|---|---|
| `motion-forge-web` | Public (PKCE) | The Next.js front-end |
| `motion-forge-engine` | Confidential (service-account) | CLI, CI, batch callers |

The web client allows redirects to `http://localhost:3001/*` and
`https://motion.ursly.io/*`. The engine client's dev secret is
`motion-forge-engine-dev-secret` — **rotate this for any non-dev
environment**.

---

## Get a token for testing

```bash
curl -s -X POST http://localhost:8080/realms/motion-forge/protocol/openid-connect/token \
  -d grant_type=password \
  -d client_id=motion-forge-web \
  -d username=owner@motion-forge.io \
  -d password=dev | jq -r .access_token
```

The engine middleware accepts that bearer token on every route that
isn't `/healthz` or `/openapi.json`.

---

## Export an updated realm

If you change anything in the admin console and want to bake it into
`realm-export.json`, run the export from inside the container:

```bash
docker compose exec keycloak /opt/keycloak/bin/kc.sh export \
  --dir /tmp/export \
  --realm motion-forge \
  --users realm_file

docker compose cp keycloak:/tmp/export/motion-forge-realm.json \
  ./infra/keycloak/realm-export.json
```

Inspect the diff and commit. **Do not** export production realms with
their real users into the dev file — strip users first.

---

## Swap for a managed Keycloak in production

The `dev-file` (embedded H2) database is **not** durable — losing the
volume loses all admin changes. For staging and production, run
Keycloak against a managed Postgres.

### 1. Provision the database

In your Terraform / Bicep, add a small Postgres (Azure Flexible Server,
RDS, or whatever you use elsewhere) and put its credentials in a secret
store. Required tables are created by Keycloak on first boot.

### 2. Switch the container config

Either point at a managed Keycloak service (Cloud-IAM, Phase Two,
Red Hat Build of Keycloak) or self-host with the following env:

```yaml
environment:
  KC_DB: postgres
  KC_DB_URL: jdbc:postgresql://kc-prod-pg.internal:5432/keycloak
  KC_DB_USERNAME: ${KEYCLOAK_DB_USER}
  KC_DB_PASSWORD: ${KEYCLOAK_DB_PASSWORD}
  KC_HOSTNAME: auth.motion-forge.io
  KC_HOSTNAME_STRICT: "true"
  KC_HOSTNAME_STRICT_HTTPS: "true"
  KC_PROXY_HEADERS: xforwarded
  KC_HTTPS_PORT: 8443
command:
  - start                  # production mode (no start-dev)
  - --optimized
```

Remove `--import-realm` from the command — production realms are
managed via Terraform (`mrparkers/keycloak` provider) or the admin
console, **not** rebuilt from the dev export.

### 3. Migrate the realm one-time

Use either:

- The Terraform `keycloak_realm` resource with the same shape as
  `realm-export.json`, or
- The admin CLI `kcadm.sh create realms -f realm-export.json` against
  the production server, then **manually delete the dev users**.

### 4. Rotate secrets

The engine client secret `motion-forge-engine-dev-secret` is bundled
into `realm-export.json` for local convenience. Generate a fresh secret
in the production admin console under **Clients → motion-forge-engine →
Credentials → Regenerate** and push it into your secret store.

### 5. Update environment

| Service | Env var |
|---|---|
| Web | `KEYCLOAK_ISSUER=https://auth.motion-forge.io/realms/motion-forge` |
| Web | `KEYCLOAK_CLIENT_ID=motion-forge-web` |
| Web | `KEYCLOAK_CLIENT_SECRET=<not-needed-for-public-client>` |
| Engine | `KEYCLOAK_ISSUER=https://auth.motion-forge.io/realms/motion-forge` |
| Engine | `KEYCLOAK_AUDIENCE=motion-forge-web,motion-forge-engine` |

The engine middleware caches the JWKS for 1 h, so credential rotation
is roughly: rotate in Keycloak → wait for the cache to expire or
restart engine pods.

---

## Troubleshooting

- **Container restarts every 60 s** — the healthcheck is failing. Check
  `docker logs motion-forge-keycloak`. The first boot can take a full
  minute while Keycloak builds optimized assets and imports the realm.
- **`Invalid parameter: redirect_uri`** — the redirect URI from the web
  app is not in the client's `redirectUris` list. Add it to
  `realm-export.json` and re-import (`docker compose down -v keycloak
  && docker compose up -d keycloak`).
- **`invalid_grant`** — the dev user password isn't `dev` anymore, or
  you have leftover state in `motion-forge-keycloak-data`. Wipe with
  `docker compose down -v` and re-up.
- **JWKS fetch from the engine fails** — the engine resolves
  `KEYCLOAK_ISSUER` from inside its own process. On macOS the
  container hostname `keycloak` won't resolve from a process running on
  the host — use `http://localhost:8080/realms/motion-forge`.
