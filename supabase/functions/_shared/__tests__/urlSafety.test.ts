/**
 * Unit tests for the Edge-Function URL/IP safety helpers.
 *
 * `isPrivateIp` is the SSRF guard for user-configured webhook destinations —
 * the webhook-dispatcher refuses to deliver to anything this function flags.
 * Failures here must be LOUD for public addresses (false positive = broken
 * deliveries) and conservative for anything ambiguous (fail closed).
 */
import { describe, it, expect } from 'vitest';
import { isPrivateIp, normalizeAppUrl } from '../urlSafety.ts';

describe('isPrivateIp — RFC 1918 & loopback (must be rejected)', () => {
  it.each([
    '10.0.0.1',
    '10.255.255.255',
    '172.16.0.5',
    '172.31.255.255',
    '192.168.1.1',
    '127.0.0.1',
    '127.255.255.254',
    '0.0.0.0',
  ])('flags %s as private', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });
});

describe('isPrivateIp — special-use ranges attackers target', () => {
  it.each([
    ['169.254.169.254', 'cloud metadata endpoint (link-local)'],
    ['169.254.1.1', 'link-local'],
    ['100.64.0.1', 'CGNAT'],
    ['100.127.255.255', 'CGNAT upper bound'],
    ['192.0.2.1', 'documentation range 192.0.2.0/24'],
    ['192.0.0.1', 'reserved 192.0.0.0/24 block'],
    ['198.18.0.1', 'benchmarking range'],
    ['198.19.255.255', 'benchmarking upper bound'],
    ['224.0.0.1', 'multicast'],
    ['255.255.255.255', 'broadcast/reserved'],
  ])('flags %s (%s) as private', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });
});

describe('isPrivateIp — IPv6', () => {
  it.each([
    '::1',          // loopback
    '::',           // unspecified
    'fc00::1',      // unique local
    'fd12:3456::1', // unique local
    'fe80::1',      // link-local
    'fea0::1',      // link-local range
    '2001:db8::1',  // documentation range
    '::ffff:10.0.0.1',   // IPv4-mapped private
    '::ffff:192.168.0.1', // IPv4-mapped private
    '[::1]',        // bracketed form
  ])('flags %s as private', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it('follows a public IPv4-mapped address through to public', () => {
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false);
  });
});

describe('isPrivateIp — public addresses must NOT be blocked', () => {
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '100.63.255.255',  // just below CGNAT start
    '100.128.0.0',     // just above CGNAT end
    '172.15.255.255',  // just below 172.16/12
    '172.32.0.0',      // just above 172.16/12
    '169.253.255.255', // just below link-local
    '169.255.0.0',     // just above link-local
    '193.0.0.1',
    '198.17.255.255',  // just below benchmarking
    '223.255.255.255', // just below multicast
    '2606:4700:4700::1111', // Cloudflare v6
  ])('allows %s as public', (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });
});

describe('isPrivateIp — malformed IPv4 fails closed', () => {
  it.each([
    '999.1.1.1', // octet out of range
    '256.0.0.1',
    '10.0.0.256',
  ])('flags %s as private/invalid', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it('treats non-IP hostnames as not-an-IP (DNS resolution guards them upstream)', () => {
    // isPrivateIp only understands IP literals; assertPublicWebhookDestination
    // separately rejects 'localhost' and requires public DNS records for
    // hostnames, so hostnames must pass through here unflagged.
    expect(isPrivateIp('localhost')).toBe(false);
    expect(isPrivateIp('example.com')).toBe(false);
  });
});

describe('normalizeAppUrl', () => {
  it('accepts a plain https URL and strips trailing slashes', () => {
    expect(normalizeAppUrl('https://app.ledgr.com/')).toBe('https://app.ledgr.com');
    expect(normalizeAppUrl('https://app.ledgr.com///')).toBe('https://app.ledgr.com');
  });

  it('recovers from a Markdown-pasted APP_URL', () => {
    expect(normalizeAppUrl('[https://ledgr-react.vercel.app](https://ledgr-react.vercel.app)'))
      .toBe('https://ledgr-react.vercel.app');
    expect(normalizeAppUrl('[app](https://app.ledgr.com/)')).toBe('https://app.ledgr.com');
  });

  it('extracts a URL embedded in surrounding prose', () => {
    expect(normalizeAppUrl('use https://app.ledgr.com for redirects'))
      .toBe('https://app.ledgr.com');
  });

  it('permits http only for local development hosts', () => {
    expect(normalizeAppUrl('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('rejects missing or empty values', () => {
    expect(normalizeAppUrl(undefined)).toBeNull();
    expect(normalizeAppUrl(null)).toBeNull();
    expect(normalizeAppUrl('')).toBeNull();
    expect(normalizeAppUrl('   ')).toBeNull();
  });

  it('rejects non-http(s) schemes (open-redirect / javascript: defence)', () => {
    expect(normalizeAppUrl('ftp://files.example.com')).toBeNull();
    expect(normalizeAppUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects garbage that is not a URL', () => {
    expect(normalizeAppUrl('not a url at all')).toBeNull();
  });
});
