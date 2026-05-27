//! Notification preferences + a pluggable email backend.
//!
//! Preferences are per-user (keyed by Keycloak `sub`) and stored as a
//! single JSON file under `$MOTION_FORGE_DATA_DIR/notifications/<sub>.json`.
//! The store mirrors the api-key store's atomic-write + best-effort
//! flush conventions so a crash mid-save can't leave a partial file.
//!
//! The email backend is a [`tower`-style trait] that the engine doesn't
//! depend on at build time — production adapters (SES, SendGrid, Azure
//! Communication Services) are empty stubs today, swap-in-when-needed.
//! Until then [`StubEmailService`] just emits a structured tracing
//! event so we can verify the right code paths fire in tests + dev.
//!
//! Why deferred adapters: the smart play for a v0 product is to ship
//! the preferences API + UI so prospects can SEE the feature, then
//! wire whichever provider the first paying customer prefers. Most
//! enterprise prospects already have an internal mail server contract
//! we'd inherit — building all three adapters now would mean throwing
//! two of them away.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

/// What kinds of events a user can opt in / out of.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    /// One-time welcome with quickstart links after the first sign-in.
    Welcome,
    /// A long-running /v1/generate call finishes.
    GenerateComplete,
    /// Weekly digest of token spend, calls per model, top prompts.
    WeeklyUsage,
    /// API key created or revoked.
    ApiKeyChange,
    /// 80% / 95% / 100% of the monthly tier budget consumed.
    UsageThreshold,
}

impl EventKind {
    pub const ALL: &'static [EventKind] = &[
        EventKind::Welcome,
        EventKind::GenerateComplete,
        EventKind::WeeklyUsage,
        EventKind::ApiKeyChange,
        EventKind::UsageThreshold,
    ];
}

/// Per-owner preferences. Defaults: everything on except WeeklyUsage
/// (which would be a per-week mail to every user we have today,
/// inappropriate for a beta).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotificationPrefs {
    pub email: Option<String>,
    pub enabled: Vec<EventKind>,
    /// RFC3339 timestamp of last update.
    pub updated_at: String,
}

impl Default for NotificationPrefs {
    fn default() -> Self {
        Self {
            email: None,
            enabled: vec![
                EventKind::Welcome,
                EventKind::GenerateComplete,
                EventKind::ApiKeyChange,
                EventKind::UsageThreshold,
            ],
            updated_at: now_rfc3339(),
        }
    }
}

/// File-backed per-owner prefs store.
#[derive(Debug, Clone)]
pub struct NotificationPrefsStore {
    inner: Arc<RwLock<()>>,
    dir: PathBuf,
}

impl NotificationPrefsStore {
    pub fn from_env() -> std::io::Result<Self> {
        let base = std::env::var("MOTION_FORGE_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./data"));
        let dir = base.join("notifications");
        std::fs::create_dir_all(&dir)?;
        Ok(Self {
            inner: Arc::new(RwLock::new(())),
            dir,
        })
    }

    /// Test helper — open against an arbitrary dir without env lookup.
    pub fn open_for_test(dir: PathBuf) -> Self {
        let _ = std::fs::create_dir_all(&dir);
        Self {
            inner: Arc::new(RwLock::new(())),
            dir,
        }
    }

    fn path_for(&self, owner_sub: &str) -> PathBuf {
        // Sanitize: only [a-zA-Z0-9-_] is allowed; everything else
        // becomes `_` so a hostile sub claim can't escape the dir.
        let safe: String = owner_sub
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        self.dir.join(format!("{safe}.json"))
    }

    pub async fn get(&self, owner_sub: &str) -> NotificationPrefs {
        let _g = self.inner.read().await;
        let path = self.path_for(owner_sub);
        if let Ok(raw) = std::fs::read(&path) {
            if let Ok(p) = serde_json::from_slice::<NotificationPrefs>(&raw) {
                return p;
            }
        }
        NotificationPrefs::default()
    }

    pub async fn put(
        &self,
        owner_sub: &str,
        prefs: NotificationPrefs,
    ) -> std::io::Result<NotificationPrefs> {
        let _g = self.inner.write().await;
        let prefs = NotificationPrefs {
            updated_at: now_rfc3339(),
            ..prefs
        };
        let path = self.path_for(owner_sub);
        let tmp = path.with_extension("json.tmp");
        let buf = serde_json::to_vec_pretty(&prefs)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        std::fs::write(&tmp, buf)?;
        std::fs::rename(&tmp, &path)?;
        Ok(prefs)
    }
}

/* -------------------------------------------------------- email backend */

/// A pluggable email delivery service. Implementations: [`StubEmailService`]
/// (logs only — current default), plus to-do impls for SES, SendGrid, and
/// Azure Communication Services.
#[async_trait::async_trait]
pub trait EmailService: Send + Sync {
    /// Send `body` to `to` with `subject`. Returns `Ok(())` if delivery
    /// is accepted by the provider (or, for the stub, if the log line is
    /// emitted).
    async fn send(&self, to: &str, subject: &str, body: &str) -> Result<(), EmailError>;
}

#[derive(Debug, thiserror::Error)]
pub enum EmailError {
    #[error("invalid recipient: {0}")]
    InvalidRecipient(String),
    #[error("provider rejected: {0}")]
    ProviderRejected(String),
    #[error("transport failure: {0}")]
    Transport(String),
}

/// Default backend — emits a structured tracing event and pretends
/// success. Production deployments swap in `SesEmailService` etc.
#[derive(Debug, Default, Clone)]
pub struct StubEmailService;

#[async_trait::async_trait]
impl EmailService for StubEmailService {
    async fn send(&self, to: &str, subject: &str, body: &str) -> Result<(), EmailError> {
        if !to.contains('@') {
            return Err(EmailError::InvalidRecipient(to.into()));
        }
        tracing::info!(
            target: "email",
            backend = "stub",
            to = %to,
            subject = %subject,
            body_len = body.len(),
            "email send (stub — not actually delivered)"
        );
        Ok(())
    }
}

/* ---- Production adapter stubs — empty impls + TODOs. Add the real
body when a customer picks the provider. */

/// AWS Simple Email Service. Will use `aws-sdk-ses` when implemented.
#[derive(Debug, Default, Clone)]
pub struct SesEmailService {
    pub region: String,
    pub from: String,
}

#[async_trait::async_trait]
impl EmailService for SesEmailService {
    async fn send(&self, _to: &str, _subject: &str, _body: &str) -> Result<(), EmailError> {
        // TODO(deploy): build an aws_sdk_ses::Client with credentials
        // from the ambient env, call send_email().
        Err(EmailError::Transport(
            "SES adapter not yet implemented".into(),
        ))
    }
}

/// SendGrid. Will use the REST API + bearer token when implemented.
#[derive(Debug, Default, Clone)]
pub struct SendgridEmailService {
    pub api_key: String,
    pub from: String,
}

#[async_trait::async_trait]
impl EmailService for SendgridEmailService {
    async fn send(&self, _to: &str, _subject: &str, _body: &str) -> Result<(), EmailError> {
        // TODO(deploy): POST https://api.sendgrid.com/v3/mail/send with
        // the SG API contract; bearer auth.
        Err(EmailError::Transport(
            "SendGrid adapter not yet implemented".into(),
        ))
    }
}

/// Azure Communication Services email.
///
/// Signs the request with the ACS HMAC-SHA256 access-key scheme + POSTs
/// the JSON envelope to `{endpoint}/emails:send?api-version=2023-03-31`.
/// `endpoint` is the host name only (`<id>.communication.azure.com`),
/// `access_key` is the base64-encoded primary key from
/// `commsService.listKeys()`, `from` is the verified sender address.
#[derive(Debug, Default, Clone)]
pub struct AzureCommsEmailService {
    pub endpoint: String,
    pub access_key: String,
    pub from: String,
}

#[async_trait::async_trait]
impl EmailService for AzureCommsEmailService {
    async fn send(&self, to: &str, subject: &str, body: &str) -> Result<(), EmailError> {
        use base64::{Engine as _, engine::general_purpose::STANDARD as B64};
        use hmac::{Hmac, Mac};
        use sha2::{Digest, Sha256};

        if self.endpoint.is_empty() || self.access_key.is_empty() {
            return Err(EmailError::Transport(
                "AZURE_COMMS_ENDPOINT/AZURE_COMMS_KEY not set".into(),
            ));
        }
        // Body shape per ACS Email REST contract.
        let payload = serde_json::json!({
            "senderAddress": self.from,
            "recipients": { "to": [{ "address": to }] },
            "content": {
                "subject": subject,
                "plainText": strip_html(body),
                "html": body,
            },
        });
        let body_bytes = serde_json::to_vec(&payload)
            .map_err(|e| EmailError::Transport(format!("serialize body: {e}")))?;

        // Step 1: SHA-256 of the request body, base64-encoded.
        let body_hash = B64.encode(Sha256::digest(&body_bytes));

        // Step 2: RFC 7231 date (UTC, ends with "GMT").
        let date_header = chrono::Utc::now()
            .format("%a, %d %b %Y %H:%M:%S GMT")
            .to_string();

        // Step 3: Compose the string-to-sign.
        // Format: VERB\nPATH_AND_QUERY\nDATE;HOST;BODY_HASH
        let host = self.endpoint.trim_end_matches('/');
        let path_and_query = "/emails:send?api-version=2023-03-31";
        let string_to_sign = format!("POST\n{path_and_query}\n{date_header};{host};{body_hash}");

        // Step 4: HMAC-SHA256 with the base64-decoded access key.
        let key_bytes = B64
            .decode(&self.access_key)
            .map_err(|e| EmailError::Transport(format!("invalid base64 key: {e}")))?;
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(&key_bytes)
            .map_err(|e| EmailError::Transport(format!("hmac key: {e}")))?;
        mac.update(string_to_sign.as_bytes());
        let signature = B64.encode(mac.finalize().into_bytes());

        // Step 5: POST with the signed Authorization header. ACS requires
        // the exact `SignedHeaders=date;host;x-ms-content-sha256` order.
        let url = format!("https://{host}{path_and_query}");
        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .header("x-ms-date", &date_header)
            .header("x-ms-content-sha256", &body_hash)
            .header("Content-Type", "application/json")
            .header(
                "Authorization",
                format!(
                    "HMAC-SHA256 SignedHeaders=date;host;x-ms-content-sha256&Signature={signature}"
                ),
            )
            .body(body_bytes)
            .send()
            .await
            .map_err(|e| EmailError::Transport(format!("acs request: {e}")))?;

        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(EmailError::Transport(format!(
                "acs send failed: HTTP {status} {body}"
            )));
        }
        tracing::info!(to, subject, "acs email queued");
        Ok(())
    }
}

/// Cheap HTML→plaintext fallback. Just strips tags + collapses whitespace
/// so the `plainText` field has something readable for mail clients that
/// don't render HTML. Not a real sanitizer.
fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    // Collapse runs of whitespace.
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Pick the email service at boot from env. Defaults to the stub so
/// nothing escapes the process in dev.
pub fn email_service_from_env() -> Arc<dyn EmailService> {
    match std::env::var("MOTION_FORGE_EMAIL_BACKEND").as_deref() {
        Ok("ses") => {
            let region = std::env::var("AWS_REGION").unwrap_or_else(|_| "us-east-1".into());
            let from = std::env::var("MOTION_FORGE_EMAIL_FROM")
                .unwrap_or_else(|_| "noreply@controlcraft.io".into());
            Arc::new(SesEmailService { region, from })
        }
        Ok("sendgrid") => Arc::new(SendgridEmailService {
            api_key: std::env::var("SENDGRID_API_KEY").unwrap_or_default(),
            from: std::env::var("MOTION_FORGE_EMAIL_FROM")
                .unwrap_or_else(|_| "noreply@controlcraft.io".into()),
        }),
        Ok("azure") => Arc::new(AzureCommsEmailService {
            endpoint: std::env::var("AZURE_COMMS_ENDPOINT").unwrap_or_default(),
            access_key: std::env::var("AZURE_COMMS_KEY").unwrap_or_default(),
            from: std::env::var("MOTION_FORGE_EMAIL_FROM")
                .unwrap_or_else(|_| "noreply@controlcraft.io".into()),
        }),
        _ => Arc::new(StubEmailService),
    }
}

use crate::timefmt::now_rfc3339;

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store_in(dir: &std::path::Path) -> NotificationPrefsStore {
        std::fs::create_dir_all(dir.join("notifications")).unwrap();
        NotificationPrefsStore {
            inner: Arc::new(RwLock::new(())),
            dir: dir.join("notifications"),
        }
    }

    #[tokio::test]
    async fn default_returns_sensible_defaults() {
        let tmp = TempDir::new().unwrap();
        let s = store_in(tmp.path());
        let p = s.get("u1").await;
        assert!(p.email.is_none());
        assert!(p.enabled.contains(&EventKind::Welcome));
        assert!(!p.enabled.contains(&EventKind::WeeklyUsage));
    }

    #[tokio::test]
    async fn put_then_get_roundtrips() {
        let tmp = TempDir::new().unwrap();
        let s = store_in(tmp.path());
        let saved = s
            .put(
                "u1",
                NotificationPrefs {
                    email: Some("user@example.com".into()),
                    enabled: vec![EventKind::WeeklyUsage],
                    updated_at: "".into(),
                },
            )
            .await
            .unwrap();
        assert_eq!(saved.email.as_deref(), Some("user@example.com"));
        let loaded = s.get("u1").await;
        assert_eq!(loaded.email.as_deref(), Some("user@example.com"));
        assert_eq!(loaded.enabled, vec![EventKind::WeeklyUsage]);
    }

    #[tokio::test]
    async fn hostile_sub_cannot_escape_dir() {
        let tmp = TempDir::new().unwrap();
        let s = store_in(tmp.path());
        let p = s.path_for("../../etc/passwd");
        assert!(p.starts_with(tmp.path()));
        assert!(p.file_name().unwrap().to_string_lossy().contains('_'));
    }

    #[tokio::test]
    async fn stub_email_logs_but_succeeds() {
        let svc = StubEmailService;
        svc.send("user@example.com", "hi", "body").await.unwrap();
        let err = svc.send("not-an-email", "hi", "body").await.unwrap_err();
        assert!(matches!(err, EmailError::InvalidRecipient(_)));
    }

    #[test]
    fn ses_adapter_is_stub_until_implemented() {
        let s = SesEmailService::default();
        let rt = tokio::runtime::Runtime::new().unwrap();
        let err = rt.block_on(s.send("u@e.com", "", "")).unwrap_err();
        assert!(matches!(err, EmailError::Transport(_)));
    }
}
