/**
 * Seeded demo books — the data behind the client-side demo account.
 *
 * `buildDemoDataset()` returns a table → rows map shaped like the Postgres
 * schema in `supabase/migrations/20250101000000_base_schema.sql`, so the app's
 * repositories, hooks and pages read it exactly as they read Supabase. Nothing
 * here is ever sent anywhere: it lives in the visitor's browser (see
 * `store.ts`).
 *
 * Design rules for this file:
 *   1. **Everything is derived from `now`** so the demo never looks stale —
 *      six months of trading history ending in the current month.
 *   2. **Every journal entry balances** (debits === credits). The trial
 *      balance, SOFP and integrity checks all assume double entry.
 *   3. **Opening balances balance** too: assets = liabilities + equity before
 *      a single transaction is posted, so the statement of financial position
 *      reconciles on day one of the demo.
 *   4. **Reuse the real reference data** — the chart of accounts comes from
 *      `seedChartOfAccounts.ts` and PAYE from `lib/paye.ts`, so demo figures
 *      match what a live Malawian tenant would see.
 */

import { getCoaTemplate } from '@/services/seedChartOfAccounts';
import { calculatePAYE, FALLBACK_PAYE_BANDS } from '@/lib/paye';
import { VAT_STANDARD_RATE } from '@/lib/vat';
import { DEMO_BUSINESS_NAME } from '@/lib/demoData';
import {
  DEMO_BUSINESS_ID,
  DEMO_EMAIL,
  DEMO_MEMBERSHIP_ID,
  DEMO_PLAN_TIER,
  DEMO_ROLE,
  DEMO_USER_ID,
  DEMO_USER_NAME,
  demoUuid,
} from './constants';

export type DemoRow = Record<string, unknown>;
export type DemoTables = Record<string, DemoRow[]>;

// ── Small helpers ────────────────────────────────────────────────────────────

/** Local-time YYYY-MM-DD (never toISOString — that shifts a day in UTC+2). */
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function toTs(d: Date): string {
  return d.toISOString();
}

/** MWK has no cents in practice; round to 2dp so sums never drift. */
function money(n: number): number {
  return Math.round(n * 100) / 100;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
}

function lastDayOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

/** A date `day` of the month `offset` months before `anchor`, clamped to anchor. */
function monthDay(anchor: Date, offset: number, day: number): Date {
  const base = addMonths(anchor, -offset);
  const d = new Date(base.getFullYear(), base.getMonth(), day);
  return d > anchor ? new Date(anchor) : d;
}

// ── Builders ─────────────────────────────────────────────────────────────────

class DatasetBuilder {
  readonly tables: DemoTables = {};
  readonly anchor: Date;
  /** code → id, shared with the seed helpers that resolve accounts by code. */
  readonly accountIds = new Map<string, string>();
  private journalSeq = 0;

  constructor(anchor: Date) {
    this.anchor = anchor;
  }

  rows(table: string): DemoRow[] {
    return (this.tables[table] ??= []);
  }

  add(table: string, row: DemoRow): DemoRow {
    this.rows(table).push(row);
    return row;
  }

  /** id of a chart-of-accounts row by its code. */
  acct(code: string): string {
    const id = this.accountIds.get(code);
    if (!id) throw new Error(`[demo] chart of accounts has no code ${code}`);
    return id;
  }

  /**
   * Append a balanced journal entry and its lines. Amounts are natural-side
   * positives; `is_debit` carries the direction. Throws if unbalanced so a
   * seeding mistake can never ship as a broken demo ledger.
   */
  journal(input: {
    entryDate: Date;
    description: string;
    sourceType: string;
    sourceId?: string | null;
    reference?: string | null;
    lines: { accountCode: string; debit?: number; credit?: number; description?: string }[];
  }): DemoRow {
    const debits = input.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const credits = input.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    if (Math.abs(debits - credits) > 0.01) {
      throw new Error(
        `[demo] unbalanced journal "${input.description}": debits ${debits} vs credits ${credits}`,
      );
    }

    this.journalSeq += 1;
    const id = demoUuid('journal', this.journalSeq);
    const entry = this.add('journal_entries', {
      id,
      business_id: DEMO_BUSINESS_ID,
      entry_number: `JE-${String(this.journalSeq).padStart(4, '0')}`,
      entry_date: toDateStr(input.entryDate),
      description: input.description,
      reference: input.reference ?? null,
      status: 'posted',
      source_type: input.sourceType,
      source_id: input.sourceId ?? null,
      currency: 'MWK',
      exchange_rate: 1,
      period_id: null,
      posted_at: toTs(input.entryDate),
      posted_by: DEMO_EMAIL,
      created_by: DEMO_EMAIL,
      created_at: toTs(input.entryDate),
    });

    input.lines.forEach((line, i) => {
      const amount = money(line.debit ?? line.credit ?? 0);
      if (amount === 0) return;
      this.add('journal_lines', {
        id: demoUuid('journal_line', `${this.journalSeq}:${i}`),
        business_id: DEMO_BUSINESS_ID,
        journal_entry_id: id,
        account_id: this.acct(line.accountCode),
        line_number: i + 1,
        description: line.description ?? input.description,
        is_debit: (line.debit ?? 0) > 0,
        amount,
        amount_base: amount,
        currency: 'MWK',
        exchange_rate: 1,
        original_amount: null,
        original_currency: null,
        rate_date: null,
        rate_is_stale: false,
        tax_amount: 0,
        tax_code: null,
        reconciled: false,
        reconciled_at: null,
        branch_id: null,
        department_id: null,
        created_at: toTs(input.entryDate),
      });
    });

    return entry;
  }
}

// ── Seed specs ───────────────────────────────────────────────────────────────

interface CustomerSpec {
  name: string;
  city: string;
  phone: string;
  email: string;
  termsDays: number;
}

const CUSTOMERS: CustomerSpec[] = [
  { name: 'Bvumbwe Traders', city: 'Lilongwe', phone: '+265 991 234 567', email: 'orders@bvumbwe.example', termsDays: 30 },
  { name: 'Mzuzu Agro Ltd', city: 'Mzuzu', phone: '+265 888 445 120', email: 'accounts@mzuzuagro.example', termsDays: 14 },
  { name: 'Lilongwe Bookshop', city: 'Lilongwe', phone: '+265 999 700 214', email: 'buy@lilbookshop.example', termsDays: 30 },
  { name: 'Blantyre Fresh Co', city: 'Blantyre', phone: '+265 884 313 908', email: 'sales@byfresh.example', termsDays: 7 },
  { name: 'Karonga Millers', city: 'Karonga', phone: '+265 996 118 442', email: 'info@karongamillers.example', termsDays: 21 },
  { name: 'Zomba Hardware Supplies', city: 'Zomba', phone: '+265 882 660 175', email: 'purchasing@zombahard.example', termsDays: 30 },
];

const SUPPLIERS = [
  { name: 'Lilongwe Wholesale Foods', city: 'Lilongwe', phone: '+265 995 220 118', email: 'sales@lilwholesale.example' },
  { name: 'Central Motors & Spares', city: 'Lilongwe', phone: '+265 888 904 331', email: 'parts@centralmotors.example' },
  { name: 'Nyasaland Logistics', city: 'Blantyre', phone: '+265 991 662 780', email: 'dispatch@nyasalog.example' },
  { name: 'Malawi Office Supplies', city: 'Lilongwe', phone: '+265 884 118 902', email: 'orders@mwoffice.example' },
];

interface ProductSpec {
  name: string;
  sku: string;
  type: 'goods' | 'service';
  purchase: number;
  sale: number;
  uom: string;
  onHand: number;
  reorderLevel: number | null;
  taxCode: 'vat_standard' | 'vat_zero';
}

/**
 * Catalogue. Purchase prices are what the wholesaler charges; sale prices are
 * counter/trade retail in Lilongwe. Margins sit at 26-29% on goods — thin by
 * software-demo standards, normal for staples — with delivery as a pure-margin
 * service. Maize flour is zero-rated for VAT, the rest standard-rated.
 */
const PRODUCTS: ProductSpec[] = [
  { name: 'Maize Flour 25kg', sku: 'MF-25', type: 'goods', purchase: 28_500, sale: 38_900, uom: 'bag', onHand: 142, reorderLevel: 40, taxCode: 'vat_zero' },
  { name: 'Cooking Oil 5L', sku: 'CO-5L', type: 'goods', purchase: 12_800, sale: 17_400, uom: 'bottle', onHand: 96, reorderLevel: 30, taxCode: 'vat_standard' },
  { name: 'Sugar 10kg', sku: 'SG-10', type: 'goods', purchase: 14_200, sale: 19_300, uom: 'bale', onHand: 18, reorderLevel: 25, taxCode: 'vat_standard' },
  { name: 'Rice 10kg', sku: 'RC-10', type: 'goods', purchase: 16_500, sale: 22_400, uom: 'bag', onHand: 64, reorderLevel: 20, taxCode: 'vat_standard' },
  { name: 'Bath Soap (pack of 6)', sku: 'SP-6', type: 'goods', purchase: 4_900, sale: 6_900, uom: 'pack', onHand: 210, reorderLevel: 60, taxCode: 'vat_standard' },
  { name: 'In-town Delivery', sku: 'SVC-DEL', type: 'service', purchase: 0, sale: 7_500, uom: 'trip', onHand: 0, reorderLevel: null, taxCode: 'vat_standard' },
];

/**
 * Scales every seeded invoice quantity.
 *
 * Staple grocery margins are thin by nature (16-18% on maize flour, oil and
 * sugar), so profitability for a trader like this comes from throughput, not
 * from price. The hand-written specs below describe a *quiet* six months; at
 * that volume the fixed cost base (three salaries, pension, rent, the van)
 * swallows the whole gross margin and the demo would show a loss-making
 * business on the dashboard and in the year-to-date P&L. This multiplier puts
 * the demo where a healthy Lilongwe wholesaler actually sits: ~30% gross
 * margin, ~9% net margin, profitable in every month of the trend chart.
 *
 * COGS is derived from the same scaled quantities, so the ledger stays
 * internally consistent — gross profit, VAT, stock issues and the trial
 * balance all move together.
 */
const SALES_VOLUME = 2.6;

interface InvoiceSpec {
  /** months before the current one */
  monthOffset: number;
  day: number;
  customer: number;
  items: [product: number, qty: number][];
  payment: 'full' | 'half' | 'none';
  /** override the derived status (e.g. a draft in the current month) */
  status?: 'draft' | 'sent' | 'paid' | 'partially_paid' | 'overdue' | 'void';
}

const INVOICES: InvoiceSpec[] = [
  { monthOffset: 5, day: 4, customer: 0, items: [[0, 40], [1, 24]], payment: 'full' },
  { monthOffset: 5, day: 14, customer: 1, items: [[3, 30], [2, 20]], payment: 'full' },
  { monthOffset: 5, day: 23, customer: 2, items: [[4, 30], [5, 4]], payment: 'full' },

  { monthOffset: 4, day: 5, customer: 3, items: [[0, 60], [1, 18]], payment: 'full' },
  { monthOffset: 4, day: 16, customer: 4, items: [[2, 35], [3, 25]], payment: 'full' },
  { monthOffset: 4, day: 26, customer: 5, items: [[0, 25], [4, 40], [5, 2]], payment: 'full' },

  { monthOffset: 3, day: 6, customer: 1, items: [[3, 40], [1, 30]], payment: 'full' },
  { monthOffset: 3, day: 18, customer: 0, items: [[0, 80], [2, 15]], payment: 'none' },
  { monthOffset: 3, day: 27, customer: 2, items: [[4, 50], [5, 6]], payment: 'full' },

  { monthOffset: 2, day: 7, customer: 4, items: [[0, 35], [3, 20]], payment: 'full' },
  { monthOffset: 2, day: 19, customer: 3, items: [[1, 40], [2, 25]], payment: 'full' },
  { monthOffset: 2, day: 28, customer: 5, items: [[4, 60], [5, 3]], payment: 'full' },

  { monthOffset: 1, day: 8, customer: 0, items: [[0, 55], [1, 20]], payment: 'full' },
  { monthOffset: 1, day: 17, customer: 2, items: [[3, 35], [2, 30]], payment: 'half' },
  { monthOffset: 1, day: 25, customer: 1, items: [[4, 45], [5, 5]], payment: 'full' },

  { monthOffset: 0, day: 3, customer: 3, items: [[0, 45], [1, 25]], payment: 'half' },
  { monthOffset: 0, day: 9, customer: 4, items: [[2, 40], [3, 30]], payment: 'none' },
  { monthOffset: 0, day: 12, customer: 5, items: [[4, 35], [5, 4]], payment: 'none', status: 'draft' },
];

interface ExpenseSpec {
  monthOffset: number;
  day: number;
  accountCode: string;
  description: string;
  net: number;
  hasVat: boolean;
  supplier?: number;
  type: 'receipt' | 'bill';
  paid: boolean;
  method: 'cash' | 'bank_transfer' | 'airtel_money' | 'cheque';
}

const EXPENSES: ExpenseSpec[] = [
  { monthOffset: 5, day: 2, accountCode: '6201', description: 'Shop rent — Area 3', net: 350_000, hasVat: false, type: 'receipt', paid: true, method: 'bank_transfer' },
  { monthOffset: 5, day: 9, accountCode: '6202', description: 'ESCOM electricity', net: 78_400, hasVat: true, type: 'receipt', paid: true, method: 'airtel_money' },
  { monthOffset: 5, day: 15, accountCode: '6401', description: 'Fuel — delivery van', net: 132_000, hasVat: true, type: 'receipt', paid: true, method: 'cash' },
  { monthOffset: 5, day: 21, accountCode: '6301', description: 'Stationery and receipt books', net: 24_800, hasVat: true, supplier: 3, type: 'bill', paid: true, method: 'cash' },

  { monthOffset: 4, day: 2, accountCode: '6201', description: 'Shop rent — Area 3', net: 350_000, hasVat: false, type: 'receipt', paid: true, method: 'bank_transfer' },
  { monthOffset: 4, day: 11, accountCode: '6203', description: 'Internet — Access Communications', net: 38_500, hasVat: true, type: 'receipt', paid: true, method: 'airtel_money' },
  { monthOffset: 4, day: 18, accountCode: '6402', description: 'Van service and tyres', net: 285_000, hasVat: true, supplier: 1, type: 'bill', paid: true, method: 'bank_transfer' },
  { monthOffset: 4, day: 24, accountCode: '7200', description: 'Bank charges', net: 12_500, hasVat: false, type: 'receipt', paid: true, method: 'bank_transfer' },

  { monthOffset: 3, day: 2, accountCode: '6201', description: 'Shop rent — Area 3', net: 350_000, hasVat: false, type: 'receipt', paid: true, method: 'bank_transfer' },
  { monthOffset: 3, day: 8, accountCode: '6202', description: 'ESCOM electricity', net: 84_100, hasVat: true, type: 'receipt', paid: true, method: 'airtel_money' },
  { monthOffset: 3, day: 16, accountCode: '6501', description: 'Radio advertising — MBC', net: 75_000, hasVat: true, type: 'bill', paid: true, method: 'bank_transfer' },
  { monthOffset: 3, day: 22, accountCode: '6303', description: 'Security services', net: 95_000, hasVat: true, supplier: 2, type: 'bill', paid: false, method: 'bank_transfer' },

  { monthOffset: 2, day: 2, accountCode: '6201', description: 'Shop rent — Area 3', net: 350_000, hasVat: false, type: 'receipt', paid: true, method: 'bank_transfer' },
  { monthOffset: 2, day: 10, accountCode: '6401', description: 'Fuel — delivery van', net: 148_500, hasVat: true, type: 'receipt', paid: true, method: 'cash' },
  { monthOffset: 2, day: 19, accountCode: '6901', description: 'Staff training — customer care', net: 62_000, hasVat: true, type: 'bill', paid: true, method: 'bank_transfer' },
  { monthOffset: 2, day: 26, accountCode: '6203', description: 'Internet — Access Communications', net: 38_500, hasVat: true, type: 'receipt', paid: true, method: 'airtel_money' },

  { monthOffset: 1, day: 2, accountCode: '6201', description: 'Shop rent — Area 3', net: 350_000, hasVat: false, type: 'receipt', paid: true, method: 'bank_transfer' },
  { monthOffset: 1, day: 7, accountCode: '6202', description: 'ESCOM electricity', net: 81_300, hasVat: true, type: 'receipt', paid: true, method: 'airtel_money' },
  { monthOffset: 1, day: 14, accountCode: '6404', description: 'Staff transport allowance', net: 60_000, hasVat: false, type: 'receipt', paid: true, method: 'cash' },
  { monthOffset: 1, day: 20, accountCode: '6601', description: 'Accounting & audit fees', net: 180_000, hasVat: true, supplier: 3, type: 'bill', paid: false, method: 'bank_transfer' },
  { monthOffset: 1, day: 27, accountCode: '7200', description: 'Bank charges', net: 13_200, hasVat: false, type: 'receipt', paid: true, method: 'bank_transfer' },

  { monthOffset: 0, day: 2, accountCode: '6201', description: 'Shop rent — Area 3', net: 350_000, hasVat: false, type: 'receipt', paid: true, method: 'bank_transfer' },
  { monthOffset: 0, day: 6, accountCode: '6401', description: 'Fuel — delivery van', net: 96_000, hasVat: true, type: 'receipt', paid: true, method: 'cash' },
  { monthOffset: 0, day: 10, accountCode: '6904', description: 'Sundry — cleaning supplies', net: 18_400, hasVat: true, type: 'receipt', paid: true, method: 'cash' },
];

interface EmployeeSpec {
  first: string;
  last: string;
  title: string;
  gross: number;
  start: string;
  phone: string;
  bank: string;
}

const EMPLOYEES: EmployeeSpec[] = [
  { first: 'Chikondi', last: 'Banda', title: 'Sales Manager', gross: 520_000, start: '2022-03-01', phone: '+265 991 445 220', bank: '44710023' },
  { first: 'Madalitso', last: 'Phiri', title: 'Accountant', gross: 420_000, start: '2023-07-15', phone: '+265 888 214 903', bank: '44718890' },
  { first: 'Thoko', last: 'Mbewe', title: 'Shop Assistant', gross: 240_000, start: '2024-01-08', phone: '+265 996 780 114', bank: '44723301' },
];

/** Pension: 5% employee, 10% employer (TPR-style). */
const PENSION_EMPLOYEE_RATE = 0.05;
const PENSION_EMPLOYER_RATE = 0.1;

// ── Main builder ─────────────────────────────────────────────────────────────

export function buildDemoDataset(now: Date = new Date()): DemoTables {
  const b = new DatasetBuilder(now);
  const anchor = now;

  seedIdentity(b, anchor);
  seedOrganisation(b, anchor);
  seedAccounts(b, anchor);
  const contactIds = seedContacts(b, anchor);
  const productIds = seedProducts(b, anchor);
  seedInventory(b, anchor, productIds);
  seedFixedAssets(b, anchor);
  seedTax(b, anchor);
  seedPeriods(b, anchor);
  const invoiceTotals = seedInvoices(b, anchor, contactIds, productIds);
  seedExpenses(b, anchor, contactIds, invoiceTotals.byMonth);
  seedPayroll(b, anchor);
  seedCogs(b, anchor, invoiceTotals);
  seedDepreciation(b, anchor);
  seedFx(b, anchor);
  seedAuditLog(b, anchor);
  seedTaxReturns(b, anchor);
  seedCashSweep(b, anchor);

  return b.tables;
}

// ── Identity / tenancy ───────────────────────────────────────────────────────

function seedIdentity(b: DatasetBuilder, anchor: Date): void {
  b.add('user_profiles', {
    id: DEMO_USER_ID,
    full_name: DEMO_USER_NAME,
    avatar_url: null,
    phone: '+265 991 000 000',
    is_platform_admin: false,
    preferred_language: 'en',
    preferred_currency: 'MWK',
    deletion_requested_at: null,
    deletion_finalized_at: null,
    created_at: toTs(addMonths(anchor, -12)),
    updated_at: toTs(anchor),
  });

  b.add('businesses', {
    id: DEMO_BUSINESS_ID,
    name: DEMO_BUSINESS_NAME,
    trading_name: 'Lilongwe Trading',
    registration_number: 'C1234567',
    tpin: '200123456',
    vat_number: '200123456V',
    vat_registered: true,
    vat_period: 'monthly',
    email: 'accounts@lilongwetrading.example',
    phone: '+265 991 500 700',
    website: 'https://lilongwetrading.example',
    address_line1: 'Plot 44, Ali Mwenya Road',
    address_line2: 'Area 3',
    city: 'Lilongwe',
    country: 'MW',
    timezone: 'Africa/Blantyre',
    base_currency: 'MWK',
    financial_year_start: '01-01',
    coa_template: 'gaap',
    invoice_prefix: 'INV',
    invoice_next_number: 19,
    expense_prefix: 'EXP',
    expense_next_number: 25,
    payroll_prefix: 'PAY',
    payroll_next_number: 3,
    plan_tier: DEMO_PLAN_TIER,
    plan_expires_at: toTs(addMonths(anchor, 12)),
    plan_updated_at: toTs(addMonths(anchor, -1)),
    brand_color: '#0E7C5A',
    logo_url: null,
    default_payment_method: 'bank_transfer',
    is_active: true,
    deleted_at: null,
    created_at: toTs(addMonths(anchor, -18)),
    updated_at: toTs(anchor),
  });

  b.add('business_users', {
    id: DEMO_MEMBERSHIP_ID,
    business_id: DEMO_BUSINESS_ID,
    user_id: DEMO_USER_ID,
    role: DEMO_ROLE,
    is_active: true,
    accepted_at: toTs(addMonths(anchor, -18)),
    invited_at: null,
    invited_by: null,
    invitation_token: null,
    invitation_expires_at: null,
    branch_id: null,
    created_at: toTs(addMonths(anchor, -18)),
    updated_at: toTs(anchor),
  });

  // Terms acceptance keeps the onboarding checklist from blocking the tour.
  b.add('business_terms_acceptances', {
    id: demoUuid('terms', 1),
    business_id: DEMO_BUSINESS_ID,
    user_id: DEMO_USER_ID,
    accepted_at: toTs(addMonths(anchor, -18)),
    version: '1.0',
    ip_address: '127.0.0.1',
  });
}

// ── Branches & departments ───────────────────────────────────────────────────

function seedOrganisation(b: DatasetBuilder, anchor: Date): void {
  const branches = [
    { key: 'lgw', name: 'Lilongwe — Head Office', code: 'LGW', location: 'Area 3, Lilongwe' },
    { key: 'bt', name: 'Blantyre Branch', code: 'BT', location: 'Chichiri, Blantyre' },
  ];
  branches.forEach((br) => {
    b.add('branches', {
      id: demoUuid('branch', br.key),
      business_id: DEMO_BUSINESS_ID,
      name: br.name,
      code: br.code,
      location: br.location,
      manager_id: br.key === 'lgw' ? DEMO_USER_NAME : 'Chikondi Banda',
      is_active: true,
      deleted_at: null,
      created_at: toTs(addMonths(anchor, -18)),
      updated_at: toTs(anchor),
    });
  });

  const departments = [
    { key: 'sales', name: 'Sales & Distribution', code: 'SLS', cost: 'CC-100', branch: 'lgw' },
    { key: 'ops', name: 'Operations', code: 'OPS', cost: 'CC-200', branch: 'lgw' },
    { key: 'admin', name: 'Finance & Admin', code: 'ADM', cost: 'CC-300', branch: 'lgw' },
  ];
  departments.forEach((d) => {
    b.add('departments', {
      id: demoUuid('department', d.key),
      business_id: DEMO_BUSINESS_ID,
      branch_id: demoUuid('branch', d.branch),
      name: d.name,
      code: d.code,
      cost_centre: d.cost,
      head_user_id: null,
      is_active: true,
      deleted_at: null,
      created_at: toTs(addMonths(anchor, -18)),
      updated_at: toTs(anchor),
    });
  });
}

// ── Chart of accounts ────────────────────────────────────────────────────────

/**
 * Opening balances (natural-side positive) as at the day before the demo's
 * six-month window. Assets 17,020,000 = liabilities 1,500,000 + equity
 * 15,520,000, so the very first statement of financial position balances.
 */
/**
 * Opening position as at the ledger cut-over (the day before the demo's
 * six-month trading window).
 *
 * The two fixed assets are deliberately NOT carried as opening balances: they
 * are capitalised by a `fixed_asset_acquisition` journal dated at their
 * acquisition (see seedFixedAssets). Carrying them both ways would double
 * count them in the Statement of Financial Position — getSOFP adds any
 * register asset that has no posted capitalisation journal to Non-Current
 * Assets on top of the GL balances, so the GL side must come from the journal.
 * The bank opening balance absorbs the same 14,900,000 so the opening
 * position still balances (assets = liabilities + equity).
 */
const OPENING_BALANCES: Record<string, number> = {
  '1110': 250_000, // Cash on Hand
  '1121': 24_750_000, // National Bank (9,850,000 working capital + 14,900,000 that funded the assets)
  '1125': 420_000, // Airtel Money
  '1141': 3_200_000, // Trading Stock
  '1522': 3_000_000, // Accum. Depr. — Motor Vehicles (credit normal)
  '1524': 600_000, // Accum. Depr. — Furniture & Fittings (credit normal)
  '2140': 1_500_000, // Short-term Loans
  '3100': 10_000_000, // Share Capital
  '3120': 13_520_000, // Retained Earnings (profits of the years before the ledger cut-over)
};

function seedAccounts(b: DatasetBuilder, anchor: Date): void {
  const openingDate = toDateStr(addDays(addMonths(anchor, -6), -1));
  for (const seed of getCoaTemplate('gaap')) {
    const id = demoUuid('account', seed.code);
    b.accountIds.set(seed.code, id);
    b.add('accounts', {
      id,
      business_id: DEMO_BUSINESS_ID,
      code: seed.code,
      name: seed.name,
      description: seed.description ?? null,
      account_type: seed.account_type,
      account_subtype: seed.account_subtype ?? null,
      normal_balance: seed.normal_balance,
      is_group: seed.is_group,
      is_system: seed.is_system,
      is_bank_account: seed.is_bank_account,
      tax_code: seed.tax_code ?? 'none',
      currency: 'MWK',
      opening_balance: OPENING_BALANCES[seed.code] ?? 0,
      opening_balance_date: OPENING_BALANCES[seed.code] ? openingDate : null,
      parent_id: seed.parent_code ? (demoUuid('account', seed.parent_code) ?? null) : null,
      branch_id: null,
      department_id: null,
      bank_name: seed.is_bank_account ? 'National Bank of Malawi' : null,
      bank_branch: seed.is_bank_account ? 'Lilongwe City Centre' : null,
      bank_account_number: seed.code === '1121' ? '1000445566' : null,
      mobile_money_type: seed.code === '1125' ? 'airtel_money' : seed.code === '1126' ? 'tnm_mpamba' : null,
      mobile_money_number: seed.code === '1125' ? '+265 991 500 700' : null,
      notes: null,
      is_active: true,
      deleted_at: null,
      created_at: toTs(addMonths(anchor, -18)),
      updated_at: toTs(anchor),
    });
  }
}

// ── Contacts ─────────────────────────────────────────────────────────────────

function seedContacts(b: DatasetBuilder, anchor: Date): string[] {
  const ids: string[] = [];

  CUSTOMERS.forEach((c, i) => {
    const id = demoUuid('contact', `cust-${i}`);
    ids.push(id);
    b.add('contacts', {
      id,
      business_id: DEMO_BUSINESS_ID,
      name: c.name,
      trading_name: c.name,
      contact_type: 'customer',
      email: c.email,
      phone: c.phone,
      mobile_money_number: c.phone,
      mobile_money_type: 'airtel_money',
      address_line1: `Plot ${10 + i * 7}, ${c.city} CBD`,
      address_line2: null,
      city: c.city,
      country: 'MW',
      tpin: null,
      vat_number: null,
      wht_exempt: false,
      wht_exemption_ref: null,
      credit_limit: c.termsDays * 90_000,
      credit_terms_days: c.termsDays,
      currency: 'MWK',
      ar_account_id: b.acct('1131'),
      ap_account_id: null,
      notes: null,
      is_active: true,
      deleted_at: null,
      created_at: toTs(addMonths(anchor, -16 + i)),
      updated_at: toTs(anchor),
    });
  });

  SUPPLIERS.forEach((s, i) => {
    const id = demoUuid('contact', `sup-${i}`);
    ids.push(id);
    b.add('contacts', {
      id,
      business_id: DEMO_BUSINESS_ID,
      name: s.name,
      trading_name: s.name,
      contact_type: 'supplier',
      email: s.email,
      phone: s.phone,
      mobile_money_number: null,
      mobile_money_type: null,
      address_line1: `${s.city} Industrial Area`,
      address_line2: null,
      city: s.city,
      country: 'MW',
      tpin: `2009${String(1000 + i * 37)}`,
      vat_number: `2009${String(1000 + i * 37)}V`,
      wht_exempt: false,
      wht_exemption_ref: null,
      credit_limit: null,
      credit_terms_days: 14,
      currency: 'MWK',
      ar_account_id: null,
      ap_account_id: b.acct('2111'),
      notes: null,
      is_active: true,
      deleted_at: null,
      created_at: toTs(addMonths(anchor, -15 + i)),
      updated_at: toTs(anchor),
    });
  });

  return ids;
}

/** Contact ids in the order seeded: 6 customers then 4 suppliers. */
export function demoContactId(kind: 'customer' | 'supplier', index: number): string {
  return demoUuid('contact', `${kind === 'customer' ? 'cust' : 'sup'}-${index}`);
}

/** Product ids in PRODUCTS order. */
export function demoProductId(index: number): string {
  return demoUuid('product', index);
}

// ── Products & inventory ─────────────────────────────────────────────────────

function seedProducts(b: DatasetBuilder, anchor: Date): string[] {
  const ids: string[] = [];
  PRODUCTS.forEach((p, i) => {
    const id = demoUuid('product', i);
    ids.push(id);
    b.add('products', {
      id,
      business_id: DEMO_BUSINESS_ID,
      name: p.name,
      sku: p.sku,
      barcode: p.type === 'goods' ? `600${String(1000 + i * 137)}` : null,
      description: `${p.name} — ${p.uom}`,
      product_type: p.type,
      unit_of_measure: p.uom,
      currency: 'MWK',
      purchase_price: p.purchase,
      sale_price: p.sale,
      purchase_tax_code: p.type === 'goods' ? 'vat_standard' : 'none',
      sales_tax_code: p.taxCode,
      track_inventory: p.type === 'goods',
      reorder_level: p.reorderLevel,
      reorder_quantity: p.reorderLevel ? p.reorderLevel * 2 : null,
      category_id: null,
      image_url: null,
      sales_account_id: p.type === 'goods' ? b.acct('4110') : b.acct('4112'),
      cogs_account_id: p.type === 'goods' ? b.acct('5100') : null,
      inventory_account_id: p.type === 'goods' ? b.acct('1141') : null,
      purchase_account_id: p.type === 'goods' ? b.acct('5100') : null,
      is_active: true,
      deleted_at: null,
      created_at: toTs(addMonths(anchor, -14)),
      updated_at: toTs(anchor),
    });
  });
  return ids;
}

function seedInventory(b: DatasetBuilder, anchor: Date, productIds: string[]): void {
  const locationId = demoUuid('location', 'main');
  b.add('inventory_locations', {
    id: locationId,
    business_id: DEMO_BUSINESS_ID,
    branch_id: demoUuid('branch', 'lgw'),
    name: 'Main Store — Area 3',
    code: 'MAIN',
    is_default: true,
    is_active: true,
    created_at: toTs(addMonths(anchor, -14)),
  });

  PRODUCTS.forEach((p, i) => {
    if (p.type !== 'goods') return;
    const productId = productIds[i];
    b.add('inventory_balances', {
      id: demoUuid('balance', i),
      business_id: DEMO_BUSINESS_ID,
      product_id: productId,
      location_id: locationId,
      quantity_on_hand: p.onHand,
      quantity_reserved: p.sku === 'RC-10' ? 6 : 0,
      quantity_available: p.onHand - (p.sku === 'RC-10' ? 6 : 0),
      average_cost: p.purchase,
      last_movement_at: toTs(monthDay(anchor, 0, 6)),
      updated_at: toTs(monthDay(anchor, 0, 6)),
    });

    // A purchase and a sale movement so the stock ledger is not empty.
    b.add('stock_movements', {
      id: demoUuid('movement', `in-${i}`),
      business_id: DEMO_BUSINESS_ID,
      product_id: productId,
      location_id: locationId,
      movement_type: 'purchase',
      movement_date: toDateStr(monthDay(anchor, 1, 5)),
      quantity: Math.round(p.onHand / 2),
      unit_cost: p.purchase,
      total_cost: money(p.purchase * Math.round(p.onHand / 2)),
      reference: `GRN-${String(i + 1).padStart(3, '0')}`,
      source_type: 'expense',
      source_id: null,
      notes: 'Opening purchase for demo',
      created_by: DEMO_EMAIL,
      created_at: toTs(monthDay(anchor, 1, 5)),
    });
    b.add('stock_movements', {
      id: demoUuid('movement', `out-${i}`),
      business_id: DEMO_BUSINESS_ID,
      product_id: productId,
      location_id: locationId,
      movement_type: 'sale',
      movement_date: toDateStr(monthDay(anchor, 0, 4)),
      quantity: -Math.round(p.onHand / 6),
      unit_cost: p.purchase,
      total_cost: money(-p.purchase * Math.round(p.onHand / 6)),
      reference: 'INV demo sale',
      source_type: 'invoice',
      source_id: null,
      notes: null,
      created_by: DEMO_EMAIL,
      created_at: toTs(monthDay(anchor, 0, 4)),
    });
  });
}

// ── Fixed assets ─────────────────────────────────────────────────────────────

const DEPRECIATION_MONTHS = 3;

function seedFixedAssets(b: DatasetBuilder, anchor: Date): void {
  const categories = [
    {
      key: 'vehicles',
      name: 'Motor Vehicles',
      method: 'straight_line',
      life: 5,
      residualPct: 10,
      mraRate: 20,
      asset: '1513',
      accum: '1522',
      dep: '6802',
    },
    {
      key: 'fittings',
      name: 'Furniture & Fittings',
      method: 'straight_line',
      life: 10,
      residualPct: 10,
      mraRate: 10,
      asset: '1515',
      accum: '1524',
      dep: '6804',
    },
    {
      key: 'computer',
      name: 'Computer Equipment',
      method: 'straight_line',
      life: 3,
      residualPct: 5,
      mraRate: 33,
      asset: '1516',
      accum: '1525',
      dep: '6805',
    },
  ];

  categories.forEach((c) => {
    b.add('asset_categories', {
      id: demoUuid('asset_category', c.key),
      business_id: DEMO_BUSINESS_ID,
      name: c.name,
      depreciation_method: c.method,
      useful_life_years: c.life,
      residual_percent: c.residualPct,
      mra_depreciation_rate: c.mraRate,
      is_depreciable: true,
      asset_account_id: b.acct(c.asset),
      accumulated_dep_account_id: b.acct(c.accum),
      dep_expense_account_id: b.acct(c.dep),
      is_active: true,
      created_at: toTs(addMonths(anchor, -18)),
    });
  });

  const assets = [
    {
      key: 'van',
      number: 'FA-0001',
      name: 'Toyota Hiace — Delivery Van',
      category: 'vehicles',
      cost: 12_500_000,
      residual: 1_250_000,
      lifeYears: 5,
      acquiredMonthsAgo: 24,
      openingAccum: 3_000_000,
      accountCode: '1513',
      accumCode: '1522',
      depCode: '6802',
      location: 'Lilongwe depot',
      reg: 'BA 4521 MW',
    },
    {
      key: 'fittings',
      number: 'FA-0002',
      name: 'Shop Fittings & Shelving',
      category: 'fittings',
      cost: 2_400_000,
      residual: 240_000,
      lifeYears: 10,
      acquiredMonthsAgo: 30,
      openingAccum: 600_000,
      accountCode: '1515',
      accumCode: '1524',
      depCode: '6804',
      location: 'Area 3 shop floor',
      reg: null,
    },
  ];

  assets.forEach((a) => {
    const monthly = money((a.cost - a.residual) / (a.lifeYears * 12));
    const posted = money(monthly * DEPRECIATION_MONTHS);
    const accum = money(a.openingAccum + posted);
    const acquisitionDate = addMonths(anchor, -a.acquiredMonthsAgo);
    const assetId = demoUuid('asset', a.key);

    // Capitalisation journal — the GL leg the asset register and the SOFP's
    // register fallback both look for (source_type + source_id + posted).
    const capitalisation = b.journal({
      entryDate: acquisitionDate,
      description: `Capitalisation of ${a.name} (${a.number})`,
      sourceType: 'fixed_asset_acquisition',
      sourceId: assetId,
      reference: a.number,
      lines: [
        { accountCode: a.accountCode, debit: a.cost, description: `${a.number} — cost` },
        { accountCode: '1121', credit: a.cost, description: `${a.number} — funded from National Bank` },
      ],
    });

    b.add('fixed_assets', {
      id: assetId,
      business_id: DEMO_BUSINESS_ID,
      asset_number: a.number,
      name: a.name,
      description: `${a.name}${a.reg ? ` (${a.reg})` : ''}`,
      category_id: demoUuid('asset_category', a.category),
      branch_id: demoUuid('branch', 'lgw'),
      department_id: demoUuid('department', 'ops'),
      supplier_id: demoUuid('contact', 'sup-1'),
      acquisition_date: toDateStr(acquisitionDate),
      acquisition_cost: a.cost,
      residual_value: a.residual,
      depreciable_amount: money(a.cost - a.residual),
      depreciation_method: 'straight_line',
      depreciation_rate: money(100 / a.lifeYears),
      useful_life_years: a.lifeYears,
      useful_life_months: a.lifeYears * 12,
      depreciation_start_date: toDateStr(acquisitionDate),
      last_depreciation_date: toDateStr(lastDayOfMonth(addMonths(anchor, -DEPRECIATION_MONTHS))),
      accumulated_depreciation: accum,
      net_book_value: money(a.cost - accum),
      status: 'active',
      is_depreciable: true,
      is_active: true,
      location: a.location,
      serial_number: a.reg,
      asset_account_id: b.acct(a.accountCode),
      accumulated_dep_account_id: b.acct(a.accumCode),
      dep_expense_account_id: b.acct(a.depCode),
      purchase_invoice_ref: null,
      purchase_journal_id: capitalisation.id,
      disposal_date: null,
      disposal_proceeds: null,
      disposal_journal_id: null,
      revaluation_date: null,
      revalued_amount: null,
      revaluation_surplus_account: null,
      insurance_policy_number: null,
      insurance_expiry_date: null,
      warranty_expiry_date: null,
      notes: null,
      image_url: null,
      deleted_at: null,
      created_by: DEMO_EMAIL,
      created_at: toTs(acquisitionDate),
      updated_at: toTs(anchor),
    });
  });
}

// ── Tax configuration, PAYE bands, periods ───────────────────────────────────

function seedTax(b: DatasetBuilder, anchor: Date): void {
  const configs: [string, string, number, string | null, string | null][] = [
    ['vat_standard', 'VAT — Standard Rate', VAT_STANDARD_RATE * 100, '2121', '1135'],
    ['vat_zero', 'VAT — Zero Rated', 0, null, null],
    ['vat_exempt', 'VAT — Exempt', 0, null, null],
    ['wht_10', 'Withholding Tax — Goods (10%)', 10, '2123', null],
    ['wht_15', 'Withholding Tax — Services (15%)', 15, '2123', null],
    ['wht_20', 'Withholding Tax — Rent (20%)', 20, '2123', null],
    ['cit', 'Corporate Income Tax', 30, '2124', null],
    ['paye', 'PAYE — Pay As You Earn', 0, '2122', null],
  ];

  configs.forEach(([code, name, rate, payable, receivable], i) => {
    b.add('tax_configurations', {
      id: demoUuid('tax_config', i),
      business_id: DEMO_BUSINESS_ID,
      tax_code: code,
      name,
      description: `${name} — MRA reference rates`,
      rate,
      employee_rate: null,
      employer_rate: null,
      mra_reference: code === 'vat_standard' ? 'VAT Act 2026' : null,
      tax_payable_account_id: payable ? b.acct(payable) : null,
      tax_receivable_account_id: receivable ? b.acct(receivable) : null,
      effective_from: toDateStr(new Date(anchor.getFullYear() - 1, 0, 1)),
      effective_to: null,
      is_active: true,
      created_at: toTs(addMonths(anchor, -18)),
      updated_at: toTs(anchor),
    });
  });

  FALLBACK_PAYE_BANDS.forEach((band, i) => {
    b.add('paye_bands', {
      id: demoUuid('paye_band', i),
      business_id: DEMO_BUSINESS_ID,
      fiscal_year: `${anchor.getFullYear()}/${anchor.getFullYear() + 1}`,
      band_label: `Band ${i + 1}`,
      band_from: band.band_from,
      band_to: band.band_to,
      rate: band.rate,
      effective_from: toDateStr(new Date(anchor.getFullYear(), 0, 1)),
      effective_to: null,
      created_at: toTs(addMonths(anchor, -12)),
    });
  });
}

function seedPeriods(b: DatasetBuilder, anchor: Date): void {
  for (let m = 0; m < 12; m += 1) {
    const start = new Date(anchor.getFullYear(), m, 1);
    const end = lastDayOfMonth(start);
    // Lock everything older than the demo's six-month trading window so the
    // period management screen has something real to show.
    const isClosed = start < addMonths(anchor, -6);
    b.add('accounting_periods', {
      id: demoUuid('period', `${start.getFullYear()}-${start.getMonth()}`),
      business_id: DEMO_BUSINESS_ID,
      name: start.toLocaleString('en', { month: 'long', year: 'numeric' }),
      period_start: toDateStr(start),
      period_end: toDateStr(end),
      is_closed: isClosed,
      closed_at: isClosed ? toTs(addDays(end, 3)) : null,
      closed_by: isClosed ? DEMO_EMAIL : null,
      created_at: toTs(new Date(anchor.getFullYear(), 0, 1)),
      updated_at: toTs(anchor),
    });
  }
}

// ── Sales ledger ─────────────────────────────────────────────────────────────

/** One invoiced sale's cost, so COGS can be recognised per document. */
interface SoldGoods {
  invoiceId: string;
  invoiceNumber: string;
  issueDate: Date;
  cost: number;
}

function seedInvoices(
  b: DatasetBuilder,
  anchor: Date,
  contactIds: string[],
  productIds: string[],
): { goodsCost: number; byMonth: Map<string, number>; soldGoods: SoldGoods[] } {
  let seq = 0;
  let goodsCostTotal = 0;
  const costByMonth = new Map<string, number>();
  const soldGoods: SoldGoods[] = [];

  for (const spec of INVOICES) {
    seq += 1;
    const issueDate = monthDay(anchor, spec.monthOffset, spec.day);
    const customer = CUSTOMERS[spec.customer];
    const dueDate = addDays(issueDate, customer.termsDays) > anchor
      ? addDays(issueDate, customer.termsDays)
      : addDays(issueDate, customer.termsDays);

    // Lines
    const lines = spec.items.map(([productIndex, specQty], i) => {
      const p = PRODUCTS[productIndex];
      const qty = Math.max(1, Math.round(specQty * SALES_VOLUME));
      const lineSubtotal = money(qty * p.sale);
      const taxRate = p.taxCode === 'vat_standard' ? VAT_STANDARD_RATE : 0;
      return {
        id: demoUuid('invoice_line', `${seq}:${i}`),
        productIndex,
        qty,
        description: `${p.name} (${qty} × ${p.uom})`,
        unit_price: p.sale,
        line_subtotal: lineSubtotal,
        line_total: lineSubtotal,
        discount_percent: 0,
        discount_amount: 0,
        tax_rate: money(taxRate * 100),
        tax_code: p.taxCode,
        tax_amount: money(lineSubtotal * taxRate),
        account_id: p.type === 'goods' ? b.acct('4110') : b.acct('4112'),
        line_number: i + 1,
        cost: money(qty * p.purchase),
      };
    });

    const subtotal = money(lines.reduce((s, l) => s + l.line_subtotal, 0));
    const vat = money(lines.reduce((s, l) => s + l.tax_amount, 0));
    const total = money(subtotal + vat);
    const goodsCost = money(lines.reduce((s, l) => s + l.cost, 0));
    goodsCostTotal += goodsCost;
    const period = toDateStr(issueDate).slice(0, 7);
    costByMonth.set(period, money((costByMonth.get(period) ?? 0) + goodsCost));

    // Status + payments
    const isFutureDue = toDateStr(dueDate) >= toDateStr(anchor);
    let status: string;
    if (spec.status) status = spec.status;
    else if (spec.payment === 'full') status = 'paid';
    else if (spec.payment === 'half') status = 'partially_paid';
    else status = isFutureDue ? 'sent' : 'overdue';

    const paidAmount =
      spec.payment === 'full' ? total : spec.payment === 'half' ? money(total / 2) : 0;

    const invoiceId = demoUuid('invoice', seq);
    // A draft has not delivered anything yet, so it carries no cost of sales.
    if (status !== 'draft' && goodsCost > 0) {
      soldGoods.push({
        invoiceId,
        invoiceNumber: `INV-${String(seq).padStart(4, '0')}`,
        issueDate,
        cost: goodsCost,
      });
    }
    b.add('invoices', {
      id: invoiceId,
      business_id: DEMO_BUSINESS_ID,
      invoice_number: `INV-${String(seq).padStart(4, '0')}`,
      invoice_type: 'invoice',
      status,
      contact_id: contactIds[spec.customer],
      issue_date: toDateStr(issueDate),
      due_date: toDateStr(dueDate),
      currency: 'MWK',
      exchange_rate: 1,
      rate_date: null,
      rate_is_stale: false,
      original_currency: null,
      original_amount: null,
      functional_amount: total,
      subtotal,
      vat_amount: vat,
      wht_amount: 0,
      discount_amount: 0,
      discount_percent: 0,
      total_amount: total,
      amount_paid: paidAmount,
      amount_due: money(total - paidAmount),
      ar_account_id: b.acct('1131'),
      revenue_account_id: b.acct('4110'),
      branch_id: demoUuid('branch', 'lgw'),
      department_id: demoUuid('department', 'sales'),
      journal_entry_id: null,
      credit_note_for: null,
      po_number: null,
      lpo_number: null,
      project_code: null,
      template: 'professional',
      accent_colour: null,
      terms: `Payment due within ${customer.termsDays} days.`,
      notes: null,
      payment_provider: null,
      payment_reference: null,
      sent_at: status === 'draft' ? null : toTs(issueDate),
      viewed_at: status === 'draft' ? null : toTs(addDays(issueDate, 1)),
      created_by: DEMO_EMAIL,
      deleted_at: null,
      created_at: toTs(issueDate),
      updated_at: toTs(issueDate),
    });

    lines.forEach((l) => {
      b.add('invoice_lines', {
        id: l.id,
        business_id: DEMO_BUSINESS_ID,
        invoice_id: invoiceId,
        product_id: l.productIndex === 5 ? productIds[5] : productIds[l.productIndex],
        account_id: l.account_id,
        line_number: l.line_number,
        description: l.description,
        quantity: l.qty,
        unit_price: l.unit_price,
        line_subtotal: l.line_subtotal,
        line_total: l.line_total,
        discount_percent: l.discount_percent,
        discount_amount: l.discount_amount,
        tax_code: l.tax_code,
        tax_rate: l.tax_rate,
        tax_amount: l.tax_amount,
        created_at: toTs(issueDate),
      });
    });

    // Revenue journal: DR debtors, CR revenue, CR output VAT. A draft has not
    // been issued yet, so it recognises nothing — the app leaves its
    // journal_entry_id null until it is sent.
    if (status !== 'draft') {
      const entry = b.journal({
        entryDate: issueDate,
        description: `Sales invoice INV-${String(seq).padStart(4, '0')} — ${customer.name}`,
        sourceType: 'invoice',
        sourceId: invoiceId,
        reference: `INV-${String(seq).padStart(4, '0')}`,
        lines: [
          { accountCode: '1131', debit: total, description: 'Trade Debtors' },
          { accountCode: '4110', credit: subtotal, description: 'Sales — Goods' },
          ...(vat > 0 ? [{ accountCode: '2121', credit: vat, description: 'Output VAT' }] : []),
        ],
      });
      b.tables.invoices!.find((r) => r.id === invoiceId)!.journal_entry_id = entry.id;
    }

    if (paidAmount > 0) {
      const payDate = addDays(issueDate, 7 + (seq % 7)) > anchor ? anchor : addDays(issueDate, 7 + (seq % 7));
      // Trade customers settle by transfer or cheque; only counter sales come
      // in over the till or mobile money.
      const method = (
        [
          'bank_transfer', 'bank_transfer', 'bank_transfer', 'cheque',
          'cheque', 'bank_transfer', 'airtel_money', 'cash',
        ] as const
      )[seq % 8];
      const bankAccount = method === 'cash' ? '1110' : method === 'airtel_money' ? '1125' : '1121';
      b.add('invoice_payments', {
        id: demoUuid('invoice_payment', seq),
        business_id: DEMO_BUSINESS_ID,
        invoice_id: invoiceId,
        amount: paidAmount,
        payment_date: toDateStr(payDate),
        payment_method: method,
        reference: `${method === 'cash' ? 'CASH' : 'TXN'}-${String(seq).padStart(4, '0')}`,
        bank_account_id: b.acct(bankAccount),
        journal_entry_id: null,
        currency: 'MWK',
        exchange_rate: 1,
        rate_date: null,
        rate_is_stale: false,
        original_amount: null,
        original_currency: null,
        functional_amount: paidAmount,
        notes: null,
        created_by: DEMO_EMAIL,
        created_at: toTs(payDate),
      });

      b.journal({
        entryDate: payDate,
        description: `Receipt for INV-${String(seq).padStart(4, '0')} — ${customer.name}`,
        sourceType: 'invoice_payment',
        sourceId: invoiceId,
        reference: `INV-${String(seq).padStart(4, '0')}`,
        lines: [
          { accountCode: bankAccount, debit: paidAmount, description: 'Cash received' },
          { accountCode: '1131', credit: paidAmount, description: 'Trade Debtors' },
        ],
      });
    }
  }

  return { goodsCost: goodsCostTotal, byMonth: costByMonth, soldGoods };
}

// ── Purchase / expense ledger ────────────────────────────────────────────────

/**
 * Operating expenses plus the monthly supplier stock bills.
 *
 * A trader replenishes roughly what it sold, so each month's purchases track
 * that month's cost of sales (plus a small build). They post to Trading Stock
 * (1141) — an asset — not to the P&L: the cost reaches the income statement as
 * COGS when the goods are invoiced. Without them the stock account drains
 * negative as COGS is recognised, and the balance sheet shows impossible
 * inventory. The basket is dominated by zero-rated maize flour, so the bills
 * carry no input VAT.
 *
 * Stock bills and opex are merged and sorted by date so one EXP-#### sequence
 * covers everything in chronological order, the way a real ledger reads.
 */
function seedExpenses(
  b: DatasetBuilder,
  anchor: Date,
  contactIds: string[],
  stockCostByMonth: Map<string, number>,
): void {
  const stockBills: { spec: ExpenseSpec; date: Date }[] = [];
  for (const [period, cost] of stockCostByMonth) {
    const [year, month] = period.split('-').map(Number);
    const date = new Date(year, month - 1, 6);
    if (date > anchor) continue;
    // This month's delivery is still in creditors — the AP balance a visitor
    // expects to see on the balance sheet and in the bills list.
    const isCurrentMonth = year === anchor.getFullYear() && month === anchor.getMonth() + 1;
    stockBills.push({
      date,
      spec: {
        monthOffset: 0,
        day: 6,
        accountCode: '1141',
        description: `Stock purchase — ${SUPPLIERS[0].name}`,
        net: money(cost * 1.02),
        hasVat: false,
        supplier: 0,
        type: 'bill',
        paid: !isCurrentMonth,
        method: 'bank_transfer',
      },
    });
  }

  const dated = [
    ...EXPENSES.map((spec) => ({ spec, date: monthDay(anchor, spec.monthOffset, spec.day) })),
    ...stockBills,
  ].sort((a, c) => a.date.getTime() - c.date.getTime());

  let seq = 0;
  for (const { spec, date: expenseDate } of dated) {
    seq += 1;
    const vatRate = spec.hasVat ? VAT_STANDARD_RATE : 0;
    const vat = money(spec.net * vatRate);
    const total = money(spec.net + vat);
    const expenseId = demoUuid('expense', seq);
    const supplierId = spec.supplier !== undefined ? contactIds[6 + spec.supplier] : null;
    const dueDate = addDays(expenseDate, 14);
    const status = spec.paid ? 'paid' : toDateStr(dueDate) < toDateStr(anchor) ? 'overdue' : 'pending';

    b.add('expenses', {
      id: expenseId,
      business_id: DEMO_BUSINESS_ID,
      expense_number: `EXP-${String(seq).padStart(4, '0')}`,
      expense_type: spec.type,
      status,
      contact_id: supplierId,
      expense_date: toDateStr(expenseDate),
      due_date: toDateStr(dueDate),
      currency: 'MWK',
      exchange_rate: 1,
      rate_date: null,
      rate_is_stale: false,
      original_currency: null,
      original_amount: null,
      functional_amount: total,
      subtotal: spec.net,
      vat_amount: vat,
      wht_amount: 0,
      discount_amount: 0,
      discount_percent: 0,
      total_amount: total,
      amount_paid: spec.paid ? total : 0,
      ap_account_id: b.acct('2111'),
      branch_id: demoUuid('branch', 'lgw'),
      department_id: demoUuid('department', 'ops'),
      journal_entry_id: null,
      reference: `${spec.description}`.slice(0, 40),
      receipt_url: null,
      receipt_filename: null,
      receipt_mime_type: null,
      receipt_size_bytes: null,
      notes: null,
      approved_at: spec.type === 'bill' ? toTs(expenseDate) : null,
      approved_by: spec.type === 'bill' ? DEMO_EMAIL : null,
      created_by: DEMO_EMAIL,
      deleted_at: null,
      created_at: toTs(expenseDate),
      updated_at: toTs(expenseDate),
    });

    b.add('expense_lines', {
      id: demoUuid('expense_line', seq),
      business_id: DEMO_BUSINESS_ID,
      expense_id: expenseId,
      account_id: b.acct(spec.accountCode),
      product_id: null,
      line_number: 1,
      description: spec.description,
      quantity: 1,
      unit_price: spec.net,
      line_subtotal: spec.net,
      line_total: spec.net,
      discount_percent: 0,
      discount_amount: 0,
      tax_code: spec.hasVat ? 'vat_standard' : 'none',
      tax_rate: money(vatRate * 100),
      tax_amount: vat,
      created_at: toTs(expenseDate),
    });

    // Receipts are settled immediately (cash/bank); bills sit in creditors.
    const creditAccount = spec.type === 'bill' ? '2111' : paymentAccountCode(spec.method);
    const entry = b.journal({
      entryDate: expenseDate,
      description: `${spec.description} (EXP-${String(seq).padStart(4, '0')})`,
      sourceType: 'expense',
      sourceId: expenseId,
      reference: `EXP-${String(seq).padStart(4, '0')}`,
      lines: [
        { accountCode: spec.accountCode, debit: spec.net, description: spec.description },
        ...(vat > 0 ? [{ accountCode: '1135', debit: vat, description: 'Input VAT' }] : []),
        { accountCode: creditAccount, credit: total, description: spec.type === 'bill' ? 'Trade Creditors' : 'Settled immediately' },
      ],
    });
    b.tables.expenses!.find((r) => r.id === expenseId)!.journal_entry_id = entry.id;

    if (spec.paid && spec.type === 'bill') {
      const payDate = addDays(expenseDate, 10) > anchor ? anchor : addDays(expenseDate, 10);
      const bankAccount = paymentAccountCode(spec.method);
      b.add('expense_payments', {
        id: demoUuid('expense_payment', seq),
        business_id: DEMO_BUSINESS_ID,
        expense_id: expenseId,
        amount: total,
        payment_date: toDateStr(payDate),
        payment_method: spec.method,
        reference: `PAY-${String(seq).padStart(4, '0')}`,
        bank_account_id: b.acct(bankAccount),
        journal_entry_id: null,
        currency: 'MWK',
        exchange_rate: 1,
        rate_date: null,
        rate_is_stale: false,
        original_amount: null,
        original_currency: null,
        functional_amount: total,
        notes: null,
        created_by: DEMO_EMAIL,
        created_at: toTs(payDate),
      });

      b.journal({
        entryDate: payDate,
        description: `Payment for EXP-${String(seq).padStart(4, '0')} — ${spec.description}`,
        sourceType: 'expense_payment',
        sourceId: expenseId,
        reference: `EXP-${String(seq).padStart(4, '0')}`,
        lines: [
          { accountCode: '2111', debit: total, description: 'Trade Creditors settled' },
          { accountCode: bankAccount, credit: total, description: 'Cash paid' },
        ],
      });
    }
  }
}

function paymentAccountCode(method: ExpenseSpec['method']): string {
  if (method === 'cash') return '1110';
  if (method === 'airtel_money') return '1125';
  return '1121';
}

// ── Cost of sales, payroll, depreciation ─────────────────────────────────────

/**
 * Perpetual-inventory COGS: one monthly entry per trading month so gross
 * profit is meaningful in the P&L and trading stock moves down.
 */
/**
 * Recognise cost of sales per invoice, on the invoice date — the same
 * perpetual-inventory treatment the app applies when it saves a sale (its
 * quick-save RPC returns a `cogs_entry_id` alongside the invoice).
 *
 * The earlier month-end approach left the CURRENT month with revenue and no
 * matching cost, because the month-end entry is dated in the future and had to
 * be skipped — which made the live month look wildly profitable on the P&L
 * while every closed month looked break-even.
 */
/**
 * Sweep the till and the mobile-money wallet down to a working float.
 *
 * Counter sales and Airtel Money receipts would otherwise pile up into
 * balances no Malawian shop actually holds (millions of kwacha in a till or a
 * phone wallet); everything above the float goes to the bank, which is what
 * the seeded receipts and stock payments are sized against. Runs last, once
 * every receipt and payment exists. Both legs are cash equivalents, so the
 * statement of cash flows treats it as the internal transfer it is.
 */
const CASH_FLOATS: Record<string, number> = {
  '1110': 400_000, // Cash on Hand — till float
  '1125': 250_000, // Airtel Money — wallet float
};

function seedCashSweep(b: DatasetBuilder, anchor: Date): void {
  const accounts = b.rows('accounts');
  const lines = b.rows('journal_lines');

  const balanceOf = (code: string): number => {
    const account = accounts.find((a) => a.code === code);
    if (!account) return 0;
    const movement = lines
      .filter((l) => l.account_id === account.id)
      .reduce((sum, l) => sum + (l.is_debit ? Number(l.amount_base) : -Number(l.amount_base)), 0);
    return Number(account.opening_balance ?? 0) + movement;
  };

  const sweeps = Object.entries(CASH_FLOATS)
    .map(([code, float]) => ({ code, excess: money(balanceOf(code) - float) }))
    .filter((entry) => entry.excess > 0);

  if (sweeps.length === 0) return;

  const total = money(sweeps.reduce((sum, entry) => sum + entry.excess, 0));
  b.journal({
    entryDate: anchor,
    description: 'Sweep till cash and mobile money to bank',
    sourceType: 'transfer',
    reference: 'SWEEP',
    lines: [
      { accountCode: '1121', debit: total, description: 'National Bank — current account' },
      ...sweeps.map((entry) => ({
        accountCode: entry.code,
        credit: entry.excess,
        description: entry.code === '1110' ? 'Till cash above float' : 'Mobile money above float',
      })),
    ],
  });
}

function seedCogs(
  b: DatasetBuilder,
  anchor: Date,
  totals: { soldGoods: SoldGoods[] },
): void {
  for (const sale of totals.soldGoods) {
    if (sale.cost <= 0 || sale.issueDate > anchor) continue;
    b.journal({
      entryDate: sale.issueDate,
      description: `Cost of goods sold — ${sale.invoiceNumber}`,
      sourceType: 'cogs',
      sourceId: sale.invoiceId,
      reference: sale.invoiceNumber,
      lines: [
        { accountCode: '5100', debit: sale.cost, description: 'Cost of Goods Sold' },
        { accountCode: '1141', credit: sale.cost, description: 'Trading Stock' },
      ],
    });
  }
}

function seedPayroll(b: DatasetBuilder, anchor: Date): void {
  const employees = EMPLOYEES.map((e, i) => {
    const annualGross = e.gross * 12;
    // calculatePAYE takes annual gross and already returns the MONTHLY PAYE
    // (it divides the banded annual tax by 12) — the same way PayrollPage uses
    // it. Dividing again here understated every employee's PAYE twelve-fold.
    const paye = money(calculatePAYE(annualGross, FALLBACK_PAYE_BANDS));
    const pensionEmployee = money(e.gross * PENSION_EMPLOYEE_RATE);
    const pensionEmployer = money(e.gross * PENSION_EMPLOYER_RATE);
    const net = money(e.gross - paye - pensionEmployee);
    const id = demoUuid('employee', i);

    b.add('employees', {
      id,
      business_id: DEMO_BUSINESS_ID,
      employee_number: `EMP-${String(i + 1).padStart(3, '0')}`,
      first_name: e.first,
      last_name: e.last,
      job_title: e.title,
      email: `${e.first.toLowerCase()}.${e.last.toLowerCase()}@lilongwetrading.example`,
      phone: e.phone,
      gender: i === 2 ? 'female' : 'male',
      date_of_birth: `19${88 - i}-0${i + 2}-1${i}`,
      national_id: `ID-${1000000 + i * 1234}`,
      tpin: `2005${String(2000 + i * 13)}`,
      employment_type: 'permanent',
      pay_frequency: 'monthly',
      payment_method: 'bank_transfer',
      bank_name: 'National Bank of Malawi',
      bank_branch: 'Lilongwe City Centre',
      bank_account_number: e.bank,
      mobile_money_number: null,
      mobile_money_type: null,
      gross_salary: e.gross,
      currency: 'MWK',
      start_date: e.start,
      end_date: null,
      probation_end_date: null,
      paye_tax_class: 'A',
      paye_code: null,
      tax_exempt: false,
      paye_liability_account_id: b.acct('2122'),
      salary_account_id: b.acct('6110'),
      branch_id: demoUuid('branch', 'lgw'),
      department_id: demoUuid('department', i === 0 ? 'sales' : i === 1 ? 'admin' : 'ops'),
      notes: null,
      is_active: true,
      deleted_at: null,
      created_at: toTs(new Date(anchor.getFullYear() - 2, 0, 15)),
      updated_at: toTs(anchor),
    });

    return { ...e, id, paye, pensionEmployee, pensionEmployer, net };
  });

  // One run per month of the demo's trading window, oldest first. The five
  // earlier runs are paid and filed with the MRA; the current month is
  // approved and waiting for its pay date — the state a payroll screen is
  // usually caught in. Paying staff only in the last two months would leave
  // the monthly P&L without any salary cost for most of the year.
  const RUN_COUNT = 6;
  Array.from({ length: RUN_COUNT }, (_, i) => RUN_COUNT - 1 - i).forEach((offset) => {
    const periodDate = addMonths(anchor, -offset);
    const periodStart = new Date(periodDate.getFullYear(), periodDate.getMonth(), 1);
    const periodEnd = lastDayOfMonth(periodStart);
    const payDate = offset === 0 ? (periodEnd > anchor ? anchor : periodEnd) : periodEnd;
    const isPaidRun = offset > 0;
    const runNumber = `PAY-${String(RUN_COUNT - offset).padStart(4, '0')}`;

    const totalGross = money(employees.reduce((s, e) => s + e.gross, 0));
    const totalPaye = money(employees.reduce((s, e) => s + e.paye, 0));
    const totalPensionEmployee = money(employees.reduce((s, e) => s + e.pensionEmployee, 0));
    const totalPensionEmployer = money(employees.reduce((s, e) => s + e.pensionEmployer, 0));
    const totalNet = money(employees.reduce((s, e) => s + e.net, 0));

    const runId = demoUuid('payroll_run', offset);
    b.add('payroll_runs', {
      id: runId,
      business_id: DEMO_BUSINESS_ID,
      run_number: runNumber,
      payroll_period: `${periodStart.toLocaleString('en', { month: 'long', year: 'numeric' })}`,
      period_start: toDateStr(periodStart),
      period_end: toDateStr(periodEnd),
      pay_date: toDateStr(payDate),
      status: isPaidRun ? 'paid' : 'approved',
      total_gross: totalGross,
      total_paye: totalPaye,
      total_other_deductions: totalPensionEmployee,
      total_net: totalNet,
      journal_entry_id: null,
      approved_at: toTs(periodEnd),
      approved_by: DEMO_EMAIL,
      paye_filed_at: isPaidRun ? toTs(addDays(periodEnd, 5)) : null,
      paye_return_ref: isPaidRun ? `MRA-PAYE-${periodStart.getFullYear()}${String(periodStart.getMonth() + 1).padStart(2, '0')}` : null,
      notes: null,
      created_by: DEMO_EMAIL,
      created_at: toTs(periodEnd),
      updated_at: toTs(payDate),
    });

    employees.forEach((e, i) => {
      b.add('payroll_employee_lines', {
        id: demoUuid('payroll_line', `${offset}:${i}`),
        business_id: DEMO_BUSINESS_ID,
        payroll_run_id: runId,
        employee_id: e.id,
        basic_salary: e.gross,
        total_allowances: 0,
        gross_pay: e.gross,
        paye_taxable_income: e.gross,
        paye_deduction: e.paye,
        pension_employee: e.pensionEmployee,
        pension_employer: e.pensionEmployer,
        other_deductions: 0,
        total_deductions: money(e.paye + e.pensionEmployee),
        net_pay: e.net,
        payment_method: 'bank_transfer',
        payment_ref: isPaidRun ? `NEFT-${runNumber}-${i + 1}` : null,
        paid_at: isPaidRun ? toTs(payDate) : null,
        payslip_generated: isPaidRun,
        payslip_url: null,
        paye_bands_json: FALLBACK_PAYE_BANDS as unknown,
        notes: null,
        created_at: toTs(periodEnd),
      });
    });

    const totalPensionPayable = money(totalPensionEmployee + totalPensionEmployer);
    const entry = b.journal({
      entryDate: payDate,
      description: `Payroll ${periodStart.toLocaleString('en', { month: 'long', year: 'numeric' })}`,
      sourceType: 'payroll',
      sourceId: runId,
      reference: runNumber,
      lines: [
        { accountCode: '6110', debit: totalGross, description: 'Basic Salaries' },
        { accountCode: '6112', debit: totalPensionEmployer, description: 'Employer Pension Contributions' },
        { accountCode: '2122', credit: totalPaye, description: 'PAYE Payable' },
        { accountCode: '2132', credit: totalPensionPayable, description: 'Pension Payable' },
        { accountCode: '1121', credit: totalNet, description: 'Net pay to staff' },
      ],
    });

    // Settled with the MRA and the pension fund on the 10th of the following
    // month. The current month's run stays accrued, which is why PAYE and
    // pension payable carry a balance on the demo's balance sheet.
    if (isPaidRun) {
      const remitDate = new Date(periodEnd.getFullYear(), periodEnd.getMonth() + 1, 10);
      if (remitDate <= anchor) {
        b.journal({
          entryDate: remitDate,
          description: `PAYE and pension remittance — ${runNumber}`,
          sourceType: 'tax_payment',
          sourceId: runId,
          reference: runNumber,
          lines: [
            { accountCode: '2122', debit: totalPaye, description: 'PAYE Payable' },
            { accountCode: '2132', debit: totalPensionPayable, description: 'Pension Payable' },
            { accountCode: '1121', credit: money(totalPaye + totalPensionPayable), description: 'National Bank' },
          ],
        });
      }
    }
    b.tables.payroll_runs!.find((r) => r.id === runId)!.journal_entry_id = entry.id;
  });
}

/** Straight-line depreciation for the last three closed months. */
function seedDepreciation(b: DatasetBuilder, anchor: Date): void {
  const assets = b.tables.fixed_assets ?? [];
  for (let m = DEPRECIATION_MONTHS; m >= 1; m -= 1) {
    const periodDate = addMonths(anchor, -m);
    const periodEnd = lastDayOfMonth(periodDate);
    if (periodEnd > anchor) continue;

    for (const asset of assets) {
      const cost = Number(asset.acquisition_cost);
      const residual = Number(asset.residual_value);
      const lifeMonths = Number(asset.useful_life_months);
      const amount = money((cost - residual) / lifeMonths);
      if (amount <= 0) continue;
      const depAccount = codeForAccountId(b, asset.dep_expense_account_id as string);
      const accumAccount = codeForAccountId(b, asset.accumulated_dep_account_id as string);
      if (!depAccount || !accumAccount) continue;
      b.journal({
        entryDate: periodEnd,
        description: `Depreciation — ${String(asset.name)} (${periodEnd.toLocaleString('en', { month: 'short', year: 'numeric' })})`,
        sourceType: 'depreciation',
        sourceId: String(asset.id),
        reference: String(asset.asset_number),
        lines: [
          { accountCode: depAccount, debit: amount, description: 'Depreciation charge' },
          { accountCode: accumAccount, credit: amount, description: 'Accumulated depreciation' },
        ],
      });
    }
  }
}

/** Reverse-lookup an account code from its id (the seed knows both). */
function codeForAccountId(b: DatasetBuilder, accountId: string): string | null {
  for (const [code, id] of b.accountIds) {
    if (id === accountId) return code;
  }
  return null;
}

// ── FX, audit log, tax returns ───────────────────────────────────────────────

function seedFx(b: DatasetBuilder, anchor: Date): void {
  const currencies: [string, string, string, boolean, boolean][] = [
    ['MWK', 'Malawian Kwacha', 'MK', true, false],
    ['USD', 'US Dollar', '$', false, true],
    ['ZAR', 'South African Rand', 'R', false, true],
    ['GBP', 'British Pound', '£', false, true],
    ['EUR', 'Euro', '€', false, true],
  ];
  currencies.forEach(([code, name, symbol, isPrimary, isSupported]) => {
    b.add('currencies', {
      code,
      name,
      symbol,
      decimal_places: 2,
      is_active: true,
      is_primary: isPrimary,
      is_frankfurter_supported: isSupported,
      created_at: toTs(addMonths(anchor, -24)),
    });
  });

  const rates: [string, number][] = [
    ['USD', 1_750],
    ['ZAR', 96.5],
    ['GBP', 2_230],
    ['EUR', 1_905],
  ];
  rates.forEach(([from, rate], i) => {
    for (let m = 2; m >= 0; m -= 1) {
      const rateDate = monthDay(anchor, m, 1);
      b.add('exchange_rates', {
        id: demoUuid('fx', `${from}:${m}:${i}`),
        business_id: DEMO_BUSINESS_ID,
        from_currency: from,
        to_currency: 'MWK',
        rate: money(rate + (2 - m) * (rate * 0.004)),
        rate_date: toDateStr(rateDate),
        source: 'manual',
        created_by: DEMO_USER_ID,
        created_at: toTs(rateDate),
      });
    }
  });
}

function seedAuditLog(b: DatasetBuilder, anchor: Date): void {
  const events: [string, string, string, number][] = [
    ['auth.login', 'user', DEMO_USER_ID, 5],
    ['invoice.created', 'invoice', demoUuid('invoice', 18), 4],
    ['expense.created', 'expense', demoUuid('expense', 24), 3],
    ['payroll.approved', 'payroll_run', demoUuid('payroll_run', 0), 2],
    ['report.exported', 'report', 'profit_or_loss', 1],
  ];
  events.forEach(([eventType, resourceType, resourceId, daysAgo], i) => {
    const at = addDays(anchor, -daysAgo);
    b.add('audit_log', {
      id: i + 1,
      business_id: DEMO_BUSINESS_ID,
      user_id: DEMO_USER_ID,
      user_email: DEMO_EMAIL,
      event_type: eventType,
      resource_type: resourceType,
      resource_id: resourceId,
      resource_ref: null,
      old_values: null,
      new_values: null,
      changed_fields: null,
      notes: 'Demo audit trail',
      ip_address: '127.0.0.1',
      user_agent: 'Ledgr demo',
      session_id: demoUuid('session', i),
      occurred_at: toTs(at),
      prev_hash: null,
      entry_hash: demoUuid('hash', i),
    });
  });
}

function seedTaxReturns(b: DatasetBuilder, anchor: Date): void {
  const VAT_RETURN_MONTHS = 6;

  for (let m = VAT_RETURN_MONTHS - 1; m >= 0; m -= 1) {
    const periodDate = addMonths(anchor, -m);
    const periodStart = new Date(periodDate.getFullYear(), periodDate.getMonth(), 1);
    const periodEnd = lastDayOfMonth(periodStart);
    const periodLabel = `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, '0')}`;
    const invoices = (b.tables.invoices ?? []).filter((inv) =>
      String(inv.issue_date).startsWith(periodLabel),
    );
    const expenses = (b.tables.expenses ?? []).filter((exp) =>
      String(exp.expense_date).startsWith(periodLabel),
    );
    const outputTax = money(invoices.reduce((s, inv) => s + Number(inv.vat_amount), 0));
    const inputTax = money(expenses.reduce((s, exp) => s + Number(exp.vat_amount), 0));
    const amountDue = money(Math.max(0, outputTax - inputTax));

    // Every month but the current one has been filed and paid — the MRA
    // deadline is the 20th of the following month. Leaving six months of
    // output VAT sitting in the payable account would make the demo business
    // look like it never files, and the balance sheet would carry a liability
    // no compliant trader would have.
    const isFiled = m > 0 && amountDue > 0;
    const filedAt = addDays(periodEnd, 18);
    const payDate = addDays(periodEnd, 20);

    let journalId: string | null = null;
    if (isFiled && payDate <= anchor) {
      // One entry settles the return: output VAT is debited away, the input
      // VAT reclaimed off the receivable account, and the net paid from the
      // bank.
      const entry = b.journal({
        entryDate: payDate,
        description: `VAT return ${periodLabel} — payment to MRA`,
        sourceType: 'tax_payment',
        reference: `MRA-VAT-${periodLabel.replace('-', '')}`,
        lines: [
          { accountCode: '2121', debit: outputTax, description: 'Output VAT for the period' },
          ...(inputTax > 0
            ? [{ accountCode: '1135', credit: inputTax, description: 'Input VAT reclaimed' }]
            : []),
          { accountCode: '1121', credit: amountDue, description: 'National Bank' },
        ],
      });
      journalId = String(entry.id);
    }

    b.add('tax_returns', {
      id: demoUuid('tax_return', `vat:${periodLabel}`),
      business_id: DEMO_BUSINESS_ID,
      tax_code: 'vat_standard',
      period_label: periodLabel,
      period_start: toDateStr(periodStart),
      period_end: toDateStr(periodEnd),
      due_date: toDateStr(addDays(periodEnd, 21)),
      output_tax: outputTax,
      input_tax: inputTax,
      gross_amount: outputTax,
      amount_due: amountDue,
      amount_paid: journalId ? amountDue : 0,
      status: journalId ? 'filed' : 'pending',
      journal_entry_id: journalId,
      filed_ref: journalId ? `MRA-VAT-${periodLabel.replace('-', '')}` : null,
      filed_at: journalId ? toTs(filedAt) : null,
      source_type: 'vat_period',
      source_id: null,
      created_by: DEMO_USER_ID,
      created_at: toTs(periodEnd),
      updated_at: toTs(anchor),
    });
  }
}
