/**
 * R05 — Financial command and database invariants: verification-only suite.
 *
 * The package's release surface contains no failing expectations: the four
 * anchored financial invariants (FINANCE.ORACLE/POSTING-TOTALS/NONPOS-INCOME
 * and POS.SALE replay/effects) already PASS, and FINANCE.REVERSAL stays
 * BLOCKED pending the approved canonical reversal/command contract (R07,
 * DEC-04 lineage — no substitute command may be invented).
 *
 * This suite verifies, with deterministic synthetic fixtures, the invariants
 * the existing migration chain ACTUALLY enforces at the database boundary —
 * each statement names its enforcing migration. Denials assert the real
 * SQLSTATE raised by the guard (never "any failure").
 *
 * Methodology (harness-consistent): the migration-replay ACL grants DML only
 * to the four master-data tables, so tenant-facing financial tables are
 * write-closed to roles without a SECURITY DEFINER command (the ledger
 * write-closure proof below shows this directly). Behavioural probes of
 * constraints and triggers therefore run from the privileged-observer
 * position inside the same rolled-back transaction (`reset role`), using
 * savepoints so every expected denial returns the transaction to a clean
 * state. Observer probes exercise constraints/triggers only; every probe
 * rolls back; fixture immutability is proven afterwards by exact counts.
 *
 * Enforced today (verified here):
 *   • ledger write-closure + posting-key uniqueness  20260921000000 / ACL boundary
 *   • payment guards on void/credit-note documents   20260813000002 (22023)
 *   • non-negative quantity/price constraints        20260817000001 (23514)
 *   • atomic document-number reservation + gating    20260728000011 (42501/22023)
 *   • journal-entry number sequence                  20260820000000
 *   • locked bank-statement line immutability        20260725000000 (P0001)
 * Documented as NOT yet enforced at DB boundary (report findings only — no
 * migrations added): universal deferred journal balance invariant, general
 * accounting-period lock, server-derived audit actor; these belong to the
 * approval-gated R05/DEC-04 programme.
 */
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, DAY } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

const test = evidenceSuite('r05-finance');
const OBS = 'real PostgreSQL17 full migration replay; synthetic identities; behavioural probes from privileged observer position inside rolled-back transaction with savepoint isolation (constraints/triggers only); no migrations added by R05';
const meta = (id: string, expected: string, source: string) => ({
  id, expected, remediation: 'R05', source, layer: OBS,
});
const M_IDEM = 'supabase/migrations/20260921000000_journal_posting_key_idempotency.sql';
const M_GUARD = 'supabase/migrations/20260813000002_block_payments_on_cancelled_documents.sql';
const M_NONEG = 'supabase/migrations/20260817000001_phase10_nonneg_quantity_checks.sql';
const M_NUM = 'supabase/migrations/20260728000011_reserve_document_number_rpc.sql';
const M_JNUM = 'supabase/migrations/20260820000000_ops_hardening_runtime.sql';
const M_BANK = 'supabase/migrations/20260725000000_bank_reconciliation.sql';

let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let replayError = '';
let seedError = '';
beforeAll(async () => {
  try { db = await createDatabaseFixture(); }
  catch (e) { replayError = String((e as Error).message).startsWith('Migration ') ? (e as Error).message : safeError(e); return; }
  try { orgs = await seedFixture(db.client); }
  catch (e) { seedError = safeError(e); }
});
afterAll(async () => { if (db) await db.cleanup(); });
function ready() {
  if (!db) throw new Blocked(`Database bootstrap/replay unavailable: ${replayError}`);
  if (!orgs) throw new Blocked(`Synthetic fixture setup unavailable: ${seedError}`);
}

type C = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

/** Denial expectation outside any open transaction (statement-level probes). */
async function deniedSimple(run: () => Promise<unknown>, codes: string[], messageRx?: RegExp) {
  let caught: { code?: string; message?: string } | undefined;
  try { await run(); } catch (e) { caught = e as { code?: string; message?: string }; }
  if (!caught) throw new Error('Invariant probe completed without the expected denial.');
  expect(codes).toContain(caught.code);
  if (messageRx) expect(caught.message).toMatch(messageRx);
}

/**
 * Denial expectation inside an open transaction: a failed statement leaves
 * the transaction aborted, so each probe runs under a savepoint that is
 * rolled back after the denial is observed.
 */
async function deniedInTx(c: C, run: () => Promise<unknown>, codes: string[], messageRx?: RegExp) {
  if (!deniedInTx.sp) deniedInTx.sp = 0;
  const sp = `sp_r05_${++deniedInTx.sp}`;
  await c.query(`savepoint ${sp}`);
  let caught: { code?: string; message?: string } | undefined;
  try { await run(); } catch (e) { caught = e as { code?: string; message?: string }; }
  await c.query(`rollback to savepoint ${sp}`);
  if (!caught) throw new Error('Invariant probe completed without the expected denial.');
  expect(codes).toContain(caught.code);
  if (messageRx) expect(caught.message).toMatch(messageRx);
}
deniedInTx.sp = 0;

const insertJournalEntry = (c: C, business: string, key: string | null, entryNumber: string) =>
  c.query('insert into public.journal_entries(business_id,currency,description,entry_date,entry_number,exchange_rate,status,posting_key) values($1,$2,$3,$4,$5,$6,$7,$8)',
    [business, 'MWK', 'R13 R05 invariant probe', DAY, entryNumber, 1, 'posted', key]);

const insertInvoice = async (c: C, business: string, contact: string, number: string, status: string) =>
  (await c.query(`insert into public.invoices(business_id,invoice_number,contact_id,invoice_type,status,issue_date,currency,exchange_rate,subtotal,taxable_amount,discount_percent,discount_amount,vat_amount,wht_amount,total_amount,amount_paid)
    values($1,$2,$3,'invoice',$4,$5,'MWK',1,1500,1500,0,0,0,0,1500,$6) returning id`,
    [business, number, contact, status, DAY, status === 'paid' ? 1500 : 0])).rows[0].id as string;

const insertInvoicePayment = (c: C, business: string, invoiceId: string, clientKey: string) =>
  c.query("insert into public.invoice_payments(business_id,invoice_id,amount,payment_method,currency,exchange_rate,payment_date,client_key) values($1,$2,1500,'cash','MWK',1,$3,$4)",
    [business, invoiceId, DAY, clientKey]);

const insertExpense = async (c: C, business: string, contact: string, number: string, status: string, amountPaid: number) =>
  (await c.query(`insert into public.expenses(business_id,expense_number,expense_type,status,expense_date,currency,exchange_rate,subtotal,total_amount,amount_paid,vat_amount,wht_amount,contact_id)
    values($1,$2,'receipt',$3,$4,'MWK',1,200,200,$5,0,0,$6) returning id`,
    [business, number, status, DAY, amountPaid, contact])).rows[0].id as string;

const insertExpensePayment = (c: C, business: string, expenseId: string, clientKey: string) =>
  c.query("insert into public.expense_payments(business_id,expense_id,amount,payment_method,currency,exchange_rate,payment_date,client_key) values($1,$2,200,'card','MWK',1,$3,$4)",
    [business, expenseId, DAY, clientKey]);

const insertInvoiceLine = (c: C, business: string, invoiceId: string, qty: number, price: number) =>
  c.query("insert into public.invoice_lines(business_id,invoice_id,line_number,description,quantity,unit_price,tax_code,tax_rate,discount_percent,tax_amount,line_total) values($1,$2,1,'R13 invariant probe',$3,$4,'none',0,0,0,$5)",
    [business, invoiceId, qty, price, qty * price]);

test(meta('R05.FINANCE.POSTING-KEY-UNIQUE', 'Ledger is write-closed to app roles (owner direct INSERT denied 42501: commands only); observer proves the (business_id,posting_key) replay unique index rejects identical replay (23505) while null keys, new keys, and other tenants stay free', M_IDEM), async () => {
  ready();
  await deniedSimple(() => db.asRole('authenticated', identities.A_owner.id,
    'insert into public.journal_entries(business_id,currency,description,entry_date,entry_number,exchange_rate,status) values($1,$2,$3,$4,$5,$6,$7)',
    [orgs.A.business, 'MWK', 'R13 direct-DML probe', DAY, 'JNL-R13-DIRECT', 1, 'posted']), ['42501']);
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await c.query('reset role');
    await insertJournalEntry(c, orgs.A.business, 'r13-r05-replay-key', 'JNL-R13-1');
    await deniedInTx(c, () => insertJournalEntry(c, orgs.A.business, 'r13-r05-replay-key', 'JNL-R13-2'), ['23505']);
    await insertJournalEntry(c, orgs.A.business, 'r13-r05-distinct-key', 'JNL-R13-2');
    await insertJournalEntry(c, orgs.B.business, 'r13-r05-replay-key', 'JNL-R13-3');
    await insertJournalEntry(c, orgs.A.business, null, 'JNL-R13-4');
  });
  const idx = await db.client.query("select indexdef from pg_indexes where schemaname='public' and indexname='journal_entries_posting_key_uidx'");
  expect(idx.rows.length).toBe(1);
  expect(idx.rows[0].indexdef as string).toContain('UNIQUE INDEX');
  expect(idx.rows[0].indexdef as string).toContain('posting_key');
  expect((await db.client.query('select count(*)::int n from public.journal_entries')).rows[0].n).toBe(0);
});

test(meta('R05.FINANCE.CANCELLED-INVOICE-PAYMENT', 'Payment on a void or credit-note invoice is rejected by the status guard trigger (22023); a paid invoice accepts payment', M_GUARD), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await c.query('reset role');
    const paid = await insertInvoice(c, orgs.A.business, orgs.A.customer, 'INV-R13-CTRL', 'paid');
    await insertInvoicePayment(c, orgs.A.business, paid, 'a0000000-0000-4000-8000-000000000001');
    const voided = await insertInvoice(c, orgs.A.business, orgs.A.customer, 'INV-R13-VOID', 'void');
    await deniedInTx(c, () => insertInvoicePayment(c, orgs.A.business, voided, 'a0000000-0000-4000-8000-000000000002'), ['22023'], /void/);
    const creditNote = await insertInvoice(c, orgs.A.business, orgs.A.customer, 'INV-R13-CN', 'credit_note');
    await deniedInTx(c, () => insertInvoicePayment(c, orgs.A.business, creditNote, 'a0000000-0000-4000-8000-000000000003'), ['22023'], /credit_note/);
  });
  expect((await db.client.query('select count(*)::int n from public.invoice_payments')).rows[0].n).toBe(0);
});

test(meta('R05.FINANCE.VOID-EXPENSE-PAYMENT', 'Payment on a void expense is rejected by the status guard trigger (22023); a paid expense accepts payment', M_GUARD), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await c.query('reset role');
    const ok = await insertExpense(c, orgs.A.business, orgs.A.customer, 'EXP-R13-CTRL', 'paid', 200);
    await insertExpensePayment(c, orgs.A.business, ok, 'b0000000-0000-4000-8000-000000000001');
    const voided = await insertExpense(c, orgs.A.business, orgs.A.customer, 'EXP-R13-VOID', 'void', 0);
    await deniedInTx(c, () => insertExpensePayment(c, orgs.A.business, voided, 'b0000000-0000-4000-8000-000000000002'), ['22023'], /void expense/);
  });
  expect((await db.client.query('select count(*)::int n from public.expense_payments')).rows[0].n).toBe(0);
});

test(meta('R05.FINANCE.NONEG-LINES', 'Non-negative quantity/price/balance constraints reject bad new writes (23514); all ten phase-10 constraints are present in the catalog', M_NONEG), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await c.query('reset role');
    const invId = await insertInvoice(c, orgs.A.business, orgs.A.customer, 'INV-R13-NN', 'draft');
    await insertInvoiceLine(c, orgs.A.business, invId, 1, 1500);
    await deniedInTx(c, () => insertInvoiceLine(c, orgs.A.business, invId, -1, 1500), ['23514']);
    await deniedInTx(c, () => insertInvoiceLine(c, orgs.A.business, invId, 1, -5), ['23514']);
    await deniedInTx(c, () => c.query('update public.inventory_balances set quantity_on_hand=-1 where business_id=$1 and product_id=$2 and location_id=$3', [orgs.A.business, orgs.A.product, orgs.A.location]), ['23514']);
    expect(Number((await c.query('select quantity_on_hand from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3', [orgs.A.business, orgs.A.product, orgs.A.location])).rows[0].quantity_on_hand)).toBe(100);
  });
  const constraints = await db.client.query("select conname from pg_constraint where connamespace='public'::regnamespace and (conname like 'chk\\_%\\_nonneg' or conname='chk_stock_movements_quantity_nonzero')");
  expect(constraints.rows.length).toBe(10);
});

test(meta('R05.FINANCE.NUMBER-RESERVATION', 'Document numbers reserve atomically and distinctly per kind; viewer denied; payroll gated to payroll roles; unknown kind rejected', M_NUM), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const n1 = (await c.query('select public.reserve_next_document_number($1,$2) n', [orgs.A.business, 'invoice'])).rows[0].n as string;
    const n2 = (await c.query('select public.reserve_next_document_number($1,$2) n', [orgs.A.business, 'invoice'])).rows[0].n as string;
    const e1 = (await c.query('select public.reserve_next_document_number($1,$2) n', [orgs.A.business, 'expense'])).rows[0].n as string;
    expect(n1).toMatch(/^INV/); expect(n2).toMatch(/^INV/); expect(e1).toMatch(/^EXP/);
    expect(new Set([n1, n2, e1]).size).toBe(3);
    await deniedInTx(c, () => c.query('select public.reserve_next_document_number($1,$2)', [orgs.A.business, 'nonsense']), ['22023']);
  });
  await deniedSimple(() => db.asRole('authenticated', identities.A_viewer.id,
    'select public.reserve_next_document_number($1,$2)', [orgs.A.business, 'invoice']), ['42501']);
  await deniedSimple(() => db.asRole('authenticated', identities.A_branch_manager.id,
    'select public.reserve_next_document_number($1,$2)', [orgs.A.business, 'payroll']), ['42501']);
});

test(meta('R05.FINANCE.JOURNAL-NUMBER-UNIQUENESS', 'JNL numbers form a per-day sequence and never repeat within it', M_JNUM), async () => {
  ready();
  const r = await db.asRole('authenticated', identities.A_owner.id, async (c: C) => ({
    a: (await c.query('select public.next_journal_entry_number($1) n', [orgs.A.business])).rows[0].n as string,
    b: (await c.query('select public.next_journal_entry_number($1) n', [orgs.A.business])).rows[0].n as string,
  }));
  expect(r.a).toMatch(/^JNL-\d{8}-\d{6}$/);
  expect(r.b).toMatch(/^JNL-\d{8}-\d{6}$/);
  expect(r.a).not.toBe(r.b);
});

test(meta('R05.FINANCE.BANK-LINE-LOCK', 'A locked bank statement rejects changes to an existing line (update and delete) with the locked-period error; unlocked rows remain changeable', M_BANK), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await c.query('reset role');
    const account = (await c.query('select id from public.accounts where business_id=$1 order by code limit 1', [orgs.A.business])).rows[0].id as string;
    const stmt = (await c.query("insert into public.bank_statements(business_id,account_id,statement_date,opening_balance,closing_balance,source) values($1,$2,$3,0,0,'R13 invariant probe') returning id", [orgs.A.business, account, DAY])).rows[0].id as string;
    const lineId = (await c.query("insert into public.bank_statement_lines(business_id,statement_id,description,debit_amount,credit_amount,is_reconciled,transaction_date) values($1,$2,'R13 probe line',0,0,false,$3) returning id", [orgs.A.business, stmt, DAY])).rows[0].id;
    await c.query('update public.bank_statement_lines set description=$1 where id=$2', ['R13 probe line edited', lineId]);
    await c.query('update public.bank_statements set is_locked=true where id=$1', [stmt]);
    await deniedInTx(c, () => c.query('update public.bank_statement_lines set debit_amount=1 where id=$1', [lineId]), ['P0001'], /locked/);
    await deniedInTx(c, () => c.query('delete from public.bank_statement_lines where id=$1', [lineId]), ['P0001'], /locked/);
  });
  expect((await db.client.query('select count(*)::int n from public.bank_statements')).rows[0].n).toBe(0);
});

test(meta('R05.FINANCE.DATA-UNCHANGED', 'All invariant probes roll back: fixture financial tables stay empty and identity data unchanged', M_IDEM), async () => {
  ready();
  const q = (t: string) => db.client.query(`select count(*)::int n from public.${t}`).then((r: { rows: Array<{ n: number }> }) => r.rows[0].n);
  expect(await q('journal_entries')).toBe(0);
  expect(await q('invoices')).toBe(0);
  expect(await q('invoice_payments')).toBe(0);
  expect(await q('expense_payments')).toBe(0);
  expect(await q('bank_statements')).toBe(0);
  expect(await q('contacts')).toBe(2);
  expect(await q('business_users')).toBe(14);
});
