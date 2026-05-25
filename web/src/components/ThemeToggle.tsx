'use client';

/**
 * ThemeToggle — two-state segmented control (light / dark).
 *
 * Designed for the slim Header. Each option is a real <button> so the
 * native focus ring and keyboard nav work for free. ArrowLeft / ArrowRight
 * move focus within the group; Enter / Space activate.
 *
 * The provider still supports `'system'` as a stored value (for users
 * whose localStorage carried over from the prior three-state UI). When
 * choice === 'system' we highlight whichever button matches the resolved
 * theme so the segmented control never reads as "nothing selected"; the
 * first explicit click coerces the stored value to 'light' or 'dark'.
 *
 * Visually a tight segmented pill, matching the .chip register already in
 * use across the home (rounded-full, border-border-light, bg-bg-secondary).
 */
import { useEffect, useRef } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from './ThemeProvider';

type ExplicitChoice = 'light' | 'dark';

interface Option {
  value: ExplicitChoice;
  label: string;
  Icon: typeof Sun;
}

const OPTIONS: ReadonlyArray<Option> = [
  { value: 'light', label: 'Light theme', Icon: Sun },
  { value: 'dark', label: 'Dark theme', Icon: Moon },
];

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { choice, resolved, setChoice } = useTheme();
  const groupRef = useRef<HTMLDivElement>(null);

  // Roving-focus keyboard nav: ArrowLeft / ArrowRight cycle focus through
  // the visible buttons. Enter / Space (native button behavior) activates.
  useEffect(() => {
    const root = groupRef.current;
    if (!root) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
      const active = document.activeElement as HTMLElement | null;
      const idx = buttons.findIndex((b) => b === active);
      if (idx === -1) return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const next = buttons[(idx + dir + buttons.length) % buttons.length];
      next?.focus();
    };
    root.addEventListener('keydown', handleKey);
    return () => root.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Color theme"
      className={`inline-flex items-center gap-0.5 rounded-full border border-border-light bg-bg-secondary p-0.5 ${className}`}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        // If the stored choice is 'system' (legacy), fall back to the
        // resolved theme so exactly one button stays visually selected.
        const selected =
          choice === value || (choice === 'system' && resolved === value);
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={label}
            tabIndex={selected ? 0 : -1}
            onClick={() => setChoice(value)}
            className={[
              'grid h-7 w-7 place-items-center rounded-full transition',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:ring-offset-1 focus-visible:ring-offset-bg-secondary',
              selected
                ? 'bg-bg-primary text-text-primary shadow-soft'
                : 'text-text-tertiary hover:text-text-primary',
            ].join(' ')}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
