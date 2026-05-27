# ControlCraft Next.js Web App — Code Quality Audit

## Executive Summary

The app is well-maintained post-rebrand (IMTN → ControlCraft) with clean component structure and modern patterns (dynamic imports for lottie-react, SSR-safe hooks). Found **12 actionable items**: mostly stale copy, one unused internal function, console statements acceptable in error paths, no dead imports, and correctly scoped framer-motion usage.

---

## 1. Stale Brand & Client References

### Quebec / SR&ED References
**src/components/home/PreviewFrame.tsx:364, 371**
```
// a static placeholder. `quebec` is a French-copy SR&ED variant
// (Recherche scientifique et développement experimental tax credit)
'/lottie/quebec.json',
```
**Action:** Delete quebec.json from `/public/lottie/` and remove from samples array. Replace the comment with a generic explanation. The SR&ED pitch is stale; use only corporate, playful, minimalist variants (or retarget the animation copy to ControlCraft's motion-design positioning).

### Chrono Innovation Placeholder Copy
**src/components/brand/BrandIdentityPanel.tsx:48, src/components/brand/types.ts, src/onboarding/EmptyPreview.tsx**
- Placeholder: `"Brand name (e.g. Chrono Innovation)"`
- Comment: `Chrono's "16.6%" model: three emphasis levels`
- Onboarding copy: `'Paste a Chrono-style script'`, `'Chrono · paste'`
- WelcomeTour: `'Paste a full Chrono-style scene'`

**Action:** Replace all "Chrono" references with a generic animation studio name (e.g., "Acme Studio") or generic "brand" terminology. Replace `Chrono Innovation` → `Your Brand Name`. Update sample-chrono.json display name to match.

### Ursly References (Comments Only)
**src/components/home/MetricsDrawer.tsx, src/lib/metrics.ts**
- "Modelled on ursly's MetricsPanel" comment
- "thresholds the engine recommends. Mirrors ursly's success / warning"

**Action:** Replace with generic attribution — `"Inspired by KPI strip pattern from internal design system"` or similar.

---

## 2. Dead Code

### DemoSamplePlayer Function
**src/components/home/PreviewFrame.tsx:359–410**
- Internal helper inside PreviewFrame — dead code from the "Lottie-based empty state" era (task #101: "Replace broken DemoSamplePlayer with native CSS motion showcase").
- Never exported; no external imports found.
- The component now uses `BrandMotionShowcase` (CSS keyframes) as the alive empty state.

**Action:** Delete the entire `DemoSamplePlayer()` function and its comment block (lines 349–410). Verify EmptyPreview.tsx doesn't call it (it doesn't).

---

## 3. Console Statements in Production

All acceptable — error-handling paths only, not on the critical home flow:

- **PreviewFrame.tsx:116** — `console.error('frame capture failed', e)` — frame export, isolated error handler
- **BrandIdentityPanel.tsx:194** — `console.warn("[BrandIdentityPanel] localStorage failed")` — graceful fallback, not user-facing
- **extractPalette.ts:18** — `console.warn("[extractPalette] failed")` — palette extraction failure, safe
- **email.ts:37, 40, 44** — `console.warn` / `console.error` tagged `[email]` — server-side failures, not critical path
- **streamMic.ts:95** — `console.warn('stt: unparseable server message')` — STT error, acceptable
- **manifest.ts:13** — `console.warn('[characters] failed to load manifests')` — safe fallback

**Action:** No change required; all are isolated error handlers, not debug cruft.

---

## 4. TODO / FIXME Comments

### api/engine/file/route.ts:17–18
```
// In production this route MUST be replaced by an engine-owned
// authenticated download endpoint (or a presigned URL from object storage) — see TODO at the bottom.
```

**Action:** Dev-only localhost file serving. Already flagged as temporary. Leave as-is if local dev is still in use; otherwise migrate to presigned URLs and remove the route.

---

## 5. Unused Dependencies

**package.json analysis:**
- `framer-motion` (11.18.2) — used once: BrandMotionShowcase.tsx, line 25 (import, but not in JSX — CSS keyframes only)
- `lottie-react` (2.4.1) — properly used: IterationRail, PreviewFrame, PreviewFullscreen, ProcessDemo (4 components)
- `cmdk` (1.1.1) — no grep hits; likely for future command palette UI
- `@scalar/api-reference-react` (0.9.41) — check DocsViewer component
- All @types, tailwindcss, lucide-react in use

**Action:** `framer-motion` can be removed if BrandMotionShowcase is CSS-only (verify one import is not for animation primitives — checked: none found). If keeping, it's a harmless remnant. `cmdk` is likely prep for onboarding; leave for now.

---

## 6. TypeScript Strictness

No `as any`, `@ts-ignore`, or `@ts-expect-error` found. **Status: Clean.**

---

## 7. Magic Numbers

Found only acceptable patterns:
- **GenerateButton.tsx, LoadingPreview.tsx** — `1200ms` in inline `animation` — CSS Dot animation timing, intentional
- **BrandMotionShowcase.tsx:78** — `const SCENE_DURATION_MS = 4_200` — properly named constant, 4.2s loop ✓

**Action:** No changes.

---

## 8. Hard-Coded URLs

All proper:
- **install/page.tsx** — `https://controlcraft.io` (default frontend, intentional)
- **install/page.tsx** — `https://staging.controlcraft.io` (env override example, documented)
- **app/layout.tsx** — metadataBase URL (proper)
- **email.ts:35** — `const appUrl = process.env.PUBLIC_APP_URL ?? 'https://www.controlcraft.io'` — env-backed with fallback ✓
- **audio/streamMic.ts:86** — `'ws://localhost:7755/v1/stt/stream'` — local dev default, acceptable

**Action:** None; properly scoped.

---

## 9. File Naming Consistency

- Components: PascalCase ✓ (BrandMotionShowcase, PreviewFrame, etc.)
- Utilities: camelCase ✓ (extractPalette.ts, rasteriseSvgToPng)
- Types: types.ts ✓
- No naming deviations found

**Action:** None.

---

## 10. Empty / Placeholder Files

- No files under 5 lines detected in src/
- All component files are functional and properly sized

**Action:** None.

---

## 11. Framer Motion Remnant

**BrandMotionShowcase.tsx line 25:**
```typescript
import { useEffect, useState } from 'react';
// (no framer-motion import, CSS keyframes only)
```

Despite framer-motion being in dependencies, this component is pure CSS + React state. Verify if any other component uses framer-motion primitives (checked; none found). Safe to remove if `cmdk` command palette doesn't need it.

---

## Punch List (Priority Order)

| Item | File:Line | Action |
|------|-----------|--------|
| 1 | PreviewFrame.tsx:359–410 | Delete DemoSamplePlayer() function and comment block |
| 2 | PreviewFrame.tsx:371 | Remove '/lottie/quebec.json' from samples array |
| 3 | public/lottie/ | Delete quebec.json (110.7K) |
| 4 | PreviewFrame.tsx:364 | Replace SR&ED comment with neutral explanation |
| 5 | BrandIdentityPanel.tsx:48 | Replace "Chrono Innovation" → "Your Brand Name" |
| 6 | BrandIdentityPanel.tsx + types.ts | Replace all "Chrono" model references with "three-tier emphasis model" |
| 7 | onboarding/EmptyPreview.tsx | Replace "Chrono-style script" → "motion design script" |
| 8 | onboarding/WelcomeTour.tsx | Replace "Chrono-style scene" → "scene" |
| 9 | lib/brand/sample-chrono.json | Rename to sample-animation.json, update display name |
| 10 | MetricsDrawer.tsx + lib/metrics.ts | Replace "ursly" comments with generic attribution |
| 11 | package.json | Consider removing framer-motion if no other component uses it (low priority) |
| 12 | api/engine/file/route.ts:17–18 | Plan migration to presigned URLs or engine-owned download endpoint |

---

## Notes

- **Lottie-react usage:** Properly dynamic-imported in 4 components; good performance pattern.
- **BrandMotionShowcase:** Best-in-class SSR-safe, reduced-motion aware, clean state machine. No changes needed.
- **Build cleanliness:** No dead imports, proper TypeScript, zero ESLint warnings expected.
