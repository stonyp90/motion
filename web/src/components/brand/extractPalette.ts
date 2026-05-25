/**
 * Client-side palette extraction from a logo image.
 *
 * Hand-rolled k-means on canvas pixel data — no external deps,
 * runs in <50ms for a 256x256 thumbnail. Returns up to `k` dominant
 * colors sorted by cluster size (largest = most dominant).
 *
 * Usage:
 *   const file = e.target.files[0];
 *   const palette = await extractPalette(file, 5);
 *   // -> ["#0a1f3a", "#ffffff", "#f0a500", "#c0392b", "#2c3e50"]
 */

const MAX_DIM = 128; // downscale before clustering — k-means cost is O(n*k)
const MAX_ITER = 8; // 8 iterations is plenty for 5 clusters on 16k pixels

interface Pixel {
  r: number;
  g: number;
  b: number;
}

function toHex({ r, g, b }: Pixel): string {
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function dist(a: Pixel, b: Pixel): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  } finally {
    // revoke after the image is decoded; the bitmap stays in memory
    queueMicrotask(() => URL.revokeObjectURL(url));
  }
}

function samplePixels(img: HTMLImageElement): Pixel[] {
  const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("extractPalette: 2d context unavailable");
  ctx.drawImage(img, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const out: Pixel[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 128) continue; // skip transparent pixels (common in PNG logos)
    out.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  return out;
}

function kmeans(pixels: Pixel[], k: number): { centroid: Pixel; size: number }[] {
  if (pixels.length === 0) return [];
  // k-means++ style seeding — pick first at random, then bias toward distance
  const centroids: Pixel[] = [];
  centroids.push({ ...pixels[Math.floor(Math.random() * pixels.length)] });
  while (centroids.length < k) {
    const weights = pixels.map(p =>
      Math.min(...centroids.map(c => dist(p, c))),
    );
    const total = weights.reduce((s, w) => s + w, 0);
    if (total === 0) break;
    let target = Math.random() * total;
    let idx = 0;
    for (; idx < weights.length; idx++) {
      target -= weights[idx];
      if (target <= 0) break;
    }
    centroids.push({ ...pixels[Math.min(idx, pixels.length - 1)] });
  }

  const assignments = new Array(pixels.length).fill(0);
  for (let iter = 0; iter < MAX_ITER; iter++) {
    let moved = false;
    for (let i = 0; i < pixels.length; i++) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = dist(pixels[i], centroids[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (assignments[i] !== best) {
        assignments[i] = best;
        moved = true;
      }
    }
    if (!moved) break;

    const sums = centroids.map(() => ({ r: 0, g: 0, b: 0, n: 0 }));
    for (let i = 0; i < pixels.length; i++) {
      const s = sums[assignments[i]];
      s.r += pixels[i].r;
      s.g += pixels[i].g;
      s.b += pixels[i].b;
      s.n += 1;
    }
    for (let c = 0; c < centroids.length; c++) {
      const s = sums[c];
      if (s.n > 0) {
        centroids[c] = { r: s.r / s.n, g: s.g / s.n, b: s.b / s.n };
      }
    }
  }

  const counts = centroids.map(() => 0);
  for (const a of assignments) counts[a]++;

  return centroids
    .map((centroid, i) => ({ centroid, size: counts[i] }))
    .sort((a, b) => b.size - a.size);
}

/**
 * Extract up to `k` dominant colors from a logo file. Returns hex strings
 * sorted by dominance. Returns [] on decode failure.
 */
export async function extractPalette(file: File, k = 5): Promise<string[]> {
  try {
    const img = await loadImage(file);
    const pixels = samplePixels(img);
    if (pixels.length === 0) return [];
    const clusters = kmeans(pixels, k);
    return clusters.map(c => toHex(c.centroid));
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn("[extractPalette] failed:", err);
    }
    return [];
  }
}
