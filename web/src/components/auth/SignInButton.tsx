/**
 * Small button that kicks off the Keycloak Auth-Code+PKCE flow via
 * NextAuth. Drop into any client component; styles inherit from the
 * existing button utility classes (`btn-primary` / `btn-ghost`).
 *
 * The Header (owned by W1) imports this directly. If W1 hasn't
 * landed the new Header yet, the existing `Header.tsx` placeholder
 * can be swapped manually by replacing the `<a>` "Book a demo" with
 * `<SignInButton>Sign in</SignInButton>`.
 */

'use client';

import { signIn, signOut } from 'next-auth/react';
import type { ReactNode } from 'react';

interface SignInButtonProps {
  /** Where to send the user once they're signed in. Defaults to the studio. */
  callbackUrl?: string;
  /** Visual variant — falls back to the primary button. */
  variant?: 'primary' | 'ghost';
  /** Button label; defaults to "Sign in". */
  children?: ReactNode;
  className?: string;
}

export function SignInButton({
  callbackUrl = '/studio',
  variant = 'primary',
  children = 'Sign in',
  className,
}: SignInButtonProps) {
  const base = variant === 'primary' ? 'btn-primary' : 'btn-ghost';
  return (
    <button
      type="button"
      onClick={() => signIn('keycloak', { callbackUrl })}
      className={`${base} py-2 text-sm ${className ?? ''}`}
    >
      {children}
    </button>
  );
}

interface SignOutButtonProps {
  callbackUrl?: string;
  variant?: 'primary' | 'ghost';
  children?: ReactNode;
  className?: string;
}

export function SignOutButton({
  callbackUrl = '/',
  variant = 'ghost',
  children = 'Sign out',
  className,
}: SignOutButtonProps) {
  const base = variant === 'primary' ? 'btn-primary' : 'btn-ghost';
  return (
    <button
      type="button"
      onClick={() => signOut({ callbackUrl })}
      className={`${base} py-2 text-sm ${className ?? ''}`}
    >
      {children}
    </button>
  );
}
