//! WebSocket route for streaming speech-to-text.
//!
//! Endpoint: `GET /v1/stt/stream` upgraded to a WebSocket connection.
//!
//! Wire protocol:
//!
//! * **Client → server (binary):** raw int16 PCM samples, little-endian,
//!   16 kHz mono. The browser worklet ships exactly
//!   [`motion_forge_stt::FRAME_SAMPLES`] samples per frame (1024 bytes / 32 ms).
//!   Short trailing frames at end-of-stream are tolerated.
//! * **Server → client (text):** JSON objects matching
//!   [`motion_forge_stt::TranscriptEvent`] — `{ "type": "partial"|"final",
//!   "text": "...", "t_ms": 1234 }`.
//! * **Either side (close):** standard WS close frame ends the session.
//!
//! Auth: the route is **intentionally unauthenticated**. The mic should
//! work the moment a visitor clicks it. If we ever bolt auth onto `/v1/*`
//! we must exempt `/v1/stt/stream` explicitly (or scope the auth layer
//! away from this route in the router builder).

use std::env;
use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::State;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use futures_util::{SinkExt, StreamExt};
use motion_forge_stt::{FRAME_SAMPLES, StreamingStt, TranscriptEvent};
use serde::Serialize;

/// Environment variable the operator sets to point at the whisper.cpp model.
pub const MODEL_PATH_ENV: &str = "MOTION_FORGE_STT_MODEL_PATH";

/// Shared route configuration. Cheap to clone; held in axum router state.
#[derive(Clone, Default)]
pub struct SttRouteConfig {
    pub model_path: Option<PathBuf>,
}

impl SttRouteConfig {
    /// Pick up `MOTION_FORGE_STT_MODEL_PATH` from the environment.
    pub fn from_env() -> Self {
        Self {
            model_path: env::var_os(MODEL_PATH_ENV).map(PathBuf::from),
        }
    }
}

/// axum handler for `GET /v1/stt/stream`. Upgrades the request to a WS.
pub async fn stt_stream_handler(
    ws: WebSocketUpgrade,
    State(state): State<Arc<SttRouteConfig>>,
) -> Response {
    let Some(model_path) = state.model_path.clone() else {
        tracing::error!(
            env = MODEL_PATH_ENV,
            "STT request rejected: model path env not set"
        );
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            format!(
                "speech-to-text is not configured: set {MODEL_PATH_ENV} to a whisper.cpp \
                 GGUF model (see engine/scripts/fetch-whisper-model.sh)"
            ),
        )
            .into_response();
    };
    if !model_path.exists() {
        tracing::error!(
            path = %model_path.display(),
            env = MODEL_PATH_ENV,
            "STT request rejected: model file does not exist on disk"
        );
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            format!(
                "speech-to-text model missing at {} — run engine/scripts/fetch-whisper-model.sh",
                model_path.display()
            ),
        )
            .into_response();
    }
    ws.on_upgrade(move |socket| handle_socket(socket, model_path))
}

async fn handle_socket(socket: WebSocket, model_path: PathBuf) {
    // Construct the worker on a blocking pool — loading the GGUF model
    // touches the filesystem and decodes a few hundred MB.
    let worker = match tokio::task::spawn_blocking(move || StreamingStt::new(model_path)).await {
        Ok(Ok(w)) => Arc::new(w),
        Ok(Err(e)) => {
            tracing::error!(error = %e, "stt: worker init failed");
            let _ = close_with_error(socket, "stt worker init failed").await;
            return;
        }
        Err(e) => {
            tracing::error!(error = %e, "stt: worker init join error");
            let _ = close_with_error(socket, "stt worker init crashed").await;
            return;
        }
    };
    tracing::info!(backend = worker.backend_name(), "stt: websocket session up");

    let (mut sender, mut receiver) = socket.split();

    while let Some(msg) = receiver.next().await {
        let frame = match msg {
            Ok(Message::Binary(bytes)) => bytes,
            Ok(Message::Close(_)) => {
                tracing::info!("stt: client closed");
                break;
            }
            Ok(Message::Ping(payload)) => {
                if sender.send(Message::Pong(payload)).await.is_err() {
                    break;
                }
                continue;
            }
            Ok(Message::Pong(_)) | Ok(Message::Text(_)) => continue,
            Err(e) => {
                tracing::warn!(error = %e, "stt: ws recv error");
                break;
            }
        };
        let samples = decode_int16_le(&frame);
        if samples.is_empty() {
            continue;
        }
        // Heavy CPU lives on a blocking thread so the WS task stays
        // responsive (otherwise long-running whisper inference would
        // starve other tasks on the runtime).
        let worker_clone = Arc::clone(&worker);
        let events =
            match tokio::task::spawn_blocking(move || worker_clone.feed_frame(&samples)).await {
                Ok(ev) => ev,
                Err(e) => {
                    tracing::error!(error = %e, "stt: feed_frame join error");
                    break;
                }
            };
        if !send_events(&mut sender, &events).await {
            break;
        }
    }

    // Drain whatever is left in the buffer as a final.
    let worker_for_flush = Arc::clone(&worker);
    let tail = tokio::task::spawn_blocking(move || worker_for_flush.finish())
        .await
        .unwrap_or_default();
    if !tail.is_empty() {
        let _ = send_events(&mut sender, &tail).await;
    }
    let _ = sender.send(Message::Close(None)).await;
    tracing::info!(
        uptime_s = worker.uptime_seconds(),
        "stt: websocket session closed"
    );
}

fn decode_int16_le(bytes: &[u8]) -> Vec<i16> {
    // Tolerate odd-length tails by truncating to the nearest sample.
    let pairs = bytes.len() / 2;
    let mut out = Vec::with_capacity(pairs);
    for i in 0..pairs {
        let lo = bytes[i * 2] as i16;
        let hi = bytes[i * 2 + 1] as i16;
        out.push((hi << 8) | (lo & 0xff));
    }
    // Warn if the browser is sending wrongly-sized frames — VAD only fires
    // on exactly FRAME_SAMPLES, so undersized frames hurt endpointing.
    if pairs != FRAME_SAMPLES && pairs > 0 && pairs % FRAME_SAMPLES != 0 {
        tracing::debug!(samples = pairs, "stt: non-aligned frame size");
    }
    out
}

async fn send_events<S>(sender: &mut S, events: &[TranscriptEvent]) -> bool
where
    S: SinkExt<Message> + Unpin,
    S::Error: std::fmt::Display,
{
    for ev in events {
        let payload = match serde_json::to_string(ev) {
            Ok(s) => s,
            Err(e) => {
                tracing::error!(error = %e, "stt: serialize event failed");
                continue;
            }
        };
        if let Err(e) = sender.send(Message::Text(payload)).await {
            tracing::warn!(error = %e, "stt: ws send error");
            return false;
        }
    }
    true
}

async fn close_with_error(mut socket: WebSocket, msg: &str) -> Result<(), axum::Error> {
    #[derive(Serialize)]
    struct Err<'a> {
        #[serde(rename = "type")]
        kind: &'a str,
        error: &'a str,
    }
    let payload = serde_json::to_string(&Err {
        kind: "error",
        error: msg,
    })
    .unwrap_or_else(|_| String::from(r#"{"type":"error","error":"unknown"}"#));
    socket.send(Message::Text(payload)).await?;
    socket.send(Message::Close(None)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_int16_le_basics() {
        // 0x0000, 0x0100 (256), 0x80FF (-128 sign-extended)
        let bytes = vec![0x00, 0x00, 0x00, 0x01, 0x80, 0xFF];
        let out = decode_int16_le(&bytes);
        assert_eq!(out, vec![0, 256, -128]);
    }

    #[test]
    fn decode_int16_le_handles_odd_tail() {
        let bytes = vec![0x01, 0x00, 0x42];
        let out = decode_int16_le(&bytes);
        assert_eq!(out, vec![1]); // trailing odd byte dropped
    }

    #[test]
    fn config_from_env_picks_up_path() {
        // Use a unique env var name to avoid clobbering other tests if the
        // suite is run with --test-threads > 1; here we just verify the
        // helper reads the documented variable.
        unsafe {
            std::env::set_var(MODEL_PATH_ENV, "/tmp/whisper-test.bin");
        }
        let cfg = SttRouteConfig::from_env();
        assert_eq!(
            cfg.model_path.as_deref(),
            Some(std::path::Path::new("/tmp/whisper-test.bin"))
        );
        unsafe {
            std::env::remove_var(MODEL_PATH_ENV);
        }
    }
}
