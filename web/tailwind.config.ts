import type { Config } from 'tailwindcss';

const config: Config = {
  // Dark mode hangs off the `[data-theme="dark"]` attribute that
  // ThemeProvider (and its FOUC-guard inline script in layout.tsx) writes
  // onto <html>. The `selector` strategy is Tailwind 3.4+; the second arg
  // overrides the default `.dark` class with the data-attribute we use.
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // The /brand kit catalogs every palette stop via dynamic class names
  // like `bg-primary-${stop}`. Tailwind's JIT can't scan those, so
  // safelist every stop in each scale.
  safelist: [
    ...[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].flatMap((s) => [
      `bg-primary-${s}`,
      `bg-accent-${s}`,
      `bg-secondary-${s}`,
      `bg-neutral-${s}`,
    ]),
  ],
  theme: {
    container: {
      center: true,
      padding: { DEFAULT: '1rem', sm: '1.5rem', lg: '2rem', xl: '2rem', '2xl': '2rem' },
      screens: { sm: '640px', md: '768px', lg: '1024px', xl: '1200px', '2xl': '1280px' },
    },
    extend: {
      colors: {
        // Primary — deep ink. Calm authority for the executive audience.
        primary: {
          50: 'var(--color-primary-50)',
          100: 'var(--color-primary-100)',
          200: 'var(--color-primary-200)',
          300: 'var(--color-primary-300)',
          400: 'var(--color-primary-400)',
          500: 'var(--color-primary-500)',
          600: 'var(--color-primary-600)',
          700: 'var(--color-primary-700)',
          800: 'var(--color-primary-800)',
          900: 'var(--color-primary-900)',
          DEFAULT: 'var(--color-primary-500)',
        },
        // Accent — vivid emerald. The "spark" / motion color.
        accent: {
          50: 'var(--color-accent-50)',
          100: 'var(--color-accent-100)',
          200: 'var(--color-accent-200)',
          300: 'var(--color-accent-300)',
          400: 'var(--color-accent-400)',
          500: 'var(--color-accent-500)',
          600: 'var(--color-accent-600)',
          700: 'var(--color-accent-700)',
          800: 'var(--color-accent-800)',
          900: 'var(--color-accent-900)',
          DEFAULT: 'var(--color-accent-500)',
        },
        // Secondary highlight — warm amber for CTAs / pricing emphasis.
        secondary: {
          50: 'var(--color-secondary-50)',
          100: 'var(--color-secondary-100)',
          200: 'var(--color-secondary-200)',
          300: 'var(--color-secondary-300)',
          400: 'var(--color-secondary-400)',
          500: 'var(--color-secondary-500)',
          600: 'var(--color-secondary-600)',
          700: 'var(--color-secondary-700)',
          800: 'var(--color-secondary-800)',
          900: 'var(--color-secondary-900)',
          DEFAULT: 'var(--color-secondary-500)',
        },
        neutral: {
          50: 'var(--color-neutral-50)',
          100: 'var(--color-neutral-100)',
          200: 'var(--color-neutral-200)',
          300: 'var(--color-neutral-300)',
          400: 'var(--color-neutral-400)',
          500: 'var(--color-neutral-500)',
          600: 'var(--color-neutral-600)',
          700: 'var(--color-neutral-700)',
          800: 'var(--color-neutral-800)',
          900: 'var(--color-neutral-900)',
        },
        bg: {
          primary: 'var(--color-bg-primary)',
          secondary: 'var(--color-bg-secondary)',
          tertiary: 'var(--color-bg-tertiary)',
          inverse: 'var(--color-bg-inverse)',
        },
        text: {
          primary: 'var(--color-text-primary)',
          secondary: 'var(--color-text-secondary)',
          tertiary: 'var(--color-text-tertiary)',
          inverse: 'var(--color-text-inverse)',
          accent: 'var(--color-text-accent)',
        },
        border: {
          light: 'var(--color-border-light)',
          DEFAULT: 'var(--color-border-default)',
          dark: 'var(--color-border-dark)',
        },
      },
      fontSize: {
        // Two named small sizes so components stop reaching for
        // `text-[10px]` / `text-[11px]` arbitrary values.
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],   // 10px / 14px
        '3xs': ['0.6875rem', { lineHeight: '0.9375rem' }], // 11px / 15px
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      // Shadows resolve through CSS vars so the dark-mode re-tunes in
      // globals.css (`:root[data-theme="dark"] { --shadow-soft: ... }`)
      // actually flip the values that `shadow-card` / `shadow-lift` emit.
      boxShadow: {
        soft: 'var(--shadow-soft)',
        card: 'var(--shadow-card)',
        lift: 'var(--shadow-lift)',
        glow: 'var(--shadow-glow)',
      },
      // Same indirection for the hero gradient — globals.css defines
      // --gradient-hero-grid per theme so the emerald/amber glow warms
      // up in dark mode without component code changing.
      backgroundImage: {
        'hero-grid': 'var(--gradient-hero-grid)',
      },
      // Easing and duration tokens are documented in globals.css under the
      // "motion-forge — motion principles" block. Expose them to Tailwind
      // so authors can reach for `duration-base` / `ease-out-quart` instead
      // of inline arbitrary values when they need one-off transitions.
      transitionDuration: {
        instant: 'var(--dur-instant)',
        fast: 'var(--dur-fast)',
        base: 'var(--dur-base)',
        slow: 'var(--dur-slow)',
      },
      transitionTimingFunction: {
        'out-quart': 'var(--ease-out-quart)',
        snap: 'var(--ease-snap)',
        'in-quart': 'var(--ease-in-quart)',
        spring: 'var(--ease-spring)',
      },
    },
  },
  plugins: [],
};

export default config;
