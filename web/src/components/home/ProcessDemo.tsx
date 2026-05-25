'use client';

import { motion, AnimatePresence } from 'framer-motion';
import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import {
  Bot,
  Check,
  Clock,
  DollarSign,
  Download,
  FileJson,
  Film,
  Mic,
  Package,
  Pencil,
  Play,
  Sparkles,
  User,
} from 'lucide-react';

/**
 * Real Lottie player — dynamically imported so the ~80 kB
 * lottie-web bundle doesn't block first paint of the hero. The
 * player only mounts when the preview phase becomes active.
 */
const Lottie = dynamic(() => import('lottie-react').then((m) => m.default), {
  ssr: false,
  loading: () => null,
});

/** Real preset Lotties served from web/public. Pick one to play in
 *  the preview phase — randomised per loop so repeat visitors don't
 *  see the same clip every time. */
const PREVIEW_LOTTIE_URLS = [
  '/lottie/corporate.json',
  '/lottie/playful.json',
  '/lottie/minimalist.json',
];

/**
 * Self-running hero animation that explains the motion-forge loop.
 *
 * Design register — modeled on Linear / Vercel / Cursor / Lovable:
 * no browser-window chrome, no fake filenames, no skeuomorphic
 * traffic-light dots. The component reads as "the product itself,
 * mid-action" rather than a mockup of the product.
 *
 * Five phases, derived from a single ticking clock so the loop is
 * immune to React StrictMode double-mounts, HMR re-runs, and
 * background-tab interval throttling:
 *
 *   1. brief     — typewriter scripts a tight 3-line storyboard
 *   2. cast      — real provider logos + lucide icons fade in
 *   3. generate  — sparkle + stage label + brand-emerald progress
 *   4. preview   — a real Lottie-shaped composition plays
 *   5. export    — three format chips light up in sequence
 *
 * Total loop: 16 s. No setTimeouts.
 */

type Phase = 'brief' | 'cast' | 'generate' | 'preview' | 'export';

const PHASES: { id: Phase; label: string; icon: typeof Pencil }[] = [
  { id: 'brief', label: 'Brief', icon: Pencil },
  { id: 'cast', label: 'Cast', icon: User },
  { id: 'generate', label: 'Generate', icon: Sparkles },
  { id: 'preview', label: 'Preview', icon: Play },
  { id: 'export', label: 'Export', icon: Download },
];

const BRIEF_LINES = [
  '1.0  Your company claims SR&ED credits every year.',
  '2.0  What if it could be done in 20 minutes,',
  '3.0  …and at one-tenth the cost?',
];
const BRIEF_FULL = BRIEF_LINES.join('\n');

type CastMember =
  | { kind: 'person'; id: string; label: string }
  | { kind: 'mascot'; id: string; label: string }
  | { kind: 'icon'; id: string; label: string; Icon: typeof DollarSign }
  | { kind: 'logo'; id: string; label: string; svg: string };

const CAST: CastMember[] = [
  { kind: 'person', id: 'alex', label: 'Alex' },
  { kind: 'mascot', id: 'lucius', label: 'Lucius' },
  { kind: 'logo', id: 'github', label: 'GitHub', svg: '/themes/integrations/github.svg' },
  { kind: 'logo', id: 'slack', label: 'Slack', svg: '/themes/integrations/slack.svg' },
  { kind: 'logo', id: 'linear', label: 'Linear', svg: '/themes/integrations/linear.svg' },
  { kind: 'icon', id: 'clock', label: 'Clock', Icon: Clock },
  { kind: 'icon', id: 'dollar', label: 'Budget', Icon: DollarSign },
];

const GENERATE_STAGES = [
  'Reading the brief',
  'Casting characters',
  'Composing scene 6 / 21',
  'Composing scene 14 / 21',
  'Polishing motion',
];

const EXPORT_FORMATS = [
  { id: 'mp4', label: 'MP4', icon: Film },
  { id: 'lottie', label: '.lottie', icon: FileJson },
  { id: 'pack', label: 'pack', icon: Package },
] as const;

const PHASE_STARTS: Record<Phase, number> = {
  brief: 0,
  cast: 3500,
  generate: 6500,
  preview: 9500,
  export: 13000,
};
const LOOP_MS = 16000;

/* ------------------------------------------------------------------ */

export function ProcessDemo() {
  const [phase, setPhase] = useState<Phase>('brief');
  const [typedChars, setTypedChars] = useState(0);
  const [castCount, setCastCount] = useState(0);
  const [genProgress, setGenProgress] = useState(0);
  const [genStage, setGenStage] = useState(0);
  const [exportDone, setExportDone] = useState<Set<number>>(new Set());
  const [previewIdx, setPreviewIdx] = useState(0);
  const [lottieData, setLottieData] = useState<Record<string, unknown> | null>(
    null,
  );

  // Preload all 3 preset Lotties once so the preview phase has zero
  // network latency when it activates.
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      PREVIEW_LOTTIE_URLS.map((u) =>
        fetch(u, { cache: 'force-cache' })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ),
    ).then((all) => {
      if (cancelled) return;
      const first = all.find(Boolean);
      if (first) setLottieData(first);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const started = Date.now();
    const tick = () => {
      const elapsed = (Date.now() - started) % LOOP_MS;
      let p: Phase = 'brief';
      if (elapsed >= PHASE_STARTS.export) p = 'export';
      else if (elapsed >= PHASE_STARTS.preview) p = 'preview';
      else if (elapsed >= PHASE_STARTS.generate) p = 'generate';
      else if (elapsed >= PHASE_STARTS.cast) p = 'cast';
      setPhase(p);

      // Brief: ~1.5s of typing inside the brief phase
      if (p === 'brief') {
        setTypedChars(Math.min(BRIEF_FULL.length, Math.floor(elapsed / 13)));
      } else {
        setTypedChars(BRIEF_FULL.length);
      }

      // Cast: chips appear 220ms apart
      if (p === 'cast' || p === 'generate' || p === 'preview' || p === 'export') {
        const castT = Math.max(0, elapsed - PHASE_STARTS.cast - 150);
        setCastCount(Math.min(CAST.length, Math.floor(castT / 220) + 1));
      } else {
        setCastCount(0);
      }

      // Generate: progress + stage
      if (p === 'generate') {
        const genT = elapsed - PHASE_STARTS.generate;
        const prog = Math.min(100, Math.round((genT / 2800) * 100));
        setGenProgress(prog);
        setGenStage(Math.min(GENERATE_STAGES.length - 1, Math.floor(prog / 22)));
      } else if (p === 'preview' || p === 'export') {
        setGenProgress(100);
        setGenStage(GENERATE_STAGES.length - 1);
      } else {
        setGenProgress(0);
        setGenStage(0);
      }

      // Export: pills check in sequence
      if (p === 'export') {
        const expT = elapsed - PHASE_STARTS.export;
        const done = new Set<number>();
        for (let i = 0; i < EXPORT_FORMATS.length; i++) {
          if (expT > i * 700 + 350) done.add(i);
        }
        setExportDone(done);
      } else {
        setExportDone(new Set());
      }

      // Cycle the preview preset on each new loop so repeat visitors
      // see different real Lotties (corporate / playful / minimalist).
      const cycle = Math.floor((Date.now() - started) / LOOP_MS);
      const idx = cycle % PREVIEW_LOTTIE_URLS.length;
      if (idx !== previewIdx) {
        setPreviewIdx(idx);
        fetch(PREVIEW_LOTTIE_URLS[idx], { cache: 'force-cache' })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => d && setLottieData(d))
          .catch(() => undefined);
      }
    };

    tick();
    const id = setInterval(tick, 80);
    return () => clearInterval(id);
  }, []);

  const phaseIndex = PHASES.findIndex((p) => p.id === phase);

  return (
    <section
      aria-label="motion-forge process demo"
      className="mx-auto w-full max-w-3xl"
    >
      {/* Phase rail */}
      <div className="mb-6 flex items-center justify-center gap-1.5 sm:gap-2">
        {PHASES.map((p, i) => {
          const isActive = i === phaseIndex;
          const isDone = i < phaseIndex;
          const Icon = p.icon;
          return (
            <div key={p.id} className="flex items-center gap-1.5 sm:gap-2">
              <motion.div
                animate={{
                  scale: isActive ? 1.05 : 1,
                  backgroundColor: isActive
                    ? 'var(--color-accent-700)'
                    : isDone
                      ? 'var(--color-accent-100)'
                      : 'var(--color-bg-secondary)',
                  color: isActive
                    ? '#ffffff'
                    : isDone
                      ? 'var(--color-accent-700)'
                      : 'var(--color-text-tertiary)',
                }}
                transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
                className="flex items-center gap-1.5 rounded-full border border-border-light px-2.5 py-1 text-2xs font-medium sm:px-3 sm:py-1.5 sm:text-xs"
              >
                {isDone ? <Check className="h-3 w-3" /> : <Icon className="h-3 w-3" />}
                <span className="hidden sm:inline">{p.label}</span>
              </motion.div>
              {i < PHASES.length - 1 && (
                <div className="h-px w-3 bg-border-light sm:w-6" aria-hidden />
              )}
            </div>
          );
        })}
      </div>

      {/* Canvas */}
      <div className="relative overflow-hidden rounded-3xl border border-border-light bg-bg-primary shadow-card">
        {/* Ambient gradient that shifts per phase — gives the surface "presence" without competing with content */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -inset-px"
          animate={{
            background:
              phase === 'preview'
                ? 'radial-gradient(120% 60% at 50% 0%, color-mix(in oklab, var(--color-accent-500) 14%, transparent), transparent 70%)'
                : phase === 'export'
                  ? 'radial-gradient(120% 60% at 50% 100%, color-mix(in oklab, var(--color-accent-500) 12%, transparent), transparent 70%)'
                  : 'radial-gradient(120% 60% at 50% 50%, color-mix(in oklab, var(--color-accent-500) 6%, transparent), transparent 70%)',
          }}
          transition={{ duration: 0.6 }}
        />

        <div className="relative min-h-[340px] sm:min-h-[380px]">
          <AnimatePresence mode="wait">
            {phase === 'brief' && (
              <motion.div
                key="brief"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                className="absolute inset-0 flex flex-col gap-4 p-7 sm:p-9"
              >
                <div className="flex items-center gap-2 text-2xs uppercase tracking-wider text-text-tertiary">
                  <Mic className="h-3 w-3" /> dictate · paste · type
                </div>
                <pre className="flex-1 whitespace-pre-wrap font-mono text-sm leading-relaxed text-text-primary">
                  {BRIEF_FULL.slice(0, typedChars)}
                  <motion.span
                    aria-hidden
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 0.9, repeat: Infinity }}
                    className="inline-block w-[2px] -mb-0.5 ml-0.5 bg-accent-700 align-baseline"
                    style={{ height: '1.05em' }}
                  />
                </pre>
              </motion.div>
            )}

            {phase === 'cast' && (
              <motion.div
                key="cast"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                className="absolute inset-0 flex flex-col gap-5 p-7 sm:p-9"
              >
                <div className="flex items-center gap-2 text-2xs uppercase tracking-wider text-text-tertiary">
                  <User className="h-3 w-3" /> cast roster · referenced by name in the brief
                </div>
                <div className="flex flex-wrap gap-2.5">
                  {CAST.map((m, i) => (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, y: 8, scale: 0.94 }}
                      animate={
                        i < castCount
                          ? { opacity: 1, y: 0, scale: 1 }
                          : { opacity: 0, y: 8, scale: 0.94 }
                      }
                      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                      className="flex items-center gap-2 rounded-full border border-border-light bg-bg-primary px-3 py-1.5 text-sm text-text-primary shadow-soft"
                    >
                      <CastIcon member={m} />
                      <span className="font-medium">{m.label}</span>
                      <span className="font-mono text-2xs text-text-tertiary">
                        @{m.id}
                      </span>
                    </motion.div>
                  ))}
                </div>
                <p className="mt-auto text-xs text-text-secondary">
                  The orchestrator threads them into every scene that mentions
                  them — same character, every shot.
                </p>
              </motion.div>
            )}

            {phase === 'generate' && (
              <motion.div
                key="generate"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-7 p-9 text-center"
              >
                <motion.div
                  aria-hidden
                  animate={{ rotate: 360 }}
                  transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
                  className="text-accent-700"
                >
                  <Sparkles className="h-9 w-9" strokeWidth={1.5} />
                </motion.div>

                <AnimatePresence mode="wait">
                  <motion.p
                    key={genStage}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.18 }}
                    className="font-mono text-sm text-text-secondary"
                  >
                    {GENERATE_STAGES[genStage]}
                    <motion.span
                      animate={{ opacity: [0.4, 1, 0.4] }}
                      transition={{ duration: 1.2, repeat: Infinity }}
                    >
                      …
                    </motion.span>
                  </motion.p>
                </AnimatePresence>

                <div className="h-[3px] w-64 max-w-[80%] overflow-hidden rounded-full bg-border-light">
                  <motion.div
                    className="h-full rounded-full bg-accent-700"
                    initial={{ width: 0 }}
                    animate={{ width: `${genProgress}%` }}
                    transition={{ duration: 0.08, ease: 'linear' }}
                  />
                </div>

                <p className="font-mono text-2xs uppercase tracking-wider text-text-tertiary">
                  21 scenes · 90 s p50 · streaming
                </p>
              </motion.div>
            )}

            {phase === 'preview' && (
              <motion.div
                key="preview"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                className="absolute inset-0 flex items-center justify-center p-7"
              >
                <PreviewStage
                  lottieData={lottieData}
                  presetLabel={
                    ['corporate', 'playful', 'minimalist'][previewIdx] ?? ''
                  }
                />
              </motion.div>
            )}

            {phase === 'export' && (
              <motion.div
                key="export"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-7 p-9"
              >
                <p className="font-mono text-2xs uppercase tracking-wider text-text-tertiary">
                  one generate · three deliverables
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  {EXPORT_FORMATS.map((f, i) => {
                    const Icon = f.icon;
                    const isDone = exportDone.has(i);
                    return (
                      <motion.div
                        key={f.id}
                        animate={{
                          borderColor: isDone
                            ? 'var(--color-accent-500)'
                            : 'var(--color-border-light)',
                          backgroundColor: isDone
                            ? 'var(--color-accent-50)'
                            : 'var(--color-bg-primary)',
                        }}
                        transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                        className="flex min-w-[120px] items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium text-text-primary shadow-soft"
                      >
                        <AnimatePresence mode="wait">
                          {isDone ? (
                            <motion.span
                              key="done"
                              initial={{ scale: 0, rotate: -90 }}
                              animate={{ scale: 1, rotate: 0 }}
                              transition={{
                                type: 'spring',
                                stiffness: 500,
                                damping: 22,
                              }}
                              className="text-accent-700"
                            >
                              <Check className="h-4 w-4" strokeWidth={2.5} />
                            </motion.span>
                          ) : (
                            <motion.span
                              key="idle"
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              className="text-text-tertiary"
                            >
                              <Icon className="h-4 w-4" />
                            </motion.span>
                          )}
                        </AnimatePresence>
                        {f.label}
                      </motion.div>
                    );
                  })}
                </div>
                <p className="max-w-md text-center text-xs text-text-secondary">
                  One video, every format your channels need. Ship the
                  master plus each scene separately if your designers
                  want to recut.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------- helpers */

function CastIcon({ member }: { member: CastMember }) {
  if (member.kind === 'person') {
    return (
      <span className="grid h-6 w-6 place-items-center rounded-full bg-accent-100 text-accent-700">
        <User className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
    );
  }
  if (member.kind === 'mascot') {
    return (
      <span className="grid h-6 w-6 place-items-center rounded-full bg-secondary-100 text-secondary-700">
        <Bot className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
    );
  }
  if (member.kind === 'icon') {
    const Icon = member.Icon;
    return (
      <span className="grid h-6 w-6 place-items-center rounded-full bg-bg-secondary text-text-secondary">
        <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
    );
  }
  // logo (real provider SVG)
  return (
    <span className="grid h-6 w-6 place-items-center rounded-full bg-bg-secondary text-text-primary">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={member.svg} alt="" className="h-3.5 w-3.5" />
    </span>
  );
}

/* Preview stage — plays a REAL Lottie from the preset library. The
 * three preset JSONs in /public/lottie are full motion-design
 * compositions produced by the actual motion-forge pipeline, so the
 * demo shows the output the tool ships — not a mock of it.
 *
 * We dynamic-import lottie-react and only mount the player when the
 * data is loaded; on the first 1-2 cycles the player may still be
 * fetching, so a thin "Loading preview…" placeholder fills the
 * frame. */
function PreviewStage({
  lottieData,
  presetLabel,
}: {
  lottieData: Record<string, unknown> | null;
  presetLabel: string;
}) {
  return (
    <div className="relative aspect-video w-full max-w-md overflow-hidden rounded-2xl bg-primary-900 shadow-lift">
      {/* Brand-tint radial backdrop */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'radial-gradient(circle at 15% 30%, rgba(52, 211, 153, 0.35) 0, transparent 35%), radial-gradient(circle at 85% 70%, rgba(245, 158, 11, 0.18) 0, transparent 38%)',
        }}
      />

      {/* The actual Lottie composition */}
      <div className="absolute inset-0 flex items-center justify-center">
        {lottieData ? (
          <Lottie
            animationData={lottieData}
            loop
            autoplay
            rendererSettings={{ preserveAspectRatio: 'xMidYMid meet' }}
            style={{ width: '100%', height: '100%' }}
          />
        ) : (
          <div className="font-mono text-2xs text-white/40">
            loading preview…
          </div>
        )}
      </div>

      {/* Transport-bar overlays */}
      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-black/35 px-2.5 py-1 font-mono text-2xs text-white/90 backdrop-blur-sm">
        <Play className="h-3 w-3 fill-white/90" strokeWidth={0} />
        00:08 · 01:00
      </div>
      <div className="absolute bottom-3 right-3 flex items-center gap-1.5 font-mono text-2xs text-white/55">
        <span>{presetLabel}</span>
        <span className="opacity-50">·</span>
        <span>1920×1080</span>
      </div>
    </div>
  );
}
