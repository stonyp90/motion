/**
 * NextAuth v5 configuration for motion-forge.
 *
 * Wires the Keycloak realm `motion-forge` as the only sign-in provider.
 * The access token issued by Keycloak is the one the engine validates
 * server-side via JWKS — we stash it on the session so the API client
 * (`lib/api.ts`) can forward it as a bearer.
 *
 * All settings come from env so this file is reusable across dev /
 * preview / prod without code changes:
 *
 * - `KEYCLOAK_ISSUER`         e.g. `http://localhost:8080/realms/motion-forge`
 * - `KEYCLOAK_CLIENT_ID`      e.g. `motion-forge-web`
 * - `KEYCLOAK_CLIENT_SECRET`  the confidential client secret
 * - `AUTH_SECRET`             NextAuth session-encryption secret
 * - `NEXTAUTH_URL` (optional) explicit base URL for callbacks
 */

import NextAuth from 'next-auth';
import type { NextAuthConfig } from 'next-auth';
import Keycloak from 'next-auth/providers/keycloak';

export const authConfig: NextAuthConfig = {
  // Trust the host header behind Vercel / reverse proxies.
  trustHost: true,
  providers: [
    Keycloak({
      clientId: process.env.KEYCLOAK_CLIENT_ID ?? 'motion-forge-web',
      clientSecret: process.env.KEYCLOAK_CLIENT_SECRET ?? '',
      issuer: process.env.KEYCLOAK_ISSUER ?? 'http://localhost:8080/realms/motion-forge',
    }),
  ],
  callbacks: {
    /**
     * Persist the access token + refresh token + expiry on the JWT
     * so the session callback can expose them to client code.
     */
    async jwt({ token, account, profile }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
        token.idToken = account.id_token;
      }
      if (profile) {
        const p = profile as Record<string, unknown>;
        if (typeof p.preferred_username === 'string') {
          token.preferredUsername = p.preferred_username;
        }
        const realmAccess = p.realm_access as { roles?: string[] } | undefined;
        if (realmAccess?.roles) {
          token.roles = realmAccess.roles;
        }
      }
      return token;
    },
    /**
     * Surface the access token + roles on the session object so
     * client + server code can read them without re-hitting the
     * provider.
     */
    async session({ session, token }) {
      // @ts-expect-error — augmenting the default Session shape.
      session.accessToken = token.accessToken;
      // @ts-expect-error — augmenting the default Session shape.
      session.roles = token.roles ?? [];
      // @ts-expect-error — augmenting the default Session shape.
      session.preferredUsername = token.preferredUsername;
      return session;
    },
    /**
     * The middleware in `src/middleware.ts` calls this to decide
     * whether to let a request through. Keep it pure: no DB calls,
     * no slow checks.
     */
    authorized({ auth, request }) {
      const isLoggedIn = !!auth?.user;
      const pathname = request.nextUrl.pathname;
      // The studio is the protected surface. Marketing pages stay
      // open — they're SEO-critical landing pages.
      const isProtected = pathname.startsWith('/studio');
      if (isProtected) return isLoggedIn;
      return true;
    },
  },
  pages: {
    // Use the default NextAuth sign-in page; we provide our own button
    // (components/auth/SignInButton.tsx) that calls signIn('keycloak')
    // directly so users never see this page in the happy path.
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
