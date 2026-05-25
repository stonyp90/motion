# motion-forge character pack — preview & attribution

Hand-authored Lottie character pack designed to match the Chrono storyboard
register (hand-drawn line art, monochrome ink with sparing emerald accents,
subtle animation). 12 sprites, 200×200 viewport each, 60 frames @ 30 fps
(2 s loop). All files render in `lottie-web` 5.7+ without errors.

To preview visually, drop any `*.json` into the dotLottie / LottieFiles preview
at https://lottiefiles.com/preview (drag-and-drop). Or open
`/tmp/motion-forge-prep/characters/_preview.html` in any browser to see the
whole grid animating. A static snapshot is at `_preview.png`.

## Characters

| ID | Name | Archetype | Animation | Source | License |
|----|------|-----------|-----------|--------|---------|
| `alex` | Alex | person | subtle vertical bob + breathing scale (woman with bob, emerald top) | hand-authored | public domain (own work) |
| `sam` | Sam | person | subtle vertical bob + breathing scale (man, short hair, teal top) | hand-authored | public domain (own work) |
| `lucius-bot` | Lucius | mascot | gentle hover; emerald antenna + chat bubble with three white dots | hand-authored | public domain (own work) |
| `office-worker` | Office Worker | person | static portrait (person at desk with laptop, green screen glow) | hand-authored | public domain (own work) |
| `generic-product` | Product | product | gentle float up and down (isometric gift box, emerald top face) | hand-authored | public domain (own work) |
| `arrow` | Arrow | icon | horizontal bounce ±8 px (right-pointing) | hand-authored | public domain (own work) |
| `timesheet` | Timesheet | icon | five emerald row bars draw on from left over 50 frames | hand-authored | public domain (own work) |
| `calendar` | Calendar | icon | green date highlight pulses (scale 100% → 130% → 100%) | hand-authored | public domain (own work) |
| `dollar` | Dollar | icon | subtle vertical bounce + 1.08× pulse | hand-authored | public domain (own work) |
| `clock` | Clock | icon | minute hand makes one full rotation per loop | hand-authored | public domain (own work) |
| `magnifier` | Magnifier | icon | drifts in a small ellipse (search motion) | hand-authored | public domain (own work) |
| `checkmark` | Checkmark | icon | green check draws on 0–24f; circle border draws on 0–30f | hand-authored | public domain (own work) |

## Visual register

- **Stroke**: deep ink `#0b1437` at 4 px (body lines), 2.5 px (detail lines),
  5.5 px (emphasis lines), round caps and joins.
- **Fills**: white face, emerald `#10b981` accents on shirts / chat bubble /
  emphasis bars / checkmark / antenna dot / calendar header & highlight /
  laptop screen glow / box top, dark ink on hair / pupils / laptop body.
- **Hand-drawn feel**: every circular outline (head, clock face, lens, magnifier
  lens, calendar highlight) uses 12–16 bezier segments with seeded jitter
  (±1.2–2.0 px on vertex positions) so the strokes read "drawn" rather than
  perfectly vector. Each character uses a distinct seed so the jitter pattern
  isn't repeated visibly.

## Sourcing & licensing posture

**100% hand-authored** by the build script `_build.py` — pure Python that emits
Lottie JSON conforming to bodymovin 5.7. Nothing sourced from a third-party
pack. The author retains no claim; treat everything in this pack as public
domain / CC0 for the motion-forge project's use.

The decision to hand-author over Option B/C: the brand palette (`#0b1437` /
`#10b981` only), the 200×200 / 60-frame uniform spec, and the requirement to
stay under 12 KB per sprite made re-coloring any sourced pack more work than
generating from scratch. Hand-authoring also guarantees a single consistent
visual register across all 12 — see `CONSISTENCY.md`.

## Animation timing

All sprites loop at exactly 60 frames @ 30 fps (2 seconds). Easing on all
keyframes uses Lottie's bezier handle convention with `i.x=0.42, i.y=1.0,
o.x=0.58, o.y=0.0` — roughly an ease-in-out. This keeps motion subtle and
non-distracting since these sprites are intended as decorative elements on
larger scene canvases.

## File-by-file size

```
alex.json              6645  bytes
arrow.json             1138  bytes
calendar.json          3547  bytes
checkmark.json         3057  bytes
clock.json             6132  bytes
dollar.json            1520  bytes
generic-product.json   2353  bytes
lucius-bot.json        4296  bytes
magnifier.json         3321  bytes
office-worker.json     7130  bytes
sam.json               6418  bytes
timesheet.json         3268  bytes
manifest.json          2138  bytes
                     ------
total                 50963  bytes  (49.8 KB)
```
