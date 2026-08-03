/**
 * Tests for the shared HTML-escape and SHA-256 helpers.
 *
 * escapeHtml guards every `document.write` print path (audit exports,
 * repayment schedules, generated documents) against stored XSS from
 * user-supplied values — a regression here reopens that vector.
 */
import { describe, it, expect } from 'vitest';
import { escapeHtml, sha256Hex, toHex } from '@/lib/html';

describe('escapeHtml', () => {
  it('escapes all five markup-significant characters', () => {
    expect(escapeHtml(`<script>alert("x") & 'y'</script>`))
      .toBe('&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;');
  });

  it('neutralises the title-breakout payload from the CapitalPage report', () => {
    expect(escapeHtml('</title><img src=x onerror=alert(1)>'))
      .not.toContain('</title>');
  });

  it('escapes ampersands first so entities are not double-escaped', () => {
    expect(escapeHtml('R&D <em>')).toBe('R&amp;D &lt;em&gt;');
  });

  it('returns an empty string for null and undefined', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('passes through safe text unchanged', () => {
    expect(escapeHtml('NBS Bank — Loan #42 (MK)')).toBe('NBS Bank — Loan #42 (MK)');
  });
});

describe('sha256Hex', () => {
  it('matches the published SHA-256 test vector for "abc"', async () => {
    // NIST FIPS 180-4 example vector
    await expect(sha256Hex('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is deterministic across calls', async () => {
    const a = await sha256Hex('<h1>export</h1>');
    const b = await sha256Hex('<h1>export</h1>');
    expect(a).toBe(b);
  });

  it('changes when the content changes (no random padding)', async () => {
    const a = await sha256Hex('<h1>export</h1>');
    const b = await sha256Hex('<h1>export2</h1>');
    expect(a).not.toBe(b);
  });

  it('encodes as 64 lowercase hex characters', async () => {
    const hex = await sha256Hex('anything');
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('toHex', () => {
  it('renders bytes as zero-padded hex', () => {
    expect(toHex(new Uint8Array([0, 1, 15, 255]).buffer)).toBe('00010fff');
  });
});
