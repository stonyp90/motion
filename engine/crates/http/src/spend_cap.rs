//! Per-principal rolling-24h image-gen spend cap.
//!
//! Defence-in-depth alongside the per-request `MAX_BRIEF_SCENE_COUNT`
//! clamp. The clamp bounds the cost of *one* call; this module bounds
//! the cost of an attacker (or a runaway client) chaining many calls
//! through a single principal id.
//!
//! ## Shape
//!
//! `UsageStore` keeps a `DashMap<principal_id, RollingWindow>` where
//! `RollingWindow` is a `VecDeque<(at, cost_micros)>` ordered by `at`.
//! Reads (`current_spend_micros`) evict stale entries first, then sum
//! the rest. Writes (`record`) push a fresh `(now, cost)` entry.
//!
//! ## Caps
//!
//! [`TierCaps::lookup`] maps the `Principal::tier_label` set by the
//! auth middleware to a daily ceiling in USD micros. The numbers are
//! seed values — easy to bump per environment via a future
//! `MOTION_FORGE_SPEND_CAPS_JSON` env var once we have real customer
//! signal.
//!
//! ## Storage
//!
//! In-memory `DashMap`. We run on a single ACA replica today; if and
//! when we scale horizontally the store becomes a one-file swap to a
//! Cosmos- or Redis-backed implementation behind the same trait shape
//! (`current_spend_micros` + `record`). Documenting the swap up front
//! so the next person isn't surprised.
//!
//! ## Reservation race
//!
//! The check-then-act between `check_room` and `record` is intentional:
//! the projected_max passed to `check_room` already covers the
//! worst-case scene fan-out, so two concurrent admits at the boundary
//! can over-commit by at most `2 * projected_max` — bounded and small
//! relative to the daily cap. A strict reservation would need a
//! separate "in-flight" bucket; deferring until we see a real bypass.

use dashmap::DashMap;
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Length of the rolling window — i.e. how long a charge counts against
/// the daily cap before it ages out.
pub const WINDOW: Duration = Duration::from_secs(24 * 60 * 60);

/// Per-tier daily caps in USD micros (1_000_000 = $1.00).
///
/// Seed values, tuned to be visibly tight for free + comfortable for
/// paid. A free-tier abuser can mint at most $0.10 of Recraft work in
/// 24h, which won't move the monthly bill even at thousands of
/// compromised accounts.
pub struct TierCaps;

impl TierCaps {
    pub const FREE: u64 = 100_000; // $0.10
    pub const PRO: u64 = 5_000_000; // $5.00
    pub const ENTERPRISE: u64 = 100_000_000; // $100.00

    /// Map the `Principal::tier_label` string to a cap. Unknown labels
    /// fall back to the strictest tier so a misconfiguration fails
    /// closed rather than open.
    ///
    /// Recognised values today:
    /// - `"free"` → 100k micros (default API-key tier)
    /// - `"pro"` → 5M micros
    /// - `"enterprise"` → 100M micros
    /// - `"jwt"` → enterprise cap (interactive logged-in users come in
    ///   without a tier; we trust the Keycloak realm gate + don't want
    ///   to surprise paying customers with $0.10/day)
    /// - `"fallback"` → `u64::MAX` (dev/CI bypass — match the rpm
    ///   convention in `auth.rs`)
    pub fn lookup(label: &str) -> u64 {
        match label.to_ascii_lowercase().as_str() {
            "free" => Self::FREE,
            "pro" => Self::PRO,
            "enterprise" => Self::ENTERPRISE,
            "jwt" => Self::ENTERPRISE,
            "fallback" => u64::MAX,
            _ => {
                tracing::warn!(
                    tier = label,
                    "unknown tier label; defaulting to free spend cap"
                );
                Self::FREE
            }
        }
    }
}

/// Charge ledger for a single principal — one entry per successful
/// image-gen call. Trim-then-sum keeps the read path O(n_active).
#[derive(Debug, Default)]
struct RollingWindow {
    entries: VecDeque<(Instant, u64)>,
}

impl RollingWindow {
    fn trim(&mut self, now: Instant) {
        let cutoff = now.checked_sub(WINDOW).unwrap_or(now);
        while let Some((at, _)) = self.entries.front() {
            if *at < cutoff {
                self.entries.pop_front();
            } else {
                break;
            }
        }
    }

    fn current(&mut self, now: Instant) -> u64 {
        self.trim(now);
        self.entries.iter().map(|(_, c)| *c).sum()
    }

    fn push(&mut self, now: Instant, cost: u64) {
        self.entries.push_back((now, cost));
    }
}

/// Outcome of a pre-flight check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SpendDecision {
    /// True when the projected charge fits under the cap.
    pub allowed: bool,
    /// What the principal has spent in the last 24 h (post-trim).
    pub current_micros: u64,
    /// What the call would add, capped at `projected_max`.
    pub projected_micros: u64,
    /// The daily limit for the principal's tier.
    pub cap_micros: u64,
    /// The tier label echoed back so the rejection body can name it.
    pub tier_label: String,
}

/// Thread-safe in-memory store keyed by principal id.
#[derive(Clone, Default)]
pub struct UsageStore {
    inner: Arc<DashMap<String, RollingWindow>>,
}

impl UsageStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Snapshot of the current 24-h spend. Trims the window as a side
    /// effect, which is the cheapest place to do it.
    pub fn current_spend_micros(&self, principal_id: &str) -> u64 {
        self.current_spend_micros_at(principal_id, Instant::now())
    }

    /// Same as [`current_spend_micros`] but with an injectable clock —
    /// the tests use this to validate the eviction path without
    /// sleeping 24 hours.
    pub fn current_spend_micros_at(&self, principal_id: &str, now: Instant) -> u64 {
        let mut entry = self.inner.entry(principal_id.to_string()).or_default();
        entry.current(now)
    }

    /// Record a successful image-gen charge for the principal.
    pub fn record(&self, principal_id: &str, cost_micros: u64) {
        self.record_at(principal_id, cost_micros, Instant::now());
    }

    /// [`record`] with an injectable clock — see [`current_spend_micros_at`].
    pub fn record_at(&self, principal_id: &str, cost_micros: u64, now: Instant) {
        if cost_micros == 0 {
            return; // skip zero-cost (e.g. no-asset) calls
        }
        let mut entry = self.inner.entry(principal_id.to_string()).or_default();
        entry.push(now, cost_micros);
    }

    /// Pre-flight check: would adding `projected_max` to the current
    /// 24-h spend exceed the principal's tier cap?
    ///
    /// `tier_label` is `Principal::tier_label`; pass it through
    /// verbatim. The decision struct is suitable for the 402 response
    /// body when `allowed = false`.
    pub fn check_room(
        &self,
        principal_id: &str,
        tier_label: &str,
        projected_max: u64,
    ) -> SpendDecision {
        self.check_room_at(principal_id, tier_label, projected_max, Instant::now())
    }

    /// [`check_room`] with an injectable clock — see [`current_spend_micros_at`].
    pub fn check_room_at(
        &self,
        principal_id: &str,
        tier_label: &str,
        projected_max: u64,
        now: Instant,
    ) -> SpendDecision {
        let cap_micros = TierCaps::lookup(tier_label);
        let current_micros = self.current_spend_micros_at(principal_id, now);
        let projected_micros = projected_max;
        // `saturating_add` so a bogus projection doesn't wrap and
        // accidentally admit. Cap === u64::MAX (fallback) always wins.
        let would_be = current_micros.saturating_add(projected_micros);
        let allowed = cap_micros == u64::MAX || would_be <= cap_micros;
        SpendDecision {
            allowed,
            current_micros,
            projected_micros,
            cap_micros,
            tier_label: tier_label.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tier_caps_known_labels() {
        assert_eq!(TierCaps::lookup("free"), TierCaps::FREE);
        assert_eq!(TierCaps::lookup("pro"), TierCaps::PRO);
        assert_eq!(TierCaps::lookup("enterprise"), TierCaps::ENTERPRISE);
        assert_eq!(TierCaps::lookup("jwt"), TierCaps::ENTERPRISE);
        assert_eq!(TierCaps::lookup("fallback"), u64::MAX);
        // Mixed case + unknown labels.
        assert_eq!(TierCaps::lookup("FREE"), TierCaps::FREE);
        assert_eq!(TierCaps::lookup("garbage"), TierCaps::FREE);
    }

    #[test]
    fn under_cap_admits() {
        let store = UsageStore::new();
        let decision = store.check_room("apikey:abc", "free", 40_000);
        assert!(decision.allowed);
        assert_eq!(decision.current_micros, 0);
        assert_eq!(decision.cap_micros, TierCaps::FREE);
    }

    #[test]
    fn exceeds_cap_rejects() {
        let store = UsageStore::new();
        // Record $0.08 already spent, then try to project another $0.04
        // — total $0.12, ceiling $0.10. Should reject.
        store.record("user:1", 80_000);
        let decision = store.check_room("user:1", "free", 40_000);
        assert!(!decision.allowed);
        assert_eq!(decision.current_micros, 80_000);
        assert_eq!(decision.projected_micros, 40_000);
    }

    #[test]
    fn boundary_exactly_at_cap_admits() {
        let store = UsageStore::new();
        store.record("user:b", TierCaps::FREE - 40_000);
        let decision = store.check_room("user:b", "free", 40_000);
        assert!(decision.allowed, "exact-cap projection should still admit");
        // Now record it; the next 40k pushes over.
        store.record("user:b", 40_000);
        let next = store.check_room("user:b", "free", 40_000);
        assert!(!next.allowed);
    }

    #[test]
    fn fallback_tier_is_unlimited() {
        let store = UsageStore::new();
        let decision = store.check_room("fallback", "fallback", u64::MAX / 2);
        assert!(decision.allowed);
        assert_eq!(decision.cap_micros, u64::MAX);
    }

    #[test]
    fn rolling_window_evicts_after_24h() {
        let store = UsageStore::new();
        let t0 = Instant::now();
        // Spend 80% of the free cap at t0.
        store.record_at("user:rw", 80_000, t0);
        // At t0 + 23h — entry still counts.
        let t_23h = t0 + Duration::from_secs(23 * 3600);
        let now_at_23h = store.current_spend_micros_at("user:rw", t_23h);
        assert_eq!(now_at_23h, 80_000);
        // At t0 + 24h + 1s — entry evicts; spend returns to zero.
        let t_just_after = t0 + WINDOW + Duration::from_secs(1);
        let now_after = store.current_spend_micros_at("user:rw", t_just_after);
        assert_eq!(now_after, 0);
        // And a fresh check_room admits the full cap again.
        let decision = store.check_room_at("user:rw", "free", TierCaps::FREE, t_just_after);
        assert!(decision.allowed);
    }

    #[test]
    fn record_zero_is_noop() {
        let store = UsageStore::new();
        store.record("noop", 0);
        assert_eq!(store.current_spend_micros("noop"), 0);
    }

    #[test]
    fn pro_tier_admits_larger_projection() {
        let store = UsageStore::new();
        let decision = store.check_room("user:pro", "pro", 4_000_000);
        assert!(decision.allowed);
        assert_eq!(decision.cap_micros, TierCaps::PRO);
        // Same projection on free is rejected.
        let on_free = store.check_room("user:free-too-big", "free", 4_000_000);
        assert!(!on_free.allowed);
    }

    #[test]
    fn partial_window_eviction_sums_remaining() {
        let store = UsageStore::new();
        let t0 = Instant::now();
        // 3 entries: 20k a day ago (will evict), 30k 12h ago, 25k now.
        store.record_at("user:p", 20_000, t0);
        store.record_at("user:p", 30_000, t0 + Duration::from_secs(12 * 3600));
        store.record_at("user:p", 25_000, t0 + Duration::from_secs(24 * 3600));
        // Query at t0 + 24h + 1s — first entry evicts, remaining = 55k.
        let now = t0 + WINDOW + Duration::from_secs(1);
        let spend = store.current_spend_micros_at("user:p", now);
        assert_eq!(spend, 55_000);
    }
}
