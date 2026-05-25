//! API key issuance, storage, and validation.
//!
//! API keys are the second-class credential for the public API. The
//! first-class credential is still a Keycloak JWT (interactive users +
//! the web app); keys exist for server-to-server callers and the
//! marketing/SDK story ("paste this into your `.env`").
//!
//! Shape on the wire:
//!
//!   X-API-Key: mf_live_<10-char-id>_<32-char-secret>
//!
//! - `mf_live_` makes leaks grep-able in logs (GitHub secret scanning
//!   already knows the prefix family).
//! - The 10-char id is a public lookup handle; we never have to scan
//!   the file to find the matching row.
//! - The 32-char secret is what we hash. Compared in constant time.
//!
//! Storage is a single JSON file at `$MOTION_FORGE_DATA_DIR/api_keys.json`
//! (or `./data/api_keys.json` if unset). Writes are atomic
//! (temp-file + rename). The file is intentionally human-inspectable —
//! we store only the hash, never the secret — so admins can audit a
//! tenant's keys with `cat`.
//!
//! Why not SQLite? The key set is small (tens to hundreds per install
//! is realistic) and the dominant access pattern is "validate one key
//! per request" which is O(1) on a HashMap loaded at boot. Pulling in
//! sqlx for this would balloon the dependency surface without buying
//! us anything we'd notice.
//!
//! Rate limit budgets live alongside each key so the limiter doesn't
//! need a second registry: `free` (60/min) and `pro` (600/min) match
//! the marketing-page tiers and stay tunable per key for enterprise
//! contracts.

use crate::timefmt::now_rfc3339;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

/// Public prefix grep-able in leaked logs / GitHub secret scanning.
pub const KEY_PREFIX: &str = "mf_live_";

/// Length of the secret half, in characters (base32-style alphabet).
const SECRET_LEN: usize = 32;

/// Length of the public id half, in characters.
const ID_LEN: usize = 10;

/// Default file location (relative to `MOTION_FORGE_DATA_DIR` if set,
/// otherwise the current working directory).
const FILE_NAME: &str = "api_keys.json";

/// Per-key rate-limit tier. Drives the sliding-window budget.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Tier {
    Free,
    Pro,
    Enterprise,
}

impl Tier {
    /// Requests per minute permitted at this tier.
    pub fn rpm(self) -> u32 {
        match self {
            Tier::Free => 60,
            Tier::Pro => 600,
            Tier::Enterprise => 6000,
        }
    }
}

impl Default for Tier {
    fn default() -> Self {
        Tier::Free
    }
}

/// A row in the store. The secret is never persisted — only its hash.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKey {
    pub id: String,
    /// Hex SHA-256 of the secret half.
    pub secret_hash: String,
    pub name: String,
    /// Sub claim of the Keycloak user who issued the key.
    pub owner_sub: String,
    pub tier: Tier,
    /// RFC3339 timestamps.
    pub created_at: String,
    pub last_used_at: Option<String>,
    pub revoked_at: Option<String>,
}

impl ApiKey {
    pub fn is_active(&self) -> bool {
        self.revoked_at.is_none()
    }
}

/// Public view returned by list — never includes the hash.
#[derive(Debug, Clone, Serialize)]
pub struct ApiKeyPublic {
    pub id: String,
    pub name: String,
    pub owner_sub: String,
    pub tier: Tier,
    pub created_at: String,
    pub last_used_at: Option<String>,
    pub revoked_at: Option<String>,
}

impl From<&ApiKey> for ApiKeyPublic {
    fn from(k: &ApiKey) -> Self {
        Self {
            id: k.id.clone(),
            name: k.name.clone(),
            owner_sub: k.owner_sub.clone(),
            tier: k.tier,
            created_at: k.created_at.clone(),
            last_used_at: k.last_used_at.clone(),
            revoked_at: k.revoked_at.clone(),
        }
    }
}

/// Returned exactly once from issue() — the only time the caller sees
/// the secret half. The struct is deliberately separate from `ApiKey`
/// so a `Debug` print can't accidentally leak the secret of a stored
/// row.
#[derive(Debug, Clone, Serialize)]
pub struct IssuedApiKey {
    pub id: String,
    pub name: String,
    pub tier: Tier,
    pub created_at: String,
    /// The literal `mf_live_<id>_<secret>` string. Show this to the
    /// user once and never again.
    pub secret: String,
}

/// In-memory + file-backed key store. Thread-safe via RwLock.
#[derive(Debug, Clone)]
pub struct ApiKeyStore {
    inner: Arc<RwLock<Inner>>,
    file: PathBuf,
}

#[derive(Debug, Default)]
struct Inner {
    /// id → key
    keys: HashMap<String, ApiKey>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct OnDisk {
    keys: Vec<ApiKey>,
}

impl ApiKeyStore {
    /// Load from disk (creating an empty store if the file is missing).
    pub fn open(file: impl Into<PathBuf>) -> std::io::Result<Self> {
        let file = file.into();
        let inner = if file.exists() {
            let raw = std::fs::read(&file)?;
            let on_disk: OnDisk = serde_json::from_slice(&raw).map_err(|e| {
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("parse {}: {e}", file.display()),
                )
            })?;
            let mut keys = HashMap::new();
            for k in on_disk.keys {
                keys.insert(k.id.clone(), k);
            }
            Inner { keys }
        } else {
            // Make sure the parent dir exists so the first write
            // doesn't surprise us with a missing-dir error.
            if let Some(parent) = file.parent() {
                std::fs::create_dir_all(parent)?;
            }
            Inner::default()
        };
        Ok(Self {
            inner: Arc::new(RwLock::new(inner)),
            file,
        })
    }

    /// Open the store from env (`MOTION_FORGE_DATA_DIR`, else cwd).
    pub fn from_env() -> std::io::Result<Self> {
        let base = std::env::var("MOTION_FORGE_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./data"));
        Self::open(base.join(FILE_NAME))
    }

    /// Issue a new key for the given owner. Returns the secret exactly
    /// once.
    pub async fn issue(
        &self,
        name: impl Into<String>,
        owner_sub: impl Into<String>,
        tier: Tier,
    ) -> std::io::Result<IssuedApiKey> {
        let id = random_token(ID_LEN);
        let secret_half = random_token(SECRET_LEN);
        let full_secret = format!("{KEY_PREFIX}{id}_{secret_half}");
        let secret_hash = hash_secret(&secret_half);
        let created_at = now_rfc3339();
        let name = name.into();
        let row = ApiKey {
            id: id.clone(),
            secret_hash,
            name: name.clone(),
            owner_sub: owner_sub.into(),
            tier,
            created_at: created_at.clone(),
            last_used_at: None,
            revoked_at: None,
        };
        {
            let mut g = self.inner.write().await;
            g.keys.insert(id.clone(), row);
            self.flush(&g)?;
        }
        Ok(IssuedApiKey {
            id,
            name,
            tier,
            created_at,
            secret: full_secret,
        })
    }

    /// Validate a `mf_live_...` key. Returns the active key on hit.
    pub async fn validate(&self, presented: &str) -> Option<ApiKey> {
        let (id, secret_half) = parse_key(presented)?;
        let presented_hash = hash_secret(secret_half);
        let mut g = self.inner.write().await;
        let row = g.keys.get(id)?;
        if !row.is_active() {
            return None;
        }
        // Constant-time compare of the two hex strings.
        if !constant_time_eq(presented_hash.as_bytes(), row.secret_hash.as_bytes()) {
            return None;
        }
        let updated = ApiKey {
            last_used_at: Some(now_rfc3339()),
            ..row.clone()
        };
        g.keys.insert(updated.id.clone(), updated.clone());
        // Best-effort flush — a lost touch isn't worth a 500.
        let _ = self.flush(&g);
        Some(updated)
    }

    /// List keys for a specific owner (the dashboard surface).
    pub async fn list_for_owner(&self, owner_sub: &str) -> Vec<ApiKeyPublic> {
        let g = self.inner.read().await;
        let mut out: Vec<ApiKeyPublic> = g
            .keys
            .values()
            .filter(|k| k.owner_sub == owner_sub)
            .map(ApiKeyPublic::from)
            .collect();
        // Newest first.
        out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        out
    }

    /// Revoke a key. Returns true if the row was found + revoked.
    pub async fn revoke(&self, id: &str, owner_sub: &str) -> std::io::Result<bool> {
        let mut g = self.inner.write().await;
        let row = match g.keys.get_mut(id) {
            Some(r) if r.owner_sub == owner_sub => r,
            _ => return Ok(false),
        };
        if row.revoked_at.is_some() {
            return Ok(false);
        }
        row.revoked_at = Some(now_rfc3339());
        self.flush(&g)?;
        Ok(true)
    }

    /// Persist the in-memory map to disk atomically.
    fn flush(&self, g: &Inner) -> std::io::Result<()> {
        let mut rows: Vec<&ApiKey> = g.keys.values().collect();
        rows.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        let on_disk = serde_json::to_vec_pretty(&OnDisk {
            keys: rows.into_iter().cloned().collect(),
        })
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        let tmp = self.file.with_extension("json.tmp");
        std::fs::write(&tmp, on_disk)?;
        std::fs::rename(&tmp, &self.file)?;
        Ok(())
    }
}

/* ----------------------------------------------------- helpers */

/// Generate `n` characters from a base32-ish unambiguous alphabet
/// (drops `0/O/1/l/I` for visual cleanliness in URLs and consoles).
fn random_token(n: usize) -> String {
    use rand::Rng;
    const ALPHABET: &[u8] = b"23456789abcdefghijkmnpqrstuvwxyz";
    let mut rng = rand::thread_rng();
    (0..n)
        .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
        .collect()
}

/// SHA-256(secret) as a lowercase hex string.
fn hash_secret(secret: &str) -> String {
    let mut h = Sha256::new();
    h.update(secret.as_bytes());
    let out = h.finalize();
    hex_lower(&out)
}

fn hex_lower(b: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut s = String::with_capacity(b.len() * 2);
    for byte in b {
        s.push(HEX[(byte >> 4) as usize] as char);
        s.push(HEX[(byte & 0xf) as usize] as char);
    }
    s
}

/// Constant-time byte comparison.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut acc: u8 = 0;
    for (x, y) in a.iter().zip(b.iter()) {
        acc |= x ^ y;
    }
    acc == 0
}

/// Parse `mf_live_<id>_<secret>` into `(id, secret)`.
fn parse_key(s: &str) -> Option<(&str, &str)> {
    let rest = s.strip_prefix(KEY_PREFIX)?;
    let (id, secret) = rest.split_once('_')?;
    if id.len() != ID_LEN || secret.len() != SECRET_LEN {
        return None;
    }
    Some((id, secret))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn store() -> (ApiKeyStore, TempDir) {
        let dir = TempDir::new().unwrap();
        let s = ApiKeyStore::open(dir.path().join("k.json")).unwrap();
        (s, dir)
    }

    #[tokio::test]
    async fn round_trip_issue_and_validate() {
        let (s, _d) = store();
        let issued = s.issue("ci", "u1", Tier::Free).await.unwrap();
        assert!(issued.secret.starts_with(KEY_PREFIX));
        let row = s.validate(&issued.secret).await.unwrap();
        assert_eq!(row.id, issued.id);
        assert!(row.last_used_at.is_some());
    }

    #[tokio::test]
    async fn validate_rejects_wrong_secret() {
        let (s, _d) = store();
        let issued = s.issue("ci", "u1", Tier::Free).await.unwrap();
        let mut tampered: String = issued.secret;
        // Flip the last char.
        let last = tampered.pop().unwrap();
        let next = if last == 'a' { 'b' } else { 'a' };
        tampered.push(next);
        assert!(s.validate(&tampered).await.is_none());
    }

    #[tokio::test]
    async fn validate_rejects_revoked() {
        let (s, _d) = store();
        let issued = s.issue("ci", "u1", Tier::Free).await.unwrap();
        assert!(s.revoke(&issued.id, "u1").await.unwrap());
        assert!(s.validate(&issued.secret).await.is_none());
    }

    #[tokio::test]
    async fn revoke_other_owner_is_noop() {
        let (s, _d) = store();
        let issued = s.issue("ci", "u1", Tier::Free).await.unwrap();
        assert!(!s.revoke(&issued.id, "different-user").await.unwrap());
        assert!(s.validate(&issued.secret).await.is_some());
    }

    #[tokio::test]
    async fn list_returns_newest_first() {
        let (s, _d) = store();
        let a = s.issue("a", "u1", Tier::Free).await.unwrap();
        std::thread::sleep(std::time::Duration::from_secs(1));
        let b = s.issue("b", "u1", Tier::Free).await.unwrap();
        let list = s.list_for_owner("u1").await;
        assert_eq!(list.len(), 2);
        // Newest first: b before a.
        assert_eq!(list[0].id, b.id);
        assert_eq!(list[1].id, a.id);
    }

    #[tokio::test]
    async fn persists_across_reopen() {
        let dir = TempDir::new().unwrap();
        let file = dir.path().join("k.json");
        let s = ApiKeyStore::open(&file).unwrap();
        let issued = s.issue("ci", "u1", Tier::Pro).await.unwrap();
        drop(s);
        let s2 = ApiKeyStore::open(&file).unwrap();
        let row = s2.validate(&issued.secret).await.unwrap();
        assert_eq!(row.tier, Tier::Pro);
    }

    #[test]
    fn tier_rpm_known() {
        assert_eq!(Tier::Free.rpm(), 60);
        assert_eq!(Tier::Pro.rpm(), 600);
        assert_eq!(Tier::Enterprise.rpm(), 6000);
    }

    #[test]
    fn parse_rejects_wrong_lengths() {
        assert!(parse_key("mf_live_short_secret").is_none());
        assert!(parse_key("wrong_prefix_abcdefghij_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx").is_none());
    }
}
