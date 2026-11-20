import type { BusinessBranding } from './documents/types';
import { printHtmlContent } from '@/services/reportPrintService';

export interface ExportOptions {
  title: string;
  subtitle?: string;
  dateLabel: string;
  currency?: string;
  preparerName?: string;
  notes?: string;
  businessName: string;
  htmlContent: string;
  // Enhanced branding - optional for backward compat
  business?: BusinessBranding | null;
  brandColor?: string | null;
  logoUrl?: string | null;
}

function resolveBusiness(opts: ExportOptions): BusinessBranding {
  if (opts.business) return opts.business;
  return {
    name: opts.businessName || 'Business',
    tradingName: null,
    logoUrl: opts.logoUrl ?? null,
    brandColor: opts.brandColor ?? null,
    baseCurrency: opts.currency,
  };
}

/**
 * Professional PDF export.
 *
 * The document is rendered by the browser's own print pipeline inside an
 * isolated frame (`printHtmlContent`) rather than rasterised with html2canvas
 * + jsPDF. The raster path produced blank or clipped pages whenever a report sat
 * in a scroll container, a hidden tab or an `overflow: hidden` card — the exact
 * "blank PDF" defect — and it could not paginate. Printing keeps the report's own
 * styles, produces real selectable text and lets the operator choose
 * "Save as PDF" in the browser dialog.
 */
export function exportReportAsPDF(opts: ExportOptions) {
  const business = resolveBusiness(opts);
  const cleanHtml = opts.htmlContent?.trim()
    || '<p style="color:#94a3b8; font-size:9pt;">No content available for this report.</p>';

  printHtmlContent(cleanHtml, {
    title: opts.title,
    subtitle: opts.subtitle,
    companyName: business.name || opts.businessName,
  });
}

// Basic XBRL export (IFRS taxonomy stub) - enhanced but backward compatible
export function exportReportAsXBRL(
  opts: ExportOptions & {
    facts: Array<{ concept: string; value: number; unit?: string; date?: string }>;
  },
) {
  const businessName = opts.business?.name || opts.businessName || 'Business';

  const xbrl = `<?xml version="1.0" encoding="UTF-8"?>
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance"
            xmlns:ledgr="http://ledgr.app/xbrl/2026"
            xmlns:iso4217="http://www.xbrl.org/2003/iso4217"
            xmlns:xlink="http://www.w3.org/1999/xlink"
            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">

  <xbrli:context id="current">
    <xbrli:entity>
      <xbrli:identifier scheme="http://www.ledgr.app">${businessName}</xbrli:identifier>
    </xbrli:entity>
    <xbrli:period>
      <xbrli:instant>${opts.dateLabel}</xbrli:instant>
    </xbrli:period>
  </xbrli:context>

  <xbrli:unit id="${opts.currency || 'MWK'}">
    <xbrli:measure>iso4217:${opts.currency || 'MWK'}</xbrli:measure>
  </xbrli:unit>

  <!-- Facts -->
  ${opts.facts
    .map(
      (fact) => `
  <ledgr:${fact.concept} contextRef="current" unitRef="${fact.unit || opts.currency || 'MWK'}" 
    ${fact.date ? `decimals="2"` : ''}>${fact.value}</ledgr:${fact.concept}>`,
    )
    .join('\n')}

  <!-- Notes -->
  ${opts.notes ? `\n  <ledgr:Notes contextRef="current">${opts.notes}</ledgr:Notes>` : ''}

</xbrli:xbrl>`;

  const blob = new Blob([xbrl], { type: 'application/xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${opts.title.toLowerCase().replace(/\s+/g, '-')}-${opts.dateLabel}.xbrl`;
  a.click();
  URL.revokeObjectURL(url);
}
