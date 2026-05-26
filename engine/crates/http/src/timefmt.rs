//! Tiny timestamp helpers shared by stores that want human-readable
//! `2026-05-25T20:19:02Z`-style strings without pulling in `chrono`.
//!
//! Pulled out of api_keys.rs because notifications, usage, and any
//! other module that wants RFC3339 strings would otherwise duplicate
//! the Howard-Hinnant Y/M/D math.

/// Trivially correct UNIX → Y/M/D/H/M/S conversion (UTC). Good for
/// 1970..2400 — algorithm from Howard Hinnant's date library
/// (public domain).
pub fn unix_to_ymdhms(secs: i64) -> (i64, u32, u32, u32, u32, u32) {
    let days = secs.div_euclid(86400);
    let secs_of_day = secs.rem_euclid(86400) as u32;
    let h = secs_of_day / 3600;
    let mi = (secs_of_day % 3600) / 60;
    let s = secs_of_day % 60;

    let z = days + 719468;
    let era = if z >= 0 {
        z / 146097
    } else {
        (z - 146096) / 146097
    };
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d, h, mi, s)
}

/// `2026-05-25T20:19:02Z` formatted from the current system clock.
pub fn now_rfc3339() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, mo, d, h, mi, s) = unix_to_ymdhms(secs);
    format!("{y:04}-{mo:02}-{d:02}T{h:02}:{mi:02}:{s:02}Z")
}

/// `2026-05-25` — date-only form for usage bucketing.
pub fn date_today_utc() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let (y, mo, d, _, _, _) = unix_to_ymdhms(secs);
    format!("{y:04}-{mo:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn epoch_renders_correctly() {
        let (y, m, d, h, mi, s) = unix_to_ymdhms(0);
        assert_eq!((y, m, d, h, mi, s), (1970, 1, 1, 0, 0, 0));
    }

    #[test]
    fn end_of_2025_renders_correctly() {
        // 2025-12-31 23:59:59 UTC
        let (y, m, d, h, mi, s) = unix_to_ymdhms(1_767_225_599);
        assert_eq!((y, m, d, h, mi, s), (2025, 12, 31, 23, 59, 59));
    }

    #[test]
    fn now_is_rfc3339_shape() {
        let s = now_rfc3339();
        assert_eq!(s.len(), 20);
        assert!(s.ends_with('Z'));
        assert!(s.contains('T'));
    }
}
