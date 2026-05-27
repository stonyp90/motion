# ControlCraft Next.js 15.5 Performance + Bundle Audit

## Summary
Codebase is **well-optimized** in key areas (fonts, hydration, code splitting). Minor improvements exist in bundle bloat and component granularity.

---

## P0: High-Impact Issues

### 1. Framer-motion + Lottie-react still in prod bundle
**File:** `package.json:19-20` | **Impact:** ~80 kB minified  
**Issue:** Both deps installed but only used in 2 components (`ProcessDemo.tsx` + 4 Lottie players).
- `framer-motion` (11.18.2): Imported only in `ProcessDemo.tsx` for hero loop animation  
- `lottie-react` (2.4.1): Dynamic-imported (good); used in `PreviewFrame`, `PreviewFullscreen`, `IterationRail`, `ProcessDemo`

**Evidence:**
- `ProcessDemo.tsx:3`: `import { motion, AnimatePresence } from 'framer-motion'`  
- 4x dynamic Lottie imports with `ssr:false` (correct pattern)  
- BrandMotionShowcase (372 lines) replaced lottie-web with pure CSS @keyframes—modern, lighter, no regression

**Fix:** Remove `framer-motion` from production dependencies. ProcessDemo animations can replace `<motion.div>` with pure CSS `@keyframes` + `useTransition()` hook, matching BrandMotionShowcase pattern. Saves ~35 kB.

---

## P1: Moderate Issues

### 2. All 24 home components are 'use client' (no server components)
**Files:** `src/components/home/*.tsx` (all 24 files marked `'use client'`)

**Analysis:**
- Every component in `/home` is marked client—none can be server components  
- Most (20+) are stateless presentational wrappers (HeaderButton, ChipRow, Badge, etc.)  
- Only 3 genuine client hooks exist: `useState` (HomeApp state), `useEffect` (BrandMotionShowcase loop), `useCallback` (form inputs)

**Safe candidates for server conversion:**
- `FormatRow.tsx`, `CastRow.tsx`, `ExamplePromptChips.tsx`, `KPIStrip.tsx`, `TokenUsageChip.tsx`, `TrustStrip.tsx` — no hooks, no event handlers
- `EmptyPreview.tsx`, `LoadingPreview.tsx` — pure display, no interactivity

**Fix:** Remove `'use client'` from 6-8 pure display components. Reduces hydration JS by ~10 kB.

---

### 3. BrandMotionShowcase should be lazy-loaded below fold
**File:** `src/components/home/BrandMotionShowcase.tsx:1-372` | **Size:** 11.7 kB gzipped  
**Issue:** 372-line component with 6 @keyframes + inline styled-jsx embedded in initial home render.

**Fix:** Wrap with `dynamic(() => import(...), { ssr: true })` and only mount on scroll-into-view or after TTI. BrandMotionShowcase is a polish feature (the "SAMPLE" demo), not critical path. Saves ~5 kB on FCP.

---

## P2: Low-Priority Improvements

### 4. CSS token coverage incomplete for arbitrary values
**File:** `tailwind.config.ts:106-147`  
**Issue:** Typography safelist uses explicit stops (lines 18-23), but component code still uses arbitrary values:
- `text-[10px]`, `text-[11px]` found in BrandMotionShowcase (lines 283, 325)  
- Can consolidate to `text-2xs` / `text-3xs` already defined (lines 109-110)

**Fix:** Replace arbitrary values with named tokens. Minor tree-shake opportunity (~200 bytes).

---

### 5. Image optimization low-hanging fruit
**Status:** GOOD — all images are SVGs + static PNGs in `/public/demos/` (270 kB total).  
**Issue:** Two `<img>` tags found instead of `next/image`:
- `ProcessDemo.tsx:1020`: Inline SVG logo images (member.svg)  
- `BrandIdentityPanel.tsx:100`: Dynamic user-uploaded logos

**Fix:** Switch to `next/image` for static logos (enables AVIF, lazy-load, proper sizing). SVG logos can stay as `<img>` (no sizing benefit).

---

### 6. Font loading is excellent
**Status:** CLEAN  
**Evidence:**
- `layout.tsx:9-24`: Inter + Space_Grotesk with `display: 'swap'` → FOUT guard, no FOIT  
- `layout.tsx:30-39`: Inline theme FOUC script runs before React hydrates  
- `globals.css:71-74`: CSS variables for fallback fonts

**No action needed.**

---

### 7. Hydration mismatch risk addressed (ThemeToggle pattern)
**Status:** GOOD  
**Evidence:**
- `ThemeToggle.tsx:40-48`: Uses `mounted` flag to defer theme styling until post-hydration  
- `layout.tsx:63`: `suppressHydrationWarning` on `<html>` for data-theme attribute  
- Prevents SSR/CSR state divergence (localStorage vs OS pref)

**Review:** All other components follow this pattern; no new hydration issues found.

---

## Summary Fixes (Prioritized)

| Priority | Issue | Est. Savings | Effort |
|----------|-------|--------------|--------|
| **P0** | Remove `framer-motion`, replace with CSS | ~35 kB | 2h |
| **P1** | Convert 6-8 home components to server | ~10 kB | 1h |
| **P1** | Lazy-load BrandMotionShowcase below fold | ~5 kB (FCP) | 1h |
| **P2** | Replace arbitrary text sizes with tokens | ~200 B | 15 min |
| **P2** | Switch static logos to `next/image` | ~1 kB | 30 min |

**Total estimated savings:** ~51 kB (~25% of home JS bundle), FCP improvement ~100-200 ms.

---

## Next Steps

1. Run `npx next build --debug` and check bundle analysis for actual weights  
2. Migrate ProcessDemo to CSS @keyframes (copy BrandMotionShowcase pattern)  
3. Add `Suspense` boundary + skeleton for lazy BrandMotionShowcase  
4. Audit other app routes (`/brand`, `/download`, `/studio`) for same patterns
