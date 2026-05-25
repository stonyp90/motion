//! Parse Figma share URLs into a `(file_key, node_id?)` tuple.
//!
//! Figma has shipped (at least) three URL shapes over the years:
//!   1. `https://www.figma.com/file/{KEY}/{slug}?node-id=1%3A2`
//!   2. `https://www.figma.com/design/{KEY}/{slug}?node-id=1-2`
//!   3. `https://www.figma.com/proto/{KEY}/{slug}?node-id=...`
//!
//! The node-id can be percent-encoded (`1%3A2`), colon-encoded (`1:2`),
//! or dash-encoded (`1-2`, the current default). We normalise everything
//! to the colon form (`1:2`) which is what the REST API expects.
//!
//! No URL parser dependency — we work on the string directly so we stay
//! lightweight and `wasm`-friendly.

use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ParseError {
    #[error("not a Figma URL (expected figma.com host)")]
    NotFigmaHost,
    #[error("missing file key segment (expected /file/, /design/, or /proto/)")]
    MissingFileSegment,
    #[error("empty file key")]
    EmptyFileKey,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedFigmaUrl {
    /// The opaque file key from the URL path.
    pub file_key: String,
    /// Node id normalised to `<num>:<num>` form for the REST API.
    /// `None` if no `node-id` query param was present.
    pub node_id: Option<String>,
}

/// Parse a Figma share / canvas URL.
///
/// Accepts:
///   - `https://www.figma.com/file/{KEY}/...`
///   - `https://www.figma.com/design/{KEY}/...`
///   - `https://www.figma.com/proto/{KEY}/...`
///   - The same forms without `www.` or without scheme.
pub fn parse_figma_url(url: &str) -> Result<ParsedFigmaUrl, ParseError> {
    let trimmed = url.trim();

    // Strip scheme.
    let without_scheme = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(trimmed);

    // Split host and path+query.
    let (host, path_and_query) = match without_scheme.find('/') {
        Some(idx) => (&without_scheme[..idx], &without_scheme[idx + 1..]),
        None => (without_scheme, ""),
    };

    // Accept figma.com or www.figma.com (and subdomains ending in .figma.com).
    let host_lower = host.to_ascii_lowercase();
    if host_lower != "figma.com"
        && host_lower != "www.figma.com"
        && !host_lower.ends_with(".figma.com")
    {
        return Err(ParseError::NotFigmaHost);
    }

    // Split path and query.
    let (path, query) = match path_and_query.find('?') {
        Some(idx) => (&path_and_query[..idx], &path_and_query[idx + 1..]),
        None => (path_and_query, ""),
    };

    // Walk path segments to find the file-segment marker.
    let mut segments = path.split('/').filter(|s| !s.is_empty());
    let mut file_key: Option<String> = None;
    while let Some(seg) = segments.next() {
        if matches!(seg, "file" | "design" | "proto" | "board" | "deck") {
            if let Some(next) = segments.next() {
                file_key = Some(next.to_string());
            }
            break;
        }
    }

    let file_key = file_key.ok_or(ParseError::MissingFileSegment)?;
    if file_key.is_empty() {
        return Err(ParseError::EmptyFileKey);
    }

    let node_id = extract_node_id(query);

    Ok(ParsedFigmaUrl { file_key, node_id })
}

/// Find `node-id=...` in a query string and normalise its value to `a:b`.
fn extract_node_id(query: &str) -> Option<String> {
    for pair in query.split('&') {
        let mut it = pair.splitn(2, '=');
        let key = it.next()?;
        if key == "node-id" {
            let raw = it.next().unwrap_or("");
            return Some(normalise_node_id(raw));
        }
    }
    None
}

/// Decode percent-encoding (`%3A` -> `:`) and convert dash form (`1-2`)
/// to colon form (`1:2`). Other characters are left alone.
fn normalise_node_id(raw: &str) -> String {
    let decoded = percent_decode(raw);
    // Figma's newer URLs use `1-2`; the REST API accepts both colon and
    // dash forms, but we standardise on colon so callers can rely on it.
    if decoded.contains(':') {
        decoded
    } else {
        // Only swap the FIRST dash so node ids like `123-456-foo` (rare,
        // but possible in deeply-nested copies) stay intact.
        match decoded.find('-') {
            Some(i) => {
                let mut s = String::with_capacity(decoded.len());
                s.push_str(&decoded[..i]);
                s.push(':');
                s.push_str(&decoded[i + 1..]);
                s
            }
            None => decoded,
        }
    }
}

/// Minimal percent-decoder — Figma node ids contain only digits, `:`, and
/// `-`, so we don't need a general-purpose decoder.
fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((h * 16 + l) as char);
                i += 3;
                continue;
            }
        }
        if bytes[i] == b'+' {
            out.push(' ');
        } else {
            out.push(bytes[i] as char);
        }
        i += 1;
    }
    out
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classic_file_url_with_colon_node_id() {
        let p = parse_figma_url("https://www.figma.com/file/abc123XYZ/My-Brand-Kit?node-id=1%3A2")
            .unwrap();
        assert_eq!(p.file_key, "abc123XYZ");
        assert_eq!(p.node_id.as_deref(), Some("1:2"));
    }

    #[test]
    fn design_url_with_dash_node_id() {
        let p = parse_figma_url(
            "https://www.figma.com/design/9pZJKaC1Vh7yfhg/Chrono-Brief?node-id=45-678",
        )
        .unwrap();
        assert_eq!(p.file_key, "9pZJKaC1Vh7yfhg");
        assert_eq!(p.node_id.as_deref(), Some("45:678"));
    }

    #[test]
    fn url_without_node_id() {
        let p = parse_figma_url("https://www.figma.com/file/HELLO/Some-Doc").unwrap();
        assert_eq!(p.file_key, "HELLO");
        assert_eq!(p.node_id, None);
    }

    #[test]
    fn proto_url_with_multi_query() {
        let p = parse_figma_url(
            "https://www.figma.com/proto/PROTOKEY/Some-Flow?page-id=0%3A1&node-id=3-99&type=design",
        )
        .unwrap();
        assert_eq!(p.file_key, "PROTOKEY");
        assert_eq!(p.node_id.as_deref(), Some("3:99"));
    }

    #[test]
    fn url_without_scheme_and_www() {
        let p = parse_figma_url("figma.com/design/keyABC/Untitled?node-id=10-20").unwrap();
        assert_eq!(p.file_key, "keyABC");
        assert_eq!(p.node_id.as_deref(), Some("10:20"));
    }

    #[test]
    fn url_with_colon_in_node_id_unencoded() {
        let p = parse_figma_url("https://figma.com/file/raw/Doc?node-id=7:8").unwrap();
        assert_eq!(p.file_key, "raw");
        assert_eq!(p.node_id.as_deref(), Some("7:8"));
    }

    #[test]
    fn rejects_non_figma_host() {
        let err = parse_figma_url("https://example.com/file/abc/foo").unwrap_err();
        assert_eq!(err, ParseError::NotFigmaHost);
    }

    #[test]
    fn rejects_url_with_no_file_segment() {
        let err = parse_figma_url("https://www.figma.com/dashboard").unwrap_err();
        assert_eq!(err, ParseError::MissingFileSegment);
    }

    #[test]
    fn community_file_url_still_parses() {
        // /community/file/{key}/{slug} — walker reaches `file` and grabs key.
        let p = parse_figma_url("https://www.figma.com/community/file/123456789/Free-Icon-Pack")
            .unwrap();
        assert_eq!(p.file_key, "123456789");
    }
}
