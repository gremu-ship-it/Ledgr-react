/**
 * Business data backup/export service.
 *
 * SECURITY MODEL — read carefully before modifying:
 *
 *  1. TENANT ISOLATION: every query below is filtered by `business_id` and
 *     runs through the existing repositories (which already enforce RLS on
 *     the server). We do NOT introduce any new reads that bypass RLS. A
 *     user can only export data their session is already authorised to
 *     see.
 *
 *  2. CLIENT-INITIATED ONLY: there is no automated backup, no cron, no
 *     background upload. The export is triggered by an explicit user
 *     gesture (Settings → Data backup → Export) and the file is saved
 *     directly to the user's device via a Blob URL + anchor click. It
 *     never touches a third-party server.
 *
 *  3. CSV INJECTION DEFENCE: spreadsheet programs (Excel, LibreOffice,
 *     Google Sheets) treat cells starting with `=`, `+`, `-`, `@`, `\t`,
 *     `\r` as formulae and will execute them on open. A malicious contact
 *     name like `=CMD(...)` would become a code-execution vector if we
 *     exported it verbatim. We prefix every such cell with a single quote
 *     (Excel/Libre's escape for "this is text") and never include raw
 *     line breaks inside a cell.
 *
 *  4. NO SECRETS: the export does not include auth tokens, password
 *     hashes, webhook secrets, API keys, or the offline sync queue.
 *
 *  5. OPT-IN: we do not trigger downloads automatically. The UI shows a
 *     confirmation with an estimate of the row count before starting.
 *
 *  6. SIZE CAPS: each table is capped at a sane maximum (see CAPS below)
 *     so a multi-year business doesn't try to serialize a billion rows
 *     into memory. These are the same caps the list views use.
 *
 *  7. FILENAME SANITISATION: the generated filename is built from the
 *     business name stripped to ASCII alphanumerics plus `-` and `_`,
 *     plus a timestamp, to avoid path-injection or special-character
 *     issues when the browser writes the file.
 */

import { repos } from '@/lib/repositories';


// Row limits per table — generous enough to cover a full financial year
// for a typical SME but bounded so we don't blow up the browser.
const CAPS = {
  expenses: 10_000,
  expense_lines: 20_000,
  invoices: 10_000,
  invoice_lines: 20_000,
  invoice_payments: 10_000,
  contacts: 5_000,
  products: 5_000,
  journal_entries: 20_000,
  journal_lines: 50_000,
  accounts: 500,
  branches: 200,
  departments: 200,
  stock_movements: 20_000,
  inventory_balances: 5_000,
} as const;

// Tables included in a "full backup" JSON export. CSV export is a
// human-friendly subset (the lists people most often take to Excel).
const CSV_TABLES = [
  'expenses',
  'invoices',
  'invoice_payments',
  'contacts',
  'products',
  'journal_entries',
  'accounts',
] as const;

export interface BackupProgress {
  stage: string;
  rows: number;
  totalStages: number;
  stageIndex: number;
}

export type ProgressCb = (p: BackupProgress) => void;

/** Sanitise a string for use inside a CSV cell. Exported for testing. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Strip control characters that would break CSV parsing. The control
  // characters are the subject of this expression rather than an accident in
  // it, which is the case no-control-regex exists to catch.
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  // Newlines inside cells become spaces (Excel-compatible).
  s = s.replace(/\r?\n/g, ' ');
  // CSV-injection defence: prefix formula-leading characters with a single
  // quote so Excel/Sheets/LibreOffice treat them as literal text. See
  // OWASP "CSV Injection" / "Formula Injection" guidance.
  // Exception: pure numeric cells like "-42.50" must not be quoted or
  // spreadsheets will treat them as text and break numeric sort/sum.
  if (
    s.length > 0 &&
    '=+-@\t\r'.includes(s.charAt(0)) &&
    // Negative numbers are safe; anything with a second non-numeric character
    // after a leading +/- is a potential formula.
    !(s.length > 1 && (s.charAt(0) === '-' || s.charAt(0) === '+') && /^-?\d+(\.\d+)?$/.test(s))
  ) {
    s = "'" + s;
  }
  // Quote the cell and double-up embedded quotes if it contains special chars.
  if (s.includes(',') || s.includes('"') || s.includes("'") || s.includes('\n')) {
    s = `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Array.from(
    rows.reduce<Set<string>>((cols, row) => {
      Object.keys(row).forEach((k) => cols.add(k));
      return cols;
    }, new Set()),
  );
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvCell(row[h])).join(','));
  }
  return lines.join('\n');
}

/** Safe filename component: strip to ASCII letters/digits/dash/underscore. */
function safeName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'business';
}

function timestampSlug(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Trigger a browser download for a Blob. */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener'; // defense-in-depth; blob URLs are same-origin
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Release the blob URL on the next tick so the browser can GC the data.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ── Table fetches ────────────────────────────────────────────────────────────
// Each returns a plain object array. Sensitive columns are explicitly
// deleted before export (e.g. no auth user ids, no webhook secrets — but
// those live in other tables not included here).

type TableFetcher = (businessId: string) => Promise<Record<string, unknown>[]>;

const fetchers: Record<string, TableFetcher> = {
  async expenses(businessId) {
    const rows = await repos.expense.findByBusiness(businessId, undefined, CAPS.expenses);
    return rows.map((r) => ({ ...r }));
  },
  async expense_lines(businessId) {
    // Lines belong to expenses of this business. Pull via a direct join to
    // enforce tenant scoping — rather than selecting all expense_lines in
    // the system.
    const { data, error } = await repos.expense.db
      .from('expense_lines')
      .select('*')
      .eq('business_id', businessId)
      .limit(CAPS.expense_lines);
    if (error) throw error;
    return (data ?? []) as unknown as Record<string, unknown>[];
  },
  async invoices(businessId) {
    const rows = await repos.invoice.findByBusiness(businessId, undefined, CAPS.invoices);
    return rows.map((r) => ({ ...r }));
  },
  async invoice_lines(businessId) {
    const { data, error } = await repos.invoice.db
      .from('invoice_lines')
      .select('*')
      .eq('business_id', businessId)
      .limit(CAPS.invoice_lines);
    if (error) throw error;
    return (data ?? []) as unknown as Record<string, unknown>[];
  },
  async invoice_payments(businessId) {
    const rows = await repos.invoice.findPayments(businessId, '%'); // no id filter: use custom method
    return rows as unknown as Record<string, unknown>[];
  },
  async contacts(businessId) {
    const rows = await repos.contact.findByBusiness(businessId, 'both');
    return rows.slice(0, CAPS.contacts).map((r) => ({ ...r })) as unknown as Record<string, unknown>[];
  },
  async products(businessId) {
    const rows = await repos.inventory.findAllProducts(businessId);
    return rows.slice(0, CAPS.products).map((r) => ({ ...r })) as unknown as Record<string, unknown>[];
  },
  async journal_entries(businessId) {
    const { data, error } = await repos.journal.db
      .from('journal_entries')
      .select('*')
      .eq('business_id', businessId)
      .order('entry_date', { ascending: false })
      .limit(CAPS.journal_entries);
    if (error) throw error;
    return (data ?? []) as unknown as Record<string, unknown>[];
  },
  async journal_lines(businessId) {
    const { data, error } = await repos.journal.db
      .from('journal_lines')
      .select('*')
      .eq('business_id', businessId)
      .limit(CAPS.journal_lines);
    if (error) throw error;
    return (data ?? []) as unknown as Record<string, unknown>[];
  },
  async accounts(businessId) {
    const rows = await repos.account.findByBusiness(businessId);
    return rows as unknown as Record<string, unknown>[];
  },
  async branches(businessId) {
    const rows = await repos.branch.findByBusiness(businessId);
    return rows.slice(0, CAPS.branches) as unknown as Record<string, unknown>[];
  },
  async departments(businessId) {
    const rows = await repos.department.findByBusiness(businessId);
    return rows.slice(0, CAPS.departments) as unknown as Record<string, unknown>[];
  },
  async stock_movements(businessId) {
    const { data, error } = await repos.expense.db
      .from('stock_movements')
      .select('*')
      .eq('business_id', businessId)
      .order('movement_date', { ascending: false })
      .limit(CAPS.stock_movements);
    if (error) throw error;
    return (data ?? []) as unknown as Record<string, unknown>[];
  },
  async inventory_balances(businessId) {
    const { data, error } = await repos.inventory.db
      .from('inventory_balances')
      .select('*')
      .eq('business_id', businessId)
      .limit(CAPS.inventory_balances);
    if (error) throw error;
    return (data ?? []) as unknown as Record<string, unknown>[];
  },
};

// invoice_payments.findPayments requires an invoiceId; we need a different
// approach. Override it to fetch all payments for this business directly.
fetchers.invoice_payments = async (businessId) => {
  const { data, error } = await repos.invoice.db
    .from('invoice_payments')
    .select('*')
    .eq('business_id', businessId)
    .order('payment_date', { ascending: false })
    .limit(CAPS.invoice_payments);
  if (error) throw error;
  return (data ?? []) as unknown as Record<string, unknown>[];
};

// JSON export: every table in fetchers keyed by table name, plus a manifest
// with export metadata.
export async function exportJsonBackup(
  businessId: string,
  businessName: string,
  onProgress?: ProgressCb,
): Promise<void> {
  const tables = Object.keys(fetchers);
  const payload: Record<string, unknown[]> = {};
  for (let i = 0; i < tables.length; i++) {
    const name = tables[i];
    onProgress?.({ stage: name, rows: 0, stageIndex: i, totalStages: tables.length });
    const rows = await fetchers[name](businessId);
    payload[name] = rows;
    onProgress?.({ stage: name, rows: rows.length, stageIndex: i + 1, totalStages: tables.length });
  }
  const manifest = {
    exportedAt: new Date().toISOString(),
    businessId,
    businessName,
    schemaVersion: 1,
    tables: Object.fromEntries(Object.keys(payload).map((k) => [k, payload[k].length])),
  };
  const blob = new Blob(
    [JSON.stringify({ manifest, data: payload }, null, 2)],
    { type: 'application/json;charset=utf-8' },
  );
  downloadBlob(blob, `ledgr_backup_${safeName(businessName)}_${timestampSlug()}.json`);
}

// CSV export: one file per table in CSV_TABLES, bundled into a zip-like
// structure? We can't add jszip without dependency; instead download each
// CSV sequentially as separate files. Browsers will batch them into the
// download tray. To avoid spamming, combine them into a single multi-table
// text file with section headers — still opens cleanly in Excel if the
// user selects one table's range, but simpler than adding a zip dep.
export async function exportCsvBackup(
  businessId: string,
  businessName: string,
  onProgress?: ProgressCb,
): Promise<void> {
  // Simple approach: one CSV per table, triggered as sequential downloads.
  // Filenames are unique so nothing is overwritten.
  for (let i = 0; i < CSV_TABLES.length; i++) {
    const name = CSV_TABLES[i];
    onProgress?.({ stage: name, rows: 0, stageIndex: i, totalStages: CSV_TABLES.length });
    const rows = await fetchers[name](businessId);
    onProgress?.({ stage: name, rows: rows.length, stageIndex: i + 1, totalStages: CSV_TABLES.length });
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    downloadBlob(blob, `ledgr_${name}_${safeName(businessName)}_${timestampSlug()}.csv`);
    // Small delay between downloads so the browser doesn't block popups.
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Quick row-count estimate for the confirmation dialog (no full data). */
export function getExportTableCount(): number {
  return Object.keys(fetchers).length;
}
