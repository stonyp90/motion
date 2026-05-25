//! Integration tests for the URL parser against 6 real-world URL shapes.
//!
//! Each case below is a verbatim shape we've observed in the wild on
//! Figma share links — old `/file/`, new `/design/`, `/proto/`, the
//! community URLs (`/community/file/`), URLs with extra query params
//! (`page-id`, `viewport`, `type`), and URLs with the URL-encoded `:`
//! in the node id.

use motion_forge_figma::url_parse::parse_figma_url;

#[test]
fn case_1_classic_file_share_with_percent_encoded_node_id() {
    // The pre-2024 share-button output. `node-id` is percent-encoded with
    // a `:` between major / minor.
    let url = "https://www.figma.com/file/Kx3vQ2YbR9aBnAbCdEfGhI/Q4-Brand-Refresh?node-id=18%3A1234&t=foo123-0";
    let p = parse_figma_url(url).unwrap();
    assert_eq!(p.file_key, "Kx3vQ2YbR9aBnAbCdEfGhI");
    assert_eq!(p.node_id.as_deref(), Some("18:1234"));
}

#[test]
fn case_2_new_design_url_with_dash_node_id() {
    // The post-Config-2024 share output. `/file/` was renamed `/design/`
    // and the node id uses `-` instead of `:`.
    let url = "https://www.figma.com/design/AbCdEfGhIjKlMnOpQrStUv/Chrono-Brief?node-id=42-101&t=ABCdef-4";
    let p = parse_figma_url(url).unwrap();
    assert_eq!(p.file_key, "AbCdEfGhIjKlMnOpQrStUv");
    assert_eq!(p.node_id.as_deref(), Some("42:101"));
}

#[test]
fn case_3_proto_url_with_multi_query_params() {
    // Prototype links carry `starting-point-node-id`, `page-id`, etc.
    let url = "https://www.figma.com/proto/HJKlmNoPqRsTuVwXyZaBcD/My-Flow?page-id=0%3A1&node-id=2-345&viewport=10%2C20%2C0.5&t=abc-1&scaling=scale-down&type=design";
    let p = parse_figma_url(url).unwrap();
    assert_eq!(p.file_key, "HJKlmNoPqRsTuVwXyZaBcD");
    assert_eq!(p.node_id.as_deref(), Some("2:345"));
}

#[test]
fn case_4_community_file_url_no_node_id() {
    // Community share — no node id, slug after the file key.
    let url = "https://www.figma.com/community/file/1234567890123456789/Material-Design-Kit";
    let p = parse_figma_url(url).unwrap();
    assert_eq!(p.file_key, "1234567890123456789");
    assert_eq!(p.node_id, None);
}

#[test]
fn case_5_url_without_scheme_or_www() {
    // Sometimes users copy without the scheme.
    let url = "figma.com/design/MyShortKey/Untitled?node-id=7-22";
    let p = parse_figma_url(url).unwrap();
    assert_eq!(p.file_key, "MyShortKey");
    assert_eq!(p.node_id.as_deref(), Some("7:22"));
}

#[test]
fn case_6_design_url_already_colon_in_node_id() {
    // Older clients / API responses sometimes return `:` unencoded.
    let url = "https://www.figma.com/design/qwertyuiopASDFGH/Brand?node-id=99:8";
    let p = parse_figma_url(url).unwrap();
    assert_eq!(p.file_key, "qwertyuiopASDFGH");
    assert_eq!(p.node_id.as_deref(), Some("99:8"));
}

#[test]
fn rejects_non_figma_host() {
    assert!(parse_figma_url("https://malicious.example.com/file/abc/Doc").is_err());
}

#[test]
fn rejects_dashboard_url_without_file_key() {
    assert!(parse_figma_url("https://www.figma.com/files/recent").is_err());
}
