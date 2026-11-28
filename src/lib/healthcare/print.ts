/**
 * Healthcare print templates.
 *
 * Labels and reports are printed through a hidden, zero-sized iframe — the
 * same isolation strategy used by `thermalReceiptService` — so the clinic SPA
 * is never printed and the label gets its own `@page` size. Everything here is
 * plain HTML/SVG; no PDF or barcode package is involved.
 */

import { buildCode39Svg } from './barcode';
import type {
  DoctorPayoutVoucherData,
  LabReportData,
  MedicationLabelFormat,
  RadiologyReportData,
} from '@/types/healthcare';

export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

export interface MedicationLabelLabels {
  title: string;
  patient: string;
  mrn: string;
  dosage: string;
  frequency: string;
  duration: string;
  durationValue: string;
  quantity: string;
  batch: string;
  expiry: string;
  dispensed: string;
  instructions: string;
  warning: string;
  preparedBy: string;
}

export interface MedicationLabelData {
  businessName: string;
  patientName: string;
  mrn: string;
  medicationName: string;
  dosage: string;
  frequency: string;
  durationDays: number;
  quantity: number;
  instructions?: string | null;
  batchNumber: string;
  expiryDate: string;
  dispensedAt: string;
  pharmacist?: string | null;
  warnings?: string[];
  labels: MedicationLabelLabels;
}

export interface SpecimenLabelLabels {
  title: string;
  patient: string;
  mrn: string;
  specimenType: string;
  tests: string;
  collected: string;
  barcode: string;
}

export interface SpecimenLabelData {
  businessName: string;
  patientName: string;
  mrn: string;
  specimenType: string;
  testNames: string[];
  barcode: string;
  collectedAt: string;
  labels: SpecimenLabelLabels;
}

function labelPageCss(format: MedicationLabelFormat): { page: string; width: string; padding: string } {
  return format === '80mm'
    ? { page: '80mm auto', width: '72mm', padding: '3mm' }
    : { page: '58mm auto', width: '50mm', padding: '2mm' };
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : '';
}

/** 58mm or 80mm medication sticker. */
export function buildMedicationLabelHtml(
  data: MedicationLabelData,
  format: MedicationLabelFormat = '58mm',
): string {
  const size = labelPageCss(format);
  const showWarnings = (data.warnings ?? []).filter(Boolean);
  const small = format === '80mm' ? '10px' : '8.5px';
  const drugSize = format === '80mm' ? '15px' : '12px';

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(data.labels.title)}</title>
    <style>
      @page { size: ${size.page}; margin: 0; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      body {
        margin: 0;
        padding: ${size.padding};
        width: ${size.width};
        max-width: ${size.width};
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        color: #000;
        background: #fff;
        font-size: ${small};
        line-height: 1.3;
      }
      .head { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 2mm; margin-bottom: 2mm; }
      .business { font-weight: 700; font-size: ${small}; text-transform: uppercase; letter-spacing: .04em; }
      .title { font-size: ${small}; margin-top: 1mm; }
      .drug { font-size: ${drugSize}; font-weight: 800; margin: 0 0 1mm; line-height: 1.15; }
      .dose { font-size: ${format === '80mm' ? '13px' : '11px'}; font-weight: 700; }
      .row { display: flex; justify-content: space-between; gap: 2mm; margin-top: .8mm; }
      .row span:first-child { font-weight: 600; }
      .muted { color: #333; }
      .instructions { margin-top: 1.5mm; border-top: 1px dashed #000; padding-top: 1.5mm; }
      .warning { margin-top: 1.5mm; border: 1px solid #000; padding: 1mm; font-weight: 700; }
      .footer { margin-top: 2mm; border-top: 1px dashed #000; padding-top: 1mm; text-align: center; font-size: ${format === '80mm' ? '9px' : '8px'}; }
    </style>
  </head>
  <body>
    <div class="head">
      <div class="business">${escapeHtml(data.businessName)}</div>
      <div class="title">${escapeHtml(data.labels.title)}</div>
    </div>

    <div class="drug">${escapeHtml(data.medicationName)}</div>
    <div class="dose">${escapeHtml(data.dosage)} · ${escapeHtml(data.frequency)}</div>

    <div class="row"><span>${escapeHtml(data.labels.patient)}</span><span>${escapeHtml(data.patientName)}</span></div>
    <div class="row"><span>${escapeHtml(data.labels.mrn)}</span><span class="muted">${escapeHtml(data.mrn)}</span></div>
    <div class="row"><span>${escapeHtml(data.labels.duration)}</span><span>${escapeHtml(data.labels.durationValue.replace('{{count}}', formatNumber(data.durationDays)))}</span></div>
    <div class="row"><span>${escapeHtml(data.labels.quantity)}</span><span>${escapeHtml(formatNumber(data.quantity))}</span></div>
    <div class="row"><span>${escapeHtml(data.labels.batch)}</span><span class="muted">${escapeHtml(data.batchNumber)}</span></div>
    <div class="row"><span>${escapeHtml(data.labels.expiry)}</span><span>${escapeHtml(data.expiryDate)}</span></div>
    <div class="row"><span>${escapeHtml(data.labels.dispensed)}</span><span class="muted">${escapeHtml(data.dispensedAt)}</span></div>

    ${
      data.instructions
        ? `<div class="instructions"><strong>${escapeHtml(data.labels.instructions)}</strong><br />${escapeHtml(data.instructions)}</div>`
        : ''
    }

    ${showWarnings
      .map((warning) => `<div class="warning">${escapeHtml(data.labels.warning)}: ${escapeHtml(warning)}</div>`)
      .join('')}

    <div class="footer">
      ${data.pharmacist ? `${escapeHtml(data.labels.preparedBy)}: ${escapeHtml(data.pharmacist)}<br />` : ''}
      ${escapeHtml(data.dispensedAt)}
    </div>
  </body>
</html>`;
}

/** 58mm specimen sticker with a Code 39 barcode. */
export function buildSpecimenLabelHtml(data: SpecimenLabelData): string {
  const barcode = buildCode39Svg(data.barcode, {
    width: 180,
    height: 46,
    quietZone: 8,
    showText: false,
  });

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(data.labels.title)}</title>
    <style>
      @page { size: 58mm auto; margin: 0; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      body {
        margin: 0;
        padding: 2mm;
        width: 50mm;
        max-width: 50mm;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        color: #000;
        background: #fff;
        font-size: 8.5px;
        line-height: 1.3;
      }
      .head { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 1mm; margin-bottom: 1.5mm; }
      .business { font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
      .title { font-weight: 600; }
      .barcode { text-align: center; margin: 1.5mm 0 0.5mm; }
      .barcode svg { width: 46mm; height: auto; }
      .code { text-align: center; font-family: 'Courier New', monospace; font-size: 11px; font-weight: 700; letter-spacing: .08em; margin-bottom: 1.5mm; }
      .row { display: flex; justify-content: space-between; gap: 2mm; margin-top: .6mm; }
      .row span:first-child { font-weight: 600; }
      .tests { margin-top: 1.5mm; border-top: 1px dashed #000; padding-top: 1mm; }
      .tests ul { margin: 0.5mm 0 0; padding-left: 3.5mm; }
    </style>
  </head>
  <body>
    <div class="head">
      <div class="business">${escapeHtml(data.businessName)}</div>
      <div class="title">${escapeHtml(data.labels.title)}</div>
    </div>

    <div class="barcode">${barcode}</div>
    <div class="code">${escapeHtml(data.barcode)}</div>

    <div class="row"><span>${escapeHtml(data.labels.patient)}</span><span>${escapeHtml(data.patientName)}</span></div>
    <div class="row"><span>${escapeHtml(data.labels.mrn)}</span><span>${escapeHtml(data.mrn)}</span></div>
    <div class="row"><span>${escapeHtml(data.labels.specimenType)}</span><span>${escapeHtml(data.specimenType)}</span></div>
    <div class="row"><span>${escapeHtml(data.labels.collected)}</span><span>${escapeHtml(data.collectedAt)}</span></div>

    <div class="tests">
      <strong>${escapeHtml(data.labels.tests)}</strong>
      <ul>${data.testNames.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul>
    </div>
  </body>
</html>`;
}

function reportStatusLabel(status: LabReportData['items'][number]['status'], data: LabReportData): string {
  switch (status) {
    case 'critical':
      return data.labels.statusCritical;
    case 'abnormal':
      return data.labels.statusAbnormal;
    case 'normal':
      return data.labels.statusNormal;
    default:
      return data.labels.statusPending;
  }
}

/** A4 laboratory report. */
export function buildLabReportHtml(data: LabReportData): string {
  const rows = data.items
    .map(
      (item) => `<tr>
        <td>${escapeHtml(item.testName)}</td>
        <td class="result">${escapeHtml(item.result || '—')}</td>
        <td>${escapeHtml(item.unit)}</td>
        <td>${escapeHtml(item.reference)}</td>
        <td class="status status-${escapeHtml(item.status)}">${escapeHtml(reportStatusLabel(item.status, data))}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(data.labels.title)}</title>
    <style>
      @page { size: A4; margin: 12mm; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        color: #111;
        background: #fff;
        font-size: 10pt;
        line-height: 1.4;
      }
      .letterhead { display: flex; align-items: center; justify-content: space-between; gap: 8mm; border-bottom: 2px solid #111; padding-bottom: 4mm; }
      .brand { display: flex; align-items: center; gap: 4mm; }
      .brand img { max-height: 16mm; max-width: 40mm; object-fit: contain; }
      .brand h1 { font-size: 16pt; margin: 0; }
      .brand p { margin: 1mm 0 0; color: #555; font-size: 9pt; }
      .doc-title { text-align: right; }
      .doc-title h2 { margin: 0; font-size: 13pt; text-transform: uppercase; letter-spacing: .06em; }
      .doc-title p { margin: 1mm 0 0; color: #555; font-size: 9pt; }
      .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm 8mm; margin: 6mm 0; }
      .meta div { display: flex; gap: 2mm; font-size: 9.5pt; }
      .meta .label { color: #555; min-width: 30mm; }
      .meta .value { font-weight: 600; }
      .specimen { border: 1px solid #ccc; border-radius: 2mm; padding: 3mm; margin-bottom: 5mm; display: grid; grid-template-columns: 1fr 1fr; gap: 2mm 8mm; font-size: 9pt; }
      table { width: 100%; border-collapse: collapse; margin-top: 2mm; }
      thead { display: table-header-group; }
      th, td { border: 1px solid #999; padding: 2.2mm 2.5mm; text-align: left; vertical-align: top; }
      th { background: #f1f5f9; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; }
      td.result { font-weight: 700; }
      td.status { font-weight: 700; text-align: center; }
      .status-critical { background: #fee2e2; color: #991b1b; }
      .status-abnormal { background: #fef3c7; color: #92400e; }
      .status-normal { background: #dcfce7; color: #166534; }
      .status-pending { background: #f1f5f9; color: #475569; }
      .signoff { margin-top: 10mm; display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; font-size: 9pt; }
      .signoff .line { border-top: 1px solid #111; padding-top: 2mm; margin-top: 10mm; }
      .footer { margin-top: 8mm; border-top: 1px solid #ccc; padding-top: 2mm; font-size: 8pt; color: #666; display: flex; justify-content: space-between; }
      .pending-note { margin-top: 4mm; border: 1px solid #f59e0b; background: #fffbeb; padding: 2.5mm; font-size: 9pt; color: #92400e; }
    </style>
  </head>
  <body>
    <header class="letterhead">
      <div class="brand">
        ${data.logoUrl ? `<img src="${escapeHtml(data.logoUrl)}" alt="" />` : ''}
        <div>
          <h1>${escapeHtml(data.businessName)}</h1>
          <p>${escapeHtml(data.labels.title)}</p>
        </div>
      </div>
      <div class="doc-title">
        <h2>${escapeHtml(data.labels.title)}</h2>
        <p>${escapeHtml(data.orderNumber)}</p>
        <p>${escapeHtml(data.orderDate)}</p>
      </div>
    </header>

    <section class="meta">
      <div><span class="label">${escapeHtml(data.labels.patient)}</span><span class="value">${escapeHtml(data.patientName)}</span></div>
      <div><span class="label">${escapeHtml(data.labels.mrn)}</span><span class="value">${escapeHtml(data.mrn)}</span></div>
      <div><span class="label">${escapeHtml(data.labels.age)}</span><span class="value">${escapeHtml(data.age || '—')}</span></div>
      <div><span class="label">${escapeHtml(data.labels.sex)}</span><span class="value">${escapeHtml(data.sex || '—')}</span></div>
      <div><span class="label">${escapeHtml(data.labels.visit)}</span><span class="value">${escapeHtml(data.visitNumber)}</span></div>
      <div><span class="label">${escapeHtml(data.labels.orderedBy)}</span><span class="value">${escapeHtml(data.orderedBy)}</span></div>
    </section>

    <section class="specimen">
      <div><strong>${escapeHtml(data.labels.specimen)}:</strong> ${escapeHtml(data.specimenType)}</div>
      <div><strong>${escapeHtml(data.labels.barcode)}:</strong> ${escapeHtml(data.specimenBarcode)}</div>
      <div><strong>${escapeHtml(data.labels.collected)}:</strong> ${escapeHtml(data.collectedAt || '—')}</div>
      <div><strong>${escapeHtml(data.labels.clinicalIndication)}:</strong> ${escapeHtml(data.clinicalIndication || '—')}</div>
    </section>

    <table>
      <thead>
        <tr>
          <th>${escapeHtml(data.labels.test)}</th>
          <th>${escapeHtml(data.labels.result)}</th>
          <th>${escapeHtml(data.labels.unit)}</th>
          <th>${escapeHtml(data.labels.reference)}</th>
          <th>${escapeHtml(data.labels.status)}</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="5">${escapeHtml(data.labels.noResults)}</td></tr>`}</tbody>
    </table>

    ${data.isVerified ? '' : `<div class="pending-note">${escapeHtml(data.labels.pendingVerification)}</div>`}

    <section class="signoff">
      <div>
        <div class="line">
          ${escapeHtml(data.labels.verifiedBy)}: ${escapeHtml(data.verifiedBy || '—')}<br />
          ${escapeHtml(data.labels.verifiedAt)}: ${escapeHtml(data.verifiedAt || '—')}
        </div>
      </div>
      <div>
        <div class="line">${escapeHtml(data.businessName)}</div>
      </div>
    </section>

    <footer class="footer">
      <span>${escapeHtml(data.orderNumber)}</span>
      <span>${escapeHtml(data.labels.printed)}: ${escapeHtml(new Date().toLocaleString())}</span>
    </footer>
  </body>
</html>`;
}

function money(value: number, currency: string): string {
  const amount = Number.isFinite(value) ? value : 0;
  const formatted = new Intl.NumberFormat('en', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${currency} ${formatted}`;
}

/** A4 doctor commission payout voucher, printed through the native dialog. */
export function buildDoctorPayoutVoucherHtml(data: DoctorPayoutVoucherData): string {
  const rows = data.lines
    .map(
      (line) => `<tr>
        <td>${escapeHtml(line.visitNumber || '—')}</td>
        <td>${escapeHtml(line.patientName || '—')}</td>
        <td class="num">${escapeHtml(money(line.consultationAmount, data.currency))}</td>
        <td class="num">${escapeHtml(money(line.labAmount, data.currency))}</td>
        <td class="num">${escapeHtml(money(line.pharmacyAmount, data.currency))}</td>
        <td class="num strong">${escapeHtml(money(line.earnedCommission, data.currency))}</td>
        <td>${escapeHtml(data.labels.statuses[line.status] ?? line.status)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(data.labels.title)}</title>
    <style>
      @page { size: A4; margin: 12mm; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
        color: #111;
        background: #fff;
        font-size: 10pt;
        line-height: 1.4;
      }
      .letterhead { display: flex; align-items: center; justify-content: space-between; gap: 8mm; border-bottom: 2px solid #111; padding-bottom: 4mm; }
      .brand { display: flex; align-items: center; gap: 4mm; }
      .brand img { max-height: 16mm; max-width: 40mm; object-fit: contain; }
      .brand h1 { font-size: 16pt; margin: 0; }
      .brand p { margin: 1mm 0 0; color: #555; font-size: 9pt; }
      .doc-title { text-align: right; }
      .doc-title h2 { margin: 0; font-size: 13pt; text-transform: uppercase; letter-spacing: .06em; }
      .doc-title p { margin: 1mm 0 0; color: #555; font-size: 9pt; }
      .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm 8mm; margin: 6mm 0; }
      .meta div { display: flex; gap: 2mm; font-size: 9.5pt; }
      .meta .label { color: #555; min-width: 28mm; }
      .meta .value { font-weight: 600; }
      table { width: 100%; border-collapse: collapse; margin-top: 2mm; }
      thead { display: table-header-group; }
      th, td { border: 1px solid #999; padding: 2mm 2.2mm; text-align: left; vertical-align: top; }
      th { background: #f1f5f9; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; }
      td.num, th.num { text-align: right; white-space: nowrap; }
      td.strong { font-weight: 700; }
      tfoot td { font-weight: 700; background: #f8fafc; }
      .signoff { margin-top: 12mm; display: grid; grid-template-columns: 1fr 1fr; gap: 12mm; font-size: 9pt; }
      .signoff .line { border-top: 1px solid #111; padding-top: 2mm; margin-top: 10mm; }
      .footer { margin-top: 8mm; border-top: 1px solid #ccc; padding-top: 2mm; font-size: 8pt; color: #666; display: flex; justify-content: space-between; }
    </style>
  </head>
  <body>
    <header class="letterhead">
      <div class="brand">
        ${data.logoUrl ? `<img src="${escapeHtml(data.logoUrl)}" alt="" />` : ''}
        <div>
          <h1>${escapeHtml(data.businessName)}</h1>
          <p>${escapeHtml(data.labels.title)}</p>
        </div>
      </div>
      <div class="doc-title">
        <h2>${escapeHtml(data.labels.title)}</h2>
        <p>${escapeHtml(data.labels.voucherNumber)}: ${escapeHtml(data.voucherNumber)}</p>
        <p>${escapeHtml(data.labels.generated)}: ${escapeHtml(data.generatedAt)}</p>
      </div>
    </header>

    <section class="meta">
      <div><span class="label">${escapeHtml(data.labels.doctor)}</span><span class="value">${escapeHtml(data.doctorName)}</span></div>
      <div><span class="label">${escapeHtml(data.labels.period)}</span><span class="value">${escapeHtml(data.periodFrom)} — ${escapeHtml(data.periodTo)}</span></div>
      <div><span class="label">${escapeHtml(data.labels.currency)}</span><span class="value">${escapeHtml(data.currency)}</span></div>
      <div><span class="label">${escapeHtml(data.labels.total)}</span><span class="value">${escapeHtml(money(data.total, data.currency))}</span></div>
    </section>

    <table>
      <thead>
        <tr>
          <th>${escapeHtml(data.labels.visit)}</th>
          <th>${escapeHtml(data.labels.patient)}</th>
          <th class="num">${escapeHtml(data.labels.consultation)}</th>
          <th class="num">${escapeHtml(data.labels.laboratory)}</th>
          <th class="num">${escapeHtml(data.labels.pharmacy)}</th>
          <th class="num">${escapeHtml(data.labels.earned)}</th>
          <th>${escapeHtml(data.labels.status)}</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="7">${escapeHtml(data.labels.footer)}</td></tr>`}</tbody>
      <tfoot>
        <tr>
          <td colspan="5">${escapeHtml(data.labels.total)}</td>
          <td class="num">${escapeHtml(money(data.total, data.currency))}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>

    <section class="signoff">
      <div>
        <div class="line">${escapeHtml(data.labels.preparedBy)}</div>
      </div>
      <div>
        <div class="line">${escapeHtml(data.labels.signature)}</div>
      </div>
    </section>

    <footer class="footer">
      <span>${escapeHtml(data.labels.voucherNumber)}: ${escapeHtml(data.voucherNumber)}</span>
      <span>${escapeHtml(data.labels.footer)}</span>
    </footer>
  </body>
</html>`;
}

/** A4 radiology / imaging report, printed through the same sandboxed iframe. */
export function buildRadiologyReportHtml(data: RadiologyReportData): string {
  const images = (data.imageUrls ?? []).filter(Boolean);
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(data.labels.title)} — ${escapeHtml(data.orderNumber)}</title>
    <style>
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; color: #111827; font-size: 12px; line-height: 1.5; }
      header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 14px; }
      h1 { font-size: 19px; margin: 0 0 4px; letter-spacing: .2px; }
      .brand { font-size: 15px; font-weight: 700; }
      .muted { color: #6b7280; font-size: 11px; }
      .order { text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; font-weight: 700; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 24px; margin: 12px 0 18px; }
      .row { display: flex; gap: 8px; border-bottom: 1px solid #e5e7eb; padding: 4px 0; }
      .row dt { color: #6b7280; min-width: 116px; margin: 0; }
      .row dd { margin: 0; font-weight: 600; }
      h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .9px; color: #374151; margin: 16px 0 6px; }
      .box { border: 1px solid #d1d5db; border-radius: 6px; padding: 10px 12px; white-space: pre-wrap; min-height: 64px; }
      .impression { background: #f8fafc; border-left: 4px solid #0f172a; }
      .images img { max-width: 100%; max-height: 230px; border: 1px solid #d1d5db; border-radius: 4px; margin: 0 8px 8px 0; }
      footer { margin-top: 28px; display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
      .signature { border-top: 1px solid #111827; padding-top: 4px; min-width: 220px; }
      .disclaimer { margin-top: 18px; color: #6b7280; font-size: 9.5px; border-top: 1px solid #e5e7eb; padding-top: 8px; }
    </style>
  </head>
  <body>
    <header>
      <div>
        <div class="brand">${escapeHtml(data.businessName)}</div>
        <h1>${escapeHtml(data.labels.title)}</h1>
        <div class="muted">${escapeHtml(data.labels.procedure)}: ${escapeHtml(data.procedureName)}</div>
      </div>
      <div class="order">${escapeHtml(data.orderNumber)}</div>
    </header>

    <dl class="grid">
      <div class="row"><dt>${escapeHtml(data.labels.patient)}</dt><dd>${escapeHtml(data.patientName)}</dd></div>
      <div class="row"><dt>${escapeHtml(data.labels.mrn)}</dt><dd>${escapeHtml(data.mrn)}</dd></div>
      <div class="row"><dt>${escapeHtml(data.labels.modality)}</dt><dd>${escapeHtml(String(data.modality).toUpperCase())}</dd></div>
      <div class="row"><dt>${escapeHtml(data.labels.bodySite)}</dt><dd>${escapeHtml(data.bodySite ?? '—')}</dd></div>
      <div class="row"><dt>${escapeHtml(data.labels.performedAt)}</dt><dd>${escapeHtml(data.performedAt ?? '—')}</dd></div>
      <div class="row"><dt>${escapeHtml(data.labels.reportedAt)}</dt><dd>${escapeHtml(data.reportedAt ?? '—')}</dd></div>
    </dl>

    <h2>${escapeHtml(data.labels.indication)}</h2>
    <div class="box">${escapeHtml(data.clinicalIndication ?? '—')}</div>

    <h2>${escapeHtml(data.labels.findings)}</h2>
    <div class="box">${escapeHtml(data.findings)}</div>

    <h2>${escapeHtml(data.labels.impression)}</h2>
    <div class="box impression">${escapeHtml(data.impression)}</div>

    ${data.recommendations ? `<h2>${escapeHtml(data.labels.recommendations)}</h2><div class="box">${escapeHtml(data.recommendations)}</div>` : ''}

    ${images.length ? `<h2>${escapeHtml(data.labels.images)}</h2><div class="images">${images.map((url) => `<img src="${escapeHtml(url)}" alt="" />`).join('')}</div>` : ''}

    <footer>
      <div class="signature">
        <div>${escapeHtml(data.radiologist ?? '')}</div>
        <div class="muted">${escapeHtml(data.labels.radiologist)}</div>
      </div>
      <div class="signature">
        <div>${escapeHtml(data.technician ?? '')}</div>
        <div class="muted">${escapeHtml(data.labels.technician)}</div>
      </div>
    </footer>
    <div class="disclaimer">${escapeHtml(data.labels.disclaimer)}</div>
  </body>
</html>`;
}

/**
 * Print an HTML document in an isolated, hidden iframe. The frame is removed
 * after a minute so closing the native print dialog does not leak DOM nodes.
 */
export function printHtmlDocument(html: string, frameId = 'ledgr-healthcare-print-frame'): void {
  if (typeof document === 'undefined') return;

  const existing = document.getElementById(frameId);
  if (existing) existing.remove();

  const iframe = document.createElement('iframe');
  iframe.id = frameId;
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.cssText =
    'position:fixed; right:0; bottom:0; width:0; height:0; border:0; opacity:0; pointer-events:none;';
  document.body.appendChild(iframe);

  let printed = false;
  const print = () => {
    if (printed) return;
    printed = true;
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => iframe.remove(), 60_000);
    }
  };

  iframe.onload = () => setTimeout(print, 60);
  iframe.srcdoc = html;
  // Safety net for browsers that never fire load on a zero-sized srcdoc frame.
  setTimeout(print, 1_500);
}
