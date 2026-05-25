//! Per-call usage log + daily-bucket aggregator.
//!
//! Every successful `/v1/generate`, `/v1/iterate`, and `/v1/export` call
//! appends one line to `$MOTION_FORGE_DATA_DIR/usage.jsonl`. The format
//! is jsonl rather than a single rolling JSON document so:
//!
//!   - appends are O(1) and lock-free at the file level (one syscall);
//!   - the file can be tailed in real time for ops dashboards;
//!   - rotation by date is trivial (`mv usage.jsonl 2026-05.jsonl`).
//!
//! Aggregation for the dashboard reads the whole file each call. That's
//! fine for the first ~100k events (a few MB); the next optimisation —
//! a per-day cache — is queued behind any sign of read latency.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::timefmt::{date_today_utc, now_rfc3339};

/// Single call record. Cost is in micro-USD (1_000_000 = $1.00) so we
/// can sum without floating-point drift.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageEvent {
    pub ts: String,
    /// `user:<sub>` for JWT principals, `apikey:<id>` for API keys,
    /// `fallback` for the desktop install secret.
    pub principal_id: String,
    pub route: String,
    pub model: Option<String>,
    pub tokens_in: u32,
    pub tokens_out: u32,
    pub cost_micros: u64,
    /// Wall-clock ms the call took. Useful for the dashboard's
    /// p50/p95 latency widget.
    pub duration_ms: u64,
}

/// Append-only usage log.
#[derive(Debug, Clone)]
pub struct UsageLog {
    inner: Arc<Mutex<()>>,
    file: PathBuf,
}

impl UsageLog {
    pub fn from_env() -> std::io::Result<Self> {
        let base = std::env::var("MOTION_FORGE_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("./data"));
        std::fs::create_dir_all(&base)?;
        Ok(Self {
            inner: Arc::new(Mutex::new(())),
            file: base.join("usage.jsonl"),
        })
    }

    /// Append a single record. Failures are logged at WARN — we don't
    /// want a usage-log write error to fail an otherwise-successful
    /// generate call.
    pub fn append(&self, ev: UsageEvent) {
        let line = match serde_json::to_string(&ev) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(error = %e, "failed to serialise usage event");
                return;
            }
        };
        let _g = self.inner.lock().expect("usage mutex poisoned");
        let mut f = match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.file)
        {
            Ok(f) => f,
            Err(e) => {
                tracing::warn!(error = %e, "failed to open usage log");
                return;
            }
        };
        if let Err(e) = writeln!(f, "{line}") {
            tracing::warn!(error = %e, "failed to write usage event");
        }
    }

    /// Aggregate by day for a specific principal. Returns daily buckets
    /// for the last `lookback_days` days (defaults to 30).
    ///
    /// Naïve full-file scan; profile if this gets slow.
    pub fn aggregate_for(&self, principal_id: &str, lookback_days: usize) -> UsageReport {
        let _g = self.inner.lock().expect("usage mutex poisoned");
        let Ok(f) = std::fs::File::open(&self.file) else {
            return UsageReport::empty();
        };
        let mut by_day: BTreeMap<String, DayBucket> = BTreeMap::new();
        let mut total = DayBucket::default();
        let mut by_model: BTreeMap<String, DayBucket> = BTreeMap::new();
        let mut by_route: BTreeMap<String, u64> = BTreeMap::new();

        // Cutoff: last N days from today, inclusive.
        let today = date_today_utc();
        let cutoff_day = nth_day_before(&today, lookback_days as i64);

        for line in BufReader::new(f).lines().map_while(Result::ok) {
            let Ok(ev) = serde_json::from_str::<UsageEvent>(&line) else {
                continue;
            };
            if ev.principal_id != principal_id {
                continue;
            }
            // Day prefix: "YYYY-MM-DD" out of "YYYY-MM-DDTHH:MM:SSZ".
            if ev.ts.len() < 10 {
                continue;
            }
            let day = &ev.ts[..10];
            if day.to_string() < cutoff_day {
                continue;
            }
            let bucket = by_day.entry(day.to_string()).or_default();
            bucket.calls += 1;
            bucket.tokens_in += ev.tokens_in as u64;
            bucket.tokens_out += ev.tokens_out as u64;
            bucket.cost_micros += ev.cost_micros;
            total.calls += 1;
            total.tokens_in += ev.tokens_in as u64;
            total.tokens_out += ev.tokens_out as u64;
            total.cost_micros += ev.cost_micros;
            if let Some(m) = ev.model.as_deref() {
                let mb = by_model.entry(m.to_string()).or_default();
                mb.calls += 1;
                mb.tokens_in += ev.tokens_in as u64;
                mb.tokens_out += ev.tokens_out as u64;
                mb.cost_micros += ev.cost_micros;
            }
            *by_route.entry(ev.route).or_default() += 1;
        }

        UsageReport {
            principal_id: principal_id.into(),
            generated_at: now_rfc3339(),
            lookback_days,
            total,
            by_day: by_day.into_iter().map(|(day, b)| DailyRow { day, bucket: b }).collect(),
            by_model: by_model.into_iter().map(|(model, b)| ModelRow { model, bucket: b }).collect(),
            by_route: by_route.into_iter().map(|(route, calls)| RouteRow { route, calls }).collect(),
        }
    }
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct DayBucket {
    pub calls: u64,
    pub tokens_in: u64,
    pub tokens_out: u64,
    pub cost_micros: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DailyRow {
    pub day: String,
    #[serde(flatten)]
    pub bucket: DayBucket,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModelRow {
    pub model: String,
    #[serde(flatten)]
    pub bucket: DayBucket,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RouteRow {
    pub route: String,
    pub calls: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UsageReport {
    pub principal_id: String,
    pub generated_at: String,
    pub lookback_days: usize,
    pub total: DayBucket,
    pub by_day: Vec<DailyRow>,
    pub by_model: Vec<ModelRow>,
    pub by_route: Vec<RouteRow>,
}

impl UsageReport {
    fn empty() -> Self {
        Self {
            principal_id: String::new(),
            generated_at: now_rfc3339(),
            lookback_days: 0,
            total: DayBucket::default(),
            by_day: vec![],
            by_model: vec![],
            by_route: vec![],
        }
    }
}

/// "YYYY-MM-DD" exactly `n` days before `today` (inclusive of today as
/// day 0).
fn nth_day_before(today: &str, n: i64) -> String {
    use crate::timefmt::unix_to_ymdhms;
    // Parse the day → unix secs at midnight UTC.
    let (y, m, d) = (
        today[0..4].parse::<i32>().unwrap_or(1970),
        today[5..7].parse::<u32>().unwrap_or(1),
        today[8..10].parse::<u32>().unwrap_or(1),
    );
    // Days since epoch, working back from (y, m, d).
    let secs = ymd_to_unix(y, m, d) - n * 86400;
    let (yy, mm, dd, _, _, _) = unix_to_ymdhms(secs);
    format!("{yy:04}-{mm:02}-{dd:02}")
}

/// Inverse of unix_to_ymdhms for midnight UTC of (y, m, d).
fn ymd_to_unix(y: i32, m: u32, d: u32) -> i64 {
    // Same Hinnant algorithm in the other direction.
    let y = (if m <= 2 { y - 1 } else { y }) as i64;
    let era = if y >= 0 { y / 400 } else { (y - 399) / 400 };
    let yoe = (y - era * 400) as u32;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + (doe as i64) - 719468;
    days * 86400
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn log_in(dir: &std::path::Path) -> UsageLog {
        std::fs::create_dir_all(dir).unwrap();
        UsageLog {
            inner: Arc::new(Mutex::new(())),
            file: dir.join("usage.jsonl"),
        }
    }

    fn ev(principal: &str, route: &str, model: Option<&str>, tin: u32, tout: u32, cost: u64) -> UsageEvent {
        UsageEvent {
            ts: now_rfc3339(),
            principal_id: principal.into(),
            route: route.into(),
            model: model.map(String::from),
            tokens_in: tin,
            tokens_out: tout,
            cost_micros: cost,
            duration_ms: 0,
        }
    }

    #[test]
    fn append_then_aggregate_for_principal() {
        let tmp = TempDir::new().unwrap();
        let log = log_in(tmp.path());
        log.append(ev("user:a", "/v1/generate", Some("ollama/llava"), 100, 50, 1500));
        log.append(ev("user:a", "/v1/iterate", Some("ollama/llava"), 50, 25, 750));
        log.append(ev("user:b", "/v1/generate", Some("openai/gpt-4o"), 1000, 500, 30000));
        let rep = log.aggregate_for("user:a", 30);
        assert_eq!(rep.total.calls, 2);
        assert_eq!(rep.total.tokens_in, 150);
        assert_eq!(rep.total.cost_micros, 2250);
        assert_eq!(rep.by_model.len(), 1);
        assert_eq!(rep.by_model[0].model, "ollama/llava");
        assert_eq!(rep.by_route.len(), 2);
    }

    #[test]
    fn aggregate_skips_other_principals() {
        let tmp = TempDir::new().unwrap();
        let log = log_in(tmp.path());
        log.append(ev("user:other", "/v1/generate", None, 1, 1, 1));
        let rep = log.aggregate_for("user:me", 30);
        assert_eq!(rep.total.calls, 0);
    }

    #[test]
    fn missing_log_returns_empty_report() {
        let tmp = TempDir::new().unwrap();
        let log = log_in(tmp.path());
        let rep = log.aggregate_for("user:nobody", 30);
        assert_eq!(rep.total.calls, 0);
        assert!(rep.by_day.is_empty());
    }

    #[test]
    fn ymd_to_unix_round_trips() {
        let s = ymd_to_unix(2026, 5, 25);
        let (y, m, d, _, _, _) = crate::timefmt::unix_to_ymdhms(s);
        assert_eq!((y, m, d), (2026, 5, 25));
    }

    #[test]
    fn nth_day_before_handles_month_boundary() {
        assert_eq!(nth_day_before("2026-03-02", 1), "2026-03-01");
        assert_eq!(nth_day_before("2026-03-01", 1), "2026-02-28");
        assert_eq!(nth_day_before("2026-01-01", 1), "2025-12-31");
    }
}
