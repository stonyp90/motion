# Runbook: local development

This runbook spins up the full motion-forge stack on a laptop, then walks the most common failure modes. If you're contributing for the first time, also read [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for the prerequisites and the PR workflow.

Target setup time on a warm cache: under 3 minutes. Cold cache (first `docker compose pull`, first `cargo build --release`, first `npm ci`): 8–12 minutes depending on bandwidth.

---

## 1. The happy path

```bash
# In one terminal: stand up the local services.
docker compose up -d
docker compose logs -f keycloak   # wait for "Imported realm motion-forge"

# In a second terminal: build the engine + Python sidecars.
cd engine
cargo build --release
./scripts/setup-python.sh
./scripts/fetch-whisper-model.sh tiny

# In a third terminal: run the web app.
cd web
npm ci
npm run dev
```

Open `http://localhost:3001`. You land on Keycloak's login screen. Sign in as `demo / demo`. You're now in the studio.

The seed brief is preloaded. Hit **Generate**. The first run takes ~90 seconds — Ollama is cold, the orchestrator is cold, the Python renderer is cold. Subsequent renders are 8–15 seconds; iterates are sub-second.

To run the engine standalone (no web), useful for poking at the HTTP surface:

```bash
cd engine
./target/release/motion-forge serve --bind 127.0.0.1:7755
curl http://127.0.0.1:7755/healthz
curl http://127.0.0.1:7755/themes
curl http://127.0.0.1:7755/openapi.json | jq .
```

In standalone mode you need `MOTION_FORGE_AUTH_FALLBACK_KEY=dev-key` set, then send `Authorization: Bearer dev-key` on every protected request. Do not enable this in CI or in prod.

---

## 2. Service ports and credentials

| Service | URL | Default credentials | Where the config lives |
| --- | --- | --- | --- |
| Web (Next.js) | `http://localhost:3001` | OIDC through Keycloak | `web/.env.local` |
| Engine HTTP | `http://localhost:7755` | `Bearer dev-key` (fallback only) | `engine/.env` |
| Keycloak | `http://localhost:8080` | `admin / admin` (master realm) | `docker-compose.yml`, `keycloak/realm/motion-forge.json` |
| Keycloak realm | `motion-forge` | `demo / demo` | as above |
| Postgres | `localhost:5435` | `postgres / postgres` | `docker-compose.yml` |
| Redis | `localhost:6379` | none | `docker-compose.yml` |
| MinIO console | `http://localhost:9003` | `minio / minio12345` | `docker-compose.yml` |
| MinIO S3 endpoint | `http://localhost:9002` | as above | `docker-compose.yml` |
| Ollama | `http://localhost:11434` | none | `docker-compose.yml` |
| Mailhog UI | `http://localhost:8026` | none | `docker-compose.yml` |

The web app picks up the engine URL from `NEXT_PUBLIC_ENGINE_URL` (default `http://localhost:7755`). The engine picks up the Keycloak issuer URL from `KEYCLOAK_ISSUER` (default `http://localhost:8080/realms/motion-forge`).

---

## 3. Common failure modes

### 3.1 Keycloak login returns "Invalid redirect URI"

Cause: the studio is running on a port other than 3001, or you opened `http://127.0.0.1:3001` instead of `http://localhost:3001`. The realm JSON lists only `http://localhost:3001/*` as a valid redirect.

Fix:
- Run `npm run dev` from `web/` without overriding `PORT`.
- Use `localhost`, not `127.0.0.1`, in the browser.
- If you must change the port, edit `keycloak/realm/motion-forge.json`, restart Keycloak (`docker compose restart keycloak`), and wait for the import-on-boot to finish.

### 3.2 `cargo build` fails on `whisper-rs` with "cmake: not found"

Cause: `whisper-rs` builds the bundled `whisper.cpp` C++ project; it needs `cmake` and a working C++ toolchain.

Fix:
- macOS: `brew install cmake`. `xcode-select --install` if you've never installed the Xcode CLT.
- Ubuntu: `sudo apt install -y cmake build-essential pkg-config libssl-dev`.

### 3.3 First `/generate` returns 500 with "ollama: connection refused"

Cause: the Ollama container is up but the model isn't pulled yet.

Fix:
```bash
docker exec -it motion-forge-ollama ollama pull llama3.2:3b
# or, switch to a different backend:
export MOTION_FORGE_LLM_BACKEND=mock
```

The mock backend returns a valid deterministic timeline in under 5 ms — useful when iterating on the renderer without burning a real LLM call.

### 3.4 Render finishes but the MP4 is empty / corrupt

Cause: the Python `lottie` package can't find a usable FFmpeg, or the bundled `cairo` is missing on the host.

Fix:
- macOS: `brew install ffmpeg cairo pango libffi`.
- Ubuntu: `sudo apt install -y ffmpeg libcairo2 libpango-1.0-0 libpangocairo-1.0-0`.
- Reproduce manually: `cd engine && .venv/bin/python scripts/render_lottie.py fixtures/sample.lottie.json /tmp/out.mp4 && open /tmp/out.mp4`.

### 3.5 Studio is logged in but every POST returns 401

Cause: the Next-side cookie has a stale access token (most often after Keycloak restarts and rotates its signing key).

Fix:
- In the browser: visit `http://localhost:3001/api/auth/signout` to force a token rotation.
- If the JWKS cache on the engine is stale: `docker exec -it motion-forge-redis redis-cli DEL jwks:keycloak`.

### 3.6 Studio reloads stop hot-reloading after a long session

Cause: Next 15's file-watcher hits the macOS `kern.maxfiles` cap when MinIO + Postgres are also watching directories.

Fix:
- `sudo launchctl limit maxfiles 65536 200000` and re-open the terminal.
- Long-term: edit `/Library/LaunchDaemons/limit.maxfiles.plist` so the limit survives reboots.

### 3.7 `cargo test --workspace --all-features` is red on `http::tests::server_starts_and_serves`

Cause: a stale process is bound to port 7755 (a previous `motion-forge serve` was Ctrl-Z'd, not killed).

Fix:
```bash
lsof -nP -iTCP:7755 -sTCP:LISTEN
kill -9 <pid>
```

### 3.8 MinIO bucket isn't created on first run

The engine creates buckets lazily on first write. If you want to pre-create:
```bash
docker exec -it motion-forge-minio mc alias set local http://localhost:9000 minio minio12345
docker exec -it motion-forge-minio mc mb local/mf-data-dev
```

### 3.9 The engine logs "Whisper model not found"

Cause: `./scripts/fetch-whisper-model.sh` wasn't run, or it landed in the wrong directory.

Fix:
```bash
cd engine
ls models/    # you should see ggml-tiny.bin (or the size you fetched)
./scripts/fetch-whisper-model.sh tiny  # idempotent; re-fetches if missing
```

The engine reads `MOTION_FORGE_WHISPER_MODEL` (default `models/ggml-tiny.bin`). Set it to an absolute path if your models live elsewhere.

---

## 4. Tearing down

```bash
# Stop services, keep data.
docker compose stop

# Stop services and wipe data volumes (Postgres, Redis, MinIO, Keycloak metadata).
docker compose down -v

# Wipe local builds (frees ~6 GB).
cd engine && cargo clean
cd web && rm -rf .next node_modules
```

If you've corrupted the local state past the point of teardown helping, the nuclear option is `docker system prune -a --volumes` plus the two `cargo clean` / `rm -rf .next node_modules` above. Then rerun the bootstrap from the top.

---

## 5. Observability locally

The engine emits OpenTelemetry to `OTEL_EXPORTER_OTLP_ENDPOINT` if set. For a local Jaeger:

```bash
docker run -d --name jaeger \
  -e COLLECTOR_OTLP_ENABLED=true \
  -p 4317:4317 -p 16686:16686 \
  jaegertracing/all-in-one:1.62
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
cd engine && cargo run --release --bin motion-forge -- serve
open http://localhost:16686
```

Without OTEL set, the engine logs to stdout via `tracing-subscriber` with `RUST_LOG=info,motion_forge=debug` as the recommended dev default.

The web app logs to the browser console and to the Next dev-server stdout. There is no observability proxy in front of it — sourcemaps are inline in dev.
