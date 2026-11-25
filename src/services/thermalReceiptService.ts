import { i18n } from '@/i18n';

export interface ReceiptItem {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface ReceiptData {
  businessName: string;
  taxNumber?: string;
  address?: string;
  phone?: string;
  receiptNumber: string;
  date: string;
  cashierName?: string;
  customerName?: string;
  items: ReceiptItem[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paymentMethod: string;
  amountPaid: number;
  change: number;
  currency: string;
  notes?: string;
}

export type ThermalPaperWidth = '80mm' | '58mm';

const t = (key: string, options?: Record<string, string>) => String(i18n.t(key, options));

/** Receipt copy comes from catalogue/business data — never trust it as HTML. */
function escapeHtml(value: string | number): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[char];
  });
}

function formatAmount(value: number): string {
  return escapeHtml((Number.isFinite(Number(value)) ? Number(value) : 0).toLocaleString());
}

/**
 * Print a receipt in an isolated, zero-sized iframe so the rest of the POS UI
 * is never printed. The @page rule and narrow body give thermal printers the
 * exact roll width they expect; the trailing feed spacer clears the tear bar.
 */
export function printThermalReceipt(data: ReceiptData, paperWidth: ThermalPaperWidth = '80mm'): void {
  const existingFrame = document.getElementById('ledgr-receipt-frame');
  if (existingFrame) existingFrame.remove();

  const iframe = document.createElement('iframe');
  iframe.id = 'ledgr-receipt-frame';
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) return;

  const widthMm = paperWidth === '80mm' ? '72mm' : '48mm';
  const fontSize = paperWidth === '80mm' ? '12px' : '10px';
  const currency = escapeHtml(data.currency);

  doc.open();
  doc.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(t('pos.thermal.receiptTitle', { number: escapeHtml(data.receiptNumber) }))}</title>
        <style>
          @page {
            size: ${paperWidth} auto;
            margin: 0;
          }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body {
            font-family: 'Courier New', Courier, monospace, -apple-system, sans-serif;
            font-size: ${fontSize};
            line-height: 1.25;
            color: #000000;
            background: #ffffff;
            margin: 0;
            padding: 4mm 2mm 8mm 2mm;
            width: ${widthMm};
            max-width: ${widthMm};
          }
          .text-center { text-align: center; }
          .text-right { text-align: right; }
          .text-bold { font-weight: bold; }
          .divider {
            border-top: 1px dashed #000000;
            margin: 4px 0;
          }
          .double-divider {
            border-top: 2px solid #000000;
            margin: 5px 0;
          }
          .header h2 {
            margin: 0;
            font-size: 1.2em;
            text-transform: uppercase;
          }
          .header p {
            margin: 1px 0;
            font-size: 0.9em;
          }
          .meta {
            font-size: 0.85em;
            margin: 4px 0;
          }
          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin: 4px 0;
          }
          .items-table th {
            text-align: left;
            border-bottom: 1px dashed #000;
            padding: 2px 0;
            font-size: 0.9em;
          }
          .items-table td {
            padding: 2px 0;
            vertical-align: top;
          }
          .totals-row {
            display: flex;
            justify-content: space-between;
            padding: 1px 0;
          }
          .grand-total {
            font-size: 1.15em;
            font-weight: bold;
          }
          .footer {
            margin-top: 6px;
            font-size: 0.85em;
            text-align: center;
          }
          .feed-spacer {
            height: 12mm;
          }
        </style>
      </head>
      <body>
        <div class="header text-center">
          <h2>${escapeHtml(data.businessName)}</h2>
          ${data.taxNumber ? `<p>${escapeHtml(t('pos.thermal.tpin'))} ${escapeHtml(data.taxNumber)}</p>` : ''}
          ${data.address ? `<p>${escapeHtml(data.address)}</p>` : ''}
          ${data.phone ? `<p>${escapeHtml(t('pos.thermal.tel'))} ${escapeHtml(data.phone)}</p>` : ''}
        </div>

        <div class="divider"></div>

        <div class="meta">
          <div>${escapeHtml(t('pos.thermal.receiptNumber'))} <strong>${escapeHtml(data.receiptNumber)}</strong></div>
          <div>${escapeHtml(t('pos.thermal.date'))} ${escapeHtml(data.date)}</div>
          ${data.cashierName ? `<div>${escapeHtml(t('pos.thermal.cashier'))} ${escapeHtml(data.cashierName)}</div>` : ''}
          ${data.customerName ? `<div>${escapeHtml(t('pos.thermal.customer'))} ${escapeHtml(data.customerName)}</div>` : ''}
        </div>

        <div class="divider"></div>

        <table class="items-table">
          <thead>
            <tr>
              <th style="width: 50%;">${escapeHtml(t('pos.thermal.item'))}</th>
              <th class="text-right" style="width: 20%;">${escapeHtml(t('pos.thermal.qty'))}</th>
              <th class="text-right" style="width: 30%;">${escapeHtml(t('pos.thermal.total'))}</th>
            </tr>
          </thead>
          <tbody>
            ${data.items
              .map(
                (item) => `
              <tr>
                <td colspan="3" class="text-bold">${escapeHtml(item.name)}</td>
              </tr>
              <tr>
                <td style="font-size: 0.85em; color: #333;">${escapeHtml(
                  t('pos.thermal.unitPrice', { currency, price: formatAmount(item.unitPrice) }),
                )}</td>
                <td class="text-right">${escapeHtml(item.quantity)}</td>
                <td class="text-right text-bold">${currency} ${formatAmount(item.total)}</td>
              </tr>
            `,
              )
              .join('')}
          </tbody>
        </table>

        <div class="divider"></div>

        <div class="totals-row">
          <span>${escapeHtml(t('pos.thermal.subtotal'))}</span>
          <span>${currency} ${formatAmount(data.subtotal)}</span>
        </div>
        ${
          data.discount > 0
            ? `<div class="totals-row">
          <span>${escapeHtml(t('pos.thermal.discount'))}</span>
          <span>-${currency} ${formatAmount(data.discount)}</span>
        </div>`
            : ''
        }
        <div class="totals-row">
          <span>${escapeHtml(t('pos.thermal.tax'))}</span>
          <span>${currency} ${formatAmount(data.tax)}</span>
        </div>

        <div class="double-divider"></div>

        <div class="totals-row grand-total">
          <span>${escapeHtml(t('pos.thermal.grandTotal'))}</span>
          <span>${currency} ${formatAmount(data.total)}</span>
        </div>

        <div class="double-divider"></div>

        <div class="totals-row">
          <span>${escapeHtml(t('pos.thermal.paid', { method: escapeHtml(data.paymentMethod) }))}</span>
          <span>${currency} ${formatAmount(data.amountPaid)}</span>
        </div>
        <div class="totals-row">
          <span>${escapeHtml(t('pos.thermal.change'))}</span>
          <span>${currency} ${formatAmount(data.change)}</span>
        </div>

        <div class="divider"></div>

        <div class="footer">
          <p>${escapeHtml(t('pos.thermal.thankYou'))}</p>
          ${data.notes ? `<p>${escapeHtml(data.notes)}</p>` : ''}
        </div>

        <!-- Spacer to allow receipt to clear the physical printer tear bar -->
        <div class="feed-spacer"></div>
      </body>
    </html>
  `);
  doc.close();

  setTimeout(() => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => iframe.remove(), 60000);
  }, 300);
}
