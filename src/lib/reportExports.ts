import type { BusinessBranding } from './documents/types';
import { generateProfessionalReportDocument } from './documents/documentGenerator';

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

// Professional PDF export with full business letterhead, logo, and polished styling
export function exportReportAsPDF(opts: ExportOptions) {
  const business = resolveBusiness(opts);

  // If htmlContent already looks like a full document (has <table>), keep it as is.
  // We wrap it as a report section for professional rendering.
  const cleanHtml = opts.htmlContent?.trim() || '<p style="color:#94a3b8; font-size:9pt;">No content available for this report.</p>';

  // Detect if htmlContent is from old selector that pulled entire page wrapper; try to strip outer containers
  // For financial reports we want only table content; if selector returned outer page, extract inner table portion
  // Otherwise keep as is - generateProfessionalReportDocument will style it.

  generateProfessionalReportDocument({
    business,
    title: opts.title,
    subtitle: opts.subtitle,
    dateLabel: opts.dateLabel,
    period: opts.subtitle?.includes('–') || opts.subtitle?.includes('to') ? opts.subtitle : opts.dateLabel,
    currency: opts.currency,
    preparerName: opts.preparerName,
    notes: opts.notes,
    sections: [{ html: `<div style="margin-top:8px;">${cleanHtml}</div>` }],
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
