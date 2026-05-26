/** @type {import('next').NextConfig} */

// Global security headers applied to every response. Mirrors OWASP
// secure-headers guidance + the Mozilla observatory's "A+" recipe,
// with the carve-outs we actually need for this app:
//
//  - `connect-src` includes localhost + 127.0.0.1 on any port so the
//    Tauri desktop shell can talk to its engine sidecar (random local
//    port) + Ollama on :11434. Prod-only browsers never see localhost
//    URLs so this is a no-op there. The `https://api.imtn.io` +
//    `https://api.github.com` entries cover the hosted engine + the
//    /download page's Releases API call.
//  - `img-src 'self' data: blob: https:` because PreviewFrame captures
//    frames as data URLs, MetricsDrawer reads SVGs from data:, the
//    brand kit page references provider logos hosted elsewhere.
//  - `script-src 'self' 'unsafe-inline'` is the minimum Next.js needs
//    for SSR hydration scripts. Switching to nonce-based CSP is a
//    follow-up — the Next 15 nonce story has rough edges.
//  - `frame-ancestors 'none'` (CSP) + X-Frame-Options DENY (legacy)
//    block clickjacking. The app is never meant to embed.
//
// HSTS is set to 2 years + includeSubDomains so we're eligible for
// the hstspreload.org list once we own a proper domain.
const SECURITY_HEADERS = [
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "media-src 'self' blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://api.imtn.io https://api.github.com http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; '),
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    // Self for microphone (we use it via the VoiceButton). Everything
    // else explicitly denied so a future iframe or 3rd-party widget
    // can't silently grab perms.
    value:
      'camera=(), microphone=(self), geolocation=(), payment=(), usb=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=(), midi=(), interest-cohort=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  // `standalone` emits a minimal `.next/standalone/` tree with the
  // server + a curated set of node_modules — exactly what we need to
  // ship inside a slim container. Local `npm run dev` ignores this.
  // The Dockerfile copies `.next/standalone`, `.next/static`, and
  // `public/` into a runtime stage and starts `node server.js`.
  output: 'standalone',
  async headers() {
    return [
      // Apply security headers to every route. Order matters — Next
      // applies the first matching block per (source, key) pair.
      {
        source: '/(.*)',
        headers: SECURITY_HEADERS,
      },
      // Long-lived cache for static demo assets — unchanged from before.
      {
        source: '/demos/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
