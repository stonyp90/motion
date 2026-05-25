import type { Config } from 'tailwindcss';

const config: Config = {
  // `dark:` variants hang off the studio's existing `[data-theme="dark"]`
  // attribute on <html>, so we don't need a second toggle. The `selector`
  // strategy is Tailwind 3.4+; the second arg overrides the default `.dark`
  // class with the data-attribute we already use.
  darkMode: ['selector', '[data-theme="dark"]'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  // The /brand kit page renders swatches via dynamic class names like
  // `bg-motion-${stop}` and `bg-primary-${stop}`. Tailwind's JIT can't
  // scan those, so safelist every stop in each palette family.
  safelist: [
    ...[50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((s) => `bg-motion-${s}`),
    ...[50, 100, 200, 300, 400, 500, 600, 700, 800, 900].flatMap((s) => [
      `bg-primary-${s}`,
      `bg-accent-${s}`,
      `bg-secondary-${s}`,
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
        // ---- New themed brand scale (HSL with alpha-value support) -------
        // Drives the `bg-motion-*`, `text-motion-*`, `border-motion-*` etc.
        // surfaces and flips automatically under [data-theme="dark"].
        motion: {
          50:  'hsl(var(--motion-50) / <alpha-value>)',
          100: 'hsl(var(--motion-100) / <alpha-value>)',
          200: 'hsl(var(--motion-200) / <alpha-value>)',
          300: 'hsl(var(--motion-300) / <alpha-value>)',
          400: 'hsl(var(--motion-400) / <alpha-value>)',
          500: 'hsl(var(--motion-500) / <alpha-value>)',
          600: 'hsl(var(--motion-600) / <alpha-value>)',
          700: 'hsl(var(--motion-700) / <alpha-value>)',
          800: 'hsl(var(--motion-800) / <alpha-value>)',
          900: 'hsl(var(--motion-900) / <alpha-value>)',
          950: 'hsl(var(--motion-950) / <alpha-value>)',
          DEFAULT: 'hsl(var(--motion-500) / <alpha-value>)',
        },
        // ---- Layered surfaces (themed, HSL with alpha-value) -------------
        surface: {
          inset:   'hsl(var(--surface-inset) / <alpha-value>)',
          overlay: 'hsl(var(--surface-overlay) / <alpha-value>)',
        },
        // ---- Original static brand palette (hex, theme-independent) ------
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
          hover: 'hsl(var(--border-hover) / <alpha-value>)',
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
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        soft: '0 1px 3px 0 rgba(11, 20, 55, 0.05), 0 1px 2px 0 rgba(11, 20, 55, 0.03)',
        card: '0 4px 16px -2px rgba(11, 20, 55, 0.08), 0 2px 6px -2px rgba(11, 20, 55, 0.04)',
        lift: '0 20px 40px -12px rgba(11, 20, 55, 0.18)',
        glow: '0 0 0 1px rgba(16, 185, 129, 0.2), 0 8px 32px -4px rgba(16, 185, 129, 0.18)',
        // Motion-themed shadows that follow the dark-mode flip.
        motion: '0 20px 40px -12px hsl(var(--motion-500) / 0.25)',
        'motion-lg': '0 25px 50px -12px hsl(var(--motion-500) / 0.35)',
        'motion-glow': '0 0 0 1px hsl(var(--motion-500) / 0.2), 0 8px 32px -4px hsl(var(--motion-500) / 0.18)',
      },
      backgroundImage: {
        'hero-grid':
          'linear-gradient(to bottom, var(--color-bg-primary) 0%, var(--color-bg-secondary) 100%), radial-gradient(at 25% 0%, rgba(16, 185, 129, 0.08) 0%, transparent 50%), radial-gradient(at 75% 100%, rgba(245, 158, 11, 0.05) 0%, transparent 50%)',
      },
    },
  },
  plugins: [],
};

export default config;
