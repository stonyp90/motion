//! End-to-end test: spin up a mock Figma API on a loopback port, fetch a
//! frame from it, run the conversion, and assert the resulting Lottie
//! layer is structurally correct.
//!
//! No external test dep (mockito, wiremock) — we use a hand-rolled
//! `tokio::net::TcpListener` because the request is a single GET and the
//! response a single fixed JSON body.

use motion_forge_figma::{fetch_frame_with, to_lottie_layer};
use std::io::Write;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const MOCK_FIGMA_RESPONSE: &str = r#"{
    "nodes": {
        "1:2": {
            "document": {
                "id": "1:2",
                "name": "Hero Frame",
                "type": "FRAME",
                "absoluteBoundingBox": { "x": 0, "y": 0, "width": 800, "height": 600 },
                "fills": [
                    { "type": "SOLID", "color": { "r": 0.05, "g": 0.05, "b": 0.1, "a": 1.0 } }
                ],
                "children": [
                    {
                        "id": "1:3",
                        "name": "Logo Mark",
                        "type": "ELLIPSE",
                        "absoluteBoundingBox": { "x": 100, "y": 100, "width": 120, "height": 120 },
                        "fills": [
                            { "type": "SOLID", "color": { "r": 0.06, "g": 0.73, "b": 0.51, "a": 1.0 } }
                        ]
                    },
                    {
                        "id": "1:4",
                        "name": "Tagline",
                        "type": "TEXT",
                        "absoluteBoundingBox": { "x": 250, "y": 130, "width": 400, "height": 60 },
                        "characters": "Motion that moves.",
                        "style": { "fontFamily": "Inter", "fontSize": 36, "textAlignHorizontal": "LEFT" },
                        "fills": [
                            { "type": "SOLID", "color": { "r": 0.95, "g": 0.96, "b": 0.98, "a": 1.0 } }
                        ]
                    }
                ]
            }
        }
    }
}"#;

#[tokio::test]
async fn fetch_then_convert_yields_valid_lottie_layer() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        // Accept exactly one connection, read until "\r\n\r\n", reply with
        // the fixed JSON body. Don't try to be a real HTTP server.
        if let Ok((mut sock, _)) = listener.accept().await {
            let mut buf = vec![0u8; 4096];
            let mut total = Vec::new();
            loop {
                let n = sock.read(&mut buf).await.unwrap_or(0);
                if n == 0 {
                    break;
                }
                total.extend_from_slice(&buf[..n]);
                if total.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            // Sanity-check that X-Figma-Token went over the wire.
            let req = String::from_utf8_lossy(&total);
            assert!(
                req.to_ascii_lowercase().contains("x-figma-token:"),
                "expected X-Figma-Token header in request, got: {req}"
            );

            let mut response: Vec<u8> = Vec::new();
            write!(
                response,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n",
                len = MOCK_FIGMA_RESPONSE.len()
            )
            .unwrap();
            response.extend_from_slice(MOCK_FIGMA_RESPONSE.as_bytes());
            sock.write_all(&response).await.unwrap();
            sock.flush().await.unwrap();
            // Give the client a moment to read before we drop the socket.
            let _ = sock.shutdown().await;
        }
    });

    let base_url = format!("http://{addr}");
    let client = reqwest::Client::new();
    let node = fetch_frame_with(&client, &base_url, "FAKEKEY", "1:2", "figd_fake_token")
        .await
        .expect("fetch_frame_with should succeed");

    assert_eq!(node.node_type, "FRAME");
    assert_eq!(node.name, "Hero Frame");
    let children = node.children.as_ref().unwrap();
    assert_eq!(children.len(), 2);
    assert_eq!(children[0].node_type, "ELLIPSE");
    assert_eq!(children[1].node_type, "TEXT");

    let layer = to_lottie_layer(&node);
    // FRAME is a shape layer (ty:4) flattened from its children.
    assert_eq!(layer.layer["ty"], 4);
    assert_eq!(layer.layer["nm"], "Hero Frame");
    // No warnings — solid fills + supported node types only.
    assert!(
        layer.warnings.is_empty(),
        "unexpected warnings: {:?}",
        layer.warnings
    );
    // The outer group should contain at least the two child groups.
    let outer = &layer.layer["shapes"][0];
    assert_eq!(outer["ty"], "gr");
    assert!(outer["it"].as_array().unwrap().len() >= 3);

    let _ = server.await;
}
