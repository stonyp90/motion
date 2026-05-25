'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import {
  Check,
  Download,
  FileText,
  Film,
  Loader2,
  Mic,
  Package,
  Pencil,
  Play,
  Sparkles,
  Users,
} from 'lucide-react';

/**
 * Self-running, looping process demo for the home page.
 *
 * Modeled on Tablix's AnimatedDemo — a unified "browser-window" card
 * with a traffic-light header, a phase-status pill, and per-phase
 * content swapped via AnimatePresence. The phases mirror the
 * motion-forge customer journey, end-to-end, in about 16 seconds:
 *
 *   1. brief     — typewriter-script of a 21-scene storyboard
 *   2. cast      — character chips materialize one by one
 *   3. generate  — sparkle + cycling stage labels + progress
 *   4. preview   — abstract Lottie-style shape composition plays
 *   5. export    — three export pills light up sequentially
 *
 * Anonymous visitors see this under the sign-in gate so they
 * understand the loop they're buying into before authenticating.
 */

type Phase = 'brief' | 'cast' | 'generate' | 'preview' | 'export';

const BRIEF_LINES = [
  '1.0 Your company claim SR&ED credits every year.',
  '   Visual: a building rises out of fog, SR&ED bubbles float up.',
  '',
  '2.0 What if you could do it faster',
  '   Visual: change of scene; FASTER appears bold on screen.',
  '',
  '3.0 ...and at half the cost?',
  '   Visual: same plane, HALF THE COST pops as a bubble.',
];

const CAST_MEMBERS = [
  { id: 'alex', label: 'Alex', kind: 'person' },
  { id: 'lucius', label: 'Lucius', kind: 'mascot' },
  { id: 'office', label: 'Office worker', kind: 'person' },
  { id: 'github', label: 'GitHub', kind: 'logo' },
  { id: 'slack', label: 'Slack', kind: 'logo' },
  { id: 'dollar', label: '$', kind: 'icon' },
];

const GENERATE_STAGES = [
  'Reading the brief…',
  'Casting characters…',
  'Composing scene 1 of 21…',
  'Composing scene 12 of 21…',
  'Polishing motion…',
];

const EXPORT_FORMATS = [
  { id: 'mp4', label: 'MP4', icon: Film },
  { id: 'lottie', label: '.lottie', icon: FileText },
  { id: 'pack', label: 'pack', icon: Package },
] as const;

/** Animation timing multiplier — bump to slow the whole loop. */
const T = (ms: number) => ms;

/** Stable at module scope — joining inside the component triggers a fresh
 *  string identity each render, which destabilises useEffect deps and
 *  causes the loop to restart every typewriter tick. */
const BRIEF_FULL = BRIEF_LINES.join('\n');

export function ProcessDemo() {
  const [phase, setPhase] = useState<Phase>('brief');
  const [typedChars, setTypedChars] = useState(0);
  const [castCount, setCastCount] = useState(0);
  const [genProgress, setGenProgress] = useState(0);
  const [genStage, setGenStage] = useState(0);
  const [exportPicked, setExportPicked] = useState<number | null>(null);
  const [exportDone, setExportDone] = useState<Set<number>>(new Set());

  // Single tick-based state machine. We poll the wall clock every
  // 100ms and derive every visible state from elapsed-mod-cycle time.
  // This is robust against React StrictMode double-mounts, HMR,
  // background-tab throttling, and chained-setTimeout drift — there
  // are no setTimeouts to misfire. The whole loop is one interval.
  useEffect(() => {
    const LOOP_MS = 18500;
    const PHASE_STARTS: Record<Phase, number> = {
      brief: 0,
      cast: 4000,
      generate: 7000,
      preview: 10500,
      export: 14500,
    };
    const started = Date.now();

    const tick = () => {
      const elapsed = (Date.now() - started) % LOOP_MS;

      // Phase
      let p: Phase = 'brief';
      if (elapsed >= PHASE_STARTS.export) p = 'export';
      else if (elapsed >= PHASE_STARTS.preview) p = 'preview';
      else if (elapsed >= PHASE_STARTS.generate) p = 'generate';
      else if (elapsed >= PHASE_STARTS.cast) p = 'cast';
      setPhase(p);

      // Brief typewriter — ~0.9 s of typing inside the brief phase
      if (p === 'brief') {
        const briefT = elapsed - PHASE_STARTS.brief;
        setTypedChars(Math.min(BRIEF_FULL.length, Math.floor(briefT / 13)));
      } else {
        setTypedChars(BRIEF_FULL.length);
      }

      // Cast count — chips materialize 280ms apart
      if (p === 'cast' || p === 'generate' || p === 'preview' || p === 'export') {
        const castT = Math.max(0, elapsed - PHASE_STARTS.cast - 200);
        setCastCount(Math.min(CAST_MEMBERS.length, Math.floor(castT / 280) + 1));
      } else {
        setCastCount(0);
      }

      // Generate progress + stage
      if (p === 'generate') {
        const genT = elapsed - PHASE_STARTS.generate;
        const prog = Math.min(100, Math.round((genT / 3000) * 100));
        setGenProgress(prog);
        setGenStage(Math.min(GENERATE_STAGES.length - 1, Math.floor(prog / 22)));
      } else if (p === 'preview' || p === 'export') {
        setGenProgress(100);
        setGenStage(GENERATE_STAGES.length - 1);
      } else {
        setGenProgress(0);
        setGenStage(0);
      }

      // Export picks
      if (p === 'export') {
        const expT = elapsed - PHASE_STARTS.export;
        const idx = Math.floor(expT / 600);
        setExportPicked(Math.min(EXPORT_FORMATS.length - 1, idx));
        const done = new Set<number>();
        for (let i = 0; i < Math.min(EXPORT_FORMATS.length, idx); i++) done.add(i);
        if (expT > (EXPORT_FORMATS.length - 1) * 600 + 400) done.add(EXPORT_FORMATS.length - 1);
        setExportDone(done);
      } else {
        setExportPicked(null);
        setExportDone(new Set());
      }
    };

    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, []);

  const statusPill = (() => {
    switch (phase) {
      case 'brief':
        return { icon: <Pencil className="h-3.5 w-3.5" />, label: 'Drafting brief' };
      case 'cast':
        return { icon: <Users className="h-3.5 w-3.5" />, label: 'Casting characters' };
      case 'generate':
        return {
          icon: (
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
            >
              <Loader2 className="h-3.5 w-3.5" />
            </motion.span>
          ),
          label: 'Generating',
        };
      case 'preview':
        return { icon: <Play className="h-3.5 w-3.5" />, label: 'Previewing' };
      case 'export':
        return { icon: <Download className="h-3.5 w-3.5" />, label: 'Exporting' };
    }
  })();

  return (
    <section
      aria-label="motion-forge process demo"
      className="mx-auto w-full max-w-2xl"
    >
      <div className="overflow-hidden rounded-2xl border border-border-light bg-bg-primary shadow-card">
        {/* Browser-window header */}
        <div className="flex items-center justify-between border-b border-border-light bg-bg-secondary px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <div className="h-2.5 w-2.5 rounded-full bg-red-400" />
              <div className="h-2.5 w-2.5 rounded-full bg-secondary-400" />
              <div className="h-2.5 w-2.5 rounded-full bg-accent-500" />
            </div>
            <div className="flex items-center gap-2 font-mono text-xs text-text-secondary">
              <Sparkles className="h-3.5 w-3.5 text-accent-600" />
              <span>motion-forge · 60s explainer</span>
            </div>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={phase}
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
              className="flex items-center gap-1.5 rounded-full bg-accent-50 px-3 py-1.5 text-xs font-medium text-accent-700"
            >
              {statusPill.icon}
              {statusPill.label}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Phase canvas */}
        <div className="relative min-h-[300px] sm:min-h-[340px] overflow-hidden">
          <AnimatePresence mode="wait">
            {phase === 'brief' && (
              <motion.div
                key="brief"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="absolute inset-0 p-5"
              >
                <div className="flex items-center gap-2 pb-3 text-2xs uppercase tracking-wider text-text-tertiary">
                  <Mic className="h-3 w-3" /> mic · paste · type
                </div>
                <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-text-secondary">
                  {BRIEF_FULL.slice(0, typedChars)}
                  <motion.span
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 0.9, repeat: Infinity }}
                    className="inline-block w-[6px] -mb-0.5 ml-0.5 bg-accent-600"
                    style={{ height: '0.95rem' }}
                  />
                </pre>
              </motion.div>
            )}

            {phase === 'cast' && (
              <motion.div
                key="cast"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="absolute inset-0 p-5"
              >
                <div className="flex items-center gap-2 pb-3 text-2xs uppercase tracking-wider text-text-tertiary">
                  <Users className="h-3 w-3" /> cast roster
                </div>
                <div className="flex flex-wrap gap-2">
                  {CAST_MEMBERS.map((m, i) => (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, y: 8, scale: 0.96 }}
                      animate={
                        i < castCount
                          ? { opacity: 1, y: 0, scale: 1 }
                          : { opacity: 0, y: 8, scale: 0.96 }
                      }
                      transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                      className="flex items-center gap-2 rounded-full border border-border-light bg-bg-secondary px-3 py-1.5 text-xs font-medium text-text-primary"
                    >
                      <span
                        aria-hidden
                        className={`grid h-5 w-5 place-items-center rounded-full text-2xs font-bold ${
                          m.kind === 'logo'
                            ? 'bg-primary-900 text-text-inverse'
                            : m.kind === 'mascot'
                              ? 'bg-secondary-400 text-text-inverse'
                              : m.kind === 'icon'
                                ? 'bg-accent-100 text-accent-700'
                                : 'bg-accent-500 text-white'
                        }`}
                      >
                        {m.label.charAt(0)}
                      </span>
                      {m.label}
                    </motion.div>
                  ))}
                </div>
                <p className="pt-6 text-2xs text-text-tertiary">
                  Reference them by name in the brief —{' '}
                  <span className="font-mono text-text-secondary">@Lucius</span> in scene 12,{' '}
                  <span className="font-mono text-text-secondary">@Office worker</span> in scene 4.
                </p>
              </motion.div>
            )}

            {phase === 'generate' && (
              <motion.div
                key="generate"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-8 text-center"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
                  className="text-accent-600"
                >
                  <Sparkles className="h-10 w-10" />
                </motion.div>

                <AnimatePresence mode="wait">
                  <motion.p
                    key={genStage}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.22 }}
                    className="font-mono text-sm text-text-secondary"
                  >
                    {GENERATE_STAGES[genStage]}
                  </motion.p>
                </AnimatePresence>

                <div className="h-1 w-64 max-w-[80%] overflow-hidden rounded-full bg-bg-tertiary">
                  <motion.div
                    className="h-full bg-accent-600"
                    initial={{ width: 0 }}
                    animate={{ width: `${genProgress}%` }}
                    transition={{ duration: 0.1, ease: 'linear' }}
                  />
                </div>

                <p className="font-mono text-2xs text-text-tertiary">
                  Ollama llava · 21 scenes · 90 s p50
                </p>
              </motion.div>
            )}

            {phase === 'preview' && (
              <motion.div
                key="preview"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="absolute inset-0 flex items-center justify-center p-5"
              >
                <div className="relative aspect-video w-full max-w-md overflow-hidden rounded-xl bg-primary-900">
                  {/* Abstract Lottie-style preview: 3 morphing shapes */}
                  <motion.div
                    aria-hidden
                    className="absolute left-[15%] top-[30%] h-16 w-16 rounded-2xl bg-accent-500"
                    animate={{
                      x: [0, 40, 0],
                      y: [0, -10, 0],
                      rotate: [0, 90, 0],
                      borderRadius: ['16px', '50%', '16px'],
                    }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  <motion.div
                    aria-hidden
                    className="absolute right-[20%] top-[40%] h-12 w-12 bg-secondary-400"
                    animate={{
                      x: [0, -20, 0],
                      scale: [1, 1.3, 1],
                      rotate: [0, -45, 0],
                    }}
                    transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', delay: 0.3 }}
                    style={{ borderRadius: 6 }}
                  />
                  <motion.div
                    aria-hidden
                    className="absolute bottom-[20%] left-1/2 h-2 w-32 -translate-x-1/2 rounded-full bg-accent-400/60"
                    animate={{ scaleX: [0.4, 1, 0.4], opacity: [0.4, 1, 0.4] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  {/* Brand chip overlay */}
                  <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-black/30 px-2 py-1 font-mono text-2xs text-white backdrop-blur-sm">
                    <Play className="h-3 w-3" />
                    00:08 / 01:00
                  </div>
                  <div className="absolute bottom-3 right-3 font-mono text-2xs text-white/70">
                    1920×1080 · 30fps
                  </div>
                </div>
              </motion.div>
            )}

            {phase === 'export' && (
              <motion.div
                key="export"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="absolute inset-0 flex flex-col items-center justify-center gap-6 p-8"
              >
                <p className="font-mono text-2xs uppercase tracking-wider text-text-tertiary">
                  Pick your shipping format
                </p>
                <div className="flex flex-wrap items-center justify-center gap-3">
                  {EXPORT_FORMATS.map((f, i) => {
                    const Icon = f.icon;
                    const isPicked = exportPicked === i;
                    const isDone = exportDone.has(i);
                    return (
                      <motion.div
                        key={f.id}
                        animate={{
                          scale: isPicked ? 1.05 : 1,
                          borderColor: isDone
                            ? 'var(--color-accent-500)'
                            : isPicked
                              ? 'var(--color-accent-300)'
                              : 'var(--color-border-light)',
                        }}
                        transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                        className="flex min-w-[110px] items-center justify-center gap-2 rounded-xl border bg-bg-primary px-4 py-3 text-sm font-medium text-text-primary"
                      >
                        {isDone ? (
                          <Check className="h-4 w-4 text-accent-600" />
                        ) : (
                          <Icon className="h-4 w-4 text-text-tertiary" />
                        )}
                        {f.label}
                      </motion.div>
                    );
                  })}
                </div>
                <p className="text-center font-mono text-2xs text-text-tertiary">
                  All three from one generate · same Lottie, different containers
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer cue strip */}
        <div className="flex items-center justify-between border-t border-border-light bg-bg-secondary px-4 py-2.5 font-mono text-2xs text-text-tertiary">
          <span>
            {['brief', 'cast', 'generate', 'preview', 'export'].map((p, i) => (
              <span
                key={p}
                className={`mr-3 ${
                  p === phase
                    ? 'text-accent-700'
                    : ['brief', 'cast', 'generate', 'preview', 'export'].indexOf(phase) > i
                      ? 'text-text-secondary line-through decoration-text-tertiary/40'
                      : ''
                }`}
              >
                {i + 1}. {p}
              </span>
            ))}
          </span>
          <span>auto · 16 s loop</span>
        </div>
      </div>
    </section>
  );
}
