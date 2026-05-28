'use client';

/**
 * AuthMotionBackground — full-bleed cinema-style scene player that sits
 * behind every auth surface (signup, login, verify-email, etc.).
 *
 * Visual register matches the home page's BrandMotionShowcase: 4 scenes,
 * ~17s loop, scene-step chips, dark "video canvas" gradient tinted by
 * the active scene's accent. Auth-specific addition: each scene renders
 * a stylized super-hero silhouette off-center, suggesting the studio
 * cast hard at work while the user signs in.
 *
 * The form card is rendered centered on top of this background. A
 * vignette overlay dims the middle of the canvas so inputs remain
 * legible no matter which scene is on screen.
 *
 * Pure CSS keyframes + React state — no animation library. SSR-safe and
 * respects prefers-reduced-motion.
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

const CHIPS = ['Brief', 'Cast', 'Generate', 'Preview', 'Export'] as const;
const SCENE_DURATION_MS = 4_200;

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

        @keyframes amb-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes amb-fade-up {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes amb-spring-in {
          0%   { opacity: 0; transform: translateY(20px) scale(0.94); }
          60%  { opacity: 1; transform: translateY(-2px) scale(1.02); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes amb-slide-left {
          from { opacity: 0; transform: translateX(-36px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes amb-slide-right {
          from { opacity: 0; transform: translateX(36px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes amb-slide-top {
          from { opacity: 0; transform: translateY(-24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes amb-slide-bottom {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .amb-scene  { animation: amb-fade-in var(--dur-slow) var(--ease-out-quart) both; }
        .amb-eyebrow { animation: amb-fade-up var(--dur-slow) var(--ease-out-quart) both; }
        .amb-word    { display: inline-block; opacity: 0; animation: amb-spring-in var(--dur-spring) var(--ease-spring) both; }
        .amb-sub     { animation: amb-fade-up var(--dur-slow) var(--ease-out-quart) 0.6s both; }

        .amb-chip { opacity: 0; animation-duration: var(--dur-slow); animation-timing-function: var(--ease-spring); animation-fill-mode: both; }
        .amb-chip-0 { animation-name: amb-slide-left;   animation-delay: 0.85s; }
        .amb-chip-1 { animation-name: amb-slide-bottom; animation-delay: 0.95s; }
        .amb-chip-2 { animation-name: amb-slide-top;    animation-delay: 1.05s; }
        .amb-chip-3 { animation-name: amb-slide-bottom; animation-delay: 1.15s; }
        .amb-chip-4 { animation-name: amb-slide-right;  animation-delay: 1.25s; }

        /* Hero entrance — flies in from off-canvas, settles, then idles
           with a slow float that suggests cape lift and breathing. */
        @keyframes amb-hero-enter-left {
          0%   { opacity: 0; transform: translate(-60%, 8%) rotate(-6deg) scale(0.95); }
          60%  { opacity: 0.9; transform: translate(0, -1%) rotate(0.5deg) scale(1.01); }
          100% { opacity: 1; transform: translate(0, 0) rotate(0deg) scale(1); }
        }
        @keyframes amb-hero-enter-right {
          0%   { opacity: 0; transform: translate(60%, 8%) rotate(6deg) scale(0.95); }
          60%  { opacity: 0.9; transform: translate(0, -1%) rotate(-0.5deg) scale(1.01); }
          100% { opacity: 1; transform: translate(0, 0) rotate(0deg) scale(1); }
        }
        @keyframes amb-hero-idle {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-10px); }
        }
        .amb-hero-wrap {
          animation:
            amb-hero-enter-left var(--dur-spring) var(--ease-spring) both,
            amb-hero-idle 6.4s var(--ease-out-quart) 0.9s infinite;
        }
        .amb-hero-wrap.amb-hero-right {
          animation:
            amb-hero-enter-right var(--dur-spring) var(--ease-spring) both,
            amb-hero-idle 6.4s var(--ease-out-quart) 0.9s infinite;
        }

        /* Cape sway — sub-element keyframe on the cape shape, layered on
           top of the wrapper's idle float. */
        @keyframes amb-cape-sway {
          0%, 100% { transform: rotate(-2deg); }
          50%      { transform: rotate(3deg); }
        }
        .amb-cape {
          transform-origin: 50% 8%;
          animation: amb-cape-sway 3.6s var(--ease-out-quart) infinite;
        }

        @keyframes amb-pulse {
          0%, 100% { opacity: 0.9; transform: scale(1); }
          50%      { opacity: 0.5; transform: scale(0.85); }
        }
        .amb-pulse-dot {
          animation: amb-pulse var(--dur-long-pulse) var(--ease-out-quart) infinite;
        }

        /* Reduced motion — collapse every entrance, kill the idle floats. */
        @media (prefers-reduced-motion: reduce) {
          .amb-scene, .amb-eyebrow, .amb-word, .amb-sub, .amb-chip,
          .amb-hero-wrap, .amb-hero-wrap.amb-hero-right, .amb-cape, .amb-pulse-dot {
            animation: none !important;
            opacity: 1 !important;
            transform: none !important;
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

      {/* Hero silhouette — re-keys per scene so the entrance plays again.
          Positioned off the centerline so the form card stays the focal
          point; sized small enough to read as ambient cast member, not
          foreground subject. */}
      <div
        key={`hero-${scene.id}`}
        className={`amb-hero-wrap absolute inset-y-0 z-[1] hidden items-center lg:flex ${
          scene.side === 'left' ? 'left-[4vw] amb-hero-left' : 'right-[4vw] amb-hero-right'
        }`}
        style={{ width: 'min(20vw, 14rem)' }}
      >
        <HeroFigure pose={scene.pose} accent={scene.accent} />
      </div>

      {/* Scene composition — eyebrow + headline + sub + chips. Keyed so
          all child entrance animations replay on every scene change. */}
      <div
        key={`scene-${scene.id}`}
        className="amb-scene absolute inset-0 z-[2] flex items-center justify-center px-6"
      >
        <div className="flex w-full max-w-2xl flex-col items-center gap-4 text-center opacity-90">
          <p
            className="amb-eyebrow font-mono text-[11px] font-semibold uppercase tracking-[0.22em]"
            style={{ color: scene.accent }}
          >
            {scene.eyebrow}
          </p>
          <h2
            className="flex max-w-2xl flex-wrap justify-center gap-x-[0.35em] gap-y-1 text-2xl font-bold leading-[1.05] tracking-tight text-white sm:text-3xl md:text-4xl"
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
          <p className="amb-sub max-w-xl text-sm leading-snug text-white/65 sm:text-base">
            {scene.sub}
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            {CHIPS.map((label, i) => (
              <div
                key={label}
                className={`amb-chip amb-chip-${i} inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-white/85 backdrop-blur-sm`}
                style={{
                  borderColor: 'color-mix(in srgb, white 16%, transparent)',
                  backgroundColor: 'color-mix(in srgb, black 35%, transparent)',
                }}
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: scene.accent }}
                />
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Vignette — radial dim at the center keeps the form card
          legible regardless of which scene is on screen. */}
      <div
        aria-hidden
        className="absolute inset-0 z-[3]"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 38rem 32rem at center, rgba(8, 10, 14, 0.78), transparent 70%)',
        }}
      />

      {/* Film-strip top rule — reel metadata, matches home register.
          Hidden below md so the mobile slim header (rendered by
          AuthSplitLayout) carries the brand anchor instead. */}
      <div className="absolute inset-x-0 top-0 z-[4] hidden items-center justify-between border-b border-white/[0.08] px-6 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white/55 md:flex">
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className="amb-pulse-dot h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: scene.accent }}
          />
          Reel 000 · Onboarding
        </span>
        <span className="hidden lg:inline">4 scenes · 17s loop · 16:9 · H.264</span>
        <span>Ctrl {String(active + 1).padStart(2, '0')} / 04</span>
      </div>

      {/* Film-strip bottom rule — production stamp. Hidden below md. */}
      <div className="absolute inset-x-0 bottom-0 z-[4] hidden items-center justify-between border-t border-white/[0.08] px-6 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white/45 md:flex">
        <span>Brief → Lottie in 46.4s</span>
        <span className="hidden lg:inline">{scene.meta} · Inter Bold</span>
        <span>Iterate in &lt; 1s · MP4 / .lottie / SVG</span>
      </div>

      {/* Scene-progress dots — bottom-center, advisory only. Visible on
          every breakpoint as a subtle "auto-play" cue. */}
      <div className="absolute bottom-4 left-1/2 z-[4] flex -translate-x-1/2 gap-1.5 md:bottom-12">
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

/**
 * HeroFigure — stylized super-hero silhouette. Pure SVG, no asset
 * dependency. The pose determines the body composition; the accent
 * colors the cape so the figure matches the on-screen scene tint.
 */
function HeroFigure({ pose, accent }: { pose: Pose; accent: string }) {
  // Cape carries the scene accent; body is a darker tint of the same
  // accent. Together they read as a 2-tone silhouette against the dark
  // "stage" canvas. Kept low-opacity at the wrapper so the figure
  // suggests a cast member rather than competing with the form card.
  const cape = `color-mix(in srgb, ${accent} 80%, transparent)`;
  const body = `color-mix(in srgb, ${accent} 30%, #0e1014)`;
  const trim = `color-mix(in srgb, ${accent} 60%, white 25%)`;

  return (
    <svg
      viewBox="0 0 200 320"
      role="img"
      aria-hidden="true"
      className="h-full w-full opacity-40"
      style={{ filter: `drop-shadow(0 16px 24px color-mix(in srgb, ${accent} 35%, transparent))` }}
    >
      {pose === 'power' && (
        <g>
          <path
            className="amb-cape"
            d="M55 70 Q20 130 35 250 Q70 240 100 250 Q130 240 165 250 Q180 130 145 70 Z"
            fill={cape}
            opacity="0.85"
          />
          <circle cx="100" cy="55" r="22" fill={body} />
          <path d="M78 80 L122 80 L130 200 L70 200 Z" fill={body} />
          <rect x="92" y="80" width="16" height="60" fill={trim} opacity="0.7" />
          <rect x="60" y="92" width="22" height="18" rx="4" fill={body} />
          <rect x="118" y="92" width="22" height="18" rx="4" fill={body} />
          <rect x="74" y="200" width="20" height="100" rx="5" fill={body} />
          <rect x="106" y="200" width="20" height="100" rx="5" fill={body} />
        </g>
      )}

      {pose === 'flight' && (
        <g transform="rotate(-12 100 160)">
          <path
            className="amb-cape"
            d="M80 80 Q 20 110 -10 180 Q 40 175 90 165 Q 130 150 160 130 Q 145 95 110 78 Z"
            fill={cape}
            opacity="0.9"
          />
          <ellipse cx="148" cy="120" rx="22" ry="20" fill={body} />
          <path d="M72 130 L150 110 L160 150 L82 168 Z" fill={body} />
          <rect x="100" y="115" width="36" height="14" fill={trim} opacity="0.65" />
          <path d="M150 110 L195 96 L200 110 L155 124 Z" fill={body} />
          <path d="M70 138 Q 40 150 14 158 L 18 174 Q 48 168 76 158 Z" fill={body} />
          <path d="M82 165 L 70 245 L 90 248 L 108 168 Z" fill={body} />
          <path d="M100 168 L 100 250 L 122 250 L 130 170 Z" fill={body} />
        </g>
      )}

      {pose === 'leap' && (
        <g>
          <path
            className="amb-cape"
            d="M50 90 Q10 150 30 240 Q70 220 100 230 Q130 220 170 240 Q190 150 150 90 Z"
            fill={cape}
            opacity="0.85"
          />
          <circle cx="100" cy="50" r="20" fill={body} />
          <path d="M82 75 L118 75 L128 180 L72 180 Z" fill={body} />
          <rect x="92" y="80" width="16" height="55" fill={trim} opacity="0.7" />
          <path d="M82 80 L62 18 L80 14 L96 78 Z" fill={body} />
          <path d="M118 80 L138 18 L120 14 L104 78 Z" fill={body} />
          <path d="M76 180 L 50 260 L 70 270 L 96 188 Z" fill={body} />
          <path d="M104 188 L130 270 L150 260 L124 180 Z" fill={body} />
        </g>
      )}

      {pose === 'hover' && (
        <g>
          <path
            className="amb-cape"
            d="M60 75 Q15 135 35 245 Q70 235 100 240 Q130 235 165 245 Q185 135 140 75 Z"
            fill={cape}
            opacity="0.8"
          />
          <circle cx="100" cy="55" r="22" fill={body} />
          <path d="M78 80 L122 80 L132 195 L68 195 Z" fill={body} />
          <rect x="92" y="80" width="16" height="60" fill={trim} opacity="0.65" />
          <path d="M78 92 Q60 130 78 168 L96 168 L96 96 Z" fill={body} />
          <path d="M122 92 Q140 130 122 168 L104 168 L104 96 Z" fill={body} />
          <rect x="78" y="195" width="20" height="90" rx="5" fill={body} />
          <rect x="102" y="195" width="20" height="90" rx="5" fill={body} />
          <ellipse cx="100" cy="305" rx="56" ry="8" fill={accent} opacity="0.18" />
        </g>
      )}
    </svg>
  );
}
