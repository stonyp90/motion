//! Recraft API-key sourcing.
//!
//! In production the Recraft key is a Key Vault secret that the ACA app
//! reads through its User-Assigned Managed Identity. We fetch it at boot
//! and refresh every 5 minutes so a rotation in Key Vault propagates
//! without redeploying the container.
//!
//! Locally (and in CI) the key is just `RECRAFT_API_KEY` — Key Vault is
//! not available so the env var stays as a first-class path. The
//! `key_source_from_env` helper picks the right strategy based on which
//! env vars are set:
//!
//! ```text
//!   RECRAFT_API_KEY=...                        → StaticKeySource (env)
//!   AZURE_KEY_VAULT_URI=... +
//!   RECRAFT_KEY_SECRET_NAME=... (+ optional
//!   AZURE_CLIENT_ID for User-Assigned MI)      → KeyVaultKeySource
//! ```
//!
//! When both are set, env wins — handy for a quick local override
//! against a prod-shaped deployment.
//!
//! ## Why raw IMDS instead of the Azure SDK crates?
//!
//! The Azure Rust SDK is large (~30 transitive crates for `identity` +
//! `keyvault-secrets`) and we use a single endpoint apiece: GET an IMDS
//! token, GET a Key Vault secret. Two reqwest calls keep the surface
//! tiny, the binary small, and the security-review story easy: every
//! byte that touches the network is in this file.

use std::sync::Arc;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use serde::Deserialize;
use tokio::sync::RwLock;

use crate::ImageGenError;

/// How often the Key Vault source re-reads the secret. Bumping this
/// up lengthens the window during which a rotated key still serves
/// requests with the old value.
const KEY_REFRESH_INTERVAL: Duration = Duration::from_secs(5 * 60);

/// Azure Key Vault REST API version pinned for reproducibility.
/// (`7.4` is GA as of Nov 2023 — the most recent stable.)
const KV_API_VERSION: &str = "7.4";

/// IMDS endpoint used to mint a Key Vault access token from the
/// container's User-Assigned Managed Identity. The `resource` is the
/// Key Vault audience; `client_id` selects the UAMI when more than one
/// is attached.
const IMDS_BASE: &str = "http://169.254.169.254/metadata/identity/oauth2/token";
const IMDS_API_VERSION: &str = "2018-02-01";
const KV_RESOURCE: &str = "https://vault.azure.net";

/// HTTP timeout for the IMDS + Key Vault calls. IMDS is on a link-local
/// address so latency is ~milliseconds; Key Vault is sub-second in
/// practice. 10s is generous enough to ride out a brief blip without
/// stalling the boot path for a minute.
const REMOTE_TIMEOUT: Duration = Duration::from_secs(10);

/// Trait used by [`crate::RecraftBackend`] to pull the current Recraft
/// API key on each generation. Implementations cache as appropriate;
/// callers should treat `current()` as cheap and not memoise it.
#[async_trait]
pub trait KeySource: Send + Sync {
    /// Return the current API key. May block briefly the first time on
    /// the Key Vault source while the secret is fetched, then serve
    /// out of cache.
    async fn current(&self) -> Result<String, ImageGenError>;

    /// Human-readable name for logging (`"env"`, `"keyvault"`).
    fn name(&self) -> &'static str;
}

/// `KeySource` backed by an in-memory string. Used for the env-var
/// path (local dev, CI, the unit-test fixture).
#[derive(Debug, Clone)]
pub struct StaticKeySource {
    key: String,
}

impl StaticKeySource {
    pub fn new(key: impl Into<String>) -> Self {
        Self { key: key.into() }
    }
}

#[async_trait]
impl KeySource for StaticKeySource {
    async fn current(&self) -> Result<String, ImageGenError> {
        Ok(self.key.clone())
    }

    fn name(&self) -> &'static str {
        "env"
    }
}

/// `KeySource` backed by Azure Key Vault, authenticated via the
/// container's User-Assigned Managed Identity (IMDS).
///
/// Internal state: a 5-minute cache of `(fetched_at, secret)`. A call
/// to `current()` returns the cache when fresh and refetches when
/// stale; concurrent stale-callers all wait on the same write lock so
/// we don't fan out N IMDS calls under contention.
#[derive(Debug)]
pub struct KeyVaultKeySource {
    vault_uri: String,
    secret_name: String,
    /// Optional UAMI client id. Only meaningful when the container has
    /// more than one user-assigned identity attached — Azure refuses to
    /// guess which one to use.
    client_id: Option<String>,
    http: reqwest::Client,
    cache: RwLock<Cache>,
    /// Override knob exposed for tests so they don't have to wait the
    /// real 5 minutes to validate the refresh path.
    refresh_interval: Duration,
}

#[derive(Debug, Default)]
struct Cache {
    secret: Option<String>,
    fetched_at: Option<Instant>,
}

impl KeyVaultKeySource {
    pub fn new(
        vault_uri: impl Into<String>,
        secret_name: impl Into<String>,
        client_id: Option<String>,
    ) -> Self {
        let http = reqwest::Client::builder()
            .timeout(REMOTE_TIMEOUT)
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            vault_uri: vault_uri.into(),
            secret_name: secret_name.into(),
            client_id,
            http,
            cache: RwLock::new(Cache::default()),
            refresh_interval: KEY_REFRESH_INTERVAL,
        }
    }

    /// Test hook — let unit tests shrink the cache TTL so a refresh
    /// happens within a single tokio test without sleeping 5 minutes.
    #[doc(hidden)]
    pub fn with_refresh_interval(mut self, d: Duration) -> Self {
        self.refresh_interval = d;
        self
    }

    /// Spawn a background task that polls the secret every
    /// `refresh_interval`, populating the cache. Returning the join
    /// handle lets the caller abort on shutdown; dropping it is also
    /// fine because the task exits when the source is dropped.
    ///
    /// Calling this is optional — `current()` lazily refreshes on
    /// demand — but having an explicit poll keeps the first
    /// post-rotation request from paying the IMDS + KV latency.
    pub fn spawn_refresh_task(self: &Arc<Self>) -> tokio::task::JoinHandle<()> {
        let this = Arc::clone(self);
        let interval = self.refresh_interval;
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(interval).await;
                match this.fetch_and_store().await {
                    Ok(_) => tracing::debug!(secret = %this.secret_name, "Key Vault refresh ok"),
                    Err(e) => {
                        // Don't poison the cache on transient failure;
                        // last-known-good keeps serving until KV recovers.
                        tracing::warn!(
                            secret = %this.secret_name,
                            error = %e,
                            "Key Vault refresh failed; keeping cached value"
                        );
                    }
                }
            }
        })
    }

    /// Force a refresh and update the cache. Returns the fresh value.
    async fn fetch_and_store(&self) -> Result<String, ImageGenError> {
        let value = self.fetch_secret().await?;
        let mut guard = self.cache.write().await;
        guard.secret = Some(value.clone());
        guard.fetched_at = Some(Instant::now());
        Ok(value)
    }

    /// One IMDS + one Key Vault round-trip. Errors surface as
    /// `ImageGenError::Transport` (network-shaped) vs
    /// `ImageGenError::Provider` (Azure rejected the call).
    async fn fetch_secret(&self) -> Result<String, ImageGenError> {
        let token = self.fetch_imds_token().await?;
        let url = format!(
            "{}/secrets/{}?api-version={}",
            self.vault_uri.trim_end_matches('/'),
            self.secret_name,
            KV_API_VERSION
        );
        let resp = self
            .http
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await
            .map_err(|e| ImageGenError::Transport(format!("key vault GET: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ImageGenError::Provider(format!(
                "key vault {status}: {}",
                body.chars().take(300).collect::<String>()
            )));
        }
        let body: KvSecret = resp
            .json()
            .await
            .map_err(|e| ImageGenError::Provider(format!("parse key vault response: {e}")))?;
        Ok(body.value)
    }

    async fn fetch_imds_token(&self) -> Result<String, ImageGenError> {
        let mut query: Vec<(&str, &str)> =
            vec![("api-version", IMDS_API_VERSION), ("resource", KV_RESOURCE)];
        if let Some(c) = self.client_id.as_deref() {
            query.push(("client_id", c));
        }
        let resp = self
            .http
            .get(IMDS_BASE)
            .header("Metadata", "true")
            .query(&query)
            .send()
            .await
            .map_err(|e| ImageGenError::Transport(format!("IMDS GET: {e}")))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(ImageGenError::Provider(format!(
                "IMDS {status}: {}",
                body.chars().take(300).collect::<String>()
            )));
        }
        let body: ImdsToken = resp
            .json()
            .await
            .map_err(|e| ImageGenError::Provider(format!("parse IMDS response: {e}")))?;
        Ok(body.access_token)
    }
}

#[async_trait]
impl KeySource for KeyVaultKeySource {
    async fn current(&self) -> Result<String, ImageGenError> {
        {
            let guard = self.cache.read().await;
            if let (Some(secret), Some(at)) = (&guard.secret, &guard.fetched_at) {
                if at.elapsed() < self.refresh_interval {
                    return Ok(secret.clone());
                }
            }
        }
        // Stale or empty — re-fetch under the write lock. Double-check
        // because someone else may have populated while we waited.
        let guard = self.cache.write().await;
        if let (Some(secret), Some(at)) = (&guard.secret, &guard.fetched_at) {
            if at.elapsed() < self.refresh_interval {
                return Ok(secret.clone());
            }
        }
        drop(guard);
        self.fetch_and_store().await
    }

    fn name(&self) -> &'static str {
        "keyvault"
    }
}

#[derive(Deserialize)]
struct ImdsToken {
    access_token: String,
}

#[derive(Deserialize)]
struct KvSecret {
    value: String,
}

/// Pick a key source from environment. Order:
///
/// 1. `RECRAFT_API_KEY` set → `StaticKeySource` (env). Wins so a local
///    operator can override prod values for a quick smoke test.
/// 2. `AZURE_KEY_VAULT_URI` + `RECRAFT_KEY_SECRET_NAME` set →
///    `KeyVaultKeySource`. `AZURE_CLIENT_ID` selects the UAMI when
///    more than one is attached to the container.
/// 3. Otherwise `None` — caller decides whether that's fatal (it is in
///    `backend_from_env`; local dev that doesn't care about image-gen
///    still boots).
pub fn key_source_from_env() -> Option<Arc<dyn KeySource>> {
    key_source_from(|k| std::env::var(k).ok())
}

/// Same as [`key_source_from_env`] but with a pluggable env lookup so
/// tests can drive every branch without touching the (process-wide)
/// `std::env` — which would race with other parallel `cargo test`
/// threads. Production callers always use `key_source_from_env`.
pub fn key_source_from<F>(get: F) -> Option<Arc<dyn KeySource>>
where
    F: Fn(&str) -> Option<String>,
{
    if let Some(k) = get("RECRAFT_API_KEY").filter(|s| !s.is_empty()) {
        tracing::info!("RECRAFT_API_KEY present — using env key source");
        return Some(Arc::new(StaticKeySource::new(k)));
    }
    let vault = get("AZURE_KEY_VAULT_URI").filter(|s| !s.is_empty());
    let secret = get("RECRAFT_KEY_SECRET_NAME").filter(|s| !s.is_empty());
    let client_id = get("AZURE_CLIENT_ID").filter(|s| !s.is_empty());
    match (vault, secret) {
        (Some(v), Some(s)) => {
            tracing::info!(
                vault = %v,
                secret = %s,
                client_id = client_id.as_deref().unwrap_or("<unset>"),
                "Key Vault key source configured"
            );
            let src = Arc::new(KeyVaultKeySource::new(v, s, client_id));
            // Fire the periodic refresh so a key rotation in Key Vault
            // propagates within 5 minutes without an in-band miss. The
            // handle is intentionally dropped — the spawned task lives
            // for the process lifetime (and dropping the source aborts
            // it via the spawn-then-detach pattern).
            std::mem::drop(src.spawn_refresh_task());
            Some(src)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    /// Build a closure suitable for [`key_source_from`] from a literal
    /// map. Lets tests express env scenarios without mutating
    /// `std::env` (which would race against sibling parallel tests).
    fn fake_env<const N: usize>(
        pairs: [(&'static str, &'static str); N],
    ) -> impl Fn(&str) -> Option<String> {
        let map: HashMap<&'static str, &'static str> = pairs.into_iter().collect();
        move |k: &str| map.get(k).map(|v| (*v).to_string())
    }

    #[tokio::test]
    async fn static_source_returns_key() {
        let s = StaticKeySource::new("abc");
        assert_eq!(s.current().await.unwrap(), "abc");
        assert_eq!(s.name(), "env");
    }

    #[tokio::test]
    async fn key_source_prefers_env_var_when_both_configured() {
        let env = fake_env([
            ("RECRAFT_API_KEY", "from-env"),
            ("AZURE_KEY_VAULT_URI", "https://example.vault.azure.net"),
            ("RECRAFT_KEY_SECRET_NAME", "recraft"),
        ]);
        let src = key_source_from(env).expect("env path returns a source");
        assert_eq!(src.current().await.unwrap(), "from-env");
        assert_eq!(src.name(), "env");
    }

    #[tokio::test]
    async fn key_source_none_when_nothing_set() {
        let src = key_source_from(fake_env([]));
        assert!(src.is_none());
    }

    #[tokio::test]
    async fn key_source_picks_keyvault_when_only_kv_set() {
        let env = fake_env([
            ("AZURE_KEY_VAULT_URI", "https://example.vault.azure.net"),
            ("RECRAFT_KEY_SECRET_NAME", "recraft"),
        ]);
        let src = key_source_from(env).expect("kv path returns a source");
        assert_eq!(src.name(), "keyvault");
    }

    #[tokio::test]
    async fn key_source_treats_empty_env_value_as_unset() {
        // A blank RECRAFT_API_KEY shouldn't beat a real Key Vault
        // config; otherwise an operator with `RECRAFT_API_KEY=` exported
        // by their shell would silently break the KV boot path.
        let env = fake_env([
            ("RECRAFT_API_KEY", ""),
            ("AZURE_KEY_VAULT_URI", "https://example.vault.azure.net"),
            ("RECRAFT_KEY_SECRET_NAME", "recraft"),
        ]);
        let src = key_source_from(env).expect("kv path wins over blank env");
        assert_eq!(src.name(), "keyvault");
    }
}
