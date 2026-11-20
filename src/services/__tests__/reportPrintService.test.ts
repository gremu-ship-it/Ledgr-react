// @vitest-environment jsdom
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRINT_FRAME_ID,
  buildPrintDocument,
  escapeHtml,
  printElementRef,
  printHtmlContent,
} from '../reportPrintService';

const htmlContent = '<table><thead><tr><th>Account</th></tr></thead><tbody><tr><td>Cash</td></tr></tbody></table>';

function frame(): HTMLIFrameElement | null {
  return document.getElementById(PRINT_FRAME_ID) as HTMLIFrameElement | null;
}

describe('escapeHtml', () => {
  it('escapes markup and quotes so report text cannot break the printed document', () => {
    expect(escapeHtml('<script>"x" & \'y\'</script>')).toBe(
      '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;',
    );
  });
});

describe('buildPrintDocument', () => {
  it('wraps the report in a complete A4 document with header, meta and footer', () => {
    const doc = buildPrintDocument(htmlContent, {
      title: 'Trial Balance',
      subtitle: '1 January – 31 January 2026',
      companyName: 'Acme Traders Ltd',
      generatedAt: '18 Nov 2026 10:00',
      orientation: 'landscape',
    });

    expect(doc.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(doc).toContain('size: A4 landscape');
    expect(doc).toContain('<title>Trial Balance</title>');
    expect(doc).toContain('<h1>Trial Balance</h1>');
    expect(doc).toContain('<p class="subtitle">1 January – 31 January 2026</p>');
    expect(doc).toContain('<strong>Acme Traders Ltd</strong>');
    expect(doc).toContain('18 Nov 2026 10:00');
    expect(doc).toContain(htmlContent);
    // The audit trail the task requires: who generated it, and the confidentiality notice.
    expect(doc).toMatch(/Generated securely by Ledgr ERP/);
    expect(doc).toMatch(/Confidential/);
    expect(doc).toContain('thead { display: table-header-group; }');
    expect(doc).toContain('break-inside: avoid');
  });

  it('defaults to portrait and omits optional header rows', () => {
    const doc = buildPrintDocument('<p>Body</p>', { title: 'Cash Flow' });

    expect(doc).toContain('size: A4 portrait');
    expect(doc).not.toContain('class="subtitle"');
    expect(doc).toContain('<p>Body</p>');
  });

  it('renders the localised generated-at label, footer and confidentiality notice', () => {
    const t = vi.spyOn(i18next, 't').mockImplementation(((key: string, options?: Record<string, unknown>) => {
      if (key === 'reports.print.generatedAt') return `Erzeugt: ${String(options?.timestamp)}`;
      if (key === 'reports.print.footer') return 'Sicher erzeugt von Ledgr ERP';
      if (key === 'reports.print.confidential') return 'Vertraulich';
      return key;
    }) as unknown as typeof i18next.t);

    try {
      const doc = buildPrintDocument('<p>Body</p>', { title: 'Bilanz', generatedAt: '18.11.2026' });
      expect(doc).toContain('Erzeugt: 18.11.2026');
      expect(doc).toContain('Sicher erzeugt von Ledgr ERP');
      expect(doc).toContain('Vertraulich');
    } finally {
      t.mockRestore();
    }
  });

  it('falls back to English copy when a translation is missing', () => {
    const t = vi.spyOn(i18next, 't').mockImplementation(((key: string) => key) as unknown as typeof i18next.t);
    try {
      const doc = buildPrintDocument('<p>Body</p>', { title: 'Balance Sheet' });
      expect(doc).toContain('Generated securely by Ledgr ERP');
      expect(doc).toContain('Confidential');
      expect(doc).not.toContain('reports.print.');
    } finally {
      t.mockRestore();
    }
  });

  it('escapes the interpolated title instead of injecting it as markup', () => {
    const doc = buildPrintDocument('<p>Body</p>', { title: '<img src=x onerror=alert(1)>' });

    expect(doc).not.toContain('<img src=x');
    expect(doc).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('printHtmlContent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    frame()?.remove();
  });

  afterEach(() => {
    vi.useRealTimers();
    frame()?.remove();
  });

  it('writes the report into an isolated, hidden frame', () => {
    printHtmlContent(htmlContent, { title: 'Balance Sheet', companyName: 'Acme Traders Ltd' });

    const printFrame = frame();
    expect(printFrame).not.toBeNull();
    expect(printFrame?.getAttribute('aria-hidden')).toBe('true');
    // Hidden frame: it must never affect the app layout.
    expect(printFrame?.style.width).toBe('0px');
    expect(printFrame?.style.height).toBe('0px');
    expect(printFrame?.style.position).toBe('fixed');

    const body = printFrame?.contentDocument?.body.innerHTML ?? '';
    expect(body).toContain('Balance Sheet');
    expect(body).toContain('Acme Traders Ltd');
    expect(body).toContain('Cash');
    expect(body).toContain('Generated securely by Ledgr ERP');
  });

  it('calls print() on the frame window once the document has painted', async () => {
    printHtmlContent(htmlContent, { title: 'Profit & Loss' });

    const frameWindow = frame()?.contentWindow;
    expect(frameWindow).not.toBeNull();
    const print = vi.fn();
    const focus = vi.fn();
    Object.assign(frameWindow as unknown as Window, { print, focus });

    // Nothing is printed before the render delay, otherwise the frame is blank.
    expect(print).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(300);

    expect(print).toHaveBeenCalledTimes(1);
    expect(focus).toHaveBeenCalled();
  });

  it('removes the frame from the DOM after the print lifetime', async () => {
    printHtmlContent(htmlContent, { title: 'Trial Balance' });
    expect(frame()).not.toBeNull();

    await vi.advanceTimersByTimeAsync(61_000);

    expect(frame()).toBeNull();
  });

  it('replaces a previous print frame so a stale report is never printed', () => {
    printHtmlContent(htmlContent, { title: 'First report' });
    printHtmlContent(htmlContent, { title: 'Second report' });

    const frames = document.querySelectorAll(`#${PRINT_FRAME_ID}`);
    expect(frames).toHaveLength(1);
    expect(frames[0].getAttribute('title')).toBe('Second report');
    const body = (frames[0] as HTMLIFrameElement).contentDocument?.body.innerHTML ?? '';
    expect(body).toContain('Second report');
    expect(body).not.toContain('First report');
  });
});

describe('printElementRef', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    frame()?.remove();
  });

  afterEach(() => {
    vi.useRealTimers();
    frame()?.remove();
    document.body.innerHTML = '';
  });

  it('does nothing when there is no element or it has no printable content', () => {
    printElementRef(null, { title: 'Balance Sheet' });
    expect(frame()).toBeNull();

    const empty = document.createElement('div');
    empty.innerHTML = '<button type="button">Export</button><input value="x" />';
    document.body.appendChild(empty);

    printElementRef(empty, { title: 'Balance Sheet' });
    expect(frame()).toBeNull();
  });

  it('prints the on-screen report body without app-only controls', () => {
    const report = document.createElement('section');
    report.innerHTML = `
      <h2>Assets</h2>
      <table><tbody><tr><td>Cash</td><td>1,200</td></tr></tbody></table>
      <button type="button">Download</button>
      <div class="no-print">Filters</div>
      <span data-print-ignore="true">Toolbar</span>`;
    document.body.appendChild(report);

    printElementRef(report, { title: 'Balance Sheet', companyName: 'Acme Traders Ltd' });

    const body = frame()?.contentDocument?.body.innerHTML ?? '';
    expect(body).toContain('Balance Sheet');
    expect(body).toContain('<h2>Assets</h2>');
    expect(body).toContain('Cash');
    expect(body).toContain('1,200');
    expect(body).not.toContain('Download');
    expect(body).not.toContain('Filters');
    expect(body).not.toContain('Toolbar');
  });
});
