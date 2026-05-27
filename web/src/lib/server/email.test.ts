/**
 * Unit tests for the ACS endpoint parser used by the email signer.
 *
 * Mirrors the Rust suite in `engine/crates/http/src/notifications.rs`
 * so both signers reject the same set of bad values + accept the same
 * set of good ones. If you add a case here, add the equivalent on the
 * Rust side too — they're parts of the same wire contract.
 *
 * `email.ts` opens with `import 'server-only'`, which throws at import
 * time outside a server bundle. We stub that module here so Vitest can
 * load the file in a Node test environment.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { parseAcsEndpoint } from './email';

describe('parseAcsEndpoint', () => {
  it('accepts a bare ACS hostname (happy path)', () => {
    const r = parseAcsEndpoint('acs-foo.communication.azure.com');
    expect(r).toEqual({ ok: true, host: 'acs-foo.communication.azure.com' });
  });

  it('strips a leading https:// prefix', () => {
    const r = parseAcsEndpoint('https://acs-foo.communication.azure.com');
    expect(r).toEqual({ ok: true, host: 'acs-foo.communication.azure.com' });
  });

  it('strips a leading https:// prefix and trailing slash', () => {
    const r = parseAcsEndpoint('https://acs-foo.communication.azure.com/');
    expect(r).toEqual({ ok: true, host: 'acs-foo.communication.azure.com' });
  });

  it('strips a leading http:// prefix', () => {
    const r = parseAcsEndpoint('http://acs-foo.communication.azure.com');
    expect(r).toEqual({ ok: true, host: 'acs-foo.communication.azure.com' });
  });

  it('is case-insensitive for the scheme and the hostname', () => {
    const r = parseAcsEndpoint('HTTPS://ACS-FOO.communication.AZURE.com');
    expect(r).toEqual({ ok: true, host: 'acs-foo.communication.azure.com' });
  });

  it('strips a trailing path so a copy-pasted full URL still parses', () => {
    const r = parseAcsEndpoint(
      'https://acs-foo.communication.azure.com/emails:send?api-version=2023-03-31'
    );
    expect(r).toEqual({ ok: true, host: 'acs-foo.communication.azure.com' });
  });

  it('rejects a hostname with the wrong TLD', () => {
    const r = parseAcsEndpoint('acs-foo.communication.azure.net');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('AZURE_COMMS_ENDPOINT');
      expect(r.error).toContain('acs-foo.communication.azure.net');
    }
  });

  it('rejects an IPv4 literal', () => {
    const r = parseAcsEndpoint('10.0.0.1');
    expect(r.ok).toBe(false);
  });

  it('rejects an extra attacker-controlled subdomain', () => {
    // Defense in depth: don't accept a hostname chained onto the legit
    // suffix — the leftmost label has to be one DNS segment.
    const r = parseAcsEndpoint('evil.acs-foo.communication.azure.com');
    expect(r.ok).toBe(false);
  });

  it('rejects an empty string', () => {
    const r = parseAcsEndpoint('');
    expect(r).toEqual({ ok: false, error: 'AZURE_COMMS_ENDPOINT is empty' });
  });

  it('rejects whitespace-only input', () => {
    const r = parseAcsEndpoint('   ');
    expect(r).toEqual({ ok: false, error: 'AZURE_COMMS_ENDPOINT is empty' });
  });

  it('rejects undefined and null', () => {
    expect(parseAcsEndpoint(undefined)).toEqual({
      ok: false,
      error: 'AZURE_COMMS_ENDPOINT is empty',
    });
    expect(parseAcsEndpoint(null)).toEqual({
      ok: false,
      error: 'AZURE_COMMS_ENDPOINT is empty',
    });
  });

  it('rejects a bare suffix (empty label)', () => {
    const r = parseAcsEndpoint('.communication.azure.com');
    expect(r.ok).toBe(false);
  });

  it('rejects a label containing an underscore', () => {
    const r = parseAcsEndpoint('acs_foo.communication.azure.com');
    expect(r.ok).toBe(false);
  });

  it('rejects a label starting with a hyphen (RFC 1035)', () => {
    const r = parseAcsEndpoint('-foo.communication.azure.com');
    expect(r.ok).toBe(false);
  });

  it('rejects a label ending with a hyphen (RFC 1035)', () => {
    const r = parseAcsEndpoint('foo-.communication.azure.com');
    expect(r.ok).toBe(false);
  });
});
