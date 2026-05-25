//! Keycloak JWT validation as a tower::Layer.
//!
//! On every request, the middleware:
//!
//! 1. Skips a static allowlist of paths (`/healthz`, `/openapi.json`,
//!    optionally the WebSocket STT route added by W3) — these stay open
//!    for liveness probes, OpenAPI discovery and unauthenticated voice
//!    streaming.
//! 2. Extracts the bearer token from the `Authorization` header.
//! 3. If the `MOTION_FORGE_AUTH_FALLBACK_KEY` env is set and matches
//!    the token verbatim, the request passes through (with a WARN log).
//!    This exists so `cargo test`, CI, and developers without a local
//!    Keycloak can still drive the engine.
//! 4. Otherwise, decodes the token with the realm's JWKS, checking
//!    `iss`, `aud`, `exp`, `nbf` and the RS256 signature.
//!
//! On failure the middleware returns `401 Unauthorized` with
//! `WWW-Authenticate: Bearer realm="motion-forge"`.
//!
//! The JWKS is fetched lazily on first use and cached for 1 h. Key
//! rotation on the Keycloak side is picked up on the next cache miss.

use axum::body::Body;
use axum::http::{HeaderValue, Request, Response, StatusCode, header};
use axum::response::IntoResponse;
use jsonwebtoken::jwk::{AlgorithmParameters, JwkSet};
use jsonwebtoken::{Algorithm, DecodingKey, TokenData, Validation, decode, decode_header};
use serde::Deserialize;
use std::collections::HashSet;
use std::env;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tower::{Layer, Service};

/// Default cache TTL for the JWKS document.
const JWKS_CACHE_TTL: Duration = Duration::from_secs(60 * 60);

/// HTTP timeout when fetching the JWKS document.
const JWKS_FETCH_TIMEOUT: Duration = Duration::from_secs(5);

/// Env var read on startup to configure the middleware.
pub const ENV_ISSUER: &str = "KEYCLOAK_ISSUER";
pub const ENV_AUDIENCE: &str = "KEYCLOAK_AUDIENCE";
pub const ENV_FALLBACK_KEY: &str = "MOTION_FORGE_AUTH_FALLBACK_KEY";

/// Paths that bypass auth.
///
/// Kept intentionally explicit and small: liveness probes for the
/// platform, OpenAPI discovery for clients, and the WebSocket STT
/// stream that W3 is building (voice should work without sign-in).
pub fn default_skip_paths() -> Vec<&'static str> {
    vec!["/healthz", "/openapi.json", "/v1/stt/stream"]
}

#[derive(Clone)]
pub struct KeycloakConfig {
    /// e.g. `http://localhost:8080/realms/motion-forge`.
    pub issuer: String,
    /// Audiences to accept. Token's `aud` must contain at least one.
    pub audiences: Vec<String>,
    /// Static fallback key. If set and the bearer token equals this
    /// string, the request is accepted with a WARN log.
    pub fallback_key: Option<String>,
    /// Paths that skip auth entirely (prefix-matched on exact path).
    pub skip_paths: Vec<String>,
}

impl KeycloakConfig {
    /// Build from env, falling back to fields that allow auth-disabled
    /// operation if `KEYCLOAK_ISSUER` is unset.
    pub fn from_env() -> Self {
        let issuer = env::var(ENV_ISSUER).unwrap_or_default();
        let audiences = env::var(ENV_AUDIENCE)
            .ok()
            .map(|s| {
                s.split(',')
                    .map(|x| x.trim().to_string())
                    .filter(|x| !x.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_else(|| vec!["motion-forge-web".into(), "motion-forge-engine".into()]);
        let fallback_key = env::var(ENV_FALLBACK_KEY).ok().filter(|s| !s.is_empty());
        Self {
            issuer,
            audiences,
            fallback_key,
            skip_paths: default_skip_paths().into_iter().map(String::from).collect(),
        }
    }

    fn has_issuer(&self) -> bool {
        !self.issuer.is_empty()
    }
}

/// Cached JWKS document.
#[derive(Default)]
struct JwksCache {
    keys: Option<JwkSet>,
    fetched_at: Option<Instant>,
}

impl JwksCache {
    fn is_stale(&self) -> bool {
        match self.fetched_at {
            None => true,
            Some(t) => t.elapsed() > JWKS_CACHE_TTL,
        }
    }
}

/// The tower::Layer.
#[derive(Clone)]
pub struct KeycloakAuthLayer {
    inner: Arc<KeycloakValidator>,
}

impl KeycloakAuthLayer {
    pub fn new(config: KeycloakConfig) -> Self {
        Self {
            inner: Arc::new(KeycloakValidator::new(config)),
        }
    }
}

impl<S> Layer<S> for KeycloakAuthLayer {
    type Service = KeycloakAuthMiddleware<S>;
    fn layer(&self, inner: S) -> Self::Service {
        KeycloakAuthMiddleware {
            inner,
            validator: Arc::clone(&self.inner),
        }
    }
}

/// The validator itself — shared across requests, holds the JWKS cache.
pub struct KeycloakValidator {
    config: KeycloakConfig,
    skip: HashSet<String>,
    cache: RwLock<JwksCache>,
    http: reqwest::Client,
}

impl KeycloakValidator {
    pub fn new(config: KeycloakConfig) -> Self {
        let skip = config.skip_paths.iter().cloned().collect();
        let http = reqwest::Client::builder()
            .timeout(JWKS_FETCH_TIMEOUT)
            .user_agent(concat!("motion-forge-http/", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            config,
            skip,
            cache: RwLock::new(JwksCache::default()),
            http,
        }
    }

    fn jwks_url(&self) -> String {
        format!(
            "{}/protocol/openid-connect/certs",
            self.config.issuer.trim_end_matches('/')
        )
    }

    /// Fetch (or return cached) JWKS.
    async fn jwks(&self) -> Result<JwkSet, AuthError> {
        {
            let guard = self.cache.read().await;
            if !guard.is_stale() {
                if let Some(set) = &guard.keys {
                    return Ok(set.clone());
                }
            }
        }
        // Acquire write lock; double-check (someone else may have
        // populated while we waited).
        let mut guard = self.cache.write().await;
        if !guard.is_stale() {
            if let Some(set) = &guard.keys {
                return Ok(set.clone());
            }
        }
        let url = self.jwks_url();
        tracing::debug!(url = %url, "fetching JWKS");
        let res = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| AuthError::JwksFetch(format!("GET {url}: {e}")))?;
        if !res.status().is_success() {
            return Err(AuthError::JwksFetch(format!(
                "GET {url}: HTTP {}",
                res.status()
            )));
        }
        let set: JwkSet = res
            .json()
            .await
            .map_err(|e| AuthError::JwksFetch(format!("decode JWKS: {e}")))?;
        guard.keys = Some(set.clone());
        guard.fetched_at = Some(Instant::now());
        Ok(set)
    }

    /// Find the key for the given `kid` in the cached JWKS, refreshing
    /// once if not found (handles rotation).
    async fn key_for(&self, kid: &str) -> Result<DecodingKey, AuthError> {
        let set = self.jwks().await?;
        if let Some(key) = decoding_key_from_set(&set, kid) {
            return Ok(key);
        }
        // Force-refresh once — Keycloak may have rotated.
        {
            let mut guard = self.cache.write().await;
            guard.fetched_at = None;
        }
        let set = self.jwks().await?;
        decoding_key_from_set(&set, kid).ok_or_else(|| AuthError::UnknownKid(kid.to_string()))
    }

    /// Validate a bearer token. Returns the decoded claims on success.
    pub async fn validate_token(&self, token: &str) -> Result<TokenData<Claims>, AuthError> {
        let header = decode_header(token).map_err(|e| AuthError::Decode(e.to_string()))?;
        let kid = header.kid.ok_or(AuthError::MissingKid)?;
        let key = self.key_for(&kid).await?;
        let mut validation = Validation::new(header.alg);
        // Restrict to RS256/RS384/RS512 — Keycloak default is RS256.
        // Reject "none" and HS* unconditionally by limiting `algorithms`.
        validation.algorithms = vec![Algorithm::RS256, Algorithm::RS384, Algorithm::RS512];
        validation.set_issuer(&[&self.config.issuer]);
        if !self.config.audiences.is_empty() {
            let audv: Vec<&str> = self.config.audiences.iter().map(String::as_str).collect();
            validation.set_audience(&audv);
        } else {
            validation.validate_aud = false;
        }
        validation.validate_nbf = true;
        validation.validate_exp = true;
        decode::<Claims>(token, &key, &validation).map_err(|e| AuthError::Decode(e.to_string()))
    }

    fn should_skip(&self, path: &str) -> bool {
        self.skip.iter().any(|p| p == path)
    }
}

fn decoding_key_from_set(set: &JwkSet, kid: &str) -> Option<DecodingKey> {
    for jwk in &set.keys {
        let matches = jwk.common.key_id.as_deref() == Some(kid);
        if !matches {
            continue;
        }
        if let AlgorithmParameters::RSA(rsa) = &jwk.algorithm {
            if let Ok(key) = DecodingKey::from_rsa_components(&rsa.n, &rsa.e) {
                return Some(key);
            }
        }
    }
    None
}

/// Subset of Keycloak claims we care about. `aud` can be a single
/// string or an array depending on the audience-mapper config, so we
/// model both via serde.
#[derive(Debug, Clone, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub iss: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub preferred_username: Option<String>,
    #[serde(default)]
    pub realm_access: Option<RealmAccess>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RealmAccess {
    #[serde(default)]
    pub roles: Vec<String>,
}

/// What can go wrong validating a token.
#[derive(Debug)]
pub enum AuthError {
    Missing,
    Malformed(String),
    Decode(String),
    MissingKid,
    UnknownKid(String),
    JwksFetch(String),
    Disabled,
}

impl AuthError {
    fn log_msg(&self) -> String {
        match self {
            AuthError::Missing => "missing bearer token".into(),
            AuthError::Malformed(s) => format!("malformed authorization header: {s}"),
            AuthError::Decode(s) => format!("token decode failed: {s}"),
            AuthError::MissingKid => "token header missing kid".into(),
            AuthError::UnknownKid(k) => format!("unknown kid: {k}"),
            AuthError::JwksFetch(s) => format!("JWKS fetch failed: {s}"),
            AuthError::Disabled => "auth disabled".into(),
        }
    }
}

impl IntoResponse for AuthError {
    fn into_response(self) -> axum::response::Response {
        let msg = self.log_msg();
        tracing::debug!(error = %msg, "auth rejected");
        let body = serde_json::json!({ "error": "unauthorized", "detail": msg });
        let mut res = (StatusCode::UNAUTHORIZED, axum::Json(body)).into_response();
        res.headers_mut().insert(
            header::WWW_AUTHENTICATE,
            HeaderValue::from_static("Bearer realm=\"motion-forge\""),
        );
        res
    }
}

#[derive(Clone)]
pub struct KeycloakAuthMiddleware<S> {
    inner: S,
    validator: Arc<KeycloakValidator>,
}

impl<S> Service<Request<Body>> for KeycloakAuthMiddleware<S>
where
    S: Service<Request<Body>, Response = Response<Body>> + Send + Clone + 'static,
    S::Future: Send + 'static,
    S::Error: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Request<Body>) -> Self::Future {
        let validator = Arc::clone(&self.validator);
        // Clone the inner *ready* service; this is the standard
        // tower idiom because `call` takes &mut self but the future
        // outlives the borrow.
        let clone = self.inner.clone();
        let mut inner = std::mem::replace(&mut self.inner, clone);
        Box::pin(async move {
            let path = req.uri().path().to_string();
            if validator.should_skip(&path) {
                tracing::trace!(path = %path, "auth skip");
                return inner.call(req).await;
            }

            let bearer = match extract_bearer(&req) {
                Ok(t) => t,
                Err(e) => return Ok(e.into_response()),
            };

            // Fallback static key path.
            if let Some(fallback) = validator.config.fallback_key.as_deref() {
                if fallback == bearer {
                    tracing::warn!(
                        path = %path,
                        "auth bypass via MOTION_FORGE_AUTH_FALLBACK_KEY — DO NOT USE IN PRODUCTION"
                    );
                    return inner.call(req).await;
                }
            }

            // Real path: require an issuer configured.
            if !validator.config.has_issuer() {
                tracing::warn!(
                    path = %path,
                    "rejecting request: KEYCLOAK_ISSUER not set and bearer did not match fallback"
                );
                return Ok(AuthError::Disabled.into_response());
            }

            match validator.validate_token(&bearer).await {
                Ok(token) => {
                    tracing::debug!(
                        path = %path,
                        sub = %token.claims.sub,
                        "auth ok"
                    );
                    inner.call(req).await
                }
                Err(e) => Ok(e.into_response()),
            }
        })
    }
}

fn extract_bearer(req: &Request<Body>) -> Result<String, AuthError> {
    let header_val = req
        .headers()
        .get(header::AUTHORIZATION)
        .ok_or(AuthError::Missing)?;
    let s = header_val
        .to_str()
        .map_err(|e| AuthError::Malformed(e.to_string()))?;
    let token = s
        .strip_prefix("Bearer ")
        .or_else(|| s.strip_prefix("bearer "))
        .ok_or_else(|| AuthError::Malformed("expected \"Bearer <token>\"".into()))?;
    Ok(token.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Router, body::to_bytes, routing::get};
    use http::Request as HttpRequest;
    use tower::ServiceExt;

    fn router_with_layer(layer: KeycloakAuthLayer) -> Router {
        Router::new()
            .route("/healthz", get(|| async { "ok" }))
            .route("/secret", get(|| async { "shh" }))
            .layer(layer)
    }

    #[tokio::test]
    async fn healthz_is_always_open() {
        let cfg = KeycloakConfig {
            issuer: String::new(),
            audiences: vec![],
            fallback_key: None,
            skip_paths: default_skip_paths().into_iter().map(String::from).collect(),
        };
        let app = router_with_layer(KeycloakAuthLayer::new(cfg));
        let res = app
            .oneshot(
                HttpRequest::builder()
                    .uri("/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), 200);
    }

    #[tokio::test]
    async fn missing_token_returns_401_with_www_authenticate() {
        let cfg = KeycloakConfig {
            issuer: "http://localhost:8080/realms/motion-forge".into(),
            audiences: vec!["motion-forge-web".into()],
            fallback_key: None,
            skip_paths: default_skip_paths().into_iter().map(String::from).collect(),
        };
        let app = router_with_layer(KeycloakAuthLayer::new(cfg));
        let res = app
            .oneshot(
                HttpRequest::builder()
                    .uri("/secret")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), 401);
        let www = res.headers().get(header::WWW_AUTHENTICATE).unwrap();
        assert!(www.to_str().unwrap().contains("motion-forge"));
    }

    #[tokio::test]
    async fn fallback_key_bypass() {
        let cfg = KeycloakConfig {
            issuer: String::new(),
            audiences: vec![],
            fallback_key: Some("local-dev".into()),
            skip_paths: default_skip_paths().into_iter().map(String::from).collect(),
        };
        let app = router_with_layer(KeycloakAuthLayer::new(cfg));
        let res = app
            .oneshot(
                HttpRequest::builder()
                    .uri("/secret")
                    .header(header::AUTHORIZATION, "Bearer local-dev")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), 200);
        let body = to_bytes(res.into_body(), 1024).await.unwrap();
        assert_eq!(&body[..], b"shh");
    }

    #[tokio::test]
    async fn bogus_token_returns_401() {
        let cfg = KeycloakConfig {
            issuer: "http://127.0.0.1:1/realms/motion-forge".into(),
            audiences: vec!["motion-forge-web".into()],
            fallback_key: None,
            skip_paths: default_skip_paths().into_iter().map(String::from).collect(),
        };
        let app = router_with_layer(KeycloakAuthLayer::new(cfg));
        let res = app
            .oneshot(
                HttpRequest::builder()
                    .uri("/secret")
                    .header(header::AUTHORIZATION, "Bearer not-a-real-jwt")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(res.status(), 401);
    }

    #[test]
    fn from_env_parses_audience_list() {
        // Use a unique env scope; mutation of env is fine inside a
        // single-threaded test.
        unsafe {
            std::env::set_var("KEYCLOAK_ISSUER", "https://kc.example/realms/x");
            std::env::set_var("KEYCLOAK_AUDIENCE", "a, b ,c");
        }
        let cfg = KeycloakConfig::from_env();
        unsafe {
            std::env::remove_var("KEYCLOAK_ISSUER");
            std::env::remove_var("KEYCLOAK_AUDIENCE");
        }
        assert_eq!(cfg.issuer, "https://kc.example/realms/x");
        assert_eq!(cfg.audiences, vec!["a", "b", "c"]);
    }
}
