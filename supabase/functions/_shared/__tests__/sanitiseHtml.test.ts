/**
 * Unit tests for the email-body HTML sanitiser used by send-invoice.
 *
 * If this function regresses, an attacker controlling the invoice email
 * `html` parameter could ship script-capable markup to a recipient's inbox.
 */
import { describe, it, expect } from 'vitest';
import { sanitiseHtml } from '../sanitiseHtml.ts';

describe('sanitiseHtml — executable content is destroyed', () => {
  it('removes script tags and their content', () => {
    expect(sanitiseHtml('<p>Hi</p><script>alert(1)</script>')).toBe('<p>Hi</p>');
  });

  it('removes self-closing / src-only script tags', () => {
    expect(sanitiseHtml('<script src="https://evil.example/x.js"></script><p>Hi</p>'))
      .not.toContain('script');
  });

  it('removes iframe/object/embed/form content outright', () => {
    expect(sanitiseHtml('<iframe src="https://phish.example"></iframe><p>Hi</p>')).toBe('<p>Hi</p>');
    expect(sanitiseHtml('<object data="x.swf"></object><p>Hi</p>')).toBe('<p>Hi</p>');
    expect(sanitiseHtml('<form action="https://phish.example"><input name="card"></form>')).toBe('');
  });

  it('strips event-handler attributes (quoted, single-quoted, unquoted)', () => {
    expect(sanitiseHtml('<p onclick="alert(1)">Hi</p>')).toBe('<p>Hi</p>');
    expect(sanitiseHtml("<p onmouseover='alert(1)'>Hi</p>")).toBe('<p>Hi</p>');
    expect(sanitiseHtml('<img src="x.gif" onerror=alert(1)>')).toBe('<img src="x.gif">');
  });

  it('neutralises javascript:/data:/vbscript: URIs in href/src', () => {
    const out = sanitiseHtml('<a href="javascript:alert(1)">Pay now</a>');
    expect(out).not.toContain('javascript:');
    expect(out).toContain('<a');
    const img = sanitiseHtml('<img src="data:text/html,<script>alert(1)</script>">');
    expect(img).not.toContain('data:');
    expect(img).not.toContain('script');
  });
});

describe('sanitiseHtml — allowed structure survives', () => {
  it('keeps structural tags and normalises them to lowercase', () => {
    expect(sanitiseHtml('<P>Hello <STRONG>World</STRONG></P>'))
      .toBe('<p>Hello <strong>World</strong></p>');
  });

  it('keeps invoice tables with cell styling and spanning', () => {
    const out = sanitiseHtml('<table><tr><td colspan="2" style="text-align:right">MK 1,000</td></tr></table>');
    expect(out).toBe('<table><tr><td colspan="2" style="text-align:right">MK 1,000</td></tr></table>');
  });

  it('keeps safe anchors including https href', () => {
    expect(sanitiseHtml('<a href="https://app.ledgr.com/pay/123">Pay invoice</a>'))
      .toBe('<a href="https://app.ledgr.com/pay/123">Pay invoice</a>');
  });

  it('keeps tracking pixels (img with src/alt/size)', () => {
    expect(sanitiseHtml('<img src="https://x.co/p.gif" alt="" width="1" height="1">'))
      .toBe('<img src="https://x.co/p.gif" alt="" width="1" height="1">');
  });

  it('allows only the global style attribute on structural tags', () => {
    expect(sanitiseHtml('<p class="lead" id="t" style="color:#333">Hi</p>'))
      .toBe('<p style="color:#333">Hi</p>');
  });

  it('normalises self-closing line breaks', () => {
    expect(sanitiseHtml('<p>a<br/>b</p>')).toBe('<p>a<br />b</p>');
  });
});

describe('sanitiseHtml — disallowed tags are unwrapped, not the text', () => {
  it('drops unknown tags but keeps inner text', () => {
    expect(sanitiseHtml('<marquee>BIG NEWS</marquee>')).toBe('BIG NEWS');
    expect(sanitiseHtml('<p>Hello <video>World</video></p>')).toBe('<p>Hello World</p>');
  });

  it('escapes embedded double quotes in preserved attribute values', () => {
    const out = sanitiseHtml('<p style="font-family:&quot;Arial&quot;">x</p>');
    expect(out).not.toMatch(/style="[^"]*"[^=]*="/);
  });
});
