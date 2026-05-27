/**
 * opengraph-image.tsx — Next.js Metadata API OG image.
 *
 * Generates the social-share preview image for the entire site at
 * /opengraph-image (Next picks it up automatically from this filename).
 *
 * Design:
 *  - 1200×630 (the Twitter / LinkedIn / Slack standard).
 *  - Same dark "video canvas" gradient as BrandMotionShowcase, so the
 *    shared link visually matches what the visitor sees on the site.
 *  - Emerald accent halo top-left, amber halo bottom-right (matches the
 *    brand-mark palette).
 *  - Space Grotesk wordmark, oversized, balanced with a tagline.
 *  - No icon mark in the OG to keep the focal area calm — the wordmark
 *    IS the brand mark at this scale.
 *
 * Rendered at request time with `next/og`, so updates ship without a
 * static asset rebuild.
 */

import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'ControlCraft — prompt-based motion graphics';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          padding: '72px',
          background:
            'radial-gradient(circle at 18% 18%, rgba(52, 211, 153, 0.28), transparent 55%), radial-gradient(circle at 82% 82%, rgba(245, 158, 11, 0.18), transparent 55%), linear-gradient(135deg, #0e1014 0%, #1a1e25 100%)',
          color: '#ffffff',
          fontFamily: 'Inter, "Space Grotesk", system-ui, sans-serif',
        }}
      >
        {/* Top row — sample badge mirroring BrandMotionShowcase */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 16px',
            borderRadius: 999,
            background: 'rgba(0, 0, 0, 0.45)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
          }}
        >
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: '#34d399',
            }}
          />
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              letterSpacing: '0.18em',
              color: 'rgba(255, 255, 255, 0.95)',
              textTransform: 'uppercase',
            }}
          >
            ControlCraft
          </div>
        </div>

        {/* Middle — wordmark + tagline */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          }}
        >
          <div
            style={{
              fontSize: 120,
              fontWeight: 700,
              letterSpacing: '-0.04em',
              lineHeight: 1,
              color: '#ffffff',
            }}
          >
            Prompt → motion graphic.
          </div>
          <div
            style={{
              fontSize: 32,
              fontWeight: 500,
              color: 'rgba(232, 234, 240, 0.75)',
              lineHeight: 1.3,
              maxWidth: 900,
            }}
          >
            Local engine, local models, no cloud round-trip. Brand-grade
            motion design the same day a brief lands.
          </div>
        </div>

        {/* Bottom — domain + accent dot row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            width: '100%',
          }}
        >
          <div
            style={{
              fontSize: 24,
              color: 'rgba(255, 255, 255, 0.5)',
              fontFamily: '"JetBrains Mono", monospace',
            }}
          >
            controlcraft.io
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            {[
              '#34d399', // emerald
              '#fbbf24', // amber
              '#6ee7b7', // mint
              '#ffffff',
            ].map((c, i) => (
              <div
                key={i}
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 4,
                  background: c,
                  opacity: 0.9,
                }}
              />
            ))}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
