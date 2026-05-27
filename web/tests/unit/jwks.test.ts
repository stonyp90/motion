/**
 * Unit tests for the JWKS verifier (src/lib/server/jwks.ts).
 *
 * Runs under Node's built-in `node:test` runner — no jest/vitest in
 * this repo. Invoke with `npm test` from web/. The runner picks up
 * TypeScript directly via Node 22+'s on-by-default type stripping.
 *
 * Strategy:
 *   - Generate a fresh RSA key pair per process with `jose`.
 *   - Stand up a tiny `http` server that returns its public key as a
 *     JWKS document at `/realms/<realm>/protocol/openid-connect/certs`.
 *   - Point `KEYCLOAK_ISSUER` at the local server so the verifier's
 *     URL discovery hits our mock instead of a real Keycloak.
 *   - Reset the JWKS cache between tests via the `__resetJwksCacheForTests`
 *     escape hatch so each scenario gets a fresh state.
 */

import { strict as assert } from 'node:assert';
import { after, before, beforeEach, describe, test } from 'node:test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JWK,
} from 'jose';

import {
  __resetJwksCacheForTests,
  verifyAccessToken,
} from '../../src/lib/server/jwks.ts';

const REALM = 'motion-forge';
const AUDIENCE = 'motion-forge-web';

interface Fixture {
  /** Private signing key, used to mint tokens. */
  privateKey: CryptoKey;
  /** Public JWK exposed on the mock JWKS endpoint. */
  publicJwk: JWK;
  /** Mock HTTP server (Keycloak stand-in). */
  server: Server;
  /** Base URL of the mock server, e.g. http://127.0.0.1:54321 */
  baseUrl: string;
  /** Issuer URL — `${baseUrl}/realms/${REALM}` */
  issuer: string;
}

const fixture: Partial<Fixture> = {};

before(async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', {
    extractable: true,
  });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = 'test-key-1';
  publicJwk.use = 'sig';
  publicJwk.alg = 'RS256';

  const server = createServer((req, res) => {
    // Mock only the JWKS endpoint. Anything else 404s — the verifier
    // shouldn't be hitting anything else.
    if (req.url === `/realms/${REALM}/protocol/openid-connect/certs`) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const issuer = `${baseUrl}/realms/${REALM}`;

  fixture.privateKey = privateKey;
  fixture.publicJwk = publicJwk;
  fixture.server = server;
  fixture.baseUrl = baseUrl;
  fixture.issuer = issuer;

  process.env.KEYCLOAK_ISSUER = issuer;
  process.env.KEYCLOAK_CLIENT_ID = AUDIENCE;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    fixture.server!.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  // Each test gets a fresh JWKS cache so a previous scenario's success
  // doesn't mask the next one's failure mode.
  __resetJwksCacheForTests();
});

/**
 * Sign a JWT against the fixture key. Defaults give a passing token;
 * pass overrides to forge an invalid one.
 */
async function mintToken(
  overrides: {
    issuer?: string;
    audience?: string;
    kid?: string;
    expSecondsFromNow?: number;
    nbfSecondsFromNow?: number;
    subject?: string;
  } = {},
): Promise<string> {
  const {
    issuer = fixture.issuer!,
    audience = AUDIENCE,
    kid = fixture.publicJwk!.kid!,
    expSecondsFromNow = 60,
    nbfSecondsFromNow = -5,
    subject = 'user-abc',
  } = overrides;

  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ scope: 'openid profile email' })
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt(now)
    .setNotBefore(now + nbfSecondsFromNow)
    .setExpirationTime(now + expSecondsFromNow)
    .setSubject(subject)
    .sign(fixture.privateKey!);
}

describe('verifyAccessToken', () => {
  test('accepts a freshly signed token with the right issuer + audience', async () => {
    const token = await mintToken();
    const result = await verifyAccessToken(token);
    assert.ok(result, 'expected verification to succeed');
    assert.equal(result!.payload.aud, AUDIENCE);
    assert.equal(result!.payload.iss, fixture.issuer);
    assert.equal(result!.payload.sub, 'user-abc');
  });

  test('rejects an expired token', async () => {
    const token = await mintToken({ expSecondsFromNow: -10 });
    const result = await verifyAccessToken(token);
    assert.equal(result, null);
  });

  test('rejects a not-yet-valid (nbf in future) token', async () => {
    const token = await mintToken({
      nbfSecondsFromNow: 600, // 10 min in future
      expSecondsFromNow: 1200,
    });
    const result = await verifyAccessToken(token);
    assert.equal(result, null);
  });

  test('rejects a token with the wrong audience', async () => {
    const token = await mintToken({ audience: 'some-other-client' });
    const result = await verifyAccessToken(token);
    assert.equal(result, null);
  });

  test('rejects a token with the wrong issuer', async () => {
    const token = await mintToken({
      issuer: 'http://127.0.0.1:1/realms/imposter',
    });
    const result = await verifyAccessToken(token);
    assert.equal(result, null);
  });

  test('rejects a token signed with an unknown kid', async () => {
    const token = await mintToken({ kid: 'kid-that-is-not-in-the-jwks' });
    const result = await verifyAccessToken(token);
    assert.equal(result, null);
  });

  test('rejects an empty token string', async () => {
    const result = await verifyAccessToken('');
    assert.equal(result, null);
  });

  test('rejects a token with a tampered payload', async () => {
    const token = await mintToken();
    // Flip a character in the payload portion (middle segment).
    const parts = token.split('.');
    const tampered = `${parts[0]}.${parts[1].replace(/.$/, (c) =>
      c === 'A' ? 'B' : 'A',
    )}.${parts[2]}`;
    const result = await verifyAccessToken(tampered);
    assert.equal(result, null);
  });

  test('rejects a malformed token (not three segments)', async () => {
    const result = await verifyAccessToken('not.a.valid.jwt');
    assert.equal(result, null);
  });
});
