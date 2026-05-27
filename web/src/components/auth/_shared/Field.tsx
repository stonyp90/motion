'use client';

import { useId } from 'react';

interface FieldProps {
  /** Optional explicit id — falls back to a React-generated id so labels are always wired. */
  id?: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  /** Small grey hint shown beneath the input. */
  hint?: string;
  /** Inline error — when present the border + ring flip to the danger palette. */
  error?: string;
  /** Native `name` (defaults to `id`). */
  name?: string;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}

/**
 * Single source of truth for auth-form inputs. Pulled out of LoginForm/SignupForm
 * so the reset-password, forgot-password, and account/security cards inherit the
 * exact same visual language. Accent focus ring; rounded-lg (not full) to read
 * as a form, not a CTA.
 */
export function Field({
  id: idProp,
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  required,
  hint,
  error,
  name,
  placeholder,
  autoFocus,
  disabled,
}: FieldProps) {
  const reactId = useId();
  const id = idProp ?? reactId;
  const inputName = name ?? id;
  const hintId = hint || error ? `${id}-hint` : undefined;
  const borderClass = error
    ? 'border-red-400 focus:border-red-500 focus:ring-red-500/20'
    : 'border-border-light focus:border-accent-500 focus:ring-accent-500/20';

  return (
    <label htmlFor={id} className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium text-text-primary">{label}</span>
      <input
        id={id}
        name={inputName}
        type={type}
        autoComplete={autoComplete}
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={hintId}
        className={`rounded-lg border bg-bg-primary px-3 py-2.5 text-base text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60 ${borderClass}`}
      />
      {(hint || error) && (
        <span
          id={hintId}
          className={`text-[11px] ${error ? 'text-red-600 dark:text-red-400' : 'text-text-tertiary'}`}
        >
          {error ?? hint}
        </span>
      )}
    </label>
  );
}
