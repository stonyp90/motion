//! Per-principal sliding-window rate limiter.
//!
//! Reads the [`Principal`](crate::auth::Principal) attached to the request
//! extensions by the auth middleware, then enforces a per-principal
//! requests-per-minute budget. Each principal carries its tier's budget
//! along with it (free / pro / enterprise → 60 / 600 / 6000 rpm) so
//! this layer never has to look anything up at request time.
//!
//! Implementation is a sliding window of request timestamps stored in a
//! `DashMap<PrincipalId, VecDeque<Instant>>`. Each call drops timestamps
//! older than the window head, then admits the request if the queue
//! length is below the budget. Memory bound is proportional to
//! `Σ active_principals * rpm`, which for our scale (hundreds of
//! principals × thousands of rpm) is at worst a few MB of `Instant`s.
//!
//! Why sliding window over token bucket? Token buckets are cheaper but
//! allow short bursts above the advertised limit, which a Hacker News
//! style traffic spike can exploit. Sliding window enforces the
//! advertised limit exactly, which is the right register for "pricing
//! tier" semantics where the customer expects rpm to mean rpm.
//!
//! Skipped for: paths that are auth-skipped (`/healthz`, `/openapi.json`,
//! `/v1/stt/stream`) and unauthenticated paths that somehow reach this
//! layer. In production those should be rejected upstream by auth; in
//! dev they pass through to keep the iteration loop snappy.

use axum::body::Body;
use axum::http::{HeaderValue, Request, Response, StatusCode, header};
use axum::response::IntoResponse;
use dashmap::DashMap;
use std::collections::VecDeque;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::{Duration, Instant};
use tower::{Layer, Service};

use crate::auth::Principal;

/// Window length: 60 seconds.
const WINDOW: Duration = Duration::from_secs(60);

#[derive(Clone, Default)]
pub struct RateLimitLayer {
    state: Arc<RateLimitState>,
}

impl RateLimitLayer {
    pub fn new() -> Self {
        Self::default()
    }
}

#[derive(Default)]
pub struct RateLimitState {
    /// principal id → window
    buckets: DashMap<String, VecDeque<Instant>>,
}

impl<S> Layer<S> for RateLimitLayer {
    type Service = RateLimitMiddleware<S>;
    fn layer(&self, inner: S) -> Self::Service {
        RateLimitMiddleware {
            inner,
            state: Arc::clone(&self.state),
        }
    }
}

#[derive(Clone)]
pub struct RateLimitMiddleware<S> {
    inner: S,
    state: Arc<RateLimitState>,
}

impl<S> Service<Request<Body>> for RateLimitMiddleware<S>
where
    S: Service<Request<Body>, Response = Response<Body>> + Send + Clone + 'static,
    S::Future: Send + 'static,
    S::Error: Send + 'static,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Request<Body>) -> Self::Future {
        let state = Arc::clone(&self.state);
        let clone = self.inner.clone();
        let mut inner = std::mem::replace(&mut self.inner, clone);
        Box::pin(async move {
            // Skip if there's no principal — either pre-auth or an
            // open path. In production auth would have rejected.
            let principal = req.extensions().get::<Principal>().cloned();
            let Some(p) = principal else {
                return inner.call(req).await;
            };
            let budget = p.rpm as usize;
            let now = Instant::now();
            let cutoff = now.checked_sub(WINDOW).unwrap_or(now);

            // Trim + admit under a single dashmap entry guard so two
            // concurrent requests for the same principal can't both
            // squeak past the budget.
            let mut entry = state.buckets.entry(p.id.clone()).or_default();
            while let Some(front) = entry.front() {
                if *front < cutoff {
                    entry.pop_front();
                } else {
                    break;
                }
            }
            if entry.len() >= budget {
                let retry_after = entry
                    .front()
                    .map(|t| (WINDOW.saturating_sub(now.duration_since(*t))).as_secs() + 1)
                    .unwrap_or(1);
                drop(entry);
                return Ok(too_many(p, retry_after));
            }
            entry.push_back(now);
            let used = entry.len() as u32;
            drop(entry);

            // Attach informational headers so SDK callers can
            // surface their budget without a separate /me call.
            let mut res = inner.call(req).await?;
            let headers = res.headers_mut();
            headers.insert(
                "X-RateLimit-Limit",
                HeaderValue::from_str(&p.rpm.to_string()).unwrap_or(HeaderValue::from_static("0")),
            );
            headers.insert(
                "X-RateLimit-Remaining",
                HeaderValue::from_str(&p.rpm.saturating_sub(used).to_string())
                    .unwrap_or(HeaderValue::from_static("0")),
            );
            Ok(res)
        })
    }
}

fn too_many(principal: Principal, retry_after_seconds: u64) -> Response<Body> {
    let body = serde_json::json!({
        "error": "rate_limited",
        "detail": format!(
            "exceeded {} rpm for {} tier — retry in {}s",
            principal.rpm, principal.tier_label, retry_after_seconds
        ),
        "tier": principal.tier_label,
        "limit_rpm": principal.rpm,
    });
    let mut res = (StatusCode::TOO_MANY_REQUESTS, axum::Json(body)).into_response();
    let h = res.headers_mut();
    h.insert(
        header::RETRY_AFTER,
        HeaderValue::from_str(&retry_after_seconds.to_string())
            .unwrap_or(HeaderValue::from_static("1")),
    );
    h.insert(
        "X-RateLimit-Limit",
        HeaderValue::from_str(&principal.rpm.to_string()).unwrap_or(HeaderValue::from_static("0")),
    );
    h.insert(
        "X-RateLimit-Remaining",
        HeaderValue::from_static("0"),
    );
    res
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{Router, routing::get};
    use http::Request as HttpRequest;
    use tower::ServiceExt;

    fn router_with_principal(p: Principal) -> Router {
        Router::new()
            .route("/x", get(|| async { "ok" }))
            .layer(RateLimitLayer::new())
            .layer(axum::middleware::from_fn(move |mut req: Request<Body>, next: axum::middleware::Next| {
                let p = p.clone();
                async move {
                    req.extensions_mut().insert(p);
                    next.run(req).await
                }
            }))
    }

    #[tokio::test]
    async fn under_budget_admits() {
        let p = Principal {
            id: "test".into(),
            kind: crate::auth::PrincipalKind::User,
            tier_label: "free".into(),
            rpm: 5,
        };
        let app = router_with_principal(p);
        for _ in 0..5 {
            let res = app
                .clone()
                .oneshot(HttpRequest::builder().uri("/x").body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(res.status(), 200);
            assert_eq!(
                res.headers().get("X-RateLimit-Limit").unwrap(),
                "5"
            );
        }
    }

    #[tokio::test]
    async fn over_budget_rejects_with_retry_after() {
        let p = Principal {
            id: "test-over".into(),
            kind: crate::auth::PrincipalKind::User,
            tier_label: "free".into(),
            rpm: 2,
        };
        let app = router_with_principal(p);
        for _ in 0..2 {
            app.clone()
                .oneshot(HttpRequest::builder().uri("/x").body(Body::empty()).unwrap())
                .await
                .unwrap();
        }
        let res = app
            .oneshot(HttpRequest::builder().uri("/x").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(res.status(), 429);
        assert!(res.headers().get(header::RETRY_AFTER).is_some());
    }
}
