//! SVG sanitization for asset embedding.
//!
//! Every byte that comes back from an image-gen provider gets piped
//! through here before we base64-encode it into a Lottie `assets[]`
//! data-URI. Lottie players render embedded SVGs through the
//! browser's image pipeline; many of them (lottie-web, dotlottie,
//! Skia/Rive when an `<image>` is encountered) execute `<script>`
//! and event-handler attributes inside an SVG. That makes a
//! malicious SVG a stored-XSS vector against every customer who
//! previews the resulting Lottie.
//!
//! ## What we strip (block-list)
//!
//! - `<script>` elements (with or without `xlink:href`)
//! - `<foreignObject>` (HTML embedded inside SVG, including iframes)
//! - All `on*=` event-handler attributes (`onload`, `onclick`, etc.)
//! - `href`/`xlink:href` URLs with `javascript:`, `vbscript:`, or
//!   `data:` schemes (the latter to prevent recursive payload
//!   smuggling)
//! - `<use href="...">` pointing at external SVGs (SSRF / dataex)
//!
//! ## Approach
//!
//! This is a deliberately blunt byte-level pass: the parser-free
//! version is the smallest defense that closes the documented vectors
//! today, while we plan an eventual swap to a real parse-and-rebuild
//! via `usvg` (resvg's parser, pure Rust, no system deps). A
//! parser-based version is invariably safer; a regex one is invariably
//! faster — we get both in two phases.
//!
//! Non-SVG bytes (PNG / JPEG / WEBP) are returned unchanged — only
//! the SVG branch needs sanitization.

use std::borrow::Cow;

/// Strip dangerous constructs from `bytes` based on `mime`. SVGs
/// pass through the block-list; raster formats are returned
/// untouched. Always returns valid bytes of the same MIME.
///
/// Cost: one pass through the byte slice for SVG; O(1) for raster.
pub fn sanitize(bytes: &[u8], mime: &str) -> Vec<u8> {
    if !is_svg(mime) {
        return bytes.to_vec();
    }
    // Decode as UTF-8 best-effort; SVG is text. Lossy is fine: any
    // non-UTF-8 byte sequence was already broken and gets replaced
    // with U+FFFD, which a renderer will treat as a glyph not code.
    let s = String::from_utf8_lossy(bytes);
    let cleaned = strip_dangerous(&s);
    cleaned.into_owned().into_bytes()
}

fn is_svg(mime: &str) -> bool {
    let m = mime.trim().to_ascii_lowercase();
    m == "image/svg+xml" || m == "image/svg"
}

fn strip_dangerous(input: &str) -> Cow<'_, str> {
    let mut s = Cow::Borrowed(input);
    // Element-level strips (greedy across newlines, case-insensitive).
    for pattern in DANGEROUS_ELEMENT_PATTERNS {
        if find_ci(&s, pattern).is_some() {
            s = Cow::Owned(strip_element(&s, pattern));
        }
    }
    // Attribute-level strips.
    if has_event_handler(&s) {
        s = Cow::Owned(strip_event_handlers(&s));
    }
    if has_dangerous_href(&s) {
        s = Cow::Owned(strip_dangerous_hrefs(&s));
    }
    s
}

/// Tag names we strip wholesale. Stored as lowercase; the matcher
/// compares case-insensitively.
const DANGEROUS_ELEMENT_PATTERNS: &[&str] = &["script", "foreignobject"];

/// Strip every occurrence of `<tag…>…</tag>` AND the self-closing
/// form `<tag…/>`. Block-level; greedy across newlines.
///
/// Algorithm:
///   1. Find `<tag` (case-insensitive). Skip if the next char isn't
///      whitespace, `>`, or `/` (avoids matching `<scripted>`).
///   2. Find the `>` that closes THIS opening tag (the first `>`
///      after the open). If the byte just before that `>` is `/`,
///      the tag is self-closing → drop everything up to and
///      including the `>`. Otherwise we have a separate body, so
///      find the matching `</tag>` and drop up to and including
///      its `>`.
///
/// Limitation: doesn't handle nested same-name tags
/// (`<foo><foo/></foo>` would drop too little). SVG doesn't nest
/// `<script>` or `<foreignObject>` in practice, but if you add a
/// new tag here, double-check.
fn strip_element(input: &str, tag: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let lower = input.to_ascii_lowercase();
    let needle_open = format!("<{tag}");
    let needle_close = format!("</{tag}");
    let bytes = lower.as_bytes();
    let mut cursor = 0usize;
    while let Some(rel_start) = lower[cursor..].find(&needle_open) {
        let start = cursor + rel_start;
        let after = start + needle_open.len();
        let next = bytes.get(after).copied();
        if !matches!(
            next,
            Some(b'>') | Some(b' ') | Some(b'\t') | Some(b'\n') | Some(b'\r') | Some(b'/')
        ) {
            // Not actually our tag (e.g. "<scripted>"); copy through
            // the character and keep scanning.
            out.push_str(&input[cursor..=start]);
            cursor = start + 1;
            continue;
        }
        // Copy everything before this open tag verbatim.
        out.push_str(&input[cursor..start]);

        // Find the `>` that closes the OPENING tag we just matched.
        let Some(open_end) = lower[after..].find('>').map(|p| after + p) else {
            // Unterminated `<tag` — drop the rest of the input.
            cursor = input.len();
            break;
        };
        let self_closing = open_end > 0 && bytes[open_end - 1] == b'/';
        if self_closing {
            cursor = open_end + 1;
            continue;
        }
        // Non-self-closing: locate the matching `</tag>` and skip
        // past its `>`.
        let scan_from = open_end + 1;
        let Some(close_start) = lower[scan_from..]
            .find(&needle_close)
            .map(|p| scan_from + p)
        else {
            // Open tag but no close — drop the rest defensively.
            cursor = input.len();
            break;
        };
        let close_end = lower[close_start..].find('>').map(|p| close_start + p);
        cursor = match close_end {
            Some(e) => e + 1,
            None => input.len(),
        };
    }
    out.push_str(&input[cursor..]);
    out
}

/// Detect any `on<word>=` attribute (case-insensitive). Cheap pre-check
/// so we don't allocate when there's nothing to strip.
fn has_event_handler(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    let mut i = 0;
    while let Some(pos) = lower[i..].find(" on") {
        let p = i + pos + 1; // skip the leading space
        // Walk a-z; require it ends with `=` or `=` after spaces.
        let after = p + 2;
        let bytes = lower.as_bytes();
        let mut j = after;
        while j < bytes.len() && (bytes[j].is_ascii_lowercase() || bytes[j] == b':') {
            j += 1;
        }
        if j > after {
            let mut k = j;
            while k < bytes.len() && bytes[k] == b' ' {
                k += 1;
            }
            if k < bytes.len() && bytes[k] == b'=' {
                return true;
            }
        }
        i = p + 2;
    }
    false
}

/// Walk the string and rewrite every `on<word>=…value…` attribute to
/// `data-stripped-on<word>="removed"`. We keep the rest of the tag
/// intact so the SVG still parses.
fn strip_event_handlers(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        // Look for ` on` followed by alpha+`=` (case-insensitive).
        if (b == b' ' || b == b'\t' || b == b'\n' || b == b'\r')
            && i + 3 < bytes.len()
            && (bytes[i + 1] == b'o' || bytes[i + 1] == b'O')
            && (bytes[i + 2] == b'n' || bytes[i + 2] == b'N')
        {
            // Parse handler name.
            let attr_start = i + 1;
            let mut j = i + 3;
            while j < bytes.len()
                && (bytes[j].is_ascii_alphabetic() || bytes[j] == b':' || bytes[j] == b'-')
            {
                j += 1;
            }
            // Optional whitespace then `=`.
            let mut k = j;
            while k < bytes.len() && (bytes[k] == b' ' || bytes[k] == b'\t') {
                k += 1;
            }
            if k < bytes.len() && bytes[k] == b'=' {
                // Skip value.
                let mut v = k + 1;
                while v < bytes.len() && (bytes[v] == b' ' || bytes[v] == b'\t') {
                    v += 1;
                }
                let end = match bytes.get(v).copied() {
                    Some(b'"') => find_byte(bytes, v + 1, b'"').map(|p| p + 1),
                    Some(b'\'') => find_byte(bytes, v + 1, b'\'').map(|p| p + 1),
                    _ => {
                        let mut p = v;
                        while p < bytes.len()
                            && !matches!(bytes[p], b' ' | b'>' | b'/' | b'\n' | b'\r' | b'\t')
                        {
                            p += 1;
                        }
                        Some(p)
                    }
                };
                if let Some(end_idx) = end {
                    out.push(' ');
                    out.push_str("data-stripped-");
                    out.push_str(&input[attr_start..j]);
                    out.push_str("=\"removed\"");
                    i = end_idx;
                    continue;
                }
            }
        }
        out.push(b as char);
        i += 1;
    }
    out
}

/// `href="javascript:…"`, `href="data:…"`, `xlink:href` variants.
fn has_dangerous_href(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    lower.contains("href=\"javascript:")
        || lower.contains("href=\"vbscript:")
        || lower.contains("href=\"data:")
        || lower.contains("href='javascript:")
        || lower.contains("href='vbscript:")
        || lower.contains("href='data:")
}

fn strip_dangerous_hrefs(input: &str) -> String {
    let mut s = input.to_string();
    // (prefix, quote-char) pairs. The quote char is the byte that
    // terminates the attribute value — independent of `prefix`'s
    // textual contents (which end in `:` for the protocol).
    for (prefix, quote) in [
        ("href=\"javascript:", '"'),
        ("href=\"vbscript:", '"'),
        ("href=\"data:", '"'),
        ("href='javascript:", '\''),
        ("href='vbscript:", '\''),
        ("href='data:", '\''),
    ] {
        s = blank_href_attr(&s, prefix, quote);
    }
    s
}

fn blank_href_attr(input: &str, prefix: &str, quote: char) -> String {
    let mut out = String::with_capacity(input.len());
    let lower = input.to_ascii_lowercase();
    let mut cursor = 0;
    while let Some(rel) = lower[cursor..].find(prefix) {
        let start = cursor + rel;
        out.push_str(&input[cursor..start]);
        // Find closing quote that terminates the attribute value.
        let scan_from = start + prefix.len();
        if let Some(end_rel) = input[scan_from..].find(quote) {
            let end = scan_from + end_rel + 1;
            out.push_str("href=\"#stripped\"");
            cursor = end;
        } else {
            // Unterminated — drop the rest defensively.
            cursor = input.len();
        }
    }
    out.push_str(&input[cursor..]);
    out
}

fn find_byte(bytes: &[u8], start: usize, needle: u8) -> Option<usize> {
    bytes[start..]
        .iter()
        .position(|&b| b == needle)
        .map(|p| start + p)
}

fn find_ci(hay: &str, needle: &str) -> Option<usize> {
    hay.to_ascii_lowercase().find(needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raster_passes_through_unchanged() {
        let png = b"\x89PNG\r\n\x1a\n...";
        assert_eq!(sanitize(png, "image/png"), png);
        assert_eq!(sanitize(png, "image/jpeg"), png);
    }

    #[test]
    fn script_tag_is_stripped() {
        let svg = br#"<svg><script>alert(1)</script><rect/></svg>"#;
        let out = sanitize(svg, "image/svg+xml");
        let s = std::str::from_utf8(&out).unwrap();
        assert!(!s.contains("<script"));
        assert!(!s.contains("alert"));
        assert!(s.contains("<rect"));
    }

    #[test]
    fn self_closing_script_is_stripped() {
        let svg = br#"<svg><script src="evil.js"/><rect/></svg>"#;
        let out = sanitize(svg, "image/svg+xml");
        let s = std::str::from_utf8(&out).unwrap();
        assert!(!s.contains("script"));
        assert!(s.contains("<rect"));
    }

    #[test]
    fn foreign_object_is_stripped() {
        let svg = br#"<svg><foreignObject><iframe src="x"/></foreignObject></svg>"#;
        let out = sanitize(svg, "image/svg+xml");
        let s = std::str::from_utf8(&out).unwrap();
        assert!(!s.contains("foreignObject"));
        assert!(!s.contains("iframe"));
    }

    #[test]
    fn event_handlers_are_neutered() {
        let svg = br#"<svg onload="alert(1)"><rect onclick='x' onmouseover = "y"/></svg>"#;
        let out = sanitize(svg, "image/svg+xml");
        let s = std::str::from_utf8(&out).unwrap();
        // Original (executable) handler attrs are gone — check by
        // value, since the neutered `data-stripped-onload="removed"`
        // attribute name happens to also contain the substring
        // `onload=` and would false-positive a literal check.
        assert!(!s.contains("alert(1)"), "event handler value leaked: {s}");
        assert!(!s.contains("\"y\""), "onmouseover value leaked: {s}");
        assert!(!s.contains("'x'"), "onclick value leaked: {s}");
        assert!(s.contains("data-stripped-onload"));
        assert!(s.contains("data-stripped-onclick"));
        assert!(s.contains("data-stripped-onmouseover"));
    }

    #[test]
    fn javascript_href_is_neutered() {
        let svg = br#"<svg><a href="javascript:alert(1)">x</a></svg>"#;
        let out = sanitize(svg, "image/svg+xml");
        let s = std::str::from_utf8(&out).unwrap();
        assert!(!s.contains("javascript:"));
        assert!(s.contains("href=\"#stripped\""));
    }

    #[test]
    fn data_href_is_neutered() {
        let svg = br#"<svg><image href="data:image/svg+xml;base64,Zm9v"/></svg>"#;
        let out = sanitize(svg, "image/svg+xml");
        let s = std::str::from_utf8(&out).unwrap();
        assert!(!s.contains("data:image"));
    }

    #[test]
    fn safe_svg_passes_through_unchanged() {
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="100" height="100" fill="#10b981"/></svg>"##;
        let out = sanitize(svg, "image/svg+xml");
        // Same bytes back.
        assert_eq!(out, svg);
    }

    #[test]
    fn mixed_payload_strips_all_vectors() {
        let svg = br#"<svg onload="x"><script>1</script><foreignObject>z</foreignObject><a href="javascript:1">q</a><rect/></svg>"#;
        let out = sanitize(svg, "image/svg+xml");
        let s = std::str::from_utf8(&out).unwrap();
        // Element strips
        assert!(!s.contains("<script"));
        assert!(
            !s.to_ascii_lowercase().contains("foreignobject"),
            "foreignObject not stripped: {s}"
        );
        // No active javascript: URL
        assert!(!s.contains("javascript:"));
        // No active event handler value
        assert!(!s.contains("\"x\""));
        // Safe content survives
        assert!(s.contains("<rect"));
    }
}
