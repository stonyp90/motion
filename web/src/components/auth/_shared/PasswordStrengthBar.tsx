'use client';

/**
 * Tablix-style five-level password meter. Pure presentational — the score
 * comes from `scorePassword`. Do NOT gate submit on this; the server is
 * authoritative on minimum length and complexity.
 */

export type PasswordScore = 0 | 1 | 2 | 3 | 4;

export function scorePassword(p: string): PasswordScore {
  if (p.length === 0) return 0;
  let score = 0;
  if (p.length >= 8) score += 1;
  if (p.length >= 12) score += 1;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score += 1;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) score += 1;
  return Math.min(4, score) as PasswordScore;
}

export function passwordHint(len: number, score: PasswordScore): string | undefined {
  if (len === 0) return 'At least 8 characters.';
  if (len < 8) return `${8 - len} more character${8 - len === 1 ? '' : 's'}.`;
  if (score <= 1) return 'Add a mix of cases, numbers, and symbols for a stronger password.';
  return undefined;
}

export function PasswordStrengthBar({ score }: { score: PasswordScore }) {
  const labels = ['Too short', 'Weak', 'OK', 'Good', 'Strong'] as const;
  const colors = [
    'bg-red-400',
    'bg-orange-400',
    'bg-yellow-400',
    'bg-accent-400',
    'bg-accent-600',
  ];
  return (
    <div
      className="-mt-2 flex items-center gap-2 text-[11px] text-text-tertiary"
      role="status"
      aria-label={`Password strength: ${labels[score]}`}
    >
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={`h-1 flex-1 rounded-full ${
              i < score ? colors[score] : 'bg-border-light'
            }`}
          />
        ))}
      </div>
      <span className="min-w-[5ch] text-right">{labels[score]}</span>
    </div>
  );
}
