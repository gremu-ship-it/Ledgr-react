import { describe, expect, it } from 'vitest';
import {
  buildCode39Svg,
  encodeCode39,
  escapeBarcodeText,
  sanitizeCode39,
} from '../barcode';

describe('Code 39 encoder', () => {
  it('wraps the value in start/stop sentinels separated by one module', () => {
    const encoded = encodeCode39('SMP-2026-0001');
    expect(encoded).toMatch(/^100101101101/); // leading *
    expect(encoded).toMatch(/100101101101$/); // trailing *
    expect(encoded).toMatch(/^[01]+$/);
    // 12 modules per character, one gap between the 15 characters
    // (13 data characters plus the two sentinels) => 15*12 + 14.
    expect(encoded).toHaveLength(15 * 12 + 14);
  });

  it('uppercases and replaces characters outside the alphabet', () => {
    expect(sanitizeCode39('smp-2026-0001')).toBe('SMP-2026-0001');
    expect(sanitizeCode39('ab_12#')).toBe('AB-12-');
    expect(sanitizeCode39('   ')).toBe('');
  });

  it('returns an empty module string for an empty value', () => {
    expect(encodeCode39('')).toBe('');
    expect(buildCode39Svg('')).toBe('');
  });
});

describe('buildCode39Svg', () => {
  it('emits an accessible SVG with one rect per bar run', () => {
    const svg = buildCode39Svg('SMP-2026-0001', { width: 200, height: 50 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 ');
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="SMP-2026-0001"');
    expect(svg).toContain('<rect');
    expect(svg).toContain('<text');
    expect(svg).toContain('SMP-2026-0001');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('can omit the human-readable text', () => {
    const svg = buildCode39Svg('ABC123', { showText: false });
    expect(svg).not.toContain('<text');
    expect(svg).toContain('aria-label="ABC123"');
  });

  it('escapes text so a barcode cannot inject markup', () => {
    expect(escapeBarcodeText('<script>&"')).toBe('&lt;script&gt;&amp;&quot;');
    const svg = buildCode39Svg('<b>');
    expect(svg).not.toContain('<b>');
    expect(svg).toContain('aria-label="&lt;b&gt;"');
  });
});
