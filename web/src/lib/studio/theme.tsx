'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'light' | 'dark';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'mf-studio-theme';

/**
 * ThemeProvider for the /studio surface.
 *
 * On mount it picks the theme in this order:
 *   1. localStorage `mf-studio-theme` if set
 *   2. The `defaultTheme` prop (which the route sets to 'dark' for
 *      /studio, 'light' for marketing)
 *   3. `prefers-color-scheme: dark` media query
 *
 * It then writes `data-theme="dark"|"light"` onto <html>, which is
 * what every CSS variable override in globals.css hangs off of.
 */
export function ThemeProvider({
  children,
  defaultTheme = 'dark',
}: {
  children: ReactNode;
  defaultTheme?: Theme;
}) {
  // Always start with defaultTheme to keep SSR + first-paint stable.
  // The effect immediately reconciles with localStorage / prefers.
  const [theme, setThemeState] = useState<Theme>(defaultTheme);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let resolved: Theme = defaultTheme;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'dark' || stored === 'light') {
        resolved = stored;
      } else if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
        resolved = 'dark';
      }
    } catch {
      // localStorage may throw in private mode — fall through.
    }
    setThemeState(resolved);
  }, [defaultTheme]);

  // Reflect every state change to <html data-theme>.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    try {
      window.localStorage?.setItem(STORAGE_KEY, t);
    } catch {
      // ignore
    }
  };

  const value: ThemeContextValue = {
    theme,
    setTheme,
    toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Returning a default-shaped object means useTheme works even
    // outside the provider (e.g. in storybook stories). It won't
    // mutate the DOM but it won't crash either.
    return {
      theme: 'dark',
      setTheme: () => undefined,
      toggle: () => undefined,
    };
  }
  return ctx;
}
