import i18next from 'i18next';

/*
 * Translations are taken from the i18next singleton rather than `@/i18n` so that
 * merely importing a page cannot pull the app's i18n bootstrap (and its React
 * binding) into a bundle or test that only needs to print a document. If the
 * instance is not initialised we fall back to English copy below.
 */

export interface PrintReportOptions {
  title: string;
  subtitle?: string;
  companyName?: string;
  generatedAt?: string;
  orientation?: 'portrait' | 'landscape';
  /** BCP-47 tag for the printed document; defaults to the app language. */
  language?: string;
}

/** The frame is fixed and hidden: it must never affect the app layout. */
export const PRINT_FRAME_ID = 'ledgr-print-frame';
/** Give the frame's document one paint before opening the print dialog. */
const PRINT_DELAY_MS = 250;
/** Keep the frame alive long enough for slow print dialogs (e.g. "Save as PDF"). */
const FRAME_LIFETIME_MS = 60_000;

/** Escape text that is interpolated into the printed document. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `{{name}}` substitution for the English fallbacks below. */
function interpolate(template: string, values?: Record<string, unknown>): string {
  if (!values) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ''));
}

function printText(key: string, fallback: string, options?: Record<string, unknown>): string {
  const translated = i18next.t(key, options);
  // i18next echoes the key when a locale is missing the entry (or before the app
  // initialises). Keep an English sentence rather than leaking a dotted key into
  // a document the customer may hand to an auditor.
  return translated && translated !== key ? translated : interpolate(fallback, options);
}

/**
 * Build the standalone printable document.
 *
 * Exported so the document contract (title, header, footer, escaping) can be
 * asserted without a DOM.
 */
export function buildPrintDocument(htmlContent: string, options: PrintReportOptions): string {
  const orientation = options.orientation ?? 'portrait';
  const language = options.language ?? i18next.resolvedLanguage ?? i18next.language ?? 'en';
  const generatedAt = options.generatedAt ?? new Date().toLocaleString(language);
  const title = escapeHtml(options.title);
  const subtitle = options.subtitle ? escapeHtml(options.subtitle) : '';
  const companyName = options.companyName ? escapeHtml(options.companyName) : '';
  const generatedLabel = printText('reports.print.generatedAt', 'Generated: {{timestamp}}', {
    timestamp: generatedAt,
  });

  return `<!DOCTYPE html>
    <html lang="${escapeHtml(language)}">
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          @page {
            size: A4 ${orientation};
            margin: 15mm 12mm 15mm 12mm;
          }
          * {
            box-sizing: border-box;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            font-size: 11pt;
            line-height: 1.4;
            color: #111827;
            background: #ffffff;
            margin: 0;
            padding: 0;
          }
          .header {
            margin-bottom: 20px;
            border-bottom: 2px solid #e5e7eb;
            padding-bottom: 12px;
          }
          .header h1 {
            font-size: 18pt;
            font-weight: 700;
            margin: 0 0 4px 0;
            color: #111827;
          }
          .header .subtitle {
            font-size: 10pt;
            color: #4b5563;
            margin: 0;
          }
          .meta {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            font-size: 9pt;
            color: #6b7280;
            margin-top: 8px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 12px;
            font-size: 9.5pt;
          }
          th {
            background-color: #f3f4f6;
            color: #374151;
            font-weight: 600;
            text-align: left;
            padding: 8px 10px;
            border-bottom: 1px solid #d1d5db;
          }
          th.text-right, td.text-right {
            text-align: right;
          }
          th.text-center, td.text-center {
            text-align: center;
          }
          td {
            padding: 6px 10px;
            border-bottom: 1px solid #f3f4f6;
            color: #1f2937;
          }
          tr:nth-child(even) td {
            background-color: #f9fafb;
          }
          .total-row td {
            font-weight: 700;
            border-top: 2px solid #d1d5db;
            border-bottom: 2px solid #d1d5db;
            background-color: #f3f4f6;
          }
          h2 { font-size: 13pt; margin: 18px 0 4px; color: #111827; }
          h3 { font-size: 11pt; margin: 14px 0 4px; color: #111827; }
          p { margin: 4px 0; }
          dl { margin: 8px 0; }
          dt { font-weight: 600; color: #374151; }
          dd { margin: 0 0 6px 0; }
          .footer {
            margin-top: 30px;
            padding-top: 10px;
            border-top: 1px solid #e5e7eb;
            font-size: 8pt;
            color: #9ca3af;
            text-align: center;
          }
          @media print {
            body { width: 100%; }
            thead { display: table-header-group; }
            tr, img { break-inside: avoid; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${title}</h1>
          ${subtitle ? `<p class="subtitle">${subtitle}</p>` : ''}
          <div class="meta">
            <span>${companyName ? `<strong>${companyName}</strong>` : ''}</span>
            <span>${escapeHtml(generatedLabel)}</span>
          </div>
        </div>
        <div class="content">
          ${htmlContent}
        </div>
        <div class="footer">
          ${escapeHtml(printText('reports.print.footer', 'Generated securely by Ledgr ERP'))} · ${escapeHtml(printText('reports.print.confidential', 'Confidential'))}
        </div>
      </body>
    </html>`;
}

/**
 * Renders an isolated HTML document in a hidden iframe and triggers native
 * `window.print()`.
 *
 * This bypasses the main app layout (sidebars, scroll containers,
 * `overflow: hidden`, virtualised tables) that makes "Print / Save as PDF" come
 * out blank or clipped, and it needs no PDF library — the browser's own print
 * pipeline produces the multi-page, styled document.
 */
export function printHtmlContent(htmlContent: string, options: PrintReportOptions): void {
  if (typeof document === 'undefined') return;

  // 1. Remove any existing print frame so a second export cannot print the
  //    previous report.
  document.getElementById(PRINT_FRAME_ID)?.remove();

  // 2. Create the hidden frame.
  const iframe = document.createElement('iframe');
  iframe.id = PRINT_FRAME_ID;
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('title', options.title);
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const frameWindow = iframe.contentWindow;
  const frameDocument = frameWindow?.document;
  if (!frameWindow || !frameDocument) {
    iframe.remove();
    return;
  }

  // 3. Write the printable document.
  frameDocument.open();
  frameDocument.write(buildPrintDocument(htmlContent, options));
  frameDocument.close();

  // 4. Print once the frame has rendered its document.
  setTimeout(() => {
    try {
      frameWindow.focus();
      if (typeof frameWindow.print === 'function') frameWindow.print();
    } finally {
      // 5. Clean up the frame; kept alive long enough for a slow print dialog.
      setTimeout(() => iframe.remove(), FRAME_LIFETIME_MS);
    }
  }, PRINT_DELAY_MS);
}

/**
 * Strip app-only chrome from the printed copy: controls cannot be used on paper
 * and, in a report body, only add noise.
 */
function printableMarkup(element: HTMLElement): string {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script, noscript, button, input, select, textarea, .no-print, [data-print-ignore]')
    .forEach((node) => node.remove());
  return clone.innerHTML;
}

/**
 * Print an on-screen report body — the common case: the page already renders the
 * figures, so the printed document reuses exactly what the user sees.
 */
export function printElementRef(element: HTMLElement | null, options: PrintReportOptions): void {
  if (!element) return;
  const markup = printableMarkup(element);
  if (!markup.trim()) return;
  printHtmlContent(markup, options);
}
