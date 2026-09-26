/**
 * The demo Supabase client.
 *
 * Drop-in replacement for the real `SupabaseClient` while demo mode is active
 * (see `src/lib/supabase.ts`, which swaps between the two). It implements the
 * parts of the client the app touches:
 *
 *   - `from()`      → in-memory query builder over the seeded tables
 *   - `rpc()`       → the Postgres functions the UI depends on, emulated
 *   - `auth`        → a fixed `demo@ledgr.test` session (no credentials)
 *   - `functions`   → Edge Function responses a demo visitor should see
 *   - `storage`     → logo uploads kept in memory as data: URLs
 *   - `channel()`   → no-op realtime stub (the app has no live channels yet)
 *
 * Every mutation writes to the visitor's own snapshot (`store.ts`), so the
 * demo is fully explorable — create an invoice, record an expense, run
 * payroll — without a backend, and without ever risking real tenant data.
 */

import { DemoQueryBuilder } from './queryBuilder';
import { computeDemoView } from './views';
import { getDemoTables, markDemoStateChanged, resetDemoData } from './store';
import {
  DEMO_BUSINESS_ID,
  DEMO_EMAIL,
  DEMO_ROLE,
  DEMO_USER_ID,
  DEMO_USER_NAME,
  demoUuid,
} from './constants';
import type { DemoRow, DemoTables } from './dataset';

export const DEMO_MODE_NOTICE =
  'You are in the Ledgr demo. Create a free account to keep your own books.';

export interface DemoRpcResponse {
  data: unknown;
  error: { message: string; details?: string; hint?: string; code?: string; status?: number } | null;
}

type Listener = (event: string, session: DemoSession | null) => void;

export interface DemoSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  expires_in: number;
  token_type: 'bearer';
  user: DemoUser;
}

export interface DemoUser {
  id: string;
  aud: 'authenticated';
  role: 'authenticated';
  email: string;
  email_confirmed_at: string;
  phone: string | null;
  confirmed_at: string;
  created_at: string;
  updated_at: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  identities: unknown[];
  is_anonymous: boolean;
}

function demoUser(): DemoUser {
  const now = new Date().toISOString();
  return {
    id: DEMO_USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: DEMO_EMAIL,
    email_confirmed_at: now,
    phone: null,
    confirmed_at: now,
    created_at: now,
    updated_at: now,
    app_metadata: { provider: 'demo', providers: ['demo'] },
    user_metadata: { full_name: DEMO_USER_NAME, email: DEMO_EMAIL },
    identities: [],
    is_anonymous: false,
  };
}

function demoSession(): DemoSession {
  return {
    access_token: `demo-${DEMO_USER_ID}`,
    refresh_token: `demo-refresh-${DEMO_USER_ID}`,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: demoUser(),
  };
}

const ok = <T,>(data: T): DemoRpcResponse => ({ data, error: null });
const fail = (message: string, code = 'DEMO01', status = 400): DemoRpcResponse => ({
  data: null,
  error: { message, code, status },
});

// ── RPC emulation ────────────────────────────────────────────────────────────

function nextDocumentNumber(tables: DemoTables, kind: 'invoice' | 'expense' | 'payroll'): string {
  const business = (tables.businesses ?? []).find((b) => b.id === DEMO_BUSINESS_ID);
  const prefixKey = `${kind}_prefix`;
  const counterKey = `${kind}_next_number`;
  const prefix = String(business?.[prefixKey] ?? kind.slice(0, 3).toUpperCase());
  const current = Number(business?.[counterKey] ?? 1);
  if (business) {
    business[counterKey] = current + 1;
    business.updated_at = new Date().toISOString();
    markDemoStateChanged();
  }
  return `${prefix}-${String(current).padStart(4, '0')}`;
}

function nextJournalEntryNumber(tables: DemoTables): string {
  const entries = tables.journal_entries ?? [];
  let max = 0;
  for (const entry of entries) {
    const match = /(\d+)\s*$/.exec(String(entry.entry_number ?? ''));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `JE-${String(max + 1).padStart(4, '0')}`;
}

/** Emulates `increment_amount_paid` and keeps the document status in step. */
function incrementAmountPaid(
  tables: DemoTables,
  args: { p_table?: string; p_id?: string; p_amount?: number; p_delta?: number },
): DemoRpcResponse {
  const table = args.p_table === 'expenses' ? 'expenses' : 'invoices';
  const rows = tables[table] ?? [];
  const row = rows.find((r) => r.id === args.p_id);
  if (!row) return fail(`${table} ${String(args.p_id)} not found`, 'P0002', 404);

  const delta = Number(args.p_amount ?? args.p_delta ?? 0);
  const paid = Number(row.amount_paid ?? 0) + delta;
  const total = Number(row.total_amount ?? 0);
  row.amount_paid = Math.round(Math.max(0, paid) * 100) / 100;
  row.amount_due = Math.round((total - Number(row.amount_paid)) * 100) / 100;

  if (Number(row.amount_paid) <= 0) row.status = table === 'invoices' ? 'sent' : 'pending';
  else if (Number(row.amount_paid) >= total) row.status = 'paid';
  else row.status = 'partially_paid';
  row.updated_at = new Date().toISOString();
  markDemoStateChanged();
  return ok(row);
}

/**
 * Emulates the atomic quick-save RPCs (`save_quick_sale`, `save_quick_expense`)
 * so the quick-entry forms — the first thing most visitors try — really do
 * create a document, its lines and a balanced journal entry.
 */
function quickSave(
  tables: DemoTables,
  kind: 'sale' | 'expense',
  payload: Record<string, unknown>,
): DemoRpcResponse {
  const businessId = String(payload.business_id ?? DEMO_BUSINESS_ID);
  const nowIso = new Date().toISOString();
  const journalNumber = nextJournalEntryNumber(tables);

  if (kind === 'sale') {
    const invoice = { ...(payload.invoice as DemoRow) };
    const lines = (payload.lines as DemoRow[]) ?? [];
    const number = nextDocumentNumber(tables, 'invoice');
    const invoiceId = demoUuid('invoice', `quick-${nowIso}`);
    const subtotal = Number(payload.subtotal ?? invoice.subtotal ?? 0);
    const vat = Number(payload.vat_amount ?? invoice.vat_amount ?? 0);
    const total = Number(invoice.total_amount ?? subtotal + vat);

    const invoiceRow: DemoRow = {
      id: invoiceId,
      business_id: businessId,
      invoice_number: number,
      invoice_type: 'invoice',
      status: String(invoice.status ?? 'sent'),
      currency: 'MWK',
      exchange_rate: 1,
      rate_is_stale: false,
      subtotal,
      vat_amount: vat,
      wht_amount: Number(invoice.wht_amount ?? 0),
      discount_amount: Number(invoice.discount_amount ?? 0),
      discount_percent: Number(invoice.discount_percent ?? 0),
      total_amount: total,
      amount_paid: 0,
      amount_due: total,
      functional_amount: total,
      template: 'professional',
      deleted_at: null,
      created_by: DEMO_EMAIL,
      created_at: nowIso,
      updated_at: nowIso,
      ...invoice,
    };
    (tables.invoices ??= []).push(invoiceRow);

    lines.forEach((line, i) => {
      (tables.invoice_lines ??= []).push({
        id: demoUuid('invoice_line', `quick-${nowIso}-${i}`),
        business_id: businessId,
        invoice_id: invoiceId,
        line_number: i + 1,
        discount_percent: 0,
        discount_amount: 0,
        tax_amount: 0,
        ...line,
        created_at: nowIso,
      });
    });

    const entryId = postQuickJournal(tables, businessId, journalNumber, invoiceRow, nowIso, [
      { code: '1131', debit: total, credit: 0, description: 'Trade Debtors' },
      { code: '4110', debit: 0, credit: subtotal, description: 'Sales' },
      ...(vat > 0 ? [{ code: '2121', debit: 0, credit: vat, description: 'Output VAT' }] : []),
    ]);
    invoiceRow.journal_entry_id = entryId;
    markDemoStateChanged();
    return ok({ id: invoiceId, number, journal_entry_id: entryId, idempotent: false });
  }

  const expense = { ...(payload.expense as DemoRow) };
  const lines = (payload.lines as DemoRow[]) ?? [];
  const allocations = (payload.allocations as DemoRow[]) ?? [];
  const number = nextDocumentNumber(tables, 'expense');
  const expenseId = demoUuid('expense', `quick-${nowIso}`);
  const vat = Number(payload.vat_amount ?? expense.vat_amount ?? 0);
  const subtotal = allocations.reduce((s, a) => s + Number(a.amount ?? 0), 0) || Number(expense.subtotal ?? 0);
  const total = Number(expense.total_amount ?? subtotal + vat);

  const expenseRow: DemoRow = {
    id: expenseId,
    business_id: businessId,
    expense_number: number,
    expense_type: String(expense.expense_type ?? 'receipt'),
    status: String(expense.status ?? 'paid'),
    currency: 'MWK',
    exchange_rate: 1,
    rate_is_stale: false,
    subtotal,
    vat_amount: vat,
    wht_amount: 0,
    discount_amount: 0,
    discount_percent: 0,
    total_amount: total,
    amount_paid: String(expense.status ?? 'paid') === 'paid' ? total : 0,
    functional_amount: total,
    deleted_at: null,
    created_by: DEMO_EMAIL,
    created_at: nowIso,
    updated_at: nowIso,
    ...expense,
  };
  (tables.expenses ??= []).push(expenseRow);

  const lineSource = lines.length > 0 ? lines : allocations.map((a) => ({ ...a }));
  lineSource.forEach((line, i) => {
    (tables.expense_lines ??= []).push({
      id: demoUuid('expense_line', `quick-${nowIso}-${i}`),
      business_id: businessId,
      expense_id: expenseId,
      line_number: i + 1,
      quantity: 1,
      unit_price: Number(line.amount ?? line.line_total ?? 0),
      line_subtotal: Number(line.amount ?? line.line_total ?? 0),
      line_total: Number(line.amount ?? line.line_total ?? 0),
      discount_percent: 0,
      discount_amount: 0,
      tax_amount: 0,
      tax_code: 'none',
      tax_rate: 0,
      description: String(line.description ?? 'Expense'),
      ...line,
      created_at: nowIso,
    });
  });

  const cashAccount = accountCodeById(tables, String(expense.ap_account_id ?? '')) ?? '1110';
  const entryId = postQuickJournal(tables, businessId, journalNumber, expenseRow, nowIso, [
    ...allocations.map((a) => ({
      code: accountCodeById(tables, String(a.account_id ?? '')) ?? '6904',
      debit: Number(a.amount ?? 0),
      credit: 0,
      description: String(a.description ?? 'Expense'),
    })),
    ...(vat > 0 ? [{ code: '1135', debit: vat, credit: 0, description: 'Input VAT' }] : []),
    { code: cashAccount, debit: 0, credit: total, description: 'Settled' },
  ]);
  expenseRow.journal_entry_id = entryId;
  markDemoStateChanged();
  return ok({ id: expenseId, number, journal_entry_id: entryId, idempotent: false });
}

function accountCodeById(tables: DemoTables, accountId: string): string | null {
  if (!accountId) return null;
  const account = (tables.accounts ?? []).find((a) => a.id === accountId);
  return account ? String(account.code) : null;
}

/** Insert a journal entry + lines, resolving account codes to seeded ids. */
function postQuickJournal(
  tables: DemoTables,
  businessId: string,
  entryNumber: string,
  source: DemoRow,
  nowIso: string,
  lines: { code: string; debit: number; credit: number; description: string }[],
): string {
  const entryId = demoUuid('journal_entry', `quick-${nowIso}-${entryNumber}`);
  (tables.journal_entries ??= []).push({
    id: entryId,
    business_id: businessId,
    entry_number: entryNumber,
    entry_date: String(source.issue_date ?? source.expense_date ?? nowIso.slice(0, 10)),
    description: String(source.description ?? `${entryNumber} — demo entry`),
    reference: String(source.invoice_number ?? source.expense_number ?? ''),
    status: 'posted',
    source_type: source.invoice_number ? 'invoice' : 'expense',
    source_id: String(source.id ?? ''),
    currency: 'MWK',
    exchange_rate: 1,
    period_id: null,
    posted_at: nowIso,
    posted_by: DEMO_EMAIL,
    created_by: DEMO_EMAIL,
    created_at: nowIso,
  });

  lines
    .filter((l) => (l.debit || 0) > 0 || (l.credit || 0) > 0)
    .forEach((line, i) => {
      const account = (tables.accounts ?? []).find((a) => a.code === line.code);
      (tables.journal_lines ??= []).push({
        id: demoUuid('journal_line', `quick-${nowIso}-${entryNumber}-${i}`),
        business_id: businessId,
        journal_entry_id: entryId,
        account_id: account?.id ?? null,
        line_number: i + 1,
        description: line.description,
        is_debit: (line.debit ?? 0) > 0,
        amount: Math.abs(line.debit || line.credit || 0),
        amount_base: Math.abs(line.debit || line.credit || 0),
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
        created_at: nowIso,
      });
    });

  return entryId;
}

/**
 * `public.ai_context(business_id)` — the Ledgr AI assistant's one-shot context
 * read. Computed from the same tables the views use, so the assistant answers
 * with the numbers actually on screen.
 */
function aiContext(tables: DemoTables): DemoRpcResponse {
  const business = (tables.businesses ?? []).find((b) => b.id === DEMO_BUSINESS_ID);
  const invoices = (tables.invoices ?? []).filter((i) => i.deleted_at == null);
  const expenses = (tables.expenses ?? []).filter((e) => e.deleted_at == null);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);

  const revenueMtd = invoices
    .filter((i) => String(i.issue_date) >= iso(monthStart))
    .reduce((s, i) => s + Number(i.subtotal ?? 0), 0);
  const expensesMtd = expenses
    .filter((e) => String(e.expense_date) >= iso(monthStart))
    .reduce((s, e) => s + Number(e.subtotal ?? 0), 0);

  const open = invoices.filter((i) =>
    ['sent', 'partially_paid', 'overdue'].includes(String(i.status)),
  );
  const overdue = open.filter((i) => String(i.due_date ?? '') < iso(now));

  const contacts = new Map<string, string>(
    (tables.contacts ?? []).map((c) => [String(c.id), String(c.name)]),
  );

  const monthlyTrend = computeDemoView('v_cash_flow', tables).map((row) => ({
    month: String(row.period),
    month_start: `${row.period}-01`,
    revenue: 0,
    expenses: 0,
    profit: 0,
    cash_in: Math.max(0, Number(row.operating)),
    cash_out: Math.abs(Math.min(0, Number(row.operating))),
    net_cash: Number(row.net_change),
    cumulative_cash: Number(row.net_change),
  }));

  const expenseByAccount = new Map<string, { amount: number; count: number }>();
  for (const line of tables.expense_lines ?? []) {
    const code = accountCodeById(tables, String(line.account_id ?? '')) ?? 'Uncategorised';
    const current = expenseByAccount.get(code) ?? { amount: 0, count: 0 };
    current.amount += Number(line.line_total ?? 0);
    current.count += 1;
    expenseByAccount.set(code, current);
  }

  const revenueByCustomer = new Map<string, number>();
  for (const invoice of invoices) {
    const name = contacts.get(String(invoice.contact_id)) ?? 'Unknown customer';
    revenueByCustomer.set(name, (revenueByCustomer.get(name) ?? 0) + Number(invoice.subtotal ?? 0));
  }
  const totalRevenue = [...revenueByCustomer.values()].reduce((s, v) => s + v, 0) || 1;

  return ok({
    generated_at: new Date().toISOString(),
    company: {
      id: DEMO_BUSINESS_ID,
      name: String(business?.name ?? 'Demo business'),
      currency: String(business?.base_currency ?? 'MWK'),
      vat_registered: Boolean(business?.vat_registered),
      financial_year_start: String(business?.financial_year_start ?? '01-01'),
    },
    kpis: {
      period_start: iso(monthStart),
      period_end: iso(now),
      revenue_mtd: revenueMtd,
      expenses_mtd: expensesMtd,
      net_profit_mtd: revenueMtd - expensesMtd,
      profit_margin_pct: revenueMtd > 0 ? ((revenueMtd - expensesMtd) / revenueMtd) * 100 : null,
      cash_balance: cashBalance(tables),
      receivables_total: open.reduce((s, i) => s + Number(i.amount_due ?? 0), 0),
      overdue_total: overdue.reduce((s, i) => s + Number(i.amount_due ?? 0), 0),
      open_invoice_count: open.length,
      payables_total: expenses
        .filter((e) => String(e.status) !== 'paid')
        .reduce((s, e) => s + Number(e.total_amount ?? 0) - Number(e.amount_paid ?? 0), 0),
      avg_days_to_pay: 12,
      expense_ratio_pct: revenueMtd > 0 ? (expensesMtd / revenueMtd) * 100 : null,
    },
    monthlyTrend,
    overdueInvoices: overdue.map((i) => ({
      invoice_id: String(i.id),
      invoice_number: String(i.invoice_number),
      customer: contacts.get(String(i.contact_id)) ?? 'Unknown customer',
      amount_outstanding: Number(i.amount_due ?? 0),
      issue_date: String(i.issue_date),
      due_date: String(i.due_date ?? ''),
      days_overdue: Math.max(
        0,
        Math.floor((now.getTime() - new Date(String(i.due_date)).getTime()) / 86_400_000),
      ),
    })),
    topExpenses: [...expenseByAccount.entries()]
      .map(([code, v]) => ({
        category: accountNameByCode(tables, code) ?? code,
        account_code: code,
        amount: v.amount,
        document_count: v.count,
        period_days: 180,
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6),
    topCustomers: [...revenueByCustomer.entries()]
      .map(([name, revenue]) => ({ customer: name, revenue, invoice_count: 1 }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5),
    concentration: [...revenueByCustomer.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 1)
      .map(([name, revenue]) => ({
        customer: name,
        revenue,
        share_pct: (revenue / totalRevenue) * 100,
      }))[0] ?? {},
    anomalies: [],
    receivableSchedule: [],
    payableSchedule: [],
  });
}

function accountNameByCode(tables: DemoTables, code: string): string | null {
  const account = (tables.accounts ?? []).find((a) => a.code === code);
  return account ? String(account.name) : null;
}

function cashBalance(tables: DemoTables): number {
  const trial = computeDemoView('v_trial_balance', tables);
  const cashCodes = new Set(['1110', '1115', '1121', '1122', '1123', '1124', '1125', '1126']);
  return trial
    .filter((row) => cashCodes.has(String(row.code)))
    .reduce((sum, row) => sum + Number(row.balance ?? 0), 0);
}

// ── Auth ─────────────────────────────────────────────────────────────────────

class DemoAuth {
  private listeners = new Set<Listener>();

  getSession() {
    return Promise.resolve({ data: { session: demoSession() }, error: null });
  }

  getUser() {
    return Promise.resolve({ data: { user: demoUser() }, error: null });
  }

  getClaims() {
    return Promise.resolve({ data: null, error: null });
  }

  onAuthStateChange(callback: Listener) {
    this.listeners.add(callback);
    // Supabase fires an initial event for the current session; mirror that so
    // listeners (Sentry, session-only markers) behave as they do in prod.
    queueMicrotask(() => callback('SIGNED_IN', demoSession()));
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            this.listeners.delete(callback);
          },
          id: demoUuid('auth-sub', this.listeners.size),
          callback,
        },
      },
    };
  }

  /** Notify listeners — used when demo mode is entered or exited. */
  emit(event: string, session: DemoSession | null): void {
    for (const listener of [...this.listeners]) listener(event, session);
  }

  signOut() {
    // Signing out of the demo leaves demo mode entirely: the flag flips, the
    // store is purged and the app is back at the login screen. Imported lazily
    // to keep client.ts free of a hard dependency on the session module.
    void import('./session').then(({ exitDemoMode }) => exitDemoMode());
    return Promise.resolve({ error: null });
  }

  signInWithPassword(credentials: { email: string; password: string }) {
    if (String(credentials.email).toLowerCase() === DEMO_EMAIL) {
      const session = demoSession();
      this.emit('SIGNED_IN', session);
      return Promise.resolve({ data: { user: session.user, session }, error: null });
    }
    return Promise.resolve({
      data: { user: null, session: null },
      error: {
        message: 'The demo only signs in demo@ledgr.test. Use "Exit demo" to sign in to your own account.',
        code: 'invalid_credentials',
        status: 400,
      },
    });
  }

  signInWithOtp() {
    return Promise.resolve({
      data: null,
      error: { message: DEMO_MODE_NOTICE, code: 'demo_not_supported', status: 400 },
    });
  }

  signUp() {
    return Promise.resolve({
      data: { user: null, session: null },
      error: { message: DEMO_MODE_NOTICE, code: 'demo_not_supported', status: 400 },
    });
  }

  resetPasswordForEmail() {
    return Promise.resolve({
      data: null,
      error: { message: DEMO_MODE_NOTICE, code: 'demo_not_supported', status: 400 },
    });
  }

  updateUser() {
    return Promise.resolve({
      data: { user: demoUser() },
      error: { message: DEMO_MODE_NOTICE, code: 'demo_not_supported', status: 400 },
    });
  }

  verifyOtp() {
    return Promise.resolve({
      data: { user: null, session: null },
      error: { message: DEMO_MODE_NOTICE, code: 'demo_not_supported', status: 400 },
    });
  }

  exchangeCodeForSession() {
    return Promise.resolve({
      data: { user: null, session: null },
      error: { message: DEMO_MODE_NOTICE, code: 'demo_not_supported', status: 400 },
    });
  }

  setSession() {
    return Promise.resolve({ data: { session: demoSession(), user: demoUser() }, error: null });
  }

  refreshSession() {
    const session = demoSession();
    return Promise.resolve({ data: { session, user: session.user }, error: null });
  }

  mfa = {
    listFactors: () => Promise.resolve({ data: { all: [], totp: [] }, error: null }),
    getAuthenticatorAssuranceLevel: () =>
      Promise.resolve({ data: { currentLevel: null, nextLevel: null, currentAuthenticationMethods: [] }, error: null }),
    enroll: () =>
      Promise.resolve({ data: null, error: { message: DEMO_MODE_NOTICE, code: 'demo_not_supported' } }),
    challenge: () =>
      Promise.resolve({ data: null, error: { message: DEMO_MODE_NOTICE, code: 'demo_not_supported' } }),
    verify: () =>
      Promise.resolve({ data: null, error: { message: DEMO_MODE_NOTICE, code: 'demo_not_supported' } }),
    unenroll: () =>
      Promise.resolve({ data: null, error: { message: DEMO_MODE_NOTICE, code: 'demo_not_supported' } }),
  };

  admin = {
    listUsers: () => Promise.resolve({ data: { users: [demoUser()] }, error: null }),
  };
}

// ── Edge Functions ───────────────────────────────────────────────────────────

const TEAM_MEMBER = {
  id: DEMO_USER_ID,
  user_id: DEMO_USER_ID,
  email: DEMO_EMAIL,
  full_name: DEMO_USER_NAME,
  role: DEMO_ROLE,
  is_active: true,
  invited_at: null,
  accepted_at: new Date().toISOString(),
  last_seen_at: new Date().toISOString(),
};

async function invokeFunction(name: string, body: unknown): Promise<DemoRpcResponse> {
  const tables = getDemoTables();
  switch (name) {
    case 'list-team-members':
      return ok({ members: [TEAM_MEMBER], count: 1 });
    case 'export-my-data':
      // Genuinely useful in the demo: hand back the visitor's own snapshot.
      return ok({ exported_at: new Date().toISOString(), demo: true, tables });
    case 'webhook-dispatcher':
      return ok({ dispatched: 0, skipped: true, demo: true });
    case 'suggest-bank-matches':
      return ok({ matches: [] });
    case 'invite-team-member':
    case 'create-invite-link':
    case 'accept-invite-link':
    case 'create-api-key':
    case 'request-account-deletion':
    case 'cancel-account-deletion':
    case 'send-invoice':
    case 'initiate-subscription-payment':
    case 'verify-subscription-payment':
      return { data: null, error: { message: DEMO_MODE_NOTICE, status: 403 } } as DemoRpcResponse;
    default:
      return ok({ demo: true, function: name, body: body ?? null });
  }
}

// ── Storage ──────────────────────────────────────────────────────────────────

class DemoStorageBucket {
  private static uploads = new Map<string, string>();
  private readonly bucket: string;

  constructor(bucket: string) {
    this.bucket = bucket;
  }

  private key(path: string): string {
    return `${this.bucket}/${path}`;
  }

  upload(path: string, file: unknown): Promise<{ data: { path: string } | null; error: unknown }> {
    const dataUrlPromise = readAsDataUrl(file);
    return dataUrlPromise.then((dataUrl) => {
      if (dataUrl) DemoStorageBucket.uploads.set(this.key(path), dataUrl);
      return { data: { path }, error: null };
    });
  }

  getPublicUrl(path: string): { data: { publicUrl: string } } {
    return {
      data: {
        publicUrl:
          DemoStorageBucket.uploads.get(this.key(path)) ??
          `demo://storage/${this.bucket}/${path}`,
      },
    };
  }

  createSignedUrl(path: string): Promise<{ data: { signedUrl: string } | null; error: unknown }> {
    return Promise.resolve({
      data: { signedUrl: DemoStorageBucket.uploads.get(this.key(path)) ?? `demo://storage/${this.bucket}/${path}` },
      error: null,
    });
  }

  list(): Promise<{ data: DemoRow[]; error: null }> {
    return Promise.resolve({ data: [], error: null });
  }

  download(path: string): Promise<{ data: Blob | null; error: unknown }> {
    const url = DemoStorageBucket.uploads.get(this.key(path));
    if (!url) return Promise.resolve({ data: null, error: { message: 'Object not found (demo)' } });
    return Promise.resolve({ data: new Blob([url], { type: 'text/plain' }), error: null });
  }

  remove(paths: string[]): Promise<{ data: unknown; error: null }> {
    paths.forEach((p) => DemoStorageBucket.uploads.delete(this.key(p)));
    return Promise.resolve({ data: null, error: null });
  }
}

function readAsDataUrl(file: unknown): Promise<string | null> {
  if (typeof FileReader === 'undefined') return Promise.resolve(null);
  if (file instanceof Blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }
  return Promise.resolve(null);
}

// ── IC 2026-09-25: demo emulation of the containment commands ───────────────
// record_invoice_payment / record_expense_payment (P6), create_invoice_with_lines
// (P7) and pos_stock_availability (P4). Same contracts as the SQL functions:
// replay by client key, validation, one location for POS stock.

function recordPaymentDemo(
  tables: DemoTables,
  kind: 'invoice' | 'expense',
  args: { p_payment?: DemoRow; p_client_key?: string },
): DemoRpcResponse {
  const payment = (args.p_payment ?? {}) as DemoRow;
  const docTable = kind === 'invoice' ? 'invoices' : 'expenses';
  const payTable = kind === 'invoice' ? 'invoice_payments' : 'expense_payments';
  const docKey = kind === 'invoice' ? 'invoice_id' : 'expense_id';
  const doc = (tables[docTable] ?? []).find((r) => r.id === payment[docKey]);
  if (!doc) return fail(`${kind} not found`, '42501', 403);
  const existing = (tables[payTable] ?? []).find(
    (r) => r.business_id === doc.business_id && r.client_key === args.p_client_key,
  );
  if (existing) return ok({ payment: existing, [kind]: doc, journal_entry_id: null, idempotent: true });
  const amount = Number(payment.amount ?? 0);
  if (!(amount > 0)) return fail('Enter a valid payment amount.', '23514');
  if (doc.status === 'void' || doc.status === 'credit_note') {
    return fail(`Cannot record a payment against a ${String(doc.status)} ${kind}.`, '23514');
  }
  if (amount > Number(doc.total_amount ?? 0) - Number(doc.amount_paid ?? 0) + 0.01) {
    return fail('Payment exceeds the outstanding balance.', '23514');
  }
  const nowIso = new Date().toISOString();
  const row: DemoRow = {
    ...payment,
    id: demoUuid(payTable, `${String(args.p_client_key)}-${nowIso}`),
    business_id: doc.business_id,
    [docKey]: doc.id,
    client_key: args.p_client_key ?? null,
    created_at: nowIso,
  };
  (tables[payTable] ??= []).push(row);
  const inc = incrementAmountPaid(tables, { p_table: docTable, p_id: String(doc.id), p_amount: amount });
  if (inc.error) return inc;
  return ok({ payment: row, [kind]: inc.data, journal_entry_id: null, idempotent: false });
}

function createInvoiceWithLinesDemo(
  tables: DemoTables,
  args: { p_invoice?: DemoRow; p_lines?: DemoRow[]; p_client_key?: string | null },
): DemoRpcResponse {
  const header = { ...((args.p_invoice ?? {}) as DemoRow) };
  const businessId = String(header.business_id ?? DEMO_BUSINESS_ID);
  if (args.p_client_key) {
    const existing = (tables.invoices ?? []).find(
      (r) => r.business_id === businessId && r.client_key === args.p_client_key,
    );
    if (existing) {
      const lines = (tables.invoice_lines ?? []).filter((l) => l.invoice_id === existing.id);
      return ok({ invoice: existing, lines, idempotent: true });
    }
  }
  const number = String(header.invoice_number ?? '');
  if (!number || number.startsWith('INV-OFFLINE-')) header.invoice_number = nextDocumentNumber(tables, 'invoice');
  const nowIso = new Date().toISOString();
  const invoice: DemoRow = {
    id: demoUuid('invoice', `rpc-${nowIso}`),
    amount_paid: 0,
    deleted_at: null,
    created_at: nowIso,
    updated_at: nowIso,
    ...header,
    business_id: businessId,
    client_key: args.p_client_key ?? null,
  };
  (tables.invoices ??= []).push(invoice);
  const lines = (args.p_lines ?? []).map((l, i) => ({
    id: demoUuid('invoice_line', `rpc-${nowIso}-${i}`),
    ...l,
    invoice_id: invoice.id,
    business_id: businessId,
  }));
  (tables.invoice_lines ??= []).push(...lines);
  markDemoStateChanged();
  return ok({ invoice, lines, idempotent: false });
}

function posStockAvailabilityDemo(
  tables: DemoTables,
  args: { p_business_id?: string; p_branch_id?: string | null },
): DemoRpcResponse {
  const locations = (tables.inventory_locations ?? []).filter((l) => l.business_id === args.p_business_id);
  // Owner decision 2026-09-26 (mirrors 20261013000000): a branch sells from its
  // OWN location only; the default/first fallback applies to branch-less tills.
  const location = args.p_branch_id
    ? locations.find((l) => l.branch_id === args.p_branch_id) ?? null
    : locations.find((l) => l.is_default) ?? locations[0] ?? null;
  return ok({
    business_id: args.p_business_id,
    branch_id: args.p_branch_id ?? null,
    location: location ? { id: location.id, name: location.name, branch_id: location.branch_id ?? null } : null,
    is_fallback: !!location && args.p_branch_id == null && location.branch_id != null,
    branch_location_missing: !!args.p_branch_id && !location,
    balances: location
      ? (tables.inventory_balances ?? [])
          .filter((b) => b.location_id === location.id)
          .map((b) => ({ product_id: b.product_id, quantity_on_hand: Number(b.quantity_on_hand ?? 0) }))
      : [],
  });
}

// ── The client ───────────────────────────────────────────────────────────────

export const demoAuth = new DemoAuth();

export const demoClient = {
  from(table: string) {
    return new DemoQueryBuilder(table, getDemoTables());
  },

  rpc(name: string, args: Record<string, unknown> = {}): Promise<DemoRpcResponse> {
    const tables = getDemoTables();
    switch (name) {
      case 'increment_amount_paid':
        return Promise.resolve(
          incrementAmountPaid(tables, args as { p_table?: string; p_id?: string; p_amount?: number }),
        );
      case 'reserve_next_document_number':
        return Promise.resolve(
          ok(nextDocumentNumber(tables, (args.p_kind as 'invoice' | 'expense' | 'payroll') ?? 'invoice')),
        );
      case 'record_invoice_payment':
        return Promise.resolve(recordPaymentDemo(tables, 'invoice', args as { p_payment?: DemoRow; p_client_key?: string }));
      case 'record_expense_payment':
        return Promise.resolve(recordPaymentDemo(tables, 'expense', args as { p_payment?: DemoRow; p_client_key?: string }));
      case 'create_invoice_with_lines':
        return Promise.resolve(createInvoiceWithLinesDemo(tables, args as { p_invoice?: DemoRow; p_lines?: DemoRow[]; p_client_key?: string | null }));
      case 'record_sale_stock_and_cogs':
        // HARDENING 2026-09-26: demo mode keeps no perpetual-inventory ledger;
        // acknowledge the atomic command without side effects.
        return Promise.resolve(ok({ idempotent: false, cogs_entry_id: null, cogs_missing: false, cost_lines: [] }));
      case 'pos_stock_availability':
        return Promise.resolve(posStockAvailabilityDemo(tables, args as { p_business_id?: string; p_branch_id?: string | null }));
      case 'close_accounting_period':
      case 'reopen_accounting_period': {
        // Owner decision 2026-09-26: period status changes only through these commands.
        const closing = name === 'close_accounting_period';
        const period = (tables.accounting_periods ?? []).find((p) => p.id === args.p_period_id);
        if (!period) return Promise.resolve(fail('Period not found.', '42501', 403));
        period.is_closed = closing;
        period.closed_at = closing ? new Date().toISOString() : null;
        markDemoStateChanged();
        return Promise.resolve(ok({ period_id: period.id, is_closed: closing, draft_invoices_in_period: 0 }));
      }
      case 'next_journal_entry_number':
        return Promise.resolve(ok(nextJournalEntryNumber(tables)));
      case 'save_quick_sale':
        return Promise.resolve(quickSave(tables, 'sale', (args.p_payload as DemoRow) ?? {}));
      case 'save_quick_expense':
        return Promise.resolve(quickSave(tables, 'expense', (args.p_payload as DemoRow) ?? {}));
      case 'ai_context':
        return Promise.resolve(aiContext(tables));
      case 'list_all_businesses':
        return Promise.resolve(ok(tables.businesses ?? []));
      case 'backfill_and_recalculate_inventory':
        // IC 2026-09-25 P2: contained server-side (EXECUTE revoked) — mirror it.
        return Promise.resolve(fail('permission denied for function backfill_and_recalculate_inventory', '42501', 403));
      case 'invite_member':
      case 'accept_invitation':
      case 'add_partner_admin':
      case 'remove_partner_admin':
      case 'clear_partner_admins':
        return Promise.resolve(fail(DEMO_MODE_NOTICE, 'demo_not_supported', 403));
      case 'list_partner_admins':
        return Promise.resolve(ok([]));
      default:
        // Unknown function: succeed with null so callers fall back to their
        // legacy paths instead of showing an error in a demo.
        return Promise.resolve(ok(null));
    }
  },

  auth: demoAuth,

  functions: {
    invoke(name: string, options?: { body?: unknown }) {
      return invokeFunction(name, options?.body);
    },
  },

  storage: {
    from(bucket: string) {
      return new DemoStorageBucket(bucket);
    },
  },

  channel(topic: string) {
    const channel = {
      topic,
      on: () => channel,
      subscribe: (cb?: (status: string) => void) => {
        cb?.('SUBSCRIBED');
        return channel;
      },
      unsubscribe: () => Promise.resolve('ok'),
      send: () => Promise.resolve('ok'),
      off: () => channel,
    };
    return channel;
  },

  removeChannel() {
    return Promise.resolve('ok');
  },

  /** Demo-only helpers (not part of the Supabase API). */
  demo: {
    resetData: resetDemoData,
  },
};

export type DemoClient = typeof demoClient;
