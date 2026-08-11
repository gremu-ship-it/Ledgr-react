/**
 * Integration tests for the PDF document generator.
 *
 * html2canvas (rasterisation) and jsPDF (file output) are mocked, and the
 * hidden render iframe is faked, so we can assert on what actually matters:
 *
 *  - the standalone HTML handed to the renderer (watermark gating, no scripts,
 *    fixed-width .page matching the A4 content area),
 *  - page-break math: tall documents are split at measured block boundaries
 *    with correct mm offsets per page,
 *  - consistent margins on every page and a real "Page x of y" footer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ── Mock the raster/output layer ─────────────────────────────────────────────

interface PdfCall {
  method: string;
  args: unknown[];
}

const pdfCalls: PdfCall[] = [];

vi.mock('jspdf', () => ({
  jsPDF: class MockJsPDF {
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    constructor() {
      pdfCalls.length = 0;
    }
    addPage() {
      pdfCalls.push({ method: 'addPage', args: [] });
    }
    addImage(...args: unknown[]) {
      pdfCalls.push({ method: 'addImage', args });
    }
    text(...args: unknown[]) {
      pdfCalls.push({ method: 'text', args });
    }
    line(...args: unknown[]) {
      pdfCalls.push({ method: 'line', args });
    }
    setFont() {}
    setFontSize() {}
    setTextColor() {}
    setDrawColor() {}
    setLineWidth() {}
    save(name: string) {
      pdfCalls.push({ method: 'save', args: [name] });
    }
  },
}));

let rasterHeightPx = 700; // overridden per test

vi.mock('html2canvas', () => ({
  default: vi.fn(async () => ({
    width: 1376, // 688 css px * scale 2
    height: rasterHeightPx * 2,
    toDataURL: () => 'data:image/jpeg;base64,AAAA',
  })),
}));

// ── Fake the hidden render iframe ────────────────────────────────────────────

interface FakeBlockRects {
  /** Rects (px from page top) for direct .page children — used as break pts. */
  childTops: number[];
  /** Rects for table rows etc. */
  rowTops: number[];
}

let fakeDocHeightPx = 700;
let fakeRects: FakeBlockRects = { childTops: [], rowTops: [] };
let capturedSrcdoc: string | null = null;

function rect(top: number, height: number) {
  return { top, height, bottom: top + height, left: 0, right: 688, width: 688, x: 0, y: top, toJSON: () => ({}) };
}

function makeFakeElement(top: number, height: number) {
  return {
    getBoundingClientRect: () => rect(top, height),
    querySelectorAll: () => [],
  };
}

function installFakeDom() {
  capturedSrcdoc = null;

  const fakePageEl = {
    getBoundingClientRect: () => rect(0, fakeDocHeightPx),
    children: fakeRects.childTops.map((t) => makeFakeElement(t, 40)),
    querySelectorAll: (selector: string) => {
      if (selector === 'img') return [];
      if (selector.includes('tr')) return fakeRects.rowTops.map((t) => makeFakeElement(t, 24));
      return [];
    },
  };

  const fakeContentDocument = {
    body: fakePageEl,
    fonts: { ready: Promise.resolve() },
    querySelector: (selector: string) => (selector === '.page' ? fakePageEl : null),
    querySelectorAll: () => [],
  };

  const fakeFrame = {
    style: {},
    listeners: {} as Record<string, () => void>,
    addEventListener(event: string, cb: () => void) {
      this.listeners[event] = cb;
    },
    set srcdoc(value: string) {
      capturedSrcdoc = value;
      // Fire the load event asynchronously like a real frame.
      queueMicrotask(() => this.listeners.load?.());
    },
    get contentDocument() {
      return fakeContentDocument;
    },
    remove: vi.fn(),
  };

  const g = globalThis as Record<string, unknown>;
  g.__fakeFrame = fakeFrame;
  g.document = {
    createElement: (tag: string) => {
      if (tag === 'iframe') return fakeFrame;
      throw new Error(`unexpected createElement(${tag})`);
    },
    body: { appendChild: vi.fn() },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 20));
const A4_CONTENT_MM = 182; // 210 - 2*14
const MARGIN_MM = 14;
const PX_PER_MM = 96 / 25.4;

import {
  generateInvoiceDocument,
  generateProfessionalReportDocument,
  pdfFileName,
} from '../documents/documentGenerator';
import { invoiceLineRowToDocumentLine } from '../documents/types';

const branding = {
  name: 'Acme Agro Ltd',
  brandColor: '#0E7C5A',
  baseCurrency: 'MWK',
  email: 'hello@acme.mw',
  phone: '+265 999 000 111',
};

const sampleInvoice = {
  invoice_number: 'INV-0001',
  issue_date: '2026-08-01',
  due_date: '2026-08-31',
  status: 'paid',
  subtotal: 100_000,
  vat_amount: 16_500,
  total_amount: 116_500,
  amount_paid: 116_500,
  currency: 'MWK',
};

const sampleLines = Array.from({ length: 40 }, (_, i) => ({
  description: `Supply of maize seed batch ${i + 1}`,
  quantity: 10,
  unit_price: 2_500,
  tax_amount: 0,
  line_total: 25_000,
}));

describe('documentGenerator PDF pipeline', () => {
  beforeEach(() => {
    installFakeDom();
    pdfCalls.length = 0;
    fakeDocHeightPx = 700;
    fakeRects = { childTops: [], rowTops: [] };
    rasterHeightPx = 700;
  });

  afterEach(() => {
    const g = globalThis as Record<string, unknown>;
    delete g.document;
    delete g.__fakeFrame;
  });

  it('renders a short invoice on a single page with A4 margins and a page footer', async () => {
    generateInvoiceDocument({ business: branding, invoice: sampleInvoice, lines: sampleLines.slice(0, 3) });
    await flush();

    expect(capturedSrcdoc).toBeTruthy();
    // No <script> may ever run inside the hidden frame.
    expect(capturedSrcdoc).not.toMatch(/<script/i);

    const images = pdfCalls.filter((c) => c.method === 'addImage');
    expect(images).toHaveLength(1);
    expect(pdfCalls.filter((c) => c.method === 'addPage')).toHaveLength(0);

    const [, , x, y, width] = images[0].args as [string, string, number, number, number, number];
    expect(x).toBeCloseTo(MARGIN_MM, 5); // 14mm left margin — not full-bleed
    expect(y).toBeCloseTo(MARGIN_MM, 5); // 14mm top margin
    expect(width).toBeCloseTo(A4_CONTENT_MM, 5); // 182mm content width

    // Real page footer text instead of a hardcoded "Page 1".
    const texts = pdfCalls.filter((c) => c.method === 'text').map((c) => c.args);
    expect(texts.some((a) => String(a[0]).includes('Page 1 of 1'))).toBe(true);

    const saved = pdfCalls.find((c) => c.method === 'save');
    expect(saved?.args[0]).toBe('Invoice_INV-0001.pdf');
  });

  it('shows the PAID watermark for paid invoices even without a logo', async () => {
    generateInvoiceDocument({ business: branding, invoice: sampleInvoice, lines: sampleLines.slice(0, 1) });
    await flush();
    expect(capturedSrcdoc).toContain('<div class="watermark">Paid</div>');
  });

  it('omits the watermark for unpaid invoices', async () => {
    generateInvoiceDocument({
      business: branding,
      invoice: { ...sampleInvoice, status: 'sent', amount_paid: 0 },
      lines: sampleLines.slice(0, 1),
    });
    await flush();
    // The .watermark CSS rule always ships with baseStyles; what matters is
    // that no watermark ELEMENT is emitted.
    expect(capturedSrcdoc).not.toContain('<div class="watermark">');
  });

  it('carries persisted line discounts into the invoice PDF', async () => {
    const discountedLine = invoiceLineRowToDocumentLine({
      description: 'Supply of maize seed',
      quantity: 10,
      unit_price: 2_500,
      discount_percent: 10,
      discount_amount: 2_500,
      tax_amount: 0,
      line_total: 22_500,
    });

    generateInvoiceDocument({
      business: branding,
      // A zero header discount exercises the legacy fallback to line values.
      invoice: {
        ...sampleInvoice,
        status: 'sent',
        subtotal: 22_500,
        discount_amount: 0,
        vat_amount: 0,
        total_amount: 22_500,
        amount_paid: 0,
      },
      lines: [discountedLine],
    });
    await flush();

    expect(discountedLine).toMatchObject({
      discount_percent: 10,
      discount_amount: 2_500,
    });
    expect(capturedSrcdoc).toContain('Disc %');
    expect(capturedSrcdoc).toContain('10%');
    expect(capturedSrcdoc).toContain('Less: Trade Discount');
    expect(capturedSrcdoc).toContain('- MWK 2,500.00');
    expect(capturedSrcdoc).toContain('Gross Subtotal');
    expect(capturedSrcdoc).toContain('MWK 25,000.00');
  });

  it('paginates tall documents at block boundaries with correct mm offsets', async () => {
    // ~3 content pages tall (content page ≈ 1009px). Rows give break points.
    fakeDocHeightPx = 2_800;
    rasterHeightPx = 2_800;
    fakeRects = {
      childTops: [90, 320, 600],
      rowTops: Array.from({ length: 100 }, (_, i) => 340 + i * 24),
    };

    generateInvoiceDocument({ business: branding, invoice: sampleInvoice, lines: sampleLines });
    await flush();

    const images = pdfCalls.filter((c) => c.method === 'addImage');
    const pages = images.length;
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(pdfCalls.filter((c) => c.method === 'addPage')).toHaveLength(pages - 1);

    // First page starts at the top margin; every later page slides the same
    // raster up by exactly the cut distance converted px → mm.
    const y0 = (images[0].args as unknown[])[3] as number;
    expect(y0).toBeCloseTo(MARGIN_MM, 5);
    const y1 = (images[1].args as unknown[])[3] as number;
    const firstCutPx = (MARGIN_MM - y1) * PX_PER_MM;
    // The first cut must have landed exactly on one of the supplied break
    // points (block or row boundary) — proving we don't slice mid-line.
    const allPoints = [...fakeRects.childTops, ...fakeRects.rowTops];
    const snapped = allPoints.some((p) => Math.abs(p - firstCutPx) < 0.5);
    expect(snapped).toBe(true);

    // Every page carries a "Page i of n" label and the document title.
    const texts = pdfCalls.filter((c) => c.method === 'text').map((c) => String(c.args[0]));
    expect(texts).toContain(`Page ${pages} of ${pages}`);
    expect(texts).toContain('Invoice INV-0001');
  });

  it('stamps DRAFT watermark on draft reports and uses the report title for the file name', async () => {
    generateProfessionalReportDocument({
      business: branding,
      title: 'Trial Balance',
      subtitle: 'All posted journal entries',
      dateLabel: '11 Aug 2026',
      currency: 'MWK',
      isDraft: true,
      sections: [{ html: '<table><tbody><tr><td>ok</td></tr></tbody></table>' }],
    });
    await flush();

    expect(capturedSrcdoc).toContain('<div class="watermark">DRAFT</div>');
    const saved = pdfCalls.find((c) => c.method === 'save');
    expect(saved?.args[0]).toBe('Trial_Balance.pdf');
  });

  it('pdfFileName sanitises titles into safe file names', () => {
    expect(pdfFileName('Delivery Note TRF-0042')).toBe('Delivery_Note_TRF-0042.pdf');
    expect(pdfFileName('  ...  ')).toBe('document.pdf');
    expect(pdfFileName('P&L: Q1/2026')).toBe('P_L_Q1_2026.pdf');
  });
});
