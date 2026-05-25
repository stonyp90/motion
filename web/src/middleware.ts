/**
 * Next.js middleware — gates the protected surface behind a NextAuth
 * session and redirects anonymous users to `/api/auth/signin`.
 *
 * The `auth` export from `lib/auth.ts` is callable as middleware in
 * NextAuth v5. Inside it, the `authorized` callback decides whether
 * to redirect.
 */

import { auth as middleware } from '@/lib/auth';

export default middleware;

export const config = {
  /**
   * Match the studio (the actual app surface) but skip:
   *  - static assets, image optimizer, favicon
   *  - the auth endpoints themselves (otherwise sign-in would loop)
   */
  matcher: ['/studio/:path*'],
};
