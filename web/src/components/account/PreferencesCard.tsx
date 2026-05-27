'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { Settings } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';

/**
 * Preferences — theme + email digest opt-in. Theme is the existing
 * `ThemeToggle` (already wired to localStorage). Email digest is
 * cosmetic in v1 — we store the boolean in localStorage but don't
 * surface a real digest yet. Wire to backend once digest content
 * exists.
 */
const PREFS_KEY = 'mf-prefs';

interface Prefs {
  emailDigest: boolean;
}

const DEFAULTS: Prefs = { emailDigest: false };

function loadPrefs(): Prefs {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULTS;
    const j = JSON.parse(raw) as Partial<Prefs>;
    return { ...DEFAULTS, ...j };
  } catch {
    return DEFAULTS;
  }
}

export function PreferencesCard() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS);

  useEffect(() => {
    setPrefs(loadPrefs());
  }, []);

  const update = (patch: Partial<Prefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <section
      className="animate-reveal-up stagger-child rounded-2xl border border-border-light bg-bg-primary p-6 shadow-card sm:p-8"
      style={{ '--i': 2 } as CSSProperties}
    >
      <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-text-primary">
        <Settings className="h-4 w-4 text-accent-700" aria-hidden />
        Preferences
      </h2>
      <div className="mt-5 flex flex-col gap-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-text-primary">Theme</span>
            <span className="text-xs text-text-tertiary">
              Auto-follows your OS unless overridden.
            </span>
          </div>
          <ThemeToggle />
        </div>
        <label className="flex items-center justify-between gap-4">
          <span className="flex flex-col">
            <span className="text-sm font-medium text-text-primary">
              Email digest
            </span>
            <span className="text-xs text-text-tertiary">
              Send a weekly summary of new features and your usage. Off by default.
            </span>
          </span>
          <input
            type="checkbox"
            checked={prefs.emailDigest}
            onChange={(e) => update({ emailDigest: e.target.checked })}
            className="h-4 w-4 cursor-pointer accent-accent-600"
          />
        </label>
      </div>
    </section>
  );
}
