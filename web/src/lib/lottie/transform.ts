/**
 * Pure functions that mutate a Lottie JSON document in place (well, on a
 * structured-cloned copy). Used by the in-browser studio to re-color, re-time,
 * and theme an animation without a server round-trip.
 *
 * The functions are intentionally lenient — Lottie has many optional fields
 * and the editor only touches the ones produced by motion-forge's emitter.
 * Unknown shapes are walked but left untouched.
 */

export type LottieJson = Record<string, unknown> & {
  v?: string;
  fr?: number;
  ip?: number;
  op?: number;
  w?: number;
  h?: number;
  layers?: LottieLayer[];
};

export type LottieLayer = Record<string, unknown> & {
  nm?: string;
  ty?: number;
  ip?: number;
  op?: number;
  st?: number;
  shapes?: LottieShape[];
  ks?: Record<string, unknown>;
};

export type LottieShape = Record<string, unknown> & {
  ty?: string;
  it?: LottieShape[];
  c?: { a?: number; k?: unknown };
  o?: { a?: number; k?: unknown };
};

export interface Recolor {
  /** Background color, applied to the layer named "background". */
  background?: [number, number, number];
  /** Accent color, applied to every non-background fill in the first shot's layers. */
  accent?: [number, number, number];
}

export interface Retime {
  /** New total duration in seconds. Original keyframe ratios are preserved. */
  durationSeconds?: number;
  /** Optional new frame rate. */
  frameRate?: number;
}

/** Deep clone via structured clone — works on any plain JSON object. */
export function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/** Convert sRGB 0–255 to Lottie's normalized 0–1 floats. */
export function rgbToLottie([r, g, b]: [number, number, number]): [number, number, number, number] {
  return [r / 255, g / 255, b / 255, 1];
}

/** Convert Lottie 0–1 back to sRGB 0–255. */
export function lottieToRgb(c: number[] | undefined): [number, number, number] {
  if (!c || c.length < 3) return [16, 16, 16];
  return [Math.round((c[0] ?? 0) * 255), Math.round((c[1] ?? 0) * 255), Math.round((c[2] ?? 0) * 255)];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const hex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const s = hex.replace('#', '').trim();
  const v = s.length === 3 ? s.split('').map((c) => c + c).join('') : s;
  return [parseInt(v.slice(0, 2), 16) || 0, parseInt(v.slice(2, 4), 16) || 0, parseInt(v.slice(4, 6), 16) || 0];
}

/** Walk every fill shape (`ty: "fl"`) and run a callback. */
function walkFills(layer: LottieLayer, cb: (fill: LottieShape, layer: LottieLayer) => void) {
  const visit = (shapes: LottieShape[] | undefined) => {
    if (!shapes) return;
    for (const shape of shapes) {
      if (shape.ty === 'fl') cb(shape, layer);
      if (Array.isArray(shape.it)) visit(shape.it);
    }
  };
  visit(layer.shapes);
}

/**
 * Apply a re-color in place. Returns the same object for fluent chaining.
 *
 * Strategy:
 *   - The background layer is identified by `nm === "background"` (the convention
 *     the motion-forge serde lottie writer follows). All its fills get `background`.
 *   - Every other fill in every other shape layer gets `accent`.
 */
export function applyRecolor(lottie: LottieJson, recolor: Recolor): LottieJson {
  const bg = recolor.background ? rgbToLottie(recolor.background) : null;
  const accent = recolor.accent ? rgbToLottie(recolor.accent) : null;
  for (const layer of lottie.layers ?? []) {
    const isBg = (layer.nm ?? '') === 'background';
    walkFills(layer, (fill) => {
      const c = fill.c as { a?: number; k?: number[] } | undefined;
      if (!c) return;
      const target = isBg ? bg : accent;
      if (!target) return;
      if (c.a === 0) {
        c.k = target as unknown as number[];
      } else if (Array.isArray(c.k)) {
        // animated — replace each keyframe's `s`/`e` arrays.
        const kfs = c.k as unknown as Array<Record<string, unknown>>;
        for (const kf of kfs) {
          if (Array.isArray(kf.s)) kf.s = target as unknown as number[];
          if (Array.isArray(kf.e)) kf.e = target as unknown as number[];
        }
      }
    });
  }
  return lottie;
}

/**
 * Re-time the animation to a new total duration (and optionally a new fps).
 * Scales every keyframe `t` and every layer's `ip` / `op` / `st` by the ratio.
 */
export function applyRetime(lottie: LottieJson, retime: Retime): LottieJson {
  const oldFr = typeof lottie.fr === 'number' && lottie.fr > 0 ? lottie.fr : 30;
  const newFr = typeof retime.frameRate === 'number' && retime.frameRate > 0 ? retime.frameRate : oldFr;
  const oldOp = typeof lottie.op === 'number' ? lottie.op : 0;
  const oldDurationSeconds = oldFr > 0 ? oldOp / oldFr : 0;
  const newDurationSeconds =
    typeof retime.durationSeconds === 'number' && retime.durationSeconds > 0
      ? retime.durationSeconds
      : oldDurationSeconds;

  if (newDurationSeconds <= 0 || oldDurationSeconds <= 0) return lottie;

  // Frame ratio combines duration change + fps change.
  const ratio = (newDurationSeconds / oldDurationSeconds) * (newFr / oldFr);

  const scaleFrame = (n: unknown): unknown => {
    if (typeof n === 'number') return Math.round(n * ratio);
    return n;
  };

  lottie.fr = newFr;
  lottie.op = Math.round(newFr * newDurationSeconds);

  for (const layer of lottie.layers ?? []) {
    if (typeof layer.ip === 'number') layer.ip = Math.max(0, scaleFrame(layer.ip) as number);
    if (typeof layer.op === 'number') layer.op = Math.max(1, scaleFrame(layer.op) as number);
    if (typeof layer.st === 'number') layer.st = scaleFrame(layer.st) as number;

    const ks = layer.ks as Record<string, unknown> | undefined;
    if (!ks) continue;
    for (const propName of Object.keys(ks)) {
      const prop = ks[propName] as { a?: number; k?: unknown };
      if (!prop || prop.a !== 1) continue;
      const keyframes = prop.k as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(keyframes)) continue;
      for (const kf of keyframes) {
        if (typeof kf.t === 'number') kf.t = scaleFrame(kf.t);
      }
    }
  }
  return lottie;
}

/** Detect the current dominant accent color (first non-bg fill). Used to seed the picker. */
export function detectAccentColor(lottie: LottieJson): [number, number, number] {
  for (const layer of lottie.layers ?? []) {
    if ((layer.nm ?? '') === 'background') continue;
    let found: [number, number, number] | null = null;
    walkFills(layer, (fill) => {
      if (found) return;
      const c = fill.c as { a?: number; k?: unknown } | undefined;
      if (!c) return;
      if (c.a === 0 && Array.isArray(c.k)) {
        found = lottieToRgb(c.k as number[]);
      } else if (Array.isArray(c.k) && c.k.length > 0) {
        const first = c.k[0] as Record<string, unknown>;
        if (Array.isArray(first.s)) found = lottieToRgb(first.s as number[]);
      }
    });
    if (found) return found;
  }
  return [16, 185, 129];
}

/** Detect the background color (first fill of the layer named "background"). */
export function detectBackgroundColor(lottie: LottieJson): [number, number, number] {
  for (const layer of lottie.layers ?? []) {
    if ((layer.nm ?? '') !== 'background') continue;
    let found: [number, number, number] | null = null;
    walkFills(layer, (fill) => {
      if (found) return;
      const c = fill.c as { a?: number; k?: unknown } | undefined;
      if (c && Array.isArray(c.k)) found = lottieToRgb(c.k as number[]);
    });
    if (found) return found;
  }
  return [11, 20, 55];
}

export function durationSeconds(lottie: LottieJson): number {
  const op = typeof lottie.op === 'number' ? lottie.op : 0;
  const fr = typeof lottie.fr === 'number' && lottie.fr > 0 ? lottie.fr : 30;
  return op / fr;
}

export function downloadJson(lottie: LottieJson, filename: string): void {
  const blob = new Blob([JSON.stringify(lottie)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Lightweight per-layer summary used by the studio's LayersPanel.
 * Pulled out of LottieLayer so the panel can render without dragging
 * the whole layer payload through React state on every selection.
 */
export interface LayerSummary {
  index: number;
  name: string;
  /** Lottie layer type: 1=solid, 2=image, 3=null, 4=shape, 5=text, etc. */
  type: number;
  hidden: boolean;
  locked: boolean;
  isBackground: boolean;
}

/**
 * Lottie uses `hd: true` on a layer to hide it, and an undeclared
 * convention for lock — motion-forge stamps `_locked: true` so the
 * client editor has somewhere to remember the lock state.
 */
export function summarizeLayers(lottie: LottieJson | null): LayerSummary[] {
  if (!lottie?.layers) return [];
  return lottie.layers.map((layer, index) => ({
    index,
    name: (layer.nm as string | undefined) ?? `layer ${index + 1}`,
    type: (layer.ty as number | undefined) ?? 4,
    hidden: Boolean((layer as Record<string, unknown>).hd),
    locked: Boolean((layer as Record<string, unknown>)._locked),
    isBackground: ((layer.nm as string | undefined) ?? '') === 'background',
  }));
}

/**
 * Flip the `hd` field on a layer. The Lottie spec treats missing as
 * visible, so we delete the key on toggle-off to stay round-trip
 * clean with renderers that don't tolerate the field.
 */
export function toggleLayerVisibility(lottie: LottieJson, index: number): LottieJson {
  const layer = lottie.layers?.[index] as Record<string, unknown> | undefined;
  if (!layer) return lottie;
  if (layer.hd) delete layer.hd;
  else layer.hd = true;
  return lottie;
}

export function toggleLayerLock(lottie: LottieJson, index: number): LottieJson {
  const layer = lottie.layers?.[index] as Record<string, unknown> | undefined;
  if (!layer) return lottie;
  if (layer._locked) delete layer._locked;
  else layer._locked = true;
  return lottie;
}

/**
 * Move a layer in the z-order. Lottie renders layers in array order
 * (index 0 is on top of index 1, etc.) so "move up" means lowering
 * the array index.
 */
export function reorderLayer(
  lottie: LottieJson,
  from: number,
  to: number,
): LottieJson {
  if (!lottie.layers) return lottie;
  if (from < 0 || from >= lottie.layers.length) return lottie;
  if (to < 0 || to >= lottie.layers.length) return lottie;
  if (from === to) return lottie;
  const [layer] = lottie.layers.splice(from, 1);
  lottie.layers.splice(to, 0, layer);
  return lottie;
}

/** Resolve a single fill on a single layer; null when not animatable. */
export function readLayerFill(
  lottie: LottieJson,
  index: number,
): [number, number, number] | null {
  const layer = lottie.layers?.[index];
  if (!layer) return null;
  let found: [number, number, number] | null = null;
  walkFills(layer, (fill) => {
    if (found) return;
    const c = fill.c as { a?: number; k?: unknown } | undefined;
    if (!c) return;
    if (c.a === 0 && Array.isArray(c.k)) {
      found = lottieToRgb(c.k as number[]);
    } else if (Array.isArray(c.k) && c.k.length > 0) {
      const first = c.k[0] as Record<string, unknown>;
      if (Array.isArray(first.s)) found = lottieToRgb(first.s as number[]);
    }
  });
  return found;
}
