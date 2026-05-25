/**
 * motion-forge — motion design tokens (TypeScript mirror of motion-principles.css).
 *
 * Use these constants when you reach for Framer Motion. If you're writing CSS,
 * prefer the CSS custom properties (--dur-base, --ease-out-quart) so the same
 * source of truth governs both code paths.
 *
 * Allocation rule:
 *   60% of transitions  → easeOutQuart  (workhorse)
 *   30% of transitions  → easeSnap      (decisive)
 *   10% of transitions  → easeInQuart   (exits)
 */

/* ── Durations (ms) ────────────────────────────────────────────────────── */

export const DURATION = {
  instant: 90,   // pressed states, color shifts
  fast:    180,  // hover, focus, chip toggle
  base:    240,  // drawer slide, list reorder, panel reveal (default)
  slow:    320,  // preview reveal, large surface entry
} as const;

/** Per-child delay when staggering siblings (e.g. cast cards entering). */
export const STAGGER_MS = 30;

/* ── Easing curves (Framer Motion / WAAPI tuple form) ──────────────────── */

export const EASING = {
  /** Workhorse. Use for the vast majority of enter/respond transitions. */
  outQuart: [0.2, 0.8, 0.2, 1] as const,

  /** Snap. Toggles, tab switches, anything that should feel decisive. */
  snap: [0.12, 0, 0.08, 1] as const,

  /** Exit. Drawer close, toast dismiss. */
  inQuart: [0.55, 0, 0.85, 0.3] as const,

  /** Spring (cubic approximation). Reserved for the generate-success moment. */
  spring: [0.34, 1.56, 0.64, 1] as const,

  /** Linear. Only for indeterminate progress (shimmer, spinner). */
  linear: [0, 0, 1, 1] as const,
} as const;

/* ── Framer Motion presets ────────────────────────────────────────────── *
 * Drop-in `transition={MOTION.reveal}` on any motion.div. */

export const MOTION = {
  reveal:    { duration: DURATION.base / 1000,    ease: EASING.outQuart },
  hover:     { duration: DURATION.fast / 1000,    ease: EASING.outQuart },
  press:     { duration: DURATION.instant / 1000, ease: EASING.snap },
  drawer:    { duration: DURATION.base / 1000,    ease: EASING.outQuart },
  drawerOut: { duration: DURATION.base / 1000,    ease: EASING.inQuart  },
  toastIn:   { duration: DURATION.base / 1000,    ease: EASING.outQuart },
  toastOut:  { duration: DURATION.fast / 1000,    ease: EASING.inQuart  },
  success:   { duration: DURATION.slow / 1000,    ease: EASING.spring   },
} as const;

/* ── Variant helpers ──────────────────────────────────────────────────── */

/**
 * Vertical reveal variant. Pass `custom={index}` on each child to stagger.
 *   <motion.div variants={fadeUp} custom={i} initial="hidden" animate="visible" />
 */
export const fadeUp = {
  hidden: { opacity: 0, y: 6 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: (i * STAGGER_MS) / 1000,
      duration: DURATION.base / 1000,
      ease: EASING.outQuart,
    },
  }),
};

/** Drawer slide-in from the right. */
export const drawerRight = {
  hidden:  { x: '100%', opacity: 0 },
  visible: { x: 0,      opacity: 1, transition: MOTION.drawer },
  exit:    { x: '100%', opacity: 0, transition: MOTION.drawerOut },
};

/** Drawer slide-up from the bottom (controls drawer on mobile). */
export const drawerUp = {
  hidden:  { y: '100%', opacity: 0 },
  visible: { y: 0,      opacity: 1, transition: MOTION.drawer },
  exit:    { y: '100%', opacity: 0, transition: MOTION.drawerOut },
};

/* ── Flicker-prevention constants (Vercel pattern) ─────────────────────── */

/** Wait this long before mounting a loader — fast responses won't flash. */
export const LOADER_SHOW_DELAY_MS = 200;

/** Once a loader is visible, keep it on screen for at least this long. */
export const LOADER_MIN_VISIBLE_MS = 400;

/**
 * Hook contract: useDeferredLoadingFlag(isLoading) returns a debounced flag
 * that only flips true after LOADER_SHOW_DELAY_MS, and only flips back to
 * false after LOADER_MIN_VISIBLE_MS once it's been true. Implement once in
 * `useDeferredLoadingFlag.ts`; reuse everywhere a spinner / skeleton mounts.
 */
