import { describe, expect, it } from 'vitest';
import { resolveProxyTarget } from '../proxyTarget.js';

describe('resolveProxyTarget', () => {
  const target = 'https://project.supabase.co/functions/v1/api';

  it('preserves the configured function base path and request query', () => {
    expect(resolveProxyTarget(target, '/api/v1/invoices?page=2&status=draft').toString()).toBe(
      'https://project.supabase.co/functions/v1/api/api/v1/invoices?page=2&status=draft',
    );
  });

  it('keeps scheme and authority pinned to TARGET_URL', () => {
    const resolved = resolveProxyTarget(target, '/api/v1/http://evil.example/path');
    expect(resolved.origin).toBe('https://project.supabase.co');
    expect(resolved.pathname).toBe('/functions/v1/api/api/v1/http://evil.example/path');
  });

  it('rejects protocol-relative, backslash and malformed paths', () => {
    expect(() => resolveProxyTarget(target, '//evil.example/api/v1/invoices')).toThrow();
    expect(() => resolveProxyTarget(target, '/api/v1/%5C%5Cevil.example')).toThrow();
    expect(() => resolveProxyTarget(target, '/api/v1/%ZZ')).toThrow();
    expect(() => resolveProxyTarget(target, '/health')).toThrow();
  });

  it('rejects target credentials, query strings and non-http protocols', () => {
    expect(() => resolveProxyTarget('https://user:pass@example.com/api', '/api/v1/test')).toThrow();
    expect(() => resolveProxyTarget('https://example.com/api?tenant=x', '/api/v1/test')).toThrow();
    expect(() => resolveProxyTarget('file:///tmp/api', '/api/v1/test')).toThrow();
  });
});
