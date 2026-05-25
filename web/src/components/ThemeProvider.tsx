'use client';

/**
 * ThemeProvider — three-state theme controller for motion-forge.
 *
 * States: 'light' | 'dark' | 'system' (default).
 * Persistence: localStorage key `mf-theme`.
 * Surface flip: writes `data-theme` attribute on <html>. CSS variables in
 * globals.css branch off that attribute, so no component code changes.
 *
 * SSR safety: the inline script in layout.tsx (see layout-script.html)
 * sets `data-theme` BEFORE React hydrates so there is no flash of the
 * wrong theme. This component just keeps the attribute in sync with user
 * changes after hydration.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  /** What the user picked. 'system' means follow OS. */
  choice: ThemeChoice;
  /** What actually got applied. Resolves 'system' to 'light' or 'dark'. */
  resolved: ResolvedTheme;
  /** Set the user's choice and persist it. */
  setChoice: (next: ThemeChoice) => void;
  /** Convenience: cycle light → dark → system → light. */
  cycle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'mf-theme';
const ATTR = 'data-theme';

function readStoredChoice(): ThemeChoice {
  if (typeof window === 'undefined') return 'system';
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function resolve(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return choice;
}

function apply(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute(ATTR, resolved);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialize from storage on first render. SSR returns 'system'; the
  // pre-hydration script in layout.tsx has already applied the correct
  // data-theme to <html>, so there is no flash.
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readStoredChoice());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(readStoredChoice()));

  // Keep the <html data-theme> attribute and persisted choice in sync.
  useEffect(() => {
    const next = resolve(choice);
    setResolved(next);
    apply(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      /* private mode, quota — silently ignore */
    }
  }, [choice]);

  // Follow OS changes while the user is on 'system'.
  useEffect(() => {
    if (choice !== 'system' || typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      const next: ResolvedTheme = e.matches ? 'dark' : 'light';
      setResolved(next);
      apply(next);
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [choice]);

  // Sync across tabs.
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const next = readStoredChoice();
      setChoiceState(next);
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const setChoice = useCallback((next: ThemeChoice) => setChoiceState(next), []);
  const cycle = useCallback(() => {
    setChoiceState((prev) =>
      prev === 'light' ? 'dark' : prev === 'dark' ? 'system' : 'light',
    );
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ choice, resolved, setChoice, cycle }),
    [choice, resolved, setChoice, cycle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within <ThemeProvider>');
  }
  return ctx;
}
