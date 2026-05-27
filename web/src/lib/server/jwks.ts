/**
 * JWKS verifier — server-only.
 *
 * Validates Keycloak-issued access tokens against the realm's JWKS
 * endpoint. Used by route handlers that must fail closed against
 * scripted (non-browser) access — e.g. the desktop installer download.
 *
 * Why a thin module:
 *   - `jose.createRemoteJWKSet` already does signature verification,
 *     JWKS rotation, and key caching for us. We just wrap it so the
 *     URL discovery (issuer + `/protocol/openid-connect/certs`) lives
 *     in one place and the cache is a true singleton across hot
 *     reloads and route handler invocations.
 *   - Cache TTL is 1h. Keycloak rotates signing keys infrequently
 *     (default never, in our realm export) and `jose` will refetch
 *     automatically when it encounters a `kid` it doesn't have.
 *   - The `verifyAccessToken` helper centralises the `iss / aud / exp /
 *     nbf / signature` checks so future protected endpoints don't have
 *     to repeat them.
 *
 * Env contract (mirrors web/src/lib/server/keycloak.ts):
 *   KEYCLOAK_ISSUER        — e.g. http://localhost:8080/realms/motion-forge
 *   KEYCLOAK_CLIENT_ID     — `motion-forge-web` (audience expected in tokens)
 *
 * Note on audience: Keycloak by default only emits an `aud` claim that
 * matches the client ID when an "audience" mapper is attached to the
 * client (we have one in the realm export). If the realm hasn't been
 * configured that way, tokens will fail audience validation here —
 * that's intentional. Fix the realm, not the verifier.
 */

import 'server-only';

import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyResult,
} from 'jose';

const DEFAULT_ISSUER = 'http://localhost:8080/realms/motion-forge';
const DEFAULT_AUDIENCE = 'motion-forge-web';

/** Cache lifetime for JWKS responses. 1h matches the task spec. */
const JWKS_CACHE_MAX_AGE_MS = 60 * 60 * 1000;
/** Cooldown between full JWKS refetches when `jose` sees an unknown kid. */
const JWKS_COOLDOWN_MS = 30 * 1000;

/** Result of a verification attempt. `null` => invalid for any reason. */
export type VerifiedJwt = JWTVerifyResult<JWTPayload> | null;

/**
 * Resolve the JWKS URL from the issuer.
 *
 * Keycloak exposes it at `<issuer>/protocol/openid-connect/certs`.
 * We don't hit `/.well-known/openid-configuration` because (a) it's a
 * second round trip on cold start and (b) the JWKS URL is part of the
 * stable OIDC contract — Keycloak isn't going to relocate it.
 */
function jwksUrl(issuer: string): URL {
  const trimmed = issuer.replace(/\/+$/, '');
  return new URL(`${trimmed}/protocol/openid-connect/certs`);
}

/**
 * Singleton JWKS cache, keyed by issuer so a test or env-change can
 * swap the URL without leaking the previous key set. Survives across
 * route handler invocations within the same process; Next.js hot
 * reloads will repopulate it on first request after a code change.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(issuer: string): ReturnType<typeof createRemoteJWKSet> {
  const existing = jwksCache.get(issuer);
  if (existing) return existing;
  const set = createRemoteJWKSet(jwksUrl(issuer), {
    cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
    cooldownDuration: JWKS_COOLDOWN_MS,
  });
  jwksCache.set(issuer, set);
  return set;
}

/**
 * Test seam: drop the cached JWKS for an issuer (or all of them).
 * Production code should never call this; tests use it to swap in a
 * mocked discovery endpoint between cases.
 */
export function __resetJwksCacheForTests(issuer?: string): void {
  if (issuer) jwksCache.delete(issuer);
  else jwksCache.clear();
}

/**
 * Verify a bearer token against the realm's JWKS. Returns the decoded
 * payload + protected header on success, or `null` on any verification
 * failure (bad signature, expired, wrong issuer/audience, malformed,
 * network error reaching the JWKS).
 *
 * We deliberately swallow the cause of failure here — a public download
 * endpoint should never leak whether the token was expired vs. forged
 * vs. issued by the wrong realm. Detailed reasons land in `console.warn`
 * so an operator can still triage from logs.
 */
export async function verifyAccessToken(token: string): Promise<VerifiedJwt> {
  if (!token) return null;

  const issuer = process.env.KEYCLOAK_ISSUER ?? DEFAULT_ISSUER;
  const audience = process.env.KEYCLOAK_CLIENT_ID ?? DEFAULT_AUDIENCE;
  const jwks = getJwks(issuer);

  try {
    return await jwtVerify(token, jwks, {
      issuer,
      audience,
      // jose checks `exp` and `nbf` by default; the algorithm allow-list
      // pins us to RS256 (Keycloak's default for the motion-forge realm)
      // so a token signed with `alg: none` or HS* can't slip through.
      algorithms: ['RS256'],
    });
  } catch (err) {
    // Distinct log lines per failure mode help operators triage without
    // leaking the cause to the caller.
    if (err instanceof joseErrors.JWTExpired) {
      console.warn('[jwks] token expired');
    } else if (err instanceof joseErrors.JWTClaimValidationFailed) {
      console.warn(`[jwks] claim validation failed: ${err.claim} (${err.reason})`);
    } else if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
      console.warn('[jwks] signature verification failed');
    } else if (err instanceof joseErrors.JWKSNoMatchingKey) {
      console.warn('[jwks] no matching signing key for kid');
    } else {
      console.warn(
        `[jwks] verify failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return null;
  }
}
