/**
 * Professional document generator - produces print-ready HTML with business
 * branding (logo, colors, contact details) for invoices, delivery notes,
 * receipts, and financial reports.
 *
 * Design goals:
 *  - Real end-product: letterhead, footer, signature blocks, professional typography
 *  - Logo support: embeds business logo if available (via direct <img> plus fallback)
 *  - Brand color theming: uses business brand_color for accents
 *  - Clean, modern, IFRS-friendly report styling
 */

import type { BusinessBranding, InvoiceLike, InvoiceLineLike, ContactLike } from './types';

const DEFAULT_BRAND = '#0E7C5A'; // 5.32:1 AA contrast

function esc(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMwk(amount: number | string | null | undefined, currency = 'MWK'): string {
  const n = Number(amount ?? 0);
  if (isNaN(n)) return `${currency} 0.00`;
  return `${currency} ${n.toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('en-MW', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function brandColorStyle(brand?: string | null, fallback = DEFAULT_BRAND): string {
  const c = brand || fallback;
  // ensure valid hex-ish, fallback
  if (!c) return fallback;
  return c;
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    draft: '#6b7280',
    sent: '#2563eb',
    viewed: '#7c3aed',
    partially_paid: '#d97706',
    paid: '#059669',
    overdue: '#dc2626',
    void: '#9ca3af',
    credit_note: '#4b5563',
  };
  return map[status] ?? '#374151';
}

function getInitials(name: string): string {
  return name.trim().split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

// Shared base CSS - professional, print-friendly
function baseStyles(brand: string): string {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
    :root { --brand: ${brand}; --brand-light: ${brand}14; --ink: #0f172a; --muted: #64748b; --border: #e2e8f0; --bg-faint: #f8fafc; }
    * { box-sizing: border-box; }
    @page { size: A4; margin: 18mm 16mm 22mm 16mm; }
    body {
      font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 10.5pt;
      color: var(--ink);
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
      margin: 0;
      padding: 0;
      background: white;
    }
    .page {
      max-width: 210mm;
      margin: 0 auto;
      background: white;
      position: relative;
    }
    /* Letterhead */
    .letterhead {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      padding-bottom: 16px;
      border-bottom: 3px solid var(--brand);
      margin-bottom: 18px;
    }
    .letterhead-left {
      display: flex;
      gap: 14px;
      align-items: flex-start;
      flex: 1;
    }
    .logo {
      width: 56px;
      height: 56px;
      border-radius: 12px;
      object-fit: contain;
      background: white;
      border: 1px solid var(--border);
      flex-shrink: 0;
    }
    .logo-fallback {
      width: 56px;
      height: 56px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 20px;
      color: white;
      background: var(--brand);
      flex-shrink: 0;
    }
    .company-name {
      font-size: 15pt;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: var(--ink);
      line-height: 1.1;
    }
    .company-trading {
      font-size: 9.5pt;
      color: var(--muted);
      font-weight: 500;
      margin-top: 1px;
    }
    .company-meta {
      margin-top: 6px;
      font-size: 8.5pt;
      color: var(--muted);
      line-height: 1.45;
    }
    .company-meta strong { color: var(--ink); font-weight: 600; }
    .doc-badge {
      text-align: right;
    }
    .doc-type {
      font-size: 22pt;
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1;
      color: var(--ink);
      text-transform: uppercase;
    }
    .doc-number {
      margin-top: 6px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 10pt;
      font-weight: 600;
      color: var(--brand);
      letter-spacing: 0.02em;
    }
    .doc-status {
      display: inline-flex;
      margin-top: 8px;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 8pt;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      border: 1.5px solid currentColor;
    }
    /* Totals cards */
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      margin: 18px 0;
    }
    .bill-card {
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 16px;
      background: var(--bg-faint);
    }
    .bill-card h4 {
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin: 0 0 8px 0;
    }
    .bill-card p {
      margin: 0;
      font-size: 10pt;
    }
    .bill-card .name {
      font-weight: 700;
      font-size: 10.5pt;
      color: var(--ink);
    }
    .bill-card .line {
      font-size: 8.5pt;
      color: var(--muted);
      margin-top: 2px;
    }
    /* Tables */
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      margin-top: 12px;
      font-size: 9.5pt;
    }
    thead th {
      background: var(--ink);
      color: white;
      font-size: 8pt;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      padding: 10px 12px;
      text-align: left;
      border: none;
    }
    thead th:first-child { border-top-left-radius: 10px; border-bottom-left-radius: 0; }
    thead th:last-child { border-top-right-radius: 10px; border-bottom-right-radius: 0; text-align: right; }
    thead th.num { text-align: right; }
    tbody td {
      padding: 10px 12px;
      border-bottom: 1px solid #f1f5f9;
      vertical-align: top;
    }
    tbody tr:last-child td { border-bottom: none; }
    tbody tr:hover td { background: #fafafa; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    td.mono { font-family: 'JetBrains Mono', monospace; font-size: 8.5pt; }
    .line-desc { font-weight: 600; color: var(--ink); }
    .line-sub { font-size: 8pt; color: var(--muted); margin-top: 2px; }
    /* Totals */
    .totals {
      margin-top: 8px;
      display: flex;
      justify-content: flex-end;
    }
    .totals-box {
      width: 300px;
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 14px;
      font-size: 9.5pt;
      border-bottom: 1px solid #f1f5f9;
    }
    .totals-row:last-child { border-bottom: none; }
    .totals-row.muted { color: var(--muted); }
    .totals-row.total {
      background: var(--ink);
      color: white;
      font-weight: 700;
      font-size: 10.5pt;
      padding: 12px 14px;
    }
    .totals-row.total span:last-child { font-variant-numeric: tabular-nums; }
    /* Notes, terms, payment */
    .section { margin-top: 20px; }
    .section h3 {
      font-size: 8.5pt;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      margin: 0 0 8px 0;
      padding-bottom: 6px;
      border-bottom: 2px solid var(--border);
    }
    .note-box {
      background: var(--bg-faint);
      border-left: 3.5px solid var(--brand);
      padding: 12px 14px;
      border-radius: 0 10px 10px 0;
      font-size: 9pt;
      color: #334155;
      line-height: 1.6;
      white-space: pre-wrap;
    }
    .payment-status {
      margin-top: 18px;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      align-items: center;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 14px;
      background: white;
    }
    .bar {
      height: 8px;
      background: #e2e8f0;
      border-radius: 999px;
      overflow: hidden;
      margin-top: 6px;
    }
    .bar-fill { height: 100%; background: var(--brand); border-radius: 999px; }
    /* Footer */
    .footer {
      margin-top: 36px;
      padding-top: 14px;
      border-top: 1.5px solid var(--border);
      display: flex;
      justify-content: space-between;
      font-size: 7.5pt;
      color: var(--muted);
      letter-spacing: 0.02em;
    }
    .footer a { color: var(--brand); text-decoration: none; }
    /* Delivery Note */
    .loc-grid {
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      gap: 12px;
      align-items: center;
      margin: 16px 0;
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px 16px;
      background: var(--bg-faint);
    }
    .loc-arrow {
      font-size: 22px;
      color: var(--border);
    }
    .loc-label {
      font-size: 8pt;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 4px;
    }
    .loc-name { font-weight: 700; color: var(--ink); }
    .sig-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
      margin-top: 48px;
    }
    .sig-block {
      border-top: 1px solid var(--ink);
      padding-top: 8px;
      font-size: 8.5pt;
      color: var(--muted);
    }
    .sig-block strong { color: var(--ink); display: block; font-size: 9.5pt; }
    /* Report */
    .report-header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
      padding-bottom: 14px;
      border-bottom: 2px solid var(--border);
    }
    .report-title {
      font-size: 18pt;
      font-weight: 800;
      letter-spacing: -0.02em;
      margin: 0;
      line-height: 1.1;
    }
    .report-subtitle {
      margin: 6px 0 0 0;
      font-size: 9.5pt;
      color: var(--muted);
    }
    .report-meta {
      display: flex;
      gap: 18px;
      font-size: 8.5pt;
      color: var(--muted);
      margin-top: 12px;
      flex-wrap: wrap;
    }
    .report-meta strong { color: var(--ink); }
    .watermark {
      position: fixed;
      top: 42%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-30deg);
      font-size: 72pt;
      font-weight: 900;
      color: var(--ink);
      opacity: 0.04;
      pointer-events: none;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      z-index: 0;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
      .page { box-shadow: none; }
    }
  `;
}

function businessAddressBlock(b: BusinessBranding): string {
  const parts: string[] = [];
  if (b.addressLine1) parts.push(esc(b.addressLine1));
  if (b.addressLine2) parts.push(esc(b.addressLine2));
  if (b.city || b.country) parts.push([esc(b.city || ''), esc(b.country || '')].filter(Boolean).join(', '));
  if (b.phone) parts.push(`Tel: ${esc(b.phone)}`);
  if (b.email) parts.push(esc(b.email));
  if (b.website) parts.push(esc(b.website));
  if (b.tpin) parts.push(`TPIN: ${esc(b.tpin)}`);
  if (b.vatNumber) parts.push(`VAT: ${esc(b.vatNumber)}`);
  if (b.registrationNumber) parts.push(`Reg: ${esc(b.registrationNumber)}`);
  if (!parts.length) return '';
  return parts.map((p) => `<div>${p}</div>`).join('');
}

function renderLetterhead(b: BusinessBranding, title: string, docNumber: string, status?: string): string {
  const logoHtml = b.logoUrl
    ? `<img src="${esc(b.logoUrl)}" class="logo" alt="${esc(b.name)} logo" crossorigin="anonymous" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" />
       <div class="logo-fallback" style="display:none;">${esc(getInitials(b.name))}</div>`
    : `<div class="logo-fallback">${esc(getInitials(b.name))}</div>`;

  const trading = b.tradingName ? `<div class="company-trading">Trading as ${esc(b.tradingName)}</div>` : '';
  const statusHtml = status
    ? `<div class="doc-status" style="color:${statusColor(status)}; border-color:${statusColor(status)}22; background:${statusColor(status)}10;">${esc(status.replace(/_/g, ' '))}</div>`
    : '';

  return `
    <div class="letterhead">
      <div class="letterhead-left">
        ${logoHtml}
        <div>
          <div class="company-name">${esc(b.name)}</div>
          ${trading}
          <div class="company-meta">
            ${businessAddressBlock(b)}
          </div>
        </div>
      </div>
      <div class="doc-badge">
        <div class="doc-type">${esc(title)}</div>
        <div class="doc-number">${esc(docNumber)}</div>
        ${statusHtml}
      </div>
    </div>
  `;
}

function openPrintWindow(title: string, html: string, autoPrint = true): void {
  const win = window.open('', '_blank');
  if (!win) {
    alert('Please allow popups to download documents');
    return;
  }
  win.document.write(html);
  win.document.close();
  win.document.title = title;
  win.focus();
  if (autoPrint) {
    // Wait for images/fonts
    const doPrint = () => {
      setTimeout(() => {
        // Ignored: the user may abort the print dialog; nothing else to recover.
        try { win.print(); } catch { /* print aborted */ }
      }, 600);
    };
    if (win.document.readyState === 'complete') doPrint();
    else win.onload = doPrint;
  }
}

// ── Invoice PDF ───────────────────────────────────────────────────────────────
export function generateInvoiceDocument(params: {
  business: BusinessBranding;
  invoice: InvoiceLike;
  lines: InvoiceLineLike[];
  contact?: ContactLike | null;
  payments?: { payment_date: string; amount: number | string; payment_method: string; reference?: string | null }[];
}) {
  const { business, invoice, lines, contact, payments } = params;
  const brand = brandColorStyle(business.brandColor);
  const currency = invoice.currency || business.baseCurrency || 'MWK';
  const total = Number(invoice.total_amount);
  const paid = Number(invoice.amount_paid ?? 0);
  const due = total - paid;
  const progress = total > 0 ? Math.min(100, Math.max(0, (paid / total) * 100)) : 0;

  const payRows = (payments || []).map((p) => `
    <div style="display:flex; justify-content:space-between; font-size:8.5pt; padding:6px 0; border-bottom:1px solid #f1f5f9;">
      <div>
        <strong>${formatDate(p.payment_date)}</strong> • ${esc(p.payment_method.replace(/_/g, ' '))}
        ${p.reference ? `<span style="color:#64748b;"> — ${esc(p.reference)}</span>` : ''}
      </div>
      <div style="font-weight:600;">${formatMwk(p.amount, currency)}</div>
    </div>
  `).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>${esc(invoice.invoice_number)} - ${esc(business.name)}</title>
<style>${baseStyles(brand)}</style>
</head><body>
<div class="page">
  ${business.logoUrl ? `<div class="watermark">${esc(statusColor(invoice.status) === '#059669' && invoice.status === 'paid' ? 'PAID' : '')}</div>` : ''}

  ${renderLetterhead(business, 'Invoice', invoice.invoice_number, invoice.status)}

  <div class="meta-grid">
    <div class="bill-card">
      <h4>Bill To</h4>
      ${contact ? `
        <p class="name">${esc(contact.name)}</p>
        ${contact.trading_name ? `<p class="line">${esc(contact.trading_name)}</p>` : ''}
        ${contact.address_line1 ? `<p class="line">${esc(contact.address_line1)}${contact.city ? `, ${esc(contact.city)}` : ''}</p>` : ''}
        ${contact.email ? `<p class="line">${esc(contact.email)}</p>` : ''}
        ${contact.phone ? `<p class="line">${esc(contact.phone)}</p>` : ''}
        ${contact.tpin ? `<p class="line">TPIN: ${esc(contact.tpin)}</p>` : ''}
        ${contact.vat_number ? `<p class="line">VAT: ${esc(contact.vat_number)}</p>` : ''}
      ` : `<p class="line">Customer details not available</p>`}
    </div>
    <div class="bill-card">
      <h4>Invoice Details</h4>
      <div style="display:grid; grid-template-columns:auto 1fr; gap:4px 12px; font-size:9pt;">
        <span style="color:#64748b;">Issue Date:</span><strong>${formatDate(invoice.issue_date)}</strong>
        ${invoice.due_date ? `<span style="color:#64748b;">Due Date:</span><strong>${formatDate(invoice.due_date)}</strong>` : ''}
        ${invoice.po_number ? `<span style="color:#64748b;">LPO / PO:</span><strong>${esc(invoice.po_number)}</strong>` : ''}
        <span style="color:#64748b;">Currency:</span><strong>${esc(currency)}</strong>
        <span style="color:#64748b;">Amount Due:</span><strong style="color:${due > 0 ? '#dc2626' : '#059669'}">${formatMwk(due, currency)}</strong>
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th scope="col" style="width:50%">Description</th>
        <th scope="col" class="num" style="width:10%">Qty</th>
        <th scope="col" class="num" style="width:15%">Unit Price</th>
        <th scope="col" class="num" style="width:10%">Tax</th>
        <th scope="col" class="num" style="width:15%">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${lines.map((l) => `
        <tr>
          <td>
            <div class="line-desc">${esc(l.description)}</div>
            ${l.product_name ? `<div class="line-sub">${esc(l.product_name)}${l.sku ? ` • SKU: ${esc(l.sku)}` : ''}</div>` : ''}
          </td>
          <td class="num mono">${Number(l.quantity).toLocaleString()}</td>
          <td class="num">${formatMwk(l.unit_price, currency)}</td>
          <td class="num">${formatMwk(l.tax_amount ?? 0, currency)}</td>
          <td class="num" style="font-weight:600;">${formatMwk(l.line_total, currency)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="totals-box">
      <div class="totals-row muted"><span>Subtotal</span><span>${formatMwk(invoice.subtotal ?? 0, currency)}</span></div>
      <div class="totals-row muted"><span>VAT</span><span>${formatMwk(invoice.vat_amount ?? 0, currency)}</span></div>
      ${Number(invoice.wht_amount ?? 0) > 0 ? `<div class="totals-row muted"><span>WHT Withheld</span><span>- ${formatMwk(invoice.wht_amount, currency)}</span></div>` : ''}
      ${Number(invoice.discount_amount ?? 0) > 0 ? `<div class="totals-row muted"><span>Discount</span><span>- ${formatMwk(invoice.discount_amount, currency)}</span></div>` : ''}
      <div class="totals-row total"><span>Total</span><span>${formatMwk(invoice.total_amount, currency)}</span></div>
      ${paid > 0 ? `
        <div class="totals-row muted"><span>Paid</span><span style="color:#059669;">- ${formatMwk(paid, currency)}</span></div>
        <div class="totals-row" style="font-weight:700; background:#f8fafc;"><span>Balance Due</span><span style="color:${due > 0 ? '#dc2626' : '#059669'}">${formatMwk(due, currency)}</span></div>
      ` : ''}
    </div>
  </div>

  ${paid > 0 || (payments && payments.length > 0) ? `
  <div class="section">
    <h3>Payment Progress</h3>
    <div class="payment-status">
      <div>
        <div style="display:flex; gap:12px; font-size:9pt;">
          <span><strong style="color:#059669;">${formatMwk(paid, currency)}</strong> <span style="color:#64748b;">paid</span></span>
          <span><strong>${formatMwk(due, currency)}</strong> <span style="color:#64748b;">outstanding</span></span>
          <span style="margin-left:auto; font-weight:700;">${Math.round(progress)}% paid</span>
        </div>
        <div class="bar"><div class="bar-fill" style="width:${progress}%"></div></div>
        ${payRows ? `<div style="margin-top:12px;">${payRows}</div>` : ''}
      </div>
    </div>
  </div>
  ` : ''}

  ${invoice.notes ? `
  <div class="section">
    <h3>Notes</h3>
    <div class="note-box">${esc(invoice.notes)}</div>
  </div>
  ` : ''}

  ${invoice.terms ? `
  <div class="section">
    <h3>Terms & Conditions</h3>
    <div class="note-box" style="border-left-color:#cbd5e1; background:#ffffff; border:1px solid #e2e8f0; border-left-width:3.5px;">${esc(invoice.terms)}</div>
  </div>
  ` : ''}

  <div class="footer">
    <div>
      <strong>${esc(business.name)}</strong> • Generated by Ledgr
      <div style="margin-top:2px;">${esc(business.email || '')} ${business.email && business.phone ? ' • ' : ''} ${esc(business.phone || '')}</div>
    </div>
    <div style="text-align:right;">
      <div>Document generated on ${new Date().toLocaleDateString('en-MW', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
      <div style="margin-top:2px;">This is a computer-generated document • ${esc(invoice.invoice_number)}</div>
    </div>
  </div>
</div>

<script>window.onload = () => setTimeout(() => { try{ window.print(); }catch(e){} }, 400);</script>
</body></html>`;

  openPrintWindow(`Invoice ${invoice.invoice_number}`, html);
}

// ── Delivery Note ─────────────────────────────────────────────────────────────
export function generateDeliveryNoteDocument(params: {
  business: BusinessBranding;
  transfer: {
    transfer_number: string;
    status: string;
    created_at: string;
    dispatched_at?: string | null;
    received_at?: string | null;
    notes?: string | null;
    from_location_name: string;
    to_location_name: string;
  };
  lines: { product_name: string; sku?: string | null; quantity_requested: number; quantity_dispatched?: number | null; quantity_received?: number | null }[];
}) {
  const { business, transfer, lines } = params;
  const brand = brandColorStyle(business.brandColor);

  const statusColors: Record<string, { bg: string; text: string }> = {
    draft: { bg: '#f3f4f6', text: '#6b7280' },
    pending_approval: { bg: '#fef3c7', text: '#d97706' },
    approved: { bg: '#dbeafe', text: '#2563eb' },
    dispatched: { bg: '#ede9fe', text: '#7c3aed' },
    received: { bg: '#d1fae5', text: '#059669' },
  };
  const st = statusColors[transfer.status] ?? statusColors.draft;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Delivery Note ${esc(transfer.transfer_number)} - ${esc(business.name)}</title>
<style>${baseStyles(brand)}</style>
</head><body>
<div class="page">
  ${renderLetterhead(business, 'Delivery Note', transfer.transfer_number, transfer.status)}

  <div class="meta-grid" style="grid-template-columns:1fr 1fr 1fr;">
    <div class="bill-card">
      <h4>Transfer Details</h4>
      <div style="display:grid; grid-template-columns:auto 1fr; gap:4px 10px; font-size:9pt;">
        <span style="color:#64748b;">Date:</span><strong>${formatDate(transfer.created_at)}</strong>
        ${transfer.dispatched_at ? `<span style="color:#64748b;">Dispatched:</span><strong>${formatDate(transfer.dispatched_at)}</strong>` : ''}
        ${transfer.received_at ? `<span style="color:#64748b;">Received:</span><strong>${formatDate(transfer.received_at)}</strong>` : ''}
        <span style="color:#64748b;">Status:</span><span style="display:inline-flex; padding:2px 8px; border-radius:99px; font-size:8pt; font-weight:700; background:${st.bg}; color:${st.text}; text-transform:uppercase;">${esc(transfer.status.replace(/_/g, ' '))}</span>
      </div>
    </div>
    <div class="bill-card" style="grid-column: span 2;">
      <h4>Route</h4>
      <div class="loc-grid" style="margin:0; border:none; background:transparent; padding:0;">
        <div><div class="loc-label">From Location</div><div class="loc-name">${esc(transfer.from_location_name)}</div></div>
        <div class="loc-arrow">→</div>
        <div style="text-align:right;"><div class="loc-label">To Location</div><div class="loc-name">${esc(transfer.to_location_name)}</div></div>
      </div>
      ${transfer.notes ? `<div style="margin-top:10px; font-size:8.5pt; color:#64748b; background:white; padding:8px 10px; border-radius:8px; border:1px solid #e2e8f0;">${esc(transfer.notes)}</div>` : ''}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th scope="col" style="width:42%">Product</th>
        <th scope="col" style="width:18%; text-align:center;">SKU</th>
        <th scope="col" class="num" style="width:13%">Requested</th>
        <th scope="col" class="num" style="width:13%">Dispatched</th>
        <th scope="col" class="num" style="width:14%">Received</th>
      </tr>
    </thead>
    <tbody>
      ${lines.map((l) => `
        <tr>
          <td><div class="line-desc">${esc(l.product_name)}</div></td>
          <td style="text-align:center;" class="mono">${esc(l.sku || '—')}</td>
          <td class="num">${l.quantity_requested}</td>
          <td class="num" style="font-weight:${l.quantity_dispatched != null ? '600' : '400'}">${l.quantity_dispatched != null ? l.quantity_dispatched : '—'}</td>
          <td class="num" style="font-weight:${l.quantity_received != null ? '600' : '400'}; color:${l.quantity_received != null ? '#059669' : '#64748b'}">${l.quantity_received != null ? l.quantity_received : '—'}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="sig-grid">
    <div class="sig-block">
      <strong>Dispatched By</strong>
      Name: ___________________________<br/>
      Signature: ______________________<br/>
      Date: ${transfer.dispatched_at ? formatDate(transfer.dispatched_at) : '_____________'}
    </div>
    <div class="sig-block">
      <strong>Received By</strong>
      Name: ___________________________<br/>
      Signature: ______________________<br/>
      Date: ${transfer.received_at ? formatDate(transfer.received_at) : '_____________'}
    </div>
  </div>

  <div class="footer">
    <div><strong>${esc(business.name)}</strong> • Stock Transfer • ${esc(transfer.transfer_number)}</div>
    <div style="text-align:right;">Generated ${new Date().toLocaleDateString('en-MW')} • Ledgr Warehouse Management</div>
  </div>
</div>
<script>window.onload = () => setTimeout(() => { try{ window.print(); }catch(e){} }, 400);</script>
</body></html>`;

  openPrintWindow(`Delivery Note ${transfer.transfer_number}`, html);
}

// ── Expense / Receipt ─────────────────────────────────────────────────────────
export function generateReceiptDocument(params: {
  business: BusinessBranding;
  title: string;
  number: string;
  date: string;
  status?: string;
  from: { name: string; details?: string[] };
  to?: { name: string; details?: string[] };
  lines: { description: string; amount: number | string }[];
  totals: { label: string; value: number | string; bold?: boolean; isTotal?: boolean }[];
  currency?: string;
  notes?: string | null;
}) {
  const { business, title, number, date, status, from, to, lines, totals, currency, notes } = params;
  const brand = brandColorStyle(business.brandColor);
  const curr = currency || business.baseCurrency || 'MWK';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>${esc(title)} ${esc(number)} - ${esc(business.name)}</title>
<style>${baseStyles(brand)}</style>
</head><body>
<div class="page">
  ${renderLetterhead(business, title, number, status)}

  <div class="meta-grid">
    <div class="bill-card">
      <h4>${esc(from.name)}</h4>
      ${(from.details || []).map((d) => `<div class="line">${esc(d)}</div>`).join('')}
    </div>
    ${to ? `
    <div class="bill-card">
      <h4>${esc(to.name)}</h4>
      ${(to.details || []).map((d) => `<div class="line">${esc(d)}</div>`).join('')}
    </div>
    ` : `<div class="bill-card"><h4>Date</h4><p class="name">${formatDate(date)}</p></div>`}
  </div>

  <table>
    <thead><tr><th scope="col">Description</th><th scope="col" class="num">Amount (${esc(curr)})</th></tr></thead>
    <tbody>
      ${lines.map((l) => `<tr><td><div class="line-desc">${esc(l.description)}</div></td><td class="num" style="font-weight:600;">${formatMwk(l.amount, curr)}</td></tr>`).join('')}
    </tbody>
  </table>

  <div class="totals"><div class="totals-box">
    ${totals.map((t) => `<div class="totals-row ${t.isTotal ? 'total' : t.bold ? '' : 'muted'}" style="${t.bold && !t.isTotal ? 'font-weight:700;' : ''}"><span>${esc(t.label)}</span><span>${formatMwk(t.value, curr)}</span></div>`).join('')}
  </div></div>

  ${notes ? `<div class="section"><h3>Notes</h3><div class="note-box">${esc(notes)}</div></div>` : ''}

  <div class="footer">
    <div><strong>${esc(business.name)}</strong> • ${esc(title)} • ${esc(number)}</div>
    <div>${formatDate(date)} • Ledgr</div>
  </div>
</div>
<script>window.onload=()=>setTimeout(()=>{try{window.print()}catch{}} ,400)</script>
</body></html>`;
  openPrintWindow(`${title} ${number}`, html);
}

// ── Professional Report ───────────────────────────────────────────────────────
export interface ReportSection {
  title?: string;
  html: string; // already formatted table html
}

export function generateProfessionalReportDocument(params: {
  business: BusinessBranding;
  title: string;
  subtitle?: string;
  period?: string;
  dateLabel?: string;
  currency?: string;
  preparerName?: string;
  notes?: string;
  sections: ReportSection[];
  facts?: { label: string; value: number; currency?: string }[];
  isDraft?: boolean;
}) {
  const { business, title, subtitle, period, currency, preparerName, notes, sections, facts } = params;
  const brand = brandColorStyle(business.brandColor);
  const curr = currency || business.baseCurrency || 'MWK';

  // Facts summary as KPI cards
  const factsHtml = facts && facts.length
    ? `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px,1fr)); gap:12px; margin:14px 0 18px 0;">
        ${facts.map((f) => `
          <div style="border:1px solid #e2e8f0; border-radius:12px; padding:12px 14px; background:#f8fafc;">
            <div style="font-size:8pt; font-weight:700; letter-spacing:0.08em; text-transform:uppercase; color:#64748b; margin-bottom:4px;">${esc(f.label)}</div>
            <div style="font-size:14pt; font-weight:800; letter-spacing:-0.02em; color:#0f172a; font-variant-numeric:tabular-nums;">${formatMwk(f.value, f.currency || curr)}</div>
          </div>
        `).join('')}
       </div>`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>${esc(title)} - ${esc(business.name)}</title>
<style>
${baseStyles(brand)}
.report-content table { width:100%; border-collapse:separate; border-spacing:0; font-size:9.5pt; }
.report-content table thead th {
  background:#0f172a; color:white; font-size:8pt; font-weight:700; letter-spacing:0.06em; text-transform:uppercase;
  padding:10px 12px; text-align:left;
}
.report-content table thead th.num { text-align:right; }
.report-content table tbody td { padding:9px 12px; border-bottom:1px solid #f1f5f9; }
.report-content table tbody td.num { text-align:right; font-variant-numeric:tabular-nums; }
.report-content table tfoot td { font-weight:700; background:#f8fafc; padding:10px 12px; border-top:2px solid #0f172a; }
.cover {
  display:flex;
  flex-direction:column;
  justify-content:center;
  min-height:180px;
  border:1px solid #e2e8f0;
  border-radius:16px;
  padding:22px 24px;
  background: linear-gradient(135deg, ${brand}0D 0%, ${brand}05 100%);
  margin-bottom:18px;
}
.cover h1 { margin:0; font-size:22pt; font-weight:800; letter-spacing:-0.03em; line-height:1.1; }
.cover .meta { margin-top:10px; font-size:9pt; color:#475569; display:flex; gap:16px; flex-wrap:wrap; }
</style>
</head><body>
<div class="page">
  ${params.isDraft ? `<div class="watermark">DRAFT</div>` : ''}

  <!-- Letterhead -->
  <div class="letterhead">
    <div class="letterhead-left">
      ${business.logoUrl ? `<img src="${esc(business.logoUrl)}" class="logo" alt="logo" crossorigin="anonymous"/>` : `<div class="logo-fallback">${esc(getInitials(business.name))}</div>`}
      <div>
        <div class="company-name">${esc(business.name)}</div>
        ${business.tradingName ? `<div class="company-trading">${esc(business.tradingName)}</div>` : ''}
        <div class="company-meta">${businessAddressBlock(business)}</div>
      </div>
    </div>
    <div style="text-align:right; font-size:8pt; color:#64748b; line-height:1.5;">
      <div><strong style="color:#0f172a; font-size:9pt;">${esc(title)}</strong></div>
      ${subtitle ? `<div style="color:#334155; max-width:220px;">${esc(subtitle)}</div>` : ''}
      <div style="margin-top:8px;">Generated: ${new Date().toLocaleDateString('en-MW', { day:'2-digit', month:'long', year:'numeric' })}</div>
      ${preparerName ? `<div>Prepared by: ${esc(preparerName)}</div>` : ''}
      ${currency ? `<div>Currency: ${esc(currency)}</div>` : ''}
    </div>
  </div>

  <div class="cover">
    <h1>${esc(title)}</h1>
    ${subtitle ? `<div style="margin-top:6px; font-size:11pt; color:#334155;">${esc(subtitle)}</div>` : ''}
    <div class="meta">
      ${period ? `<span><strong>Period:</strong> ${esc(period)}</span>` : ''}
      ${params.dateLabel ? `<span><strong>Date:</strong> ${esc(params.dateLabel)}</span>` : ''}
      ${currency ? `<span><strong>Currency:</strong> ${esc(currency)}</span>` : ''}
      ${preparerName ? `<span><strong>Preparer:</strong> ${esc(preparerName)}</span>` : ''}
    </div>
    ${factsHtml}
  </div>

  <div class="report-content">
    ${sections.map((s) => `
      ${s.title ? `<div class="section"><h3>${esc(s.title)}</h3></div>` : ''}
      ${s.html}
    `).join('')}
  </div>

  ${notes ? `
    <div class="section" style="margin-top:24px;">
      <h3>Notes & Disclosures</h3>
      <div class="note-box">${esc(notes).replace(/\n/g, '<br/>')}</div>
    </div>
  ` : ''}

  <div class="footer">
    <div>
      <strong>${esc(business.name)}</strong> • ${esc(title)}<br/>
      <span style="font-size:7pt;">This document was generated by Ledgr • Confidential • IFRS compliant where applicable</span>
    </div>
    <div style="text-align:right;">
      Page 1 • ${new Date().toLocaleDateString('en-MW')} • ${esc(business.baseCurrency || 'MWK')}
    </div>
  </div>
</div>
<script>window.onload=()=>setTimeout(()=>{try{window.print()}catch{}} ,500)</script>
</body></html>`;

  openPrintWindow(title, html);
}
