'use client';

/**
 * AuthMotionBackground — full-bleed cinema-style scene player that sits
 * behind every auth surface (signup, login, verify-email, etc.).
 *
 * The canvas reads as a motion-design engine running live:
 *   - A scrubber/playhead advances through each ~4.2 s scene.
 *   - The hero silhouette is stroke-drawn limb-by-limb on every scene
 *     change (the engine "rendering" the cast on screen).
 *   - The pipeline row beneath the headline is a connected timeline
 *     with a traveling render dot, not a static chip cluster.
 *   - A frame counter, render % and codec stamp surround the canvas
 *     so the chrome reads as a live render rig.
 *
 * Visual register matches the home page's BrandMotionShowcase: dark
 * "video canvas" gradient tinted by the active scene's accent, 48 px
 * grid, vignette around the centered form.
 *
 * Pure CSS keyframes + React state — no animation library. SSR-safe
 * and respects prefers-reduced-motion.
 */

import { useEffect, useState } from 'react';

type Pose = 'power' | 'flight' | 'leap' | 'hover';

interface Scene {
  id: string;
  eyebrow: string;
  headline: string;
  sub: string;
  /** CSS color (token) for the scene accent — drives glow + cape color. */
  accent: string;
  meta: string;
  pose: Pose;
  /** Which side the hero lands on — heroes stay clear of the centered form. */
  side: 'left' | 'right';
}

const SCENES: ReadonlyArray<Scene> = [
  {
    id: 'corporate',
    eyebrow: 'BRIEF',
    headline: 'Brand-grade motion design',
    sub: 'Same day. Same brand system. Same security posture.',
    accent: 'var(--color-accent-400)',
    meta: 'corporate · 1920×1080',
    pose: 'power',
    side: 'left',
  },
  {
    id: 'animation',
    eyebrow: 'FESTIVAL TEASER',
    headline: 'From storyboard to broadcast in twenty minutes.',
    sub: 'Animated-feature teasers, festival cuts, distributor reels — every market, every format.',
    accent: 'var(--color-secondary-400)',
    meta: 'animation · 1920×1080',
    pose: 'flight',
    side: 'right',
  },
  {
    id: 'playful',
    eyebrow: 'CAMPAIGN',
    headline: 'From brief to broadcast in minutes',
    sub: 'Iterate to a new tagline, market, or persona in seconds.',
    accent: 'var(--color-accent-300)',
    meta: 'playful · 1920×1080',
    pose: 'leap',
    side: 'left',
  },
  {
    id: 'minimalist',
    eyebrow: 'PRINCIPLE',
    headline: 'Less waiting. More making.',
    sub: 'Calm motion. Tight typography. Numbers that count up.',
    accent: 'var(--color-accent-500)',
    meta: 'minimalist · 1920×1080',
    pose: 'hover',
    side: 'right',
  },
];

const PIPELINE = ['Brief', 'Cast', 'Generate', 'Preview', 'Export'] as const;
const SCENE_DURATION_MS = 4_200;
/** 24 fps × 4.2 s ≈ 101 frames; round to 100 per scene for clean math. */
const FRAMES_PER_SCENE = 100;
const TOTAL_FRAMES = FRAMES_PER_SCENE * SCENES.length;

export function AuthMotionBackground() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setActive((i) => (i + 1) % SCENES.length);
    }, SCENE_DURATION_MS);
    return () => window.clearInterval(id);
  }, []);

  const scene = SCENES[active]!;
  const words = scene.headline.split(' ');
  const sceneFrameStart = active * FRAMES_PER_SCENE + 1;
  const sceneFrameEnd = (active + 1) * FRAMES_PER_SCENE;

  return (
    <div
      aria-hidden="true"
      className="amb-root pointer-events-none absolute inset-0 overflow-hidden"
      style={
        {
          '--amb-accent': scene.accent,
        } as React.CSSProperties
      }
    >
      <style jsx>{`
        .amb-root {
          background-image:
            radial-gradient(
              circle at 20% 18%,
              color-mix(in srgb, var(--amb-accent) 32%, transparent),
              transparent 55%
            ),
            radial-gradient(
              circle at 82% 84%,
              color-mix(in srgb, #f59e0b 16%, transparent),
              transparent 60%
            ),
            linear-gradient(to bottom right, #0e1014, #1a1e25);
          transition: background-image var(--dur-slow) var(--ease-out-quart);
        }

        /* ─── entrance primitives ─── */
        @keyframes amb-fade-in   { from { opacity: 0; } to { opacity: 1; } }
        @keyframes amb-fade-up   { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes amb-spring-in { 0% { opacity: 0; transform: translateY(20px) scale(0.94); } 60% { opacity: 1; transform: translateY(-2px) scale(1.02); } 100% { opacity: 1; transform: translateY(0) scale(1); } }

        .amb-scene   { animation: amb-fade-in var(--dur-slow) var(--ease-out-quart) both; }
        .amb-eyebrow { animation: amb-fade-up var(--dur-slow) var(--ease-out-quart) both; }
        .amb-word    { display: inline-block; opacity: 0; animation: amb-spring-in var(--dur-spring) var(--ease-spring) both; }
        .amb-sub     { animation: amb-fade-up var(--dur-slow) var(--ease-out-quart) 0.6s both; }

        /* ─── scrubber / playhead ─── */
        @keyframes amb-scrub {
          from { transform: scaleX(0); }
          to   { transform: scaleX(1); }
        }
        .amb-scrub-fill {
          transform-origin: left;
          animation: amb-scrub 4.2s linear forwards;
        }
        @keyframes amb-playhead {
          from { left: 0%; }
          to   { left: 100%; }
        }
        .amb-playhead {
          animation: amb-playhead 4.2s linear forwards;
        }

        /* ─── pipeline timeline ─── */
        @keyframes amb-pipeline-dot {
          0%   { left: 0%; opacity: 0; }
          6%   { opacity: 1; }
          94%  { opacity: 1; }
          100% { left: 100%; opacity: 0; }
        }
        .amb-pipeline-dot { animation: amb-pipeline-dot 4.2s linear forwards; }

        @keyframes amb-node-flash {
          0%, 100% { transform: scale(1); box-shadow: 0 0 0 0 transparent; }
          50%      { transform: scale(1.3); box-shadow: 0 0 0 6px color-mix(in srgb, var(--amb-accent) 28%, transparent); }
        }
        .amb-node {
          animation: amb-node-flash 4.2s linear forwards;
        }
        .amb-node-0 { animation-delay: 0s; }
        .amb-node-1 { animation-delay: 0.84s; animation-duration: 0s; animation-fill-mode: backwards; }
        /* Each node flashes when the dot reaches it. We accomplish that with
           per-node keyframes positioned at the right time slice. */
        .amb-node {
          animation: none;
        }
        @keyframes amb-node-0 { 0%, 12% { transform: scale(1.4); background-color: var(--amb-accent); } 13%, 100% { transform: scale(1); background-color: rgba(255,255,255,0.5); } }
        @keyframes amb-node-1 { 0%, 18% { transform: scale(1); background-color: rgba(255,255,255,0.5); } 19%, 31% { transform: scale(1.4); background-color: var(--amb-accent); } 32%, 100% { transform: scale(1); background-color: rgba(255,255,255,0.5); } }
        @keyframes amb-node-2 { 0%, 38% { transform: scale(1); background-color: rgba(255,255,255,0.5); } 39%, 51% { transform: scale(1.4); background-color: var(--amb-accent); } 52%, 100% { transform: scale(1); background-color: rgba(255,255,255,0.5); } }
        @keyframes amb-node-3 { 0%, 58% { transform: scale(1); background-color: rgba(255,255,255,0.5); } 59%, 71% { transform: scale(1.4); background-color: var(--amb-accent); } 72%, 100% { transform: scale(1); background-color: rgba(255,255,255,0.5); } }
        @keyframes amb-node-4 { 0%, 78% { transform: scale(1); background-color: rgba(255,255,255,0.5); } 79%, 91% { transform: scale(1.4); background-color: var(--amb-accent); } 92%, 100% { transform: scale(1); background-color: rgba(255,255,255,0.5); } }

        .amb-node-0 { animation: amb-node-0 4.2s linear forwards; }
        .amb-node-1 { animation: amb-node-1 4.2s linear forwards; }
        .amb-node-2 { animation: amb-node-2 4.2s linear forwards; }
        .amb-node-3 { animation: amb-node-3 4.2s linear forwards; }
        .amb-node-4 { animation: amb-node-4 4.2s linear forwards; }

        @keyframes amb-track-fill {
          from { transform: scaleX(0); }
          to   { transform: scaleX(1); }
        }
        .amb-track-fill {
          transform-origin: left;
          animation: amb-track-fill 4.2s linear forwards;
        }

        /* ─── hero entrance + stroke-build ─── */
        @keyframes amb-hero-enter-left  { 0% { opacity: 0; transform: translate(-30%, 4%); } 100% { opacity: 1; transform: translate(0, 0); } }
        @keyframes amb-hero-enter-right { 0% { opacity: 0; transform: translate(30%, 4%); }  100% { opacity: 1; transform: translate(0, 0); } }
        @keyframes amb-hero-idle        { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }

        .amb-hero-wrap {
          animation:
            amb-hero-enter-left 0.9s var(--ease-out-quart) both,
            amb-hero-idle 6.4s var(--ease-out-quart) 1.6s infinite;
        }
        .amb-hero-wrap.amb-hero-right {
          animation:
            amb-hero-enter-right 0.9s var(--ease-out-quart) both,
            amb-hero-idle 6.4s var(--ease-out-quart) 1.6s infinite;
        }

        @keyframes amb-cape-sway { 0%, 100% { transform: rotate(-2deg); } 50% { transform: rotate(3deg); } }
        .amb-cape {
          transform-origin: 50% 8%;
          animation: amb-cape-sway 3.6s var(--ease-out-quart) infinite;
        }

        /* The engine draws each hero part in sequence — stroke first,
           then fill comes in. Reads as an SVG path being plotted live. */
        @keyframes amb-stroke-build {
          0%   { stroke-dashoffset: 600; fill-opacity: 0; stroke-opacity: 1; }
          70%  { stroke-dashoffset: 0;   fill-opacity: 0; stroke-opacity: 1; }
          100% { stroke-dashoffset: 0;   fill-opacity: 1; stroke-opacity: 0.35; }
        }
        .amb-hero-part {
          stroke-dasharray: 600;
          stroke-width: 1.25;
          animation: amb-stroke-build 1.2s var(--ease-out-quart) both;
        }
        .amb-hero-part:nth-child(1) { animation-delay: 0.05s; }
        .amb-hero-part:nth-child(2) { animation-delay: 0.10s; }
        .amb-hero-part:nth-child(3) { animation-delay: 0.15s; }
        .amb-hero-part:nth-child(4) { animation-delay: 0.20s; }
        .amb-hero-part:nth-child(5) { animation-delay: 0.25s; }
        .amb-hero-part:nth-child(6) { animation-delay: 0.30s; }
        .amb-hero-part:nth-child(7) { animation-delay: 0.35s; }
        .amb-hero-part:nth-child(8) { animation-delay: 0.40s; }
        .amb-hero-part:nth-child(9) { animation-delay: 0.45s; }

        /* ─── ambient ─── */
        @keyframes amb-pulse {
          0%, 100% { opacity: 0.9; transform: scale(1); }
          50%      { opacity: 0.5; transform: scale(0.85); }
        }
        .amb-pulse-dot { animation: amb-pulse var(--dur-long-pulse) var(--ease-out-quart) infinite; }

        /* Reduced motion — collapse every entrance, kill idle floats. */
        @media (prefers-reduced-motion: reduce) {
          .amb-scene, .amb-eyebrow, .amb-word, .amb-sub,
          .amb-hero-wrap, .amb-hero-wrap.amb-hero-right, .amb-cape,
          .amb-pulse-dot, .amb-hero-part, .amb-scrub-fill, .amb-playhead,
          .amb-pipeline-dot, .amb-track-fill,
          .amb-node-0, .amb-node-1, .amb-node-2, .amb-node-3, .amb-node-4 {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
            stroke-dashoffset: 0 !important;
            fill-opacity: 1 !important;
          }
        }
      `}</style>

      {/* Subtle grid texture — sells the "motion canvas" register. */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage:
            'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Hero silhouette — re-keys per scene so stroke-build replays. */}
      <div
        key={`hero-${scene.id}`}
        className={`amb-hero-wrap absolute inset-y-0 z-[1] hidden items-center lg:flex ${
          scene.side === 'left' ? 'left-[4vw] amb-hero-left' : 'right-[4vw] amb-hero-right'
        }`}
        style={{ width: 'min(20vw, 14rem)' }}
      >
        <HeroFigure pose={scene.pose} accent={scene.accent} />
      </div>

      {/* Scene heading — pinned just under the top HUD with an absolute
          offset so the centered form never occludes it. Kept tight
          (eyebrow + single-line headline) so it slots cleanly between
          the HUD and the form card. Keyed so word-spring + eyebrow
          fade replay on every scene change. */}
      <div
        key={`heading-${scene.id}`}
        className="amb-scene absolute inset-x-0 top-12 z-[2] flex justify-center px-6 md:top-[72px]"
      >
        <div className="flex w-full max-w-2xl flex-col items-center gap-2 text-center opacity-95">
          <p
            className="amb-eyebrow font-mono text-[11px] font-semibold uppercase tracking-[0.22em]"
            style={{ color: scene.accent }}
          >
            {scene.eyebrow}
          </p>
          <h2
            className="flex max-w-xl flex-wrap justify-center gap-x-[0.3em] gap-y-0.5 text-xl font-bold leading-[1.1] tracking-tight text-white/95 sm:text-2xl"
            style={{ textWrap: 'balance' } as React.CSSProperties}
          >
            {words.map((word, i) => (
              <span
                key={`${word}-${i}`}
                className="amb-word"
                style={{ animationDelay: `${0.08 + i * 0.07}s` }}
              >
                {word}
              </span>
            ))}
          </h2>
        </div>
      </div>

      {/* Pipeline timeline — pinned with an absolute offset just above
          the bottom HUD so the centered form never occludes the middle
          nodes. A render dot flows across the 5 nodes over the scene's
          4.2 s window; each node flashes when the dot arrives. */}
      <div
        key={`pipeline-${scene.id}`}
        className="absolute inset-x-0 bottom-16 z-[2] hidden justify-center px-10 sm:flex md:bottom-[72px]"
      >
        <div className="relative w-full max-w-2xl">
          {/* Underlying dim track */}
          <div className="absolute left-2 right-2 top-1/2 h-px -translate-y-1/2 bg-white/15" aria-hidden />
          {/* Lit progress track — fills behind the dot. */}
          <div
            className="amb-track-fill absolute left-2 right-2 top-1/2 h-px -translate-y-1/2"
            style={{ backgroundColor: scene.accent }}
            aria-hidden
          />
          {/* Render dot travelling across the track. */}
          <div
            className="amb-pipeline-dot absolute top-1/2 z-[2] h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              backgroundColor: scene.accent,
              boxShadow: `0 0 16px 4px color-mix(in srgb, ${scene.accent} 55%, transparent)`,
            }}
            aria-hidden
          />
          {/* Nodes */}
          <ul className="relative flex items-center justify-between">
            {PIPELINE.map((label, i) => (
              <li key={label} className="flex flex-col items-center gap-2">
                <span
                  className={`amb-node-${i} relative z-[3] h-2.5 w-2.5 rounded-full border border-white/30`}
                  aria-hidden
                />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/75">
                  {label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Vignette — keeps the center legible regardless of scene. */}
      <div
        aria-hidden
        className="absolute inset-0 z-[3]"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 38rem 32rem at center, rgba(8, 10, 14, 0.82), transparent 70%)',
        }}
      />

      {/* Corner frame brackets — cinema "framing" marks at the canvas
          corners. Drawn with two short border edges per corner. */}
      <CornerBrackets accent={scene.accent} />

      {/* ── Engine HUD: top bar with reel + scrubber + frame counter ── */}
      <div className="absolute inset-x-0 top-0 z-[4] hidden md:block">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-6 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white/55">
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden
              className="amb-pulse-dot h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: scene.accent }}
            />
            Reel 001 · Live render
          </span>
          <span className="hidden items-center gap-3 lg:inline-flex">
            <span className="text-white/40">4 scenes</span>
            <span className="text-white/20">·</span>
            <span className="text-white/40">17s loop</span>
            <span className="text-white/20">·</span>
            <span className="text-white/40">16:9</span>
            <span className="text-white/20">·</span>
            <span className="text-white/40">H.264</span>
          </span>
          <span className="inline-flex items-center gap-3">
            <span style={{ color: scene.accent }}>
              Frame {String(sceneFrameStart).padStart(4, '0')}–{String(sceneFrameEnd).padStart(4, '0')}
            </span>
            <span className="text-white/40">/ {String(TOTAL_FRAMES).padStart(4, '0')}</span>
            <span className="text-white/20">·</span>
            <span className="text-white/40">24 fps</span>
          </span>
        </div>

        {/* Scrubber + playhead — re-keys per scene so the bar resets to
            0% and re-fills over the scene's 4.2 s. */}
        <div key={`scrub-${scene.id}`} className="relative h-1.5 overflow-visible">
          <div className="absolute inset-x-0 top-0 h-px bg-white/[0.06]" aria-hidden />
          <div
            className="amb-scrub-fill absolute inset-y-0 left-0 right-0 origin-left"
            style={{
              background: `linear-gradient(90deg, color-mix(in srgb, ${scene.accent} 80%, transparent), color-mix(in srgb, ${scene.accent} 30%, transparent))`,
            }}
            aria-hidden
          />
          {/* Tick marks — 4 dividers showing the loop's 4 scenes. */}
          {[0, 25, 50, 75, 100].map((p) => (
            <span
              key={p}
              className="absolute top-0 h-2 w-px bg-white/30"
              style={{ left: `${p}%` }}
              aria-hidden
            />
          ))}
          {/* Playhead diamond — rides on top of the fill. */}
          <span
            className="amb-playhead absolute top-1/2 z-[2] h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px]"
            style={{
              backgroundColor: scene.accent,
              boxShadow: `0 0 12px 2px color-mix(in srgb, ${scene.accent} 65%, transparent)`,
            }}
            aria-hidden
          />
        </div>
      </div>

      {/* ── Engine HUD: bottom render stamp ── */}
      <div className="absolute inset-x-0 bottom-0 z-[4] hidden items-center justify-between border-t border-white/[0.08] px-6 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white/45 md:flex">
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className="amb-pulse-dot h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: scene.accent }}
          />
          Engine · drawing {scene.pose}
        </span>
        <span className="hidden lg:inline">{scene.meta} · Inter Bold · Lottie + MP4</span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-white/30">↺</span>
          Iterate in &lt; 1 s
        </span>
      </div>

      {/* Mobile-only scene-progress dots (the HUD scrubber is desktop-only). */}
      <div className="absolute bottom-4 left-1/2 z-[4] flex -translate-x-1/2 gap-1.5 md:hidden">
        {SCENES.map((s, i) => (
          <span
            key={s.id}
            aria-hidden
            className={
              'h-1 rounded-full transition-all ' +
              (i === active ? 'w-6' : 'w-1 bg-white/30')
            }
            style={i === active ? { backgroundColor: scene.accent } : undefined}
          />
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────── corner brackets ────────────────────────── */

function CornerBrackets({ accent }: { accent: string }) {
  const c = `color-mix(in srgb, ${accent} 70%, transparent)`;
  const len = '14px';
  const off = '20px';
  const thick = '1px';
  return (
    <>
      {/* top-left */}
      <span
        aria-hidden
        className="absolute z-[4]"
        style={{ top: off, left: off, width: len, height: len, borderTop: `${thick} solid ${c}`, borderLeft: `${thick} solid ${c}` }}
      />
      {/* top-right */}
      <span
        aria-hidden
        className="absolute z-[4]"
        style={{ top: off, right: off, width: len, height: len, borderTop: `${thick} solid ${c}`, borderRight: `${thick} solid ${c}` }}
      />
      {/* bottom-left */}
      <span
        aria-hidden
        className="absolute z-[4]"
        style={{ bottom: off, left: off, width: len, height: len, borderBottom: `${thick} solid ${c}`, borderLeft: `${thick} solid ${c}` }}
      />
      {/* bottom-right */}
      <span
        aria-hidden
        className="absolute z-[4]"
        style={{ bottom: off, right: off, width: len, height: len, borderBottom: `${thick} solid ${c}`, borderRight: `${thick} solid ${c}` }}
      />
    </>
  );
}

/* ─────────────────────────── hero figure ─────────────────────────── */

/**
 * HeroFigure — stylized super-hero silhouette. Pure SVG, no asset
 * dependency. Each anatomical part wears the `amb-hero-part` class so
 * the engine "stroke-builds" the figure on every scene change — the
 * outline draws in first, the fill colors in second.
 */
function HeroFigure({ pose, accent }: { pose: Pose; accent: string }) {
  const cape = `color-mix(in srgb, ${accent} 80%, transparent)`;
  const body = `color-mix(in srgb, ${accent} 30%, #0e1014)`;
  const trim = `color-mix(in srgb, ${accent} 60%, white 25%)`;
  const stroke = `color-mix(in srgb, ${accent} 95%, white 0%)`;

  return (
    <svg
      viewBox="0 0 200 320"
      role="img"
      aria-hidden="true"
      className="h-full w-full opacity-55"
      style={{
        filter: `drop-shadow(0 16px 24px color-mix(in srgb, ${accent} 35%, transparent))`,
        ['--draw-color' as string]: stroke,
      }}
    >
      <g style={{ stroke }}>
        {pose === 'power' && (
          <>
            <path className="amb-cape amb-hero-part" d="M55 70 Q20 130 35 250 Q70 240 100 250 Q130 240 165 250 Q180 130 145 70 Z" fill={cape} />
            <circle className="amb-hero-part" cx="100" cy="55" r="22" fill={body} />
            <path className="amb-hero-part" d="M78 80 L122 80 L130 200 L70 200 Z" fill={body} />
            <rect className="amb-hero-part" x="92" y="80" width="16" height="60" fill={trim} />
            <rect className="amb-hero-part" x="60" y="92" width="22" height="18" rx="4" fill={body} />
            <rect className="amb-hero-part" x="118" y="92" width="22" height="18" rx="4" fill={body} />
            <rect className="amb-hero-part" x="74" y="200" width="20" height="100" rx="5" fill={body} />
            <rect className="amb-hero-part" x="106" y="200" width="20" height="100" rx="5" fill={body} />
          </>
        )}

        {pose === 'flight' && (
          <g transform="rotate(-12 100 160)">
            <path className="amb-cape amb-hero-part" d="M80 80 Q 20 110 -10 180 Q 40 175 90 165 Q 130 150 160 130 Q 145 95 110 78 Z" fill={cape} />
            <ellipse className="amb-hero-part" cx="148" cy="120" rx="22" ry="20" fill={body} />
            <path className="amb-hero-part" d="M72 130 L150 110 L160 150 L82 168 Z" fill={body} />
            <rect className="amb-hero-part" x="100" y="115" width="36" height="14" fill={trim} />
            <path className="amb-hero-part" d="M150 110 L195 96 L200 110 L155 124 Z" fill={body} />
            <path className="amb-hero-part" d="M70 138 Q 40 150 14 158 L 18 174 Q 48 168 76 158 Z" fill={body} />
            <path className="amb-hero-part" d="M82 165 L 70 245 L 90 248 L 108 168 Z" fill={body} />
            <path className="amb-hero-part" d="M100 168 L 100 250 L 122 250 L 130 170 Z" fill={body} />
          </g>
        )}

        {pose === 'leap' && (
          <>
            <path className="amb-cape amb-hero-part" d="M50 90 Q10 150 30 240 Q70 220 100 230 Q130 220 170 240 Q190 150 150 90 Z" fill={cape} />
            <circle className="amb-hero-part" cx="100" cy="50" r="20" fill={body} />
            <path className="amb-hero-part" d="M82 75 L118 75 L128 180 L72 180 Z" fill={body} />
            <rect className="amb-hero-part" x="92" y="80" width="16" height="55" fill={trim} />
            <path className="amb-hero-part" d="M82 80 L62 18 L80 14 L96 78 Z" fill={body} />
            <path className="amb-hero-part" d="M118 80 L138 18 L120 14 L104 78 Z" fill={body} />
            <path className="amb-hero-part" d="M76 180 L 50 260 L 70 270 L 96 188 Z" fill={body} />
            <path className="amb-hero-part" d="M104 188 L130 270 L150 260 L124 180 Z" fill={body} />
          </>
        )}

        {pose === 'hover' && (
          <>
            <path className="amb-cape amb-hero-part" d="M60 75 Q15 135 35 245 Q70 235 100 240 Q130 235 165 245 Q185 135 140 75 Z" fill={cape} />
            <circle className="amb-hero-part" cx="100" cy="55" r="22" fill={body} />
            <path className="amb-hero-part" d="M78 80 L122 80 L132 195 L68 195 Z" fill={body} />
            <rect className="amb-hero-part" x="92" y="80" width="16" height="60" fill={trim} />
            <path className="amb-hero-part" d="M78 92 Q60 130 78 168 L96 168 L96 96 Z" fill={body} />
            <path className="amb-hero-part" d="M122 92 Q140 130 122 168 L104 168 L104 96 Z" fill={body} />
            <rect className="amb-hero-part" x="78" y="195" width="20" height="90" rx="5" fill={body} />
            <rect className="amb-hero-part" x="102" y="195" width="20" height="90" rx="5" fill={body} />
            <ellipse cx="100" cy="305" rx="56" ry="8" fill={accent} opacity="0.18" className="amb-hero-part" />
          </>
        )}
      </g>
    </svg>
  );
}
