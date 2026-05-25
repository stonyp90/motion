# Pack consistency notes

The 12 characters were built from a single Python generator (`_build.py`)
that emits identical scaffolding for every sprite. The following invariants
hold across the entire pack — relying on any of them is safe.

## Document-level invariants

- Lottie version: `v: "5.7.0"`
- Canvas: `w: 200, h: 200`
- Timeline: `ip: 0, op: 60, fr: 30` → exactly 2 s @ 30 fps, looped
- Background: **none** (no `solid` layer, no layer named `background`). The
  parent canvas paints the background. `applyRecolor({ background })` from
  `motion-forge/web/src/lib/lottie/transform.ts` is a safe no-op.
- `assets: []`, `ddd: 0`

## Layer convention

- All visible content lives in **shape layers** (`ty: 4`).
- Layer **anchor** is always `(0, 0)` and layer **position** defaults to
  `(100, 100)` — the canvas center. So shape coordinates inside the layer are
  in **layer-local** space, centered around `(0, 0)`, and the layer translates
  to the world center. Animated scale/rotation pivot around the visual center.
- Layer name matches the character ID (e.g. `alex`, `arrow`, `lucius`).
- Each sprite has 1 layer except `clock` (2: rotating minute hand + static
  base) and `calendar` (2: pulsing date highlight + static page).

## Stroke / fill convention

- Primary stroke color: **deep ink `#0b1437`** = `[0.043, 0.078, 0.216, 1.0]`.
- Accent fill color: **emerald `#10b981`** = `[0.063, 0.725, 0.506, 1.0]`.
- Stroke widths: **4 px** standard, **2.5 px** thin (detail), **5.5 px** thick
  (emphasis lines like dollar S, arrow shaft, ribbon). Always round caps &
  joins (`lc: 2, lj: 2`).
- Fills use `r: 1` (non-zero winding rule) so self-touching paths still fill
  correctly.

## Z-order convention

Within a layer's `shapes` array, **earlier items render in front**. The
generator deliberately reverses the natural top-down ordering so e.g. face
features come first in the array (rendered first → drawn on top), structural
elements last. This matches what `lottie-web` 5.7+ does in practice (verified
by headless render).

## Hand-drawn feel

All "round" outlines (heads, clock face, lens, calendar highlight, checkmark
circle, magnifier lens) are built by `hand_drawn_circle(cx, cy, r, jitter,
segments, seed)`. Each character uses a **distinct seed** so the jitter
pattern doesn't repeat visibly across the pack. Jitter is bounded to ±2 px
on vertex positions so the silhouette stays recognizable.

## Manifest contract

`manifest.json` has shape `{ "version": 1, "characters": [...] }`. Each entry
has `id`, `name`, `archetype` ∈ `{person, mascot, product, icon}`, `file`,
`default_scale` (0–1), `preferred_y` (0–1, top-of-canvas to bottom). The
orchestrator can place sprites by reading those fields without inspecting the
JSON contents.

## Naming convention

- Files: kebab-case `*.json` (e.g. `lucius-bot.json`, `generic-product.json`).
- Layer name: matches the file basename with hyphens preserved (e.g.
  `lucius-bot` → layer named `lucius`, `office-worker` → `office_worker`,
  reflecting Lottie's friendliness to underscores). The orchestrator should
  look up sprites by `file` field from the manifest, not by layer name.
- Group names inside shapes describe the visual part (`head`, `eyes`,
  `bubble`, `screen`, etc.) so the motion-forge studio's `LayersPanel` can
  show useful labels.

## How to verify

```bash
# Quick parse test
for f in /tmp/motion-forge-prep/characters/*.json; do
  jq . "$f" > /dev/null && echo "OK: $(basename $f)"
done

# Structural validation (catches bad shape groups, RGBA arrays, etc.)
python3 /tmp/motion-forge-prep/characters/_validate.py

# Live render test (requires playwright + chromium)
node /tmp/motion-forge-prep/characters/_snapshot.js
# Writes _preview.png + _thumb-*.png for visual inspection
```

## Re-generating

The entire pack can be re-built by running `python3 _build.py`. To change a
character: edit its `build_*` function in `_build.py`, re-run, and re-validate.
Color tweaks: change the `INK` / `EMERALD` constants at the top of the file.
Timing tweaks: change `DURATION_FRAMES` and `FRAMERATE`.
