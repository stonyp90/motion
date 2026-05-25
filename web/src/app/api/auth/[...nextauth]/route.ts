/**
 * NextAuth v5 catch-all route. All `/api/auth/*` requests
 * (sign-in, callback, session, sign-out, csrf, providers) flow
 * through the GET / POST handlers exported by `lib/auth.ts`.
 */

import { handlers } from '@/lib/auth';

export const { GET, POST } = handlers;
