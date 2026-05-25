# motion-forge website

Marketing site for the motion-forge engine. Same look-and-feel as Tablix
and Diamantex — Next.js 15 + Tailwind + CSS-variable design tokens — so
adding a `/login` panel and wiring it into the same auth stack later is
a single-day job.

## Run it

```bash
npm install
npm run dev          # http://localhost:3001
npm run build
npm run start
npm run lint
```

## Architecture

```
src/
  app/
    layout.tsx        Root layout + metadata
    page.tsx          Section orchestration
    globals.css       Design tokens (light theme only, dark TODO)
  components/
    Header.tsx        Sticky nav with mobile sheet
    Footer.tsx
    sections/
      HeroSection.tsx          Embedded chrono.mp4 demo + drifting panel rail
      ProofSection.tsx         4 hard numbers (90s, <1s, $0.18, 100% local)
      ValuePillarsSection.tsx  6 pillars
      HowItWorksSection.tsx    4 steps with CLI invocations
      ComparisonSection.tsx    Agency vs in-house vs motion-forge
      ArchitectureSection.tsx  Dark section with the 6-layer Azure stack
      PricingSection.tsx       Self-hosted (free) / Cloud / Enterprise
      FAQSection.tsx           Accordion
      CTASection.tsx           Bottom CTA
public/
  demos/
    chrono.mp4         The actual panelize output (37.6 MB)
    chrono-sample-*.png Three frames used in the drifting strip
```

## Brand tokens

`src/app/globals.css` defines every color via CSS variables:

- `--color-primary-*` deep ink (navy) for authority
- `--color-accent-*` emerald (the motion-design spark)
- `--color-secondary-*` warm amber for CTAs / pricing
- `--color-neutral-*` slate greys
- semantic `bg-*`, `text-*`, `border-*` mappings on top

To re-skin for a customer: change the three palettes in `globals.css`.
Nothing in the components reads a hex value directly (per the global
project rule).

## Conventions matched from Tablix / Diamantex

- Section components live under `components/sections/`
- `'use client'` only on components that need it (Header menu, FAQ accordion, Hero video controls)
- Tailwind utility classes everywhere; no inline styles except for the gradient hero background
- Mobile-first responsive
- Sticky header with backdrop blur
- Container max-width 1200px

## TODO before launch

- [ ] Wire `cal.com/` link to the actual booking URL
- [ ] Set `metadataBase` to the real domain
- [ ] Add OG image (1200×630)
- [ ] Dark mode (the tokens are already swappable; just add a `[data-theme="dark"]` block in globals.css)
- [ ] Replace placeholder `mailto:hello@motion-forge.io` with the real address
- [ ] Add `/privacy` and `/terms` pages
- [ ] Replace `github.com/` with the real repo URL
