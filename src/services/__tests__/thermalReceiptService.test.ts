// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { printThermalReceipt, type ReceiptData } from '../thermalReceiptService';

const receipt: ReceiptData = {
  businessName: 'LEDGR Retail',
  taxNumber: '1234567890',
  address: 'Blantyre',
  phone: '+265 999 123 456',
  receiptNumber: 'RCP-001',
  date: '25/11/2026, 10:30:00',
  cashierName: 'Mary',
  customerName: 'Chongo',
  items: [
    { name: 'Maize flour 2kg', quantity: 3, unitPrice: 4500, total: 13500 },
    { name: 'Cooking oil 1L', quantity: 1, unitPrice: 6800, total: 6800 },
  ],
  subtotal: 20300,
  tax: 0,
  discount: 300,
  total: 20000,
  paymentMethod: 'cash',
  amountPaid: 20000,
  change: 0,
  currency: 'MWK',
  notes: 'Keep your receipt',
};

const originalContentWindow = Object.getOwnPropertyDescriptor(
  HTMLIFrameElement.prototype,
  'contentWindow',
);

describe('printThermalReceipt', () => {
  let htmlParts: string[];
  let open: ReturnType<typeof vi.fn>;
  let write: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let focus: ReturnType<typeof vi.fn>;
  let print: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    htmlParts = [];
    open = vi.fn();
    write = vi.fn((markup: string) => {
      htmlParts.push(markup);
    });
    close = vi.fn();
    focus = vi.fn();
    print = vi.fn();

    // Stub the iframe window before the service writes into it. jsdom gives
    // each iframe its own Document realm, so a parent-level spy is unreliable.
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      configurable: true,
      get: () => ({ document: { open, write, close }, focus, print }),
    });
  });

  afterEach(() => {
    if (originalContentWindow) {
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', originalContentWindow);
    } else {
      Reflect.deleteProperty(HTMLIFrameElement.prototype, 'contentWindow');
    }
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const printedHtml = () => htmlParts.join('');

  it('builds a hidden iframe with an 80mm roll and prints after the content settles', () => {
    printThermalReceipt(receipt);

    const frame = document.getElementById('ledgr-receipt-frame') as HTMLIFrameElement | null;
    expect(frame).toBeInstanceOf(HTMLIFrameElement);
    expect(frame?.style.position).toBe('fixed');
    expect(frame?.style.right).toMatch(/^0(px)?$/);
    expect(frame?.style.bottom).toMatch(/^0(px)?$/);
    expect(frame?.style.width).toMatch(/^0(px)?$/);
    expect(frame?.style.height).toMatch(/^0(px)?$/);
    expect(frame?.style.border).toMatch(/^0(px)?/);
    expect(open).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);

    const html = printedHtml();
    expect(html).toContain('size: 80mm auto');
    expect(html).toContain('margin: 0;');
    expect(html).toContain('font-size: 12px');
    expect(html).toContain('width: 72mm');
    expect(html).toContain('max-width: 72mm');
    expect(html).toContain('<title>Receipt RCP-001</title>');
    expect(html).toContain('<span>Subtotal:</span>');
    expect(html).toContain('Paid (cash):');
    expect(html).toContain('Maize flour 2kg');
    expect(html).toContain('13,500');

    expect(print).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(focus).toHaveBeenCalledTimes(1);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('uses 58mm roll sizing when requested', () => {
    printThermalReceipt(receipt, '58mm');

    const html = printedHtml();
    expect(html).toContain('size: 58mm auto');
    expect(html).toContain('font-size: 10px');
    expect(html).toContain('width: 48mm');
    expect(html).toContain('max-width: 48mm');
    expect(html).not.toContain('size: 80mm auto');
    expect(html).not.toContain('width: 72mm');
  });

  it('replaces a previous print frame instead of stacking hidden iframes', () => {
    printThermalReceipt(receipt);
    const firstFrame = document.getElementById('ledgr-receipt-frame');

    printThermalReceipt(receipt);

    expect(document.querySelectorAll('#ledgr-receipt-frame')).toHaveLength(1);
    expect(firstFrame?.isConnected).toBe(false);
  });

  it('escapes receipt content so catalogue data cannot inject markup', () => {
    printThermalReceipt({ ...receipt, businessName: '<script>alert(1)</script>' });

    const html = printedHtml();
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});
