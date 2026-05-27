'use client';

import { useRouter } from 'next/navigation';
import type { CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowRight, KeyRound, LogOut, User } from 'lucide-react';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Three-card row exposing account actions from the dashboard.
 * Profile → /account, API keys → /dashboard/api-keys, Sign out → clears
 * the store and routes home.
 */
export function AccountLinksRow() {
  const router = useRouter();
  const clear = useAuthStore((s) => s.clear);

  const handleSignOut = () => {
    clear();
    router.push('/');
    router.refresh();
  };

  return (
    <section
      className="animate-reveal-up stagger-child grid grid-cols-1 gap-3 sm:grid-cols-3"
      style={{ '--i': 5 } as CSSProperties}
      aria-label="Account quick links"
    >
      <LinkCard
        href="/account"
        icon={<User className="h-4 w-4" aria-hidden />}
        title="Profile + settings"
        body="Update your name, change your password, manage preferences."
      />
      <LinkCard
        href="/dashboard/api-keys"
        icon={<KeyRound className="h-4 w-4" aria-hidden />}
        title="API keys"
        body="Issue, rotate, and revoke programmatic access tokens."
      />
      <button
        type="button"
        onClick={handleSignOut}
        className="motion-hover flex flex-col items-start gap-3 rounded-2xl border border-border-light bg-bg-primary p-5 text-left hover:-translate-y-px hover:border-accent-200 hover:bg-accent-50"
      >
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-bg-tertiary text-text-secondary">
          <LogOut className="h-4 w-4" aria-hidden />
        </span>
        <span className="flex flex-col gap-1">
          <span className="text-sm font-bold tracking-tight text-text-primary">
            Sign out
          </span>
          <span className="text-xs leading-relaxed text-text-secondary">
            End this session on this device. Your work stays put.
          </span>
        </span>
        <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-text-accent">
          Sign out <ArrowRight className="h-3 w-3" aria-hidden />
        </span>
      </button>
    </section>
  );
}

function LinkCard({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href as never}
      className="motion-hover flex flex-col items-start gap-3 rounded-2xl border border-border-light bg-bg-primary p-5 hover:-translate-y-px hover:border-accent-200 hover:bg-accent-50"
    >
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent-50 text-accent-700">
        {icon}
      </span>
      <span className="flex flex-col gap-1">
        <span className="text-sm font-bold tracking-tight text-text-primary">
          {title}
        </span>
        <span className="text-xs leading-relaxed text-text-secondary">{body}</span>
      </span>
      <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-text-accent">
        Open <ArrowRight className="h-3 w-3" aria-hidden />
      </span>
    </Link>
  );
}
