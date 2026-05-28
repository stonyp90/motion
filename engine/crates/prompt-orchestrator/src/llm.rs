//! Backend-agnostic LLM trait. Adapters pick whatever runtime is
//! available locally (Ollama, LM Studio) or fall back to a cloud
//! provider (Anthropic, OpenAI). The trait is intentionally narrow:
//! produce a JSON object that deserializes into the caller's type.
//!
//! Local-first by design — `LlmBackend::auto_local_first` returns an
//! Ollama backend if `OLLAMA_HOST` is reachable, then LM Studio, then
//! a cloud backend if an API key is set, else a deterministic
//! `MockBackend` so the pipeline never hard-fails at the seam.

use anyhow::{Context, Result, anyhow};
use async_trait::async_trait;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::time::{Duration, Instant};
use tracing::Instrument;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmRequest {
    pub system: String,
    pub user: String,
    /// Optional JSON Schema the backend should constrain to.
    pub schema: Option<serde_json::Value>,
    pub max_tokens: u32,
    pub temperature: f32,
    /// Base64-encoded images attached to the request. The Ollama
    /// backend forwards these as `images: [...]` to /api/generate
    /// when the model is vision-capable (llava-class). Other backends
    /// drop them with a debug log until their multimodal pathway lands.
    #[serde(default)]
    pub images: Vec<String>,
}

impl LlmRequest {
    pub fn new(system: impl Into<String>, user: impl Into<String>) -> Self {
        Self {
            system: system.into(),
            user: user.into(),
            schema: None,
            max_tokens: 4096,
            temperature: 0.4,
            images: Vec::new(),
        }
    }

    pub fn with_schema(mut self, schema: serde_json::Value) -> Self {
        self.schema = Some(schema);
        self
    }

    pub fn with_temperature(mut self, t: f32) -> Self {
        self.temperature = t;
        self
    }

    /// Attach base64-encoded image bytes. The orchestrator does the
    /// encoding so callers pass `String`s, not raw bytes.
    pub fn with_images(mut self, images: Vec<String>) -> Self {
        self.images = images;
        self
    }
}

/// Token usage / latency reported by a backend after a completion.
///
/// All fields are `Option` because providers differ in what they expose:
/// - Ollama: token counts only when `options.return_full_telemetry` is on
///   (we don't enable it by default), so usually all `None`.
/// - LM Studio / OpenAI-compatible: `prompt_tokens` + `completion_tokens`
///   + `total_tokens` when the endpoint returns a `usage` block.
/// - OpenAI cloud: same shape as LM Studio.
/// - Anthropic: `input_tokens` + `output_tokens`, plus the two
///   prompt-caching fields (`cache_creation_input_tokens`,
///   `cache_read_input_tokens`) when caching is active.
///
/// The struct is non-exhaustive in spirit — additional fields may be
/// added in future without breaking callers, since usage is currently
/// surfaced via `tracing` logs rather than a public return value.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Usage {
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
    /// Anthropic prompt-caching: tokens written to the cache on this
    /// call (first time a stable prefix is seen). Present only on
    /// Anthropic responses where caching is enabled.
    pub cache_creation_input_tokens: Option<u32>,
    /// Anthropic prompt-caching: tokens served from cache on this call.
    /// A non-zero value means the system prefix was a cache hit and the
    /// caller paid the (much cheaper) cached read rate.
    pub cache_read_input_tokens: Option<u32>,
}

#[async_trait]
pub trait LlmBackend: Send + Sync {
    fn name(&self) -> &str;

    /// Return a JSON string. Caller is responsible for parsing.
    async fn complete_json(&self, req: &LlmRequest) -> Result<String>;
}

/// Extension trait — generic helpers that would break `dyn` compatibility
/// if they lived on `LlmBackend` directly. Auto-implemented for every
/// `LlmBackend`.
#[async_trait]
pub trait LlmBackendExt {
    async fn complete_into<T: DeserializeOwned + Send>(&self, req: &LlmRequest) -> Result<T>;
}

#[async_trait]
impl<B: LlmBackend + ?Sized> LlmBackendExt for B {
    async fn complete_into<T: DeserializeOwned + Send>(&self, req: &LlmRequest) -> Result<T> {
        let raw = self.complete_json(req).await?;
        let cleaned = strip_code_fence(&raw);

        // Strict parse first — handles the well-behaved-model case.
        if let Ok(v) = serde_json::from_str::<T>(&cleaned) {
            return Ok(v);
        }

        // Tolerant retry: small local models (llava, qwen2.5-7b) sometimes
        // echo the JSON Schema definition we sent them — wrapping arrays
        // inside `{"items": [...], "type": "array"}` and primitives inside
        // `{"type": "string", "enum": [...]}`. We coerce that into the
        // data-only shape and try again before giving up.
        if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&cleaned) {
            coerce_schema_echo(&mut value);
            if let Ok(v) = serde_json::from_value::<T>(value.clone()) {
                tracing::warn!("LLM returned schema-wrapped output; recovered via tolerant parse");
                return Ok(v);
            }
        }

        // Both attempts failed — emit the original error with the raw
        // payload for debugging.
        serde_json::from_str(&cleaned).with_context(|| format!("parsing LLM JSON: {cleaned}"))
    }
}

/// LLMs often wrap JSON in ```json fences. Strip them.
fn strip_code_fence(s: &str) -> String {
    let t = s.trim();
    if let Some(stripped) = t.strip_prefix("```json") {
        return stripped.trim_end_matches("```").trim().to_string();
    }
    if let Some(stripped) = t.strip_prefix("```") {
        return stripped.trim_end_matches("```").trim().to_string();
    }
    t.to_string()
}

/// Recursively unwrap JSON-Schema-shaped envelopes that small local
/// models occasionally emit instead of pure data. Two patterns we
/// see in the wild:
///
///   - Object with `items: [...]` (+ sometimes `type: "array"`,
///     `minItems`, `maxItems`) → unwrapped to the array itself.
///   - Top-level `{"properties": {...}, "required": [...], "type": "object"}`
///     where the *real* fields live under `properties` → lifted up so
///     `properties.scenes` becomes top-level `scenes`.
///
/// Idempotent. Cheap (O(node count)). Doesn't touch shapes that
/// already look like data, so it's safe to run unconditionally on
/// every fallback path.
pub(crate) fn coerce_schema_echo(value: &mut serde_json::Value) {
    use serde_json::Value;

    // 1. Lift `{"properties": {...}, "required": [...], "type": "object"}`
    //    to its inner properties map. Done before the items unwrap so the
    //    inner properties get a chance to be coerced too.
    if let Value::Object(map) = value {
        let looks_like_schema_object = map.contains_key("properties")
            && map.get("type").and_then(|t| t.as_str()) == Some("object");
        if looks_like_schema_object {
            if let Some(Value::Object(props)) = map.remove("properties") {
                *value = Value::Object(props);
            }
        }
    }

    // 2. Unwrap `{"items": [...], ...}` → the array.
    if let Value::Object(map) = value {
        if let Some(items) = map.get("items") {
            if items.is_array() {
                let arr = map.remove("items").unwrap();
                *value = arr;
            }
        }
    }

    // 3. Recurse into whatever shape we now have.
    match value {
        Value::Object(map) => {
            for v in map.values_mut() {
                coerce_schema_echo(v);
            }
        }
        Value::Array(arr) => {
            for v in arr.iter_mut() {
                coerce_schema_echo(v);
            }
        }
        _ => {}
    }
}

// -------------------------- Ollama ------------------------------

pub struct OllamaBackend {
    pub host: String,
    pub model: String,
    pub client: reqwest::Client,
}

impl OllamaBackend {
    pub fn new(host: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            host: host.into(),
            model: model.into(),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(300))
                .build()
                .expect("reqwest client"),
        }
    }

    pub fn from_env() -> Self {
        // Default model upgraded Jan 2026 to qwen2.5vl:7b — Qwen2.5-VL
        // (Alibaba, Apache-2.0) topped the Open VLM Leaderboard for its
        // size class on release, and benchmarks above llama3.2-vision:11b
        // on document understanding + structured-output tasks despite
        // being ~30% smaller in RAM footprint. Specifically:
        //   - Vision-capable (native image input via Ollama `images:[…]`)
        //   - Apache-2.0 weights (commercial-safe)
        //   - ~6 GB quantized (q4_K_M) — fits Apple Silicon ≥16 GB
        //     comfortably alongside the rest of the toolchain
        //   - Tops llama3.2-vision:11b on MMMU + DocVQA (the two
        //     benchmarks that correlate with "follows a JSON schema
        //     without echoing it back")
        //   - Strong agentic / structured-output finetune family
        //     (Qwen2.5 base is the most popular JSON-tuned OSS line)
        //
        // 32B and 72B variants exist and are better, but exceed the
        // 16 GB Apple-Silicon target: q4 32B is ~18-22 GB, leaving
        // no headroom for the OS + Tauri shell. Power users on 32+ GB
        // can opt in via `OLLAMA_MODEL=qwen2.5vl:32b`.
        //
        // Override with OLLAMA_MODEL=<tag> per deploy. The full
        // recommended set is in /install on the web app.
        Self::new(
            std::env::var("OLLAMA_HOST").unwrap_or_else(|_| "http://localhost:11434".into()),
            std::env::var("OLLAMA_MODEL").unwrap_or_else(|_| "qwen2.5vl:7b".into()),
        )
    }

    pub async fn is_reachable(&self) -> bool {
        // Use a short-timeout probe client so an unreachable host fails
        // in ~1s instead of waiting on the 5-min completion timeout.
        let probe = match reqwest::Client::builder()
            .timeout(Duration::from_millis(1500))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                tracing::debug!(error = %e, "ollama probe: client build failed");
                return false;
            }
        };
        let url = format!("{}/api/tags", self.host);
        match probe.get(&url).send().await {
            Ok(r) if r.status().is_success() => true,
            Ok(r) => {
                tracing::debug!(
                    status = %r.status(),
                    host = %self.host,
                    "ollama probe: non-2xx response"
                );
                false
            }
            Err(e) => {
                tracing::debug!(error = %e, host = %self.host, "ollama probe: send failed");
                false
            }
        }
    }

    /// Returns the list of locally-pulled model tags, or empty on failure.
    pub async fn list_models(&self) -> Vec<String> {
        let probe = match reqwest::Client::builder()
            .timeout(Duration::from_millis(1500))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                tracing::debug!(error = %e, "list_models: client build failed");
                return Vec::new();
            }
        };
        let url = format!("{}/api/tags", self.host);
        let body: serde_json::Value = match probe.get(&url).send().await {
            Ok(r) => match r.json().await {
                Ok(j) => j,
                Err(e) => {
                    tracing::debug!(error = %e, "list_models: parse failed");
                    return Vec::new();
                }
            },
            Err(e) => {
                tracing::debug!(error = %e, "list_models: request failed");
                return Vec::new();
            }
        };
        body["models"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m["name"].as_str().map(|s| s.to_string()))
                    .collect()
            })
            .unwrap_or_default()
    }
}

#[derive(Serialize)]
struct OllamaReq<'a> {
    model: &'a str,
    prompt: String,
    format: &'a str,
    stream: bool,
    options: OllamaOpts,
    system: &'a str,
    /// Only emitted when non-empty so non-vision models don't see an
    /// unexpected field. Ollama accepts base64 image strings directly.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    images: Vec<&'a str>,
}

#[derive(Serialize)]
struct OllamaOpts {
    temperature: f32,
    num_predict: u32,
}

#[derive(Deserialize)]
struct OllamaResp {
    response: String,
    /// Ollama returns prompt token count under `prompt_eval_count` and
    /// completion token count under `eval_count` when available (not
    /// every model/build reports them). Both optional; we surface them
    /// via tracing when present.
    #[serde(default)]
    prompt_eval_count: Option<u32>,
    #[serde(default)]
    eval_count: Option<u32>,
}

#[async_trait]
impl LlmBackend for OllamaBackend {
    fn name(&self) -> &str {
        "ollama"
    }

    async fn complete_json(&self, req: &LlmRequest) -> Result<String> {
        let span = tracing::info_span!(
            "llm_complete",
            backend = "ollama",
            model = %self.model,
        );
        self.complete_json_inner(req).instrument(span).await
    }
}

impl OllamaBackend {
    async fn complete_json_inner(&self, req: &LlmRequest) -> Result<String> {
        let started = Instant::now();
        let url = format!("{}/api/generate", self.host);
        // Bake the schema into the user prompt as a hint — Ollama's
        // built-in JSON mode constrains shape but not field names.
        //
        // The instruction here is intentionally redundant with the
        // system prompt: smaller local models (7B-class) follow
        // negative directives ("DO NOT preface with anything") far more
        // reliably when they appear last, immediately before the
        // generation point. Three hallucination-reduction levers:
        //   1. "DO NOT" instead of "do not" — uppercase markers anchor
        //      attention on instruction-tuned models.
        //   2. Explicit enumeration of the things to NOT emit
        //      (preamble, ```json fence, "Sure, here is …").
        //   3. The opening `{` cue at the end is a soft prefill — it
        //      primes the next-token distribution toward JSON without
        //      requiring an actual prefill API (which Ollama lacks).
        let prompt = if let Some(schema) = &req.schema {
            format!(
                "{user}\n\n\
                 Return JSON matching exactly this schema:\n{schema}\n\n\
                 OUTPUT RULES (strict):\n\
                 - Respond with ONE valid JSON object only.\n\
                 - DO NOT add a preamble like \"Sure, here is…\" or \"Here's the JSON\".\n\
                 - DO NOT wrap the JSON in ```json fences or any markdown.\n\
                 - DO NOT add explanatory prose after the JSON.\n\
                 - DO NOT echo the schema definition itself — emit DATA matching the schema.\n\
                 Begin your response with the opening brace and nothing else.\n",
                user = req.user,
                schema = schema,
            )
        } else {
            format!(
                "{user}\n\n\
                 OUTPUT RULES (strict):\n\
                 - Respond with ONE valid JSON object only.\n\
                 - DO NOT add a preamble or trailing prose.\n\
                 - DO NOT wrap the JSON in ```json fences.\n\
                 Begin your response with the opening brace and nothing else.\n",
                user = req.user,
            )
        };
        let body = OllamaReq {
            model: &self.model,
            prompt,
            format: "json",
            stream: false,
            options: OllamaOpts {
                temperature: req.temperature,
                num_predict: req.max_tokens,
            },
            system: &req.system,
            images: req.images.iter().map(String::as_str).collect(),
        };
        if !req.images.is_empty() {
            tracing::debug!(
                model = %self.model,
                images = req.images.len(),
                "ollama: attaching images (vision)"
            );
        }
        let resp: OllamaResp = self
            .client
            .post(&url)
            .json(&body)
            .send()
            .await
            .context("posting to ollama")?
            .error_for_status()
            .context("ollama returned error status")?
            .json()
            .await
            .context("parsing ollama response")?;
        let elapsed_ms = started.elapsed().as_millis() as u64;
        let total_tokens = match (resp.prompt_eval_count, resp.eval_count) {
            (Some(p), Some(c)) => Some(p + c),
            _ => None,
        };
        tracing::info!(
            elapsed_ms,
            prompt_tokens = ?resp.prompt_eval_count,
            completion_tokens = ?resp.eval_count,
            total_tokens = ?total_tokens,
            "ollama complete_json done"
        );
        Ok(resp.response)
    }
}

// -------------------------- LM Studio --------------------------
// LM Studio exposes an OpenAI-compatible /v1/chat/completions endpoint.

pub struct LmStudioBackend {
    pub host: String,
    pub model: String,
    pub client: reqwest::Client,
}

impl LmStudioBackend {
    pub fn new(host: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            host: host.into(),
            model: model.into(),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(300))
                .build()
                .expect("reqwest client"),
        }
    }

    pub fn from_env() -> Self {
        Self::new(
            std::env::var("LMSTUDIO_HOST").unwrap_or_else(|_| "http://localhost:1234".into()),
            std::env::var("LMSTUDIO_MODEL").unwrap_or_else(|_| "local-model".into()),
        )
    }

    pub async fn is_reachable(&self) -> bool {
        let probe = match reqwest::Client::builder()
            .timeout(Duration::from_millis(1500))
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                tracing::debug!(error = %e, "lmstudio probe: client build failed");
                return false;
            }
        };
        let url = format!("{}/v1/models", self.host);
        match probe.get(&url).send().await {
            Ok(r) if r.status().is_success() => true,
            Ok(r) => {
                tracing::debug!(
                    status = %r.status(),
                    host = %self.host,
                    "lmstudio probe: non-2xx response"
                );
                false
            }
            Err(e) => {
                tracing::debug!(error = %e, host = %self.host, "lmstudio probe: send failed");
                false
            }
        }
    }
}

#[derive(Serialize)]
pub(crate) struct OpenAiMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Serialize)]
struct OpenAiReq<'a> {
    model: &'a str,
    messages: Vec<OpenAiMessage<'a>>,
    temperature: f32,
    max_tokens: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct OpenAiResp {
    choices: Vec<OpenAiChoice>,
    #[serde(default)]
    usage: Option<OpenAiUsage>,
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessageOwned,
}

#[derive(Deserialize)]
struct OpenAiMessageOwned {
    content: String,
}

#[derive(Deserialize, Default)]
struct OpenAiUsage {
    #[serde(default)]
    prompt_tokens: Option<u32>,
    #[serde(default)]
    completion_tokens: Option<u32>,
    #[serde(default)]
    total_tokens: Option<u32>,
}

/// Internal wrapper around the OpenAI-style call that also surfaces the
/// usage block when the upstream reports it. The public callers
/// (`LmStudioBackend`, `OpenAiBackend`) wrap their own tracing span
/// around the call and log usage after this returns.
async fn openai_style_call(
    client: &reqwest::Client,
    url: &str,
    api_key: Option<&str>,
    model: &str,
    req: &LlmRequest,
) -> Result<(String, Usage)> {
    let response_format = req.schema.as_ref().map(|schema| {
        serde_json::json!({
            "type": "json_schema",
            "json_schema": { "name": "motion_forge_output", "schema": schema, "strict": true }
        })
    });
    let body = OpenAiReq {
        model,
        messages: vec![
            OpenAiMessage {
                role: "system",
                content: &req.system,
            },
            OpenAiMessage {
                role: "user",
                content: &req.user,
            },
        ],
        temperature: req.temperature,
        max_tokens: req.max_tokens,
        response_format,
    };
    let mut builder = client.post(url).json(&body);
    if let Some(key) = api_key {
        builder = builder.bearer_auth(key);
    }
    let raw = builder
        .send()
        .await
        .context("posting to OpenAI-compatible endpoint")?
        .error_for_status()
        .context("OpenAI-compatible endpoint returned error status")?
        .json::<OpenAiResp>()
        .await
        .context("parsing OpenAI-compatible response")?;
    let usage = raw
        .usage
        .as_ref()
        .map(|u| Usage {
            prompt_tokens: u.prompt_tokens,
            completion_tokens: u.completion_tokens,
            total_tokens: u.total_tokens,
            ..Usage::default()
        })
        .unwrap_or_default();
    let content = raw
        .choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .ok_or_else(|| anyhow!("empty choices array"))?;
    Ok((content, usage))
}

#[async_trait]
impl LlmBackend for LmStudioBackend {
    fn name(&self) -> &str {
        "lmstudio"
    }
    async fn complete_json(&self, req: &LlmRequest) -> Result<String> {
        let span = tracing::info_span!(
            "llm_complete",
            backend = "lmstudio",
            model = %self.model,
        );
        self.complete_json_inner(req).instrument(span).await
    }
}

impl LmStudioBackend {
    async fn complete_json_inner(&self, req: &LlmRequest) -> Result<String> {
        let started = Instant::now();
        let url = format!("{}/v1/chat/completions", self.host);
        let (content, usage) =
            openai_style_call(&self.client, &url, None, &self.model, req).await?;
        let elapsed_ms = started.elapsed().as_millis() as u64;
        tracing::info!(
            elapsed_ms,
            prompt_tokens = ?usage.prompt_tokens,
            completion_tokens = ?usage.completion_tokens,
            total_tokens = ?usage.total_tokens,
            "lmstudio complete_json done"
        );
        Ok(content)
    }
}

// -------------------------- OpenAI cloud --------------------------

pub struct OpenAiBackend {
    pub api_key: String,
    pub model: String,
    pub client: reqwest::Client,
}

impl OpenAiBackend {
    pub fn new(api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            model: model.into(),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(300))
                .build()
                .expect("reqwest client"),
        }
    }

    pub fn from_env() -> Option<Self> {
        let key = std::env::var("OPENAI_API_KEY").ok()?;
        let model = std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-5".into());
        Some(Self::new(key, model))
    }
}

#[async_trait]
impl LlmBackend for OpenAiBackend {
    fn name(&self) -> &str {
        "openai"
    }
    async fn complete_json(&self, req: &LlmRequest) -> Result<String> {
        let span = tracing::info_span!(
            "llm_complete",
            backend = "openai",
            model = %self.model,
        );
        self.complete_json_inner(req).instrument(span).await
    }
}

impl OpenAiBackend {
    async fn complete_json_inner(&self, req: &LlmRequest) -> Result<String> {
        let started = Instant::now();
        let (content, usage) = openai_style_call(
            &self.client,
            "https://api.openai.com/v1/chat/completions",
            Some(&self.api_key),
            &self.model,
            req,
        )
        .await?;
        let elapsed_ms = started.elapsed().as_millis() as u64;
        tracing::info!(
            elapsed_ms,
            prompt_tokens = ?usage.prompt_tokens,
            completion_tokens = ?usage.completion_tokens,
            total_tokens = ?usage.total_tokens,
            "openai complete_json done"
        );
        Ok(content)
    }
}

// -------------------------- Anthropic cloud --------------------------

pub struct AnthropicBackend {
    pub api_key: String,
    pub model: String,
    pub client: reqwest::Client,
}

impl AnthropicBackend {
    pub fn new(api_key: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            model: model.into(),
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(300))
                .build()
                .expect("reqwest client"),
        }
    }

    pub fn from_env() -> Option<Self> {
        let key = std::env::var("ANTHROPIC_API_KEY").ok()?;
        let model = std::env::var("ANTHROPIC_MODEL").unwrap_or_else(|_| "claude-opus-4-7".into());
        Some(Self::new(key, model))
    }
}

/// Anthropic request body. `system` is sent as an array of content
/// blocks (rather than a plain string) so we can attach
/// `cache_control: { type: "ephemeral" }` to the stable prefix and let
/// the upstream serve the system prompt from cache on subsequent calls.
/// See <https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching>.
#[derive(Serialize)]
struct AnthropicReq<'a> {
    model: &'a str,
    system: Vec<AnthropicSystemBlock<'a>>,
    messages: Vec<AnthropicMessage<'a>>,
    max_tokens: u32,
    temperature: f32,
}

/// A single block inside the Anthropic `system` array. Each block has
/// a `type` ("text"), a `text` payload, and an optional `cache_control`
/// directive. The "ephemeral" cache TTL is ~5 minutes — long enough for
/// a brief-to-timeline run (which fires ~N scene calls back-to-back)
/// to amortize the cache write on the first call and hit the (much
/// cheaper) cached read on every scene after.
#[derive(Serialize)]
struct AnthropicSystemBlock<'a> {
    #[serde(rename = "type")]
    block_type: &'a str,
    text: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_control: Option<AnthropicCacheControl>,
}

#[derive(Serialize, Clone, Copy)]
struct AnthropicCacheControl {
    #[serde(rename = "type")]
    cc_type: &'static str,
}

#[derive(Serialize)]
struct AnthropicMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct AnthropicResp {
    content: Vec<AnthropicContent>,
    #[serde(default)]
    usage: Option<AnthropicUsage>,
}

#[derive(Deserialize)]
struct AnthropicContent {
    text: Option<String>,
}

#[derive(Deserialize, Default)]
struct AnthropicUsage {
    #[serde(default)]
    input_tokens: Option<u32>,
    #[serde(default)]
    output_tokens: Option<u32>,
    /// Tokens written to the prompt-cache on this call. Non-zero only
    /// on the first call that pushed a new stable prefix into the cache.
    #[serde(default)]
    cache_creation_input_tokens: Option<u32>,
    /// Tokens served from the prompt-cache on this call. Non-zero on a
    /// cache hit — billed at the cached read rate (~10× cheaper).
    #[serde(default)]
    cache_read_input_tokens: Option<u32>,
}

/// Split the system prompt into a "stable prefix" (cacheable) and a
/// "volatile suffix" (per-call). The stable prefix carries everything
/// that's identical across calls within an orchestration run — the
/// persona, output format, anti-patterns, quality bar — while the
/// volatile suffix carries any caller-injected addendum (theme
/// guidance, attached-images reinforcement) that may vary per call.
///
/// We look for the addendum delimiter the orchestrator uses
/// ("\n\nAdditional theme guidance: ") and the attached-images banner
/// ("\n\nUSER HAS ATTACHED REFERENCE IMAGES"); the earliest match wins.
/// If neither is present the whole system string is the stable prefix
/// and the suffix is empty.
fn split_system_for_caching(system: &str) -> (&str, &str) {
    let candidates = ["\n\nAdditional theme guidance: ", "\n\nUSER HAS ATTACHED"];
    let cut = candidates
        .iter()
        .filter_map(|needle| system.find(needle))
        .min();
    match cut {
        Some(idx) => system.split_at(idx),
        None => (system, ""),
    }
}

#[async_trait]
impl LlmBackend for AnthropicBackend {
    fn name(&self) -> &str {
        "anthropic"
    }
    async fn complete_json(&self, req: &LlmRequest) -> Result<String> {
        let span = tracing::info_span!(
            "llm_complete",
            backend = "anthropic",
            model = %self.model,
        );
        self.complete_json_inner(req).instrument(span).await
    }
}

impl AnthropicBackend {
    async fn complete_json_inner(&self, req: &LlmRequest) -> Result<String> {
        let started = Instant::now();
        let user = if let Some(schema) = &req.schema {
            format!(
                "{}\n\nReturn JSON matching exactly this schema:\n{}\n\n\
                 Emit DATA matching the schema — never the schema definition itself.",
                req.user, schema
            )
        } else {
            req.user.clone()
        };

        // Build the `system` array — split into a cacheable stable
        // prefix (persona, JSON-schema instructions, anti-patterns,
        // easing rules) and a volatile suffix (per-call theme addendum
        // and attached-image hints). Mark only the stable prefix as
        // ephemeral; the suffix flows through uncached.
        let (stable, volatile) = split_system_for_caching(&req.system);
        let mut system = Vec::with_capacity(2);
        system.push(AnthropicSystemBlock {
            block_type: "text",
            text: stable,
            cache_control: Some(AnthropicCacheControl {
                cc_type: "ephemeral",
            }),
        });
        if !volatile.is_empty() {
            system.push(AnthropicSystemBlock {
                block_type: "text",
                text: volatile,
                cache_control: None,
            });
        }

        // Anthropic's `assistant prefill` pattern: seed the assistant's
        // turn with `{` so the model is forced to continue from inside
        // a JSON object. This is the official Anthropic technique for
        // structured output — eliminates the "model wrote ```json
        // markdown" failure mode and removes the need for `Return ONLY
        // JSON` instruction prose. We re-prepend `{` to the response
        // below since prefill content is NOT echoed back.
        let body = AnthropicReq {
            model: &self.model,
            system,
            messages: vec![
                AnthropicMessage {
                    role: "user",
                    content: &user,
                },
                AnthropicMessage {
                    role: "assistant",
                    content: "{",
                },
            ],
            max_tokens: req.max_tokens,
            temperature: req.temperature,
        };
        let resp: AnthropicResp = self
            .client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await
            .context("posting to anthropic")?
            .error_for_status()
            .context("anthropic returned error status")?
            .json()
            .await
            .context("parsing anthropic response")?;
        let elapsed_ms = started.elapsed().as_millis() as u64;
        let usage = resp.usage.unwrap_or_default();
        let total_tokens = match (usage.input_tokens, usage.output_tokens) {
            (Some(i), Some(o)) => Some(i + o),
            _ => None,
        };
        tracing::info!(
            elapsed_ms,
            prompt_tokens = ?usage.input_tokens,
            completion_tokens = ?usage.output_tokens,
            total_tokens = ?total_tokens,
            cache_creation_input_tokens = ?usage.cache_creation_input_tokens,
            cache_read_input_tokens = ?usage.cache_read_input_tokens,
            "anthropic complete_json done"
        );
        resp.content
            .into_iter()
            .filter_map(|c| c.text)
            .next()
            // Re-prepend the `{` from the prefill so callers get a
            // complete, parsable JSON object. Without this the response
            // starts with the model's continuation (e.g. `"version":…`).
            .map(|t| format!("{{{t}"))
            .ok_or_else(|| anyhow!("anthropic response had no text content"))
    }
}

// -------------------------- Mock --------------------------

/// Returns a canned JSON object. Useful for tests and for keeping the
/// pipeline functional when no real LLM is reachable.
pub struct MockBackend {
    pub canned: String,
}

impl MockBackend {
    pub fn new(canned: impl Into<String>) -> Self {
        Self {
            canned: canned.into(),
        }
    }
}

#[async_trait]
impl LlmBackend for MockBackend {
    fn name(&self) -> &str {
        "mock"
    }
    async fn complete_json(&self, _req: &LlmRequest) -> Result<String> {
        Ok(self.canned.clone())
    }
}

// -------------------------- auto picker --------------------------

/// Probe backends in this order: Ollama → LM Studio → Anthropic →
/// OpenAI → Mock. The first one that's reachable wins. Lets the user
/// run the whole pipeline locally if they have Ollama, and silently
/// fall through to a cloud backend (or Mock) if not.
pub async fn auto_local_first(mock_canned: &str) -> Box<dyn LlmBackend> {
    let mut ollama = OllamaBackend::from_env();
    if ollama.is_reachable().await {
        // Switch to whatever model is actually pulled if our default isn't.
        let installed = ollama.list_models().await;
        let env_set = std::env::var("OLLAMA_MODEL").is_ok();
        if !installed.is_empty() && !installed.iter().any(|m| m == &ollama.model) {
            if env_set {
                tracing::warn!(
                    requested = %ollama.model,
                    available = ?installed,
                    "configured OLLAMA_MODEL not pulled; using first installed model instead"
                );
            }
            ollama.model = installed[0].clone();
        }
        tracing::info!(backend = "ollama", model = %ollama.model, "selected LLM backend");
        return Box::new(ollama);
    }
    let lm = LmStudioBackend::from_env();
    if lm.is_reachable().await {
        tracing::info!(backend = "lmstudio", model = %lm.model, "selected LLM backend");
        return Box::new(lm);
    }
    if let Some(anthropic) = AnthropicBackend::from_env() {
        tracing::info!(backend = "anthropic", model = %anthropic.model, "selected LLM backend");
        return Box::new(anthropic);
    }
    if let Some(openai) = OpenAiBackend::from_env() {
        tracing::info!(backend = "openai", model = %openai.model, "selected LLM backend");
        return Box::new(openai);
    }
    tracing::warn!("no LLM backend reachable; using MockBackend with canned response");
    Box::new(MockBackend::new(mock_canned))
}

// -------------------------- tiered router --------------------------

/// Threshold (in `max_tokens`) below which a request routes to the
/// cheap backend instead of the main one. Anything `<=` this value
/// goes to `cheap`; anything larger goes to `main`. Picked so that
/// utility calls (script-synth's per-scene VO line, brief
/// classification) hit the small/fast tier, while the full
/// timeline-generation call still goes to the main tier.
pub const CHEAP_TIER_MAX_TOKENS: u32 = 512;

/// Two-tier router. `cheap` handles low-cost utility calls (anything
/// with `max_tokens <= CHEAP_TIER_MAX_TOKENS`), `main` handles the
/// timeline-generation hot path. When only one backend is available
/// the same `Arc` is stored in both fields so the router is a no-op
/// pass-through and existing single-backend deployments keep working.
///
/// Implemented as an [`LlmBackend`] itself so it can be plugged into
/// any call site that takes a `&dyn LlmBackend` without further
/// changes. The router picks per-call via [`Backends::route`].
pub struct Backends {
    pub cheap: std::sync::Arc<dyn LlmBackend>,
    pub main: std::sync::Arc<dyn LlmBackend>,
}

impl Backends {
    /// Construct a router with explicit cheap + main backends.
    pub fn new(
        cheap: std::sync::Arc<dyn LlmBackend>,
        main: std::sync::Arc<dyn LlmBackend>,
    ) -> Self {
        Self { cheap, main }
    }

    /// Construct a router from a single backend (degenerate case —
    /// cheap == main). Useful when only one backend is configured
    /// (e.g. local-only Ollama deployment).
    pub fn single(backend: std::sync::Arc<dyn LlmBackend>) -> Self {
        Self {
            cheap: backend.clone(),
            main: backend,
        }
    }

    /// Decide which backend handles this request. Currently a simple
    /// threshold on `max_tokens`; a future revision may consider the
    /// schema complexity, the presence of images, or a caller-supplied
    /// `tier` hint on `LlmRequest`.
    pub fn route(&self, req: &LlmRequest) -> &dyn LlmBackend {
        if req.max_tokens <= CHEAP_TIER_MAX_TOKENS {
            &*self.cheap
        } else {
            &*self.main
        }
    }

    /// Build a `Backends` router using `auto_local_first` selection.
    /// In the current implementation cheap == main (the auto-picker
    /// only chooses one backend), so this is equivalent to
    /// [`Backends::single`]. Reserved for the future when the cheap
    /// tier picks a smaller local Ollama model (e.g. qwen2.5:3b)
    /// while the main tier picks a larger one (qwen2.5vl:7b) or a
    /// cloud backend.
    pub async fn auto_local_first(mock_canned: &str) -> Self {
        let single = auto_local_first(mock_canned).await;
        let arc: std::sync::Arc<dyn LlmBackend> = std::sync::Arc::from(single);
        Self::single(arc)
    }
}

#[async_trait]
impl LlmBackend for Backends {
    fn name(&self) -> &str {
        // Reports the main tier's name — callers that care about the
        // per-call backend should inspect the routed `&dyn LlmBackend`
        // returned by `route()` directly. This name is used for
        // top-level logging only.
        self.main.name()
    }

    async fn complete_json(&self, req: &LlmRequest) -> Result<String> {
        self.route(req).complete_json(req).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mock_backend_returns_canned() {
        let b = MockBackend::new(r#"{"ok":true}"#);
        let r = LlmRequest::new("system", "user");
        let raw = b.complete_json(&r).await.unwrap();
        assert!(raw.contains("ok"));
    }

    #[tokio::test]
    async fn backends_router_routes_by_max_tokens() {
        // Two distinct mock backends so we can tell which one served
        // the call by the response content.
        let cheap: std::sync::Arc<dyn LlmBackend> =
            std::sync::Arc::new(MockBackend::new(r#"{"tier":"cheap"}"#));
        let main: std::sync::Arc<dyn LlmBackend> =
            std::sync::Arc::new(MockBackend::new(r#"{"tier":"main"}"#));
        let router = Backends::new(cheap, main);

        // <= CHEAP_TIER_MAX_TOKENS → cheap
        let small = LlmRequest {
            max_tokens: CHEAP_TIER_MAX_TOKENS,
            ..LlmRequest::new("s", "u")
        };
        let raw = router.complete_json(&small).await.unwrap();
        assert!(
            raw.contains("cheap"),
            "small req should route to cheap: {raw}"
        );

        // > CHEAP_TIER_MAX_TOKENS → main
        let big = LlmRequest {
            max_tokens: CHEAP_TIER_MAX_TOKENS + 1,
            ..LlmRequest::new("s", "u")
        };
        let raw = router.complete_json(&big).await.unwrap();
        assert!(raw.contains("main"), "big req should route to main: {raw}");
    }

    #[tokio::test]
    async fn backends_single_serves_both_tiers_from_one_backend() {
        // Degenerate case: only one backend configured. Both tiers
        // should resolve to it and the router must not break.
        let one: std::sync::Arc<dyn LlmBackend> =
            std::sync::Arc::new(MockBackend::new(r#"{"only":true}"#));
        let router = Backends::single(one);
        let small = LlmRequest {
            max_tokens: 16,
            ..LlmRequest::new("s", "u")
        };
        let big = LlmRequest {
            max_tokens: 4096,
            ..LlmRequest::new("s", "u")
        };
        assert!(router.complete_json(&small).await.unwrap().contains("only"));
        assert!(router.complete_json(&big).await.unwrap().contains("only"));
    }

    #[test]
    fn split_system_for_caching_splits_at_addendum() {
        let s = "STABLE PERSONA\n\nAdditional theme guidance: be playful";
        let (stable, volatile) = split_system_for_caching(s);
        assert_eq!(stable, "STABLE PERSONA");
        assert!(volatile.starts_with("\n\nAdditional theme guidance:"));
    }

    #[test]
    fn split_system_for_caching_splits_at_images_banner() {
        let s = "STABLE PERSONA\n\nUSER HAS ATTACHED REFERENCE IMAGES\nuse them";
        let (stable, volatile) = split_system_for_caching(s);
        assert_eq!(stable, "STABLE PERSONA");
        assert!(volatile.starts_with("\n\nUSER HAS ATTACHED"));
    }

    #[test]
    fn split_system_for_caching_no_split_when_pure_stable() {
        let s = "STABLE ONLY";
        let (stable, volatile) = split_system_for_caching(s);
        assert_eq!(stable, "STABLE ONLY");
        assert_eq!(volatile, "");
    }

    #[test]
    fn strip_code_fence_handles_variants() {
        assert_eq!(strip_code_fence("```json\n{}\n```"), "{}");
        assert_eq!(strip_code_fence("```\n{}\n```"), "{}");
        assert_eq!(strip_code_fence("{\"a\":1}"), "{\"a\":1}");
    }

    #[test]
    fn coerce_unwraps_items_array_envelope() {
        // The exact wire shape llava emitted in the wild — schema's
        // `{items: [...]}` instead of data's `[...]`.
        let raw = r#"{"scenes": {"items": [{"id":"1.0"},{"id":"2.0"}]}}"#;
        let mut v: serde_json::Value = serde_json::from_str(raw).unwrap();
        coerce_schema_echo(&mut v);
        assert!(v["scenes"].is_array(), "scenes should be unwrapped: {v}");
        assert_eq!(v["scenes"][0]["id"].as_str(), Some("1.0"));
        assert_eq!(v["scenes"][1]["id"].as_str(), Some("2.0"));
    }

    #[test]
    fn coerce_lifts_top_level_schema_envelope() {
        // The full schema-echo: top-level "type":"object" + "properties"
        // wrapping where the real data lives.
        let raw = r#"{
            "type": "object",
            "required": ["scenes"],
            "properties": {
                "language": {"type": "string", "enum": ["english"]},
                "scenes": {
                    "type": "array",
                    "items": [{"id":"1.0","visual":"x"}]
                }
            }
        }"#;
        let mut v: serde_json::Value = serde_json::from_str(raw).unwrap();
        coerce_schema_echo(&mut v);
        // Top-level should now have `language` + `scenes` (lifted out
        // of properties); `scenes` should be an array (items unwrapped).
        assert!(v.is_object());
        assert!(v["scenes"].is_array());
        assert_eq!(v["scenes"][0]["id"].as_str(), Some("1.0"));
        // `language` is still a schema fragment — that's OK for our
        // callers because `language` is `#[serde(default)]` and
        // serde_json's deserializer will reject the fragment shape,
        // returning None via the default. The important fix is that
        // `scenes` parses.
    }

    #[test]
    fn coerce_is_idempotent_on_already_clean_data() {
        let raw = r#"{"scenes": [{"id":"1.0"}]}"#;
        let mut v: serde_json::Value = serde_json::from_str(raw).unwrap();
        let before = v.clone();
        coerce_schema_echo(&mut v);
        assert_eq!(v, before, "clean data must round-trip unchanged");
    }

    #[test]
    fn coerce_recovers_synth_brief_shape() {
        // End-to-end: the exact echo llava produced + the SynthBrief
        // expected shape. After coercion, deserialization should
        // succeed.
        #[derive(serde::Deserialize)]
        struct Scene {
            id: Option<String>,
            #[serde(default)]
            visual: Option<String>,
        }
        #[derive(serde::Deserialize)]
        struct SynthBrief {
            scenes: Vec<Scene>,
        }

        let raw = r#"{
            "properties": {
                "language": {"type": "string", "enum": ["english","french","unknown"]},
                "scenes": {"items": [
                    {"id":"1.0","visual":"three accountants huddled"},
                    {"id":"2.0","visual":"calendar pages fly"}
                ]}
            },
            "required": ["scenes"],
            "type": "object"
        }"#;
        let mut v: serde_json::Value = serde_json::from_str(raw).unwrap();
        coerce_schema_echo(&mut v);
        let brief: SynthBrief = serde_json::from_value(v).unwrap();
        assert_eq!(brief.scenes.len(), 2);
        assert_eq!(brief.scenes[0].id.as_deref(), Some("1.0"));
        assert!(
            brief.scenes[1]
                .visual
                .as_deref()
                .unwrap()
                .contains("calendar")
        );
    }
}
