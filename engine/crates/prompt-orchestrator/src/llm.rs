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
use std::time::Duration;

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
}

#[async_trait]
impl LlmBackend for OllamaBackend {
    fn name(&self) -> &str {
        "ollama"
    }

    async fn complete_json(&self, req: &LlmRequest) -> Result<String> {
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
}

#[derive(Deserialize)]
struct OpenAiChoice {
    message: OpenAiMessageOwned,
}

#[derive(Deserialize)]
struct OpenAiMessageOwned {
    content: String,
}

async fn openai_style_call(
    client: &reqwest::Client,
    url: &str,
    api_key: Option<&str>,
    model: &str,
    req: &LlmRequest,
) -> Result<String> {
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
    raw.choices
        .into_iter()
        .next()
        .map(|c| c.message.content)
        .ok_or_else(|| anyhow!("empty choices array"))
}

#[async_trait]
impl LlmBackend for LmStudioBackend {
    fn name(&self) -> &str {
        "lmstudio"
    }
    async fn complete_json(&self, req: &LlmRequest) -> Result<String> {
        let url = format!("{}/v1/chat/completions", self.host);
        openai_style_call(&self.client, &url, None, &self.model, req).await
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
        openai_style_call(
            &self.client,
            "https://api.openai.com/v1/chat/completions",
            Some(&self.api_key),
            &self.model,
            req,
        )
        .await
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

#[derive(Serialize)]
struct AnthropicReq<'a> {
    model: &'a str,
    system: &'a str,
    messages: Vec<AnthropicMessage<'a>>,
    max_tokens: u32,
    temperature: f32,
}

#[derive(Serialize)]
struct AnthropicMessage<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct AnthropicResp {
    content: Vec<AnthropicContent>,
}

#[derive(Deserialize)]
struct AnthropicContent {
    text: Option<String>,
}

#[async_trait]
impl LlmBackend for AnthropicBackend {
    fn name(&self) -> &str {
        "anthropic"
    }
    async fn complete_json(&self, req: &LlmRequest) -> Result<String> {
        let user = if let Some(schema) = &req.schema {
            format!(
                "{}\n\nReturn JSON matching exactly this schema:\n{}\n\n\
                 Emit DATA matching the schema — never the schema definition itself.",
                req.user, schema
            )
        } else {
            req.user.clone()
        };
        // Anthropic's `assistant prefill` pattern: seed the assistant's
        // turn with `{` so the model is forced to continue from inside
        // a JSON object. This is the official Anthropic technique for
        // structured output — eliminates the "model wrote ```json
        // markdown" failure mode and removes the need for `Return ONLY
        // JSON` instruction prose. We re-prepend `{` to the response
        // below since prefill content is NOT echoed back.
        let body = AnthropicReq {
            model: &self.model,
            system: &req.system,
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
