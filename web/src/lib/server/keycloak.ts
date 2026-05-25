/**
 * Keycloak helpers — server-only.
 *
 * Every function here runs inside a Next.js Route Handler. The
 * browser never sees the `motion-forge-web` client secret, the
 * master-realm admin password, or any token endpoint URL — it only
 * sees JSON shapes we hand back from `/api/auth/*` routes.
 *
 * Env contract (set in web/.env.local for dev; see .env.example for prod):
 *   KEYCLOAK_ISSUER         — e.g. http://127.0.0.1:8080/realms/motion-forge
 *   KEYCLOAK_CLIENT_ID      — `motion-forge-web`
 *   KEYCLOAK_CLIENT_SECRET  — confidential-client secret
 *   KEYCLOAK_ADMIN_USER     — master realm bootstrap admin (default `admin`)
 *   KEYCLOAK_ADMIN_PASSWORD — master realm bootstrap admin pw (default `admin`)
 */

import 'server-only';

const ISSUER = process.env.KEYCLOAK_ISSUER ?? 'http://127.0.0.1:8080/realms/motion-forge';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'motion-forge-web';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';
const ADMIN_USER = process.env.KEYCLOAK_ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD ?? 'admin';

/** Derive the master-realm base URL from the realm-scoped issuer. */
function masterBase(): string {
  const u = new URL(ISSUER);
  // /realms/motion-forge → /realms/master
  u.pathname = u.pathname.replace(/\/realms\/[^/]+\/?$/, '/realms/master');
  return u.toString().replace(/\/$/, '');
}

/** Derive the admin REST base URL from the issuer (`/admin/realms/<realm>`). */
function adminBase(): string {
  const u = new URL(ISSUER);
  const m = u.pathname.match(/\/realms\/([^/]+)\/?$/);
  const realm = m?.[1];
  if (!realm) throw new Error(`KEYCLOAK_ISSUER missing /realms/<name>: ${ISSUER}`);
  u.pathname = `/admin/realms/${realm}`;
  return u.toString().replace(/\/$/, '');
}

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in?: number;
  token_type: string;
  scope?: string;
}

/**
 * Direct-grant ("password") login against the `motion-forge-web` client.
 * The realm export enables `directAccessGrantsEnabled` so this works.
 */
export async function passwordLogin(username: string, password: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    username,
    password,
    scope: 'openid profile email',
  });
  const r = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new KcError(r.status, parseKcError(text) ?? 'invalid credentials');
  }
  return (await r.json()) as TokenSet;
}

/** Refresh an access token using a refresh_token issued earlier. */
export async function refreshTokens(refreshToken: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: refreshToken,
  });
  const r = await fetch(`${ISSUER}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new KcError(r.status, parseKcError(text) ?? 'refresh failed');
  }
  return (await r.json()) as TokenSet;
}

/**
 * Master-realm admin token via `admin-cli` direct grant. Cached in
 * module scope until expiry-30s so concurrent register calls share
 * one round-trip.
 */
let adminTokenCache: { token: string; expiresAt: number } | null = null;
async function adminToken(): Promise<string> {
  const now = Date.now();
  if (adminTokenCache && adminTokenCache.expiresAt > now + 30_000) {
    return adminTokenCache.token;
  }
  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: ADMIN_USER,
    password: ADMIN_PASSWORD,
  });
  const r = await fetch(`${masterBase()}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new KcError(r.status, `admin login failed: ${text.slice(0, 200)}`);
  }
  const t = (await r.json()) as TokenSet;
  adminTokenCache = {
    token: t.access_token,
    expiresAt: now + t.expires_in * 1000,
  };
  return t.access_token;
}

export interface CreateUserInput {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}

/**
 * Create a Keycloak user via the Admin REST API. The new user is
 * enabled, email-verified (verifyEmail is disabled at the realm
 * level), and given a permanent password. Returns the user id.
 *
 * Throws `KcError(409, ...)` if the email is taken.
 */
export async function adminCreateUser(input: CreateUserInput): Promise<string> {
  const token = await adminToken();
  const r = await fetch(`${adminBase()}/users`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: input.email,
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      enabled: true,
      emailVerified: true,
      credentials: [
        { type: 'password', value: input.password, temporary: false },
      ],
    }),
    cache: 'no-store',
  });
  if (r.status === 409) {
    throw new KcError(409, 'email already registered');
  }
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new KcError(r.status, `create user failed: ${text.slice(0, 200)}`);
  }
  // Keycloak returns the user id in the Location header.
  const loc = r.headers.get('location');
  const id = loc?.split('/').pop() ?? '';
  return id;
}

/** Map Keycloak's various error shapes to a human-readable string. */
function parseKcError(body: string): string | null {
  try {
    const j = JSON.parse(body) as { error?: string; error_description?: string };
    return j.error_description || j.error || null;
  } catch {
    return null;
  }
}

export class KcError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'KcError';
  }
}
