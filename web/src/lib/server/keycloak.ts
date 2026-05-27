/**
 * Keycloak helpers — server-only.
 *
 * Every function here runs inside a Next.js Route Handler. The
 * browser never sees the `motion-forge-web` client secret, the
 * master-realm admin password, or any token endpoint URL — it only
 * sees JSON shapes we hand back from `/api/auth/*` routes.
 *
 * Env contract (set in web/.env.local for dev; see .env.example for prod):
 *   KEYCLOAK_ISSUER         — e.g. http://127.0.0.1:8080/realms/controlcraft
 *   KEYCLOAK_CLIENT_ID      — `motion-forge-web`
 *   KEYCLOAK_CLIENT_SECRET  — confidential-client secret
 *   KEYCLOAK_ADMIN_USER     — master realm bootstrap admin (default `admin`)
 *   KEYCLOAK_ADMIN_PASSWORD — master realm bootstrap admin pw (default `admin`)
 */

import 'server-only';

const ISSUER = process.env.KEYCLOAK_ISSUER ?? 'http://127.0.0.1:8080/realms/controlcraft';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? 'motion-forge-web';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET ?? '';

/**
 * Master-realm admin creds. We refuse to use the well-known bootstrap
 * `admin/admin` defaults at runtime in production: any Keycloak that
 * still has those creds enabled would be fully compromised by an
 * attacker who reached the master realm. Local dev still gets the
 * convenience default because the docker-compose Keycloak isn't
 * reachable from the public internet and is wiped on every restart.
 *
 * `IS_PRODUCTION` follows the standard `NODE_ENV` convention. The
 * check fires lazily inside `requireSafeAdminCreds()` so Next.js's
 * build-time page data collection doesn't trip it (build runs with
 * `NODE_ENV=production` but no Azure secret block in scope).
 */
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const ADMIN_USER = process.env.KEYCLOAK_ADMIN_USER ?? (IS_PRODUCTION ? '' : 'admin');
const ADMIN_PASSWORD = process.env.KEYCLOAK_ADMIN_PASSWORD ?? (IS_PRODUCTION ? '' : 'admin');

function requireSafeAdminCreds(): void {
  if (!IS_PRODUCTION) return;
  if (!ADMIN_USER || !ADMIN_PASSWORD) {
    throw new Error(
      'KEYCLOAK_ADMIN_USER and KEYCLOAK_ADMIN_PASSWORD must be set in production. ' +
        'Refusing to authenticate with the well-known admin/admin defaults.',
    );
  }
  if (ADMIN_USER === 'admin' && ADMIN_PASSWORD === 'admin') {
    throw new Error(
      'KEYCLOAK_ADMIN_PASSWORD is set to the well-known default "admin" in production. ' +
        'Rotate the master realm bootstrap credentials before serving traffic.',
    );
  }
}

/** Derive the master-realm base URL from the realm-scoped issuer. */
function masterBase(): string {
  const u = new URL(ISSUER);
  // /realms/controlcraft → /realms/master
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
  // Lazy production-safety check: fires the first time a real request
  // tries to hit the admin endpoint, NOT at module load (which would
  // break Next.js's build-time page data collection).
  requireSafeAdminCreds();

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
 * enabled, NOT email-verified — verify-email runs in our Next.js layer
 * via /api/auth/verify-email. Login refuses tokens until the user
 * clicks the link in the verification email. Returns the user id.
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
      emailVerified: false,
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

export interface KcUser {
  id: string;
  email: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  emailVerified: boolean;
  enabled: boolean;
  createdTimestamp?: number;
}

/**
 * Look up a Keycloak user by email. Used by the verify / forgot-password
 * routes which key off email (the user has not yet authenticated).
 * Returns null when no user matches — the API routes always respond 200
 * regardless, so this nullable shape is the enumeration-safe contract.
 */
export async function adminFindUserByEmail(email: string): Promise<KcUser | null> {
  const token = await adminToken();
  const url = new URL(`${adminBase()}/users`);
  url.searchParams.set('email', email);
  url.searchParams.set('exact', 'true');
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new KcError(r.status, `find user failed: ${text.slice(0, 200)}`);
  }
  const arr = (await r.json()) as KcUser[];
  return arr[0] ?? null;
}

/** Fetch a user by id (the JWT `sub` claim). */
export async function adminGetUser(userId: string): Promise<KcUser> {
  const token = await adminToken();
  const r = await fetch(`${adminBase()}/users/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new KcError(r.status, `get user failed: ${text.slice(0, 200)}`);
  }
  return (await r.json()) as KcUser;
}

/**
 * Mark a user's email as verified. Idempotent — the verify endpoint
 * tolerates re-clicks because we treat already-verified as success.
 */
export async function adminSetEmailVerified(userId: string): Promise<void> {
  return adminUpdateUser(userId, { emailVerified: true });
}

/** Patch a user's profile (currently firstName / lastName / emailVerified / enabled). */
export async function adminUpdateUser(
  userId: string,
  patch: Partial<Pick<KcUser, 'firstName' | 'lastName' | 'emailVerified' | 'enabled'>>,
): Promise<void> {
  const token = await adminToken();
  const r = await fetch(`${adminBase()}/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
    cache: 'no-store',
  });
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new KcError(r.status, `update user failed: ${text.slice(0, 200)}`);
  }
}

/**
 * Set a permanent (non-temporary) password for a user via admin REST.
 * Used by the forgot-password and change-password flows.
 */
export async function adminResetPassword(userId: string, newPassword: string): Promise<void> {
  const token = await adminToken();
  const r = await fetch(
    `${adminBase()}/users/${encodeURIComponent(userId)}/reset-password`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'password', value: newPassword, temporary: false }),
      cache: 'no-store',
    },
  );
  if (!r.ok) {
    const text = await r.text().catch(() => '');
    throw new KcError(r.status, `reset password failed: ${text.slice(0, 200)}`);
  }
}

/**
 * Disable a user account. v1 of "delete account" — recoverable by an
 * admin via the Keycloak UI within the grace period; we'll move to
 * hard-delete (`DELETE /users/{id}`) once a retention policy lands.
 */
export async function adminDisableUser(userId: string): Promise<void> {
  return adminUpdateUser(userId, { enabled: false });
}

/** Hard-delete a Keycloak user. Use with care — irreversible. */
export async function adminDeleteUser(userId: string): Promise<void> {
  const token = await adminToken();
  const r = await fetch(`${adminBase()}/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!r.ok && r.status !== 404) {
    const text = await r.text().catch(() => '');
    throw new KcError(r.status, `delete user failed: ${text.slice(0, 200)}`);
  }
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
