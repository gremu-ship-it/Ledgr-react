/**
 * Unit tests for the shared Edge-Function crypto helpers.
 *
 * These run under Node/vitest (the module deliberately uses only Web-standard
 * APIs). HMAC and SHA-256 are asserted against published test vectors — a
 * subtle regression (e.g. wrong encoding) would silently break PayChangu
 * webhook verification and the invoice tracking-pixel tokens.
 */
import { describe, it, expect } from 'vitest';
import { hmacSha256Hex, sha256Hex, timingSafeEqual } from '../crypto.ts';

describe('hmacSha256Hex', () => {
  it('matches the RFC 4231-style published vector', async () => {
    // key="key", message="The quick brown fox jumps over the lazy dog"
    await expect(hmacSha256Hex('key', 'The quick brown fox jumps over the lazy dog'))
      .resolves.toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  });

  it('produces 64 lowercase hex chars', async () => {
    await expect(hmacSha256Hex('secret', '{}')).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it('is keyed: different secrets sign the same payload differently', async () => {
    const a = await hmacSha256Hex('secret-a', '{"event":"x"}');
    const b = await hmacSha256Hex('secret-b', '{"event":"x"}');
    expect(a).not.toBe(b);
  });

  it('binds the exact payload bytes (no normalisation)', async () => {
    const compact = await hmacSha256Hex('secret', '{"a":1}');
    const spaced = await hmacSha256Hex('secret', '{ "a": 1 }');
    expect(compact).not.toBe(spaced);
  });
});

describe('sha256Hex', () => {
  it('matches the NIST test vector for "abc"', async () => {
    await expect(sha256Hex('abc'))
      .resolves.toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('matches the NIST test vector for the empty string', async () => {
    await expect(sha256Hex(''))
      .resolves.toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

describe('timingSafeEqual', () => {
  it('accepts identical strings', () => {
    expect(timingSafeEqual('abcdef0123456789', 'abcdef0123456789')).toBe(true);
  });

  it('rejects same-length strings differing in any position', () => {
    expect(timingSafeEqual('abcdef0123456789', 'abcdef0123456788')).toBe(false);
    expect(timingSafeEqual('7bcdef0123456789', 'abcdef0123456789')).toBe(false);
  });

  it('rejects different-length strings', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', 'a')).toBe(false);
  });

  it('accepts two empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('verifies a full round-trip signature comparison', async () => {
    const sig = await hmacSha256Hex('webhook-secret', '{"status":"success"}');
    expect(timingSafeEqual(sig, sig)).toBe(true);
    const forged = `0${sig.slice(1)}`;
    expect(timingSafeEqual(sig, forged)).toBe(false);
  });
});
