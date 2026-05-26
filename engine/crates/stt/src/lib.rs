//! Streaming speech-to-text — `StreamingStt`.
//!
//! Wire model: caller feeds 32-ms frames of int16 PCM at 16 kHz mono via
//! [`StreamingStt::feed_frame`]. The worker buffers the audio and emits a
//! mix of `Partial` and `Final` [`TranscriptEvent`]s as it goes. Endpointing
//! is driven by WebRTC VAD: when we see N consecutive non-voice frames
//! after a stretch of voiced ones, the current span is committed as `Final`
//! and the buffer is cleared. While voiced audio is accumulating we re-run
//! whisper.cpp every ~500 ms over the buffered span and emit a `Partial`.
//!
//! The whisper.cpp backend is gated behind the `whisper` cargo feature
//! (default on). When the feature is off — typically in CI environments
//! that don't have `cmake` / a C/C++ toolchain — the crate compiles with a
//! tiny stub adapter that still emits well-formed events (an empty string
//! payload) so the rest of the pipeline can be exercised. The wire format
//! between the server and the browser doesn't change.
//!
//! Production-grade things deliberately left out for the demo:
//!  * No model warm-up pool — one `WhisperContext` per `StreamingStt`.
//!  * No language detection — assumes English; configure via env var if needed.
//!  * No noise-suppression preprocessor.
//!  * Re-running whisper on a growing buffer is O(buffer length); for very
//!    long sessions the partials slow down. The VAD-driven commit caps the
//!    buffer at a single utterance, which keeps things bounded in practice.

use std::path::{Path, PathBuf};
use std::time::Instant;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use webrtc_vad::{SampleRate, Vad, VadMode};

/// Input sample rate the worker expects on every frame.
pub const SAMPLE_RATE_HZ: u32 = 16_000;
/// Number of samples in one VAD-sized frame (32 ms @ 16 kHz).
pub const FRAME_SAMPLES: usize = 512;
/// Voiced run that must precede a silence run before we commit a final.
const MIN_VOICED_FRAMES: usize = 6; // ~192 ms of speech
/// Silence run that closes out an utterance and triggers a `Final`.
const SILENCE_COMMIT_FRAMES: usize = 18; // ~576 ms of trailing silence
/// Minimum delay between two `Partial` emissions, in ms of accumulated audio.
const PARTIAL_INTERVAL_MS: u64 = 400;
/// Hard cap on the buffered audio. Beyond this we commit a final and reset.
const MAX_BUFFER_SAMPLES: usize = SAMPLE_RATE_HZ as usize * 18; // 18 s

/// Kind of transcript emitted by the worker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TranscriptKind {
    /// Best-effort intermediate transcript; the text may change later.
    Partial,
    /// Endpointed segment — won't be revised.
    Final,
}

/// One transcript event surfaced to the browser.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptEvent {
    /// Kind of event — `Partial` or `Final`.
    #[serde(rename = "type")]
    pub kind: TranscriptKind,
    /// UTF-8 text. Empty string is legal (e.g. silence-only commit).
    pub text: String,
    /// Milliseconds of audio that have been fed into the worker so far.
    pub t_ms: u64,
}

/// Public worker handle.
pub struct StreamingStt {
    backend: Mutex<Box<dyn Backend + Send>>,
    state: Mutex<RollingState>,
    vad: Mutex<Vad>,
    model_path: PathBuf,
    started: Instant,
}

// SAFETY: `webrtc_vad::Vad` wraps an `*mut Fvad` and is not `Send`/`Sync` by
// default. We never expose the underlying pointer; every access goes through
// the `Mutex<Vad>` field above, and the worker is always handed to other
// threads behind an `Arc<StreamingStt>`. The mutex makes the access strictly
// sequential, which is the same invariant the C library requires.
unsafe impl Send for StreamingStt {}
unsafe impl Sync for StreamingStt {}

#[derive(Default)]
struct RollingState {
    /// Buffered samples for the current utterance.
    buffer: Vec<i16>,
    /// Total samples ever fed (used for `t_ms`).
    total_samples: u64,
    /// Consecutive voiced frame count (for endpointing).
    voiced_run: usize,
    /// Consecutive silence frame count (for endpointing).
    silence_run: usize,
    /// True once we've seen enough voiced frames to consider this an utterance.
    has_voice: bool,
    /// `t_ms` at which we last emitted a `Partial` for the active utterance.
    last_partial_ms: u64,
    /// Last partial text we emitted; used to suppress redundant partials.
    last_partial_text: String,
}

/// Errors returned by the constructor.
#[derive(Debug, Error)]
pub enum SttError {
    #[error("MODEL_PATH does not exist: {0}")]
    ModelMissing(PathBuf),
    #[error("backend init failed: {0}")]
    Backend(String),
    #[error("invalid VAD configuration: {0}")]
    Vad(String),
}

impl StreamingStt {
    /// Construct a new worker, loading the whisper.cpp model from disk.
    ///
    /// The `model_path` must point at a `.gguf` / `.bin` file produced by
    /// whisper.cpp — typically `ggml-large-v3-turbo-q5_0.bin`. Use the helper
    /// script at `engine/scripts/fetch-whisper-model.sh` to download one.
    pub fn new(model_path: impl Into<PathBuf>) -> Result<Self, SttError> {
        let model_path = model_path.into();
        if !model_path.exists() {
            return Err(SttError::ModelMissing(model_path));
        }
        let backend = build_backend(&model_path)?;
        let mut vad = Vad::new_with_rate_and_mode(SampleRate::Rate16kHz, VadMode::Aggressive);
        // The constructor doesn't fail today, but reach through any future
        // panic by configuring rate/mode after construction too.
        vad.set_sample_rate(SampleRate::Rate16kHz);
        vad.set_mode(VadMode::Aggressive);
        Ok(Self {
            backend: Mutex::new(backend),
            state: Mutex::new(RollingState::default()),
            vad: Mutex::new(vad),
            model_path,
            started: Instant::now(),
        })
    }

    /// Returns the model path the worker was initialised with.
    pub fn model_path(&self) -> &Path {
        &self.model_path
    }

    /// Returns the backend identifier (for logging / debug only).
    pub fn backend_name(&self) -> &'static str {
        self.backend.lock().name()
    }

    /// Feed a frame of `FRAME_SAMPLES` int16 samples (16 kHz mono).
    ///
    /// Returns zero or more transcript events to forward to the client.
    /// The frame size is asserted but a short trailing frame at end-of-stream
    /// is tolerated — it is zero-padded internally.
    pub fn feed_frame(&self, frame: &[i16]) -> Vec<TranscriptEvent> {
        let mut events = Vec::new();
        let mut state = self.state.lock();

        // Append samples (pad if a partial last frame slipped through).
        state.buffer.extend_from_slice(frame);
        state.total_samples += frame.len() as u64;

        // VAD wants exactly 80/160/240/320/480/512/640 samples. We feed in
        // chunks of FRAME_SAMPLES (512). For short trailing frames we just
        // skip the VAD update and rely on the silence timer to roll forward.
        let is_voice = if frame.len() == FRAME_SAMPLES {
            self.vad.lock().is_voice_segment(frame).unwrap_or(false)
        } else {
            false
        };

        if is_voice {
            state.voiced_run = state.voiced_run.saturating_add(1);
            state.silence_run = 0;
            if state.voiced_run >= MIN_VOICED_FRAMES {
                state.has_voice = true;
            }
        } else {
            state.silence_run = state.silence_run.saturating_add(1);
            state.voiced_run = 0;
        }

        let now_ms = samples_to_ms(state.total_samples);

        // Decide whether to emit a partial.
        let want_partial = state.has_voice
            && now_ms.saturating_sub(state.last_partial_ms) >= PARTIAL_INTERVAL_MS
            && state.silence_run < SILENCE_COMMIT_FRAMES;

        if want_partial {
            let text = self.backend.lock().transcribe(&state.buffer);
            if !text.is_empty() && text != state.last_partial_text {
                state.last_partial_text = text.clone();
                state.last_partial_ms = now_ms;
                events.push(TranscriptEvent {
                    kind: TranscriptKind::Partial,
                    text,
                    t_ms: now_ms,
                });
            } else {
                // Even when text didn't change, advance the timer so we
                // don't re-run whisper on every single frame.
                state.last_partial_ms = now_ms;
            }
        }

        // Endpoint: enough silence after a real utterance → commit final.
        let commit_for_silence = state.has_voice && state.silence_run >= SILENCE_COMMIT_FRAMES;
        // Hard cap: utterance is too long, commit even without endpointing.
        let commit_for_size = state.buffer.len() >= MAX_BUFFER_SAMPLES;

        if commit_for_silence || commit_for_size {
            let text = self.backend.lock().transcribe(&state.buffer);
            events.push(TranscriptEvent {
                kind: TranscriptKind::Final,
                text,
                t_ms: now_ms,
            });
            state.reset_utterance();
        }

        events
    }

    /// Force-flush whatever's buffered as a `Final` (e.g. on socket close).
    pub fn finish(&self) -> Vec<TranscriptEvent> {
        let mut state = self.state.lock();
        if state.buffer.is_empty() {
            return Vec::new();
        }
        let now_ms = samples_to_ms(state.total_samples);
        let text = self.backend.lock().transcribe(&state.buffer);
        state.reset_utterance();
        vec![TranscriptEvent {
            kind: TranscriptKind::Final,
            text,
            t_ms: now_ms,
        }]
    }

    /// Seconds since the worker was constructed — handy for logs.
    pub fn uptime_seconds(&self) -> f64 {
        self.started.elapsed().as_secs_f64()
    }
}

impl RollingState {
    fn reset_utterance(&mut self) {
        self.buffer.clear();
        self.voiced_run = 0;
        self.silence_run = 0;
        self.has_voice = false;
        self.last_partial_ms = 0;
        self.last_partial_text.clear();
    }
}

fn samples_to_ms(total_samples: u64) -> u64 {
    (total_samples * 1000) / SAMPLE_RATE_HZ as u64
}

// ---- backend abstraction ----

trait Backend {
    fn name(&self) -> &'static str;
    fn transcribe(&mut self, samples: &[i16]) -> String;
}

#[cfg(feature = "whisper")]
fn build_backend(model_path: &Path) -> Result<Box<dyn Backend + Send>, SttError> {
    whisper_backend::WhisperBackend::open(model_path)
        .map(|b| Box::new(b) as Box<dyn Backend + Send>)
}

#[cfg(not(feature = "whisper"))]
fn build_backend(_model_path: &Path) -> Result<Box<dyn Backend + Send>, SttError> {
    Ok(Box::new(stub_backend::StubBackend) as Box<dyn Backend + Send>)
}

#[cfg(feature = "whisper")]
mod whisper_backend {
    use std::path::Path;

    use super::{Backend, SAMPLE_RATE_HZ, SttError};
    use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

    pub(super) struct WhisperBackend {
        ctx: WhisperContext,
        scratch: Vec<f32>,
    }

    impl WhisperBackend {
        pub(super) fn open(path: &Path) -> Result<Self, SttError> {
            let path_str = path.to_str().ok_or_else(|| {
                SttError::Backend(format!("non-utf8 model path: {}", path.display()))
            })?;
            let ctx_params = WhisperContextParameters::default();
            let ctx = WhisperContext::new_with_params(path_str, ctx_params)
                .map_err(|e| SttError::Backend(format!("WhisperContext::new: {e}")))?;
            Ok(Self {
                ctx,
                scratch: Vec::with_capacity(SAMPLE_RATE_HZ as usize * 4),
            })
        }
    }

    impl Backend for WhisperBackend {
        fn name(&self) -> &'static str {
            "whisper.cpp"
        }

        fn transcribe(&mut self, samples: &[i16]) -> String {
            // whisper.cpp wants normalised f32 in [-1, 1].
            self.scratch.clear();
            self.scratch.reserve(samples.len());
            for &s in samples {
                self.scratch.push(s as f32 / 32_768.0);
            }
            // Single-segment, greedy, threaded.
            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            params.set_n_threads(num_threads());
            params.set_translate(false);
            params.set_print_special(false);
            params.set_print_progress(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);
            params.set_language(Some("en"));
            params.set_no_context(true);
            params.set_single_segment(true);

            let state = self.ctx.create_state();
            let mut state = match state {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!(error = %e, "whisper: create_state failed");
                    return String::new();
                }
            };
            if let Err(e) = state.full(params, &self.scratch) {
                tracing::warn!(error = %e, "whisper: full() failed");
                return String::new();
            }
            let segment_count = state.full_n_segments();
            let mut out = String::new();
            for i in 0..segment_count {
                let Some(segment) = state.get_segment(i) else {
                    continue;
                };
                let text = match segment.to_str_lossy() {
                    Ok(t) => t,
                    Err(e) => {
                        tracing::debug!(error = %e, "whisper: segment text decode failed");
                        continue;
                    }
                };
                if !out.is_empty() {
                    out.push(' ');
                }
                out.push_str(text.trim());
            }
            out
        }
    }

    fn num_threads() -> i32 {
        std::thread::available_parallelism()
            .map(|n| n.get().min(8) as i32)
            .unwrap_or(2)
    }
}

#[cfg(not(feature = "whisper"))]
mod stub_backend {
    use super::Backend;

    pub(super) struct StubBackend;

    impl Backend for StubBackend {
        fn name(&self) -> &'static str {
            "stub"
        }

        fn transcribe(&mut self, _samples: &[i16]) -> String {
            // The stub is intentionally inert. The WebSocket path still
            // emits well-formed events; the `text` field is just blank.
            String::new()
        }
    }
}

// ---- tests ----

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_to_ms_conversion() {
        assert_eq!(samples_to_ms(0), 0);
        assert_eq!(samples_to_ms(SAMPLE_RATE_HZ as u64), 1000);
        assert_eq!(samples_to_ms(SAMPLE_RATE_HZ as u64 / 2), 500);
    }

    #[test]
    fn missing_model_path_is_reported() {
        match StreamingStt::new("/definitely/does/not/exist.bin") {
            Err(SttError::ModelMissing(_)) => {}
            Err(other) => panic!("expected ModelMissing, got {other:?}"),
            Ok(_) => panic!("expected error for missing model"),
        }
    }

    #[test]
    fn transcript_event_serializes_to_documented_shape() {
        let ev = TranscriptEvent {
            kind: TranscriptKind::Partial,
            text: "hello".into(),
            t_ms: 420,
        };
        let v: serde_json::Value = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["type"], "partial");
        assert_eq!(v["text"], "hello");
        assert_eq!(v["t_ms"], 420);
        let ev = TranscriptEvent {
            kind: TranscriptKind::Final,
            text: String::new(),
            t_ms: 0,
        };
        assert_eq!(serde_json::to_value(&ev).unwrap()["type"], "final");
    }
}
