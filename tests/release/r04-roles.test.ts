/**
 * R04 — Tenant/role enforcement verification suite.
 *
 * Scope: cashier and stock_clerk may not read or directly mutate the general
 * ledger, budgets or bank statements through PostgREST. Cashier sales remain
 * available through the scoped sales-invoice path and SECURITY DEFINER
 * post_pos_sale command. Existing contacts writer controls remain covered.
 *
 * Coverage: seeded-role write matrix, cross-organisation and anonymous
 * variants, preserved POS sale path, financial table read/write denial,
 * policy/ACL end state, no-over-narrowing read controls, and fixture-data
 * immutability. Every probe is isolated in the database harness.
 *
 * Supervisor coverage (20261225000000): a supervisor reads posted ledger
 * transactions, expenses, invoices and construction purchase orders of its own
 * business (never another tenant's) and still writes nothing — visibility is
 * not authority, and manual journal DML stays command-only.
 */
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, roles, saleFixture, enableRetailModel, DAY } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

const test = evidenceSuite('r04-roles');
const MIGRATION = 'supabase/migrations/20260927000001_r04_contacts_writer_scope.sql';
const FINANCIAL_MIGRATION = 'supabase/migrations/20261218000000_role_aware_financial_rls.sql';
const DB_LAYER = 'real PostgreSQL17 roles/RLS; synthetic identities; full migration replay';
const meta = (id: string, expected: string, source = MIGRATION, layer = DB_LAYER) => ({
  id, expected, remediation: 'R04', source, layer,
});

/** can_write_contacts_data = can_write_business_data minus cashier (17 roles). */
const MATRIX_ALLOWED = ['owner', 'admin', 'accountant', 'stock_clerk', 'branch_manager'];
const MATRIX_DENIED = ['cashier', 'viewer'];
const FULL_TIER = ['owner', 'admin', 'accountant', 'supervisor', 'data_entry',
  'inventory_manager', 'sales_clerk', 'purchasing_officer', 'warehouse_worker',
  'sales_manager', 'customer_service_rep', 'tax_compliance_officer',
  'treasury_manager', 'asset_manager', 'branch_manager', 'manager', 'stock_clerk'];

let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let replayError = '';
let seedError = '';
beforeAll(async () => {
  try { db = await createDatabaseFixture(); }
  catch (e) { replayError = String((e as Error).message).startsWith('Migration ') ? (e as Error).message : safeError(e); return; }
  try { orgs = await seedFixture(db.client);
    await enableRetailModel(db.client, orgs); }
  catch (e) { seedError = safeError(e); }
});
afterAll(async () => { if (db) await db.cleanup(); });
function ready() {
  if (!db) throw new Blocked(`Database bootstrap/replay unavailable: ${replayError}`);
  if (!orgs) throw new Blocked(`Synthetic fixture setup unavailable: ${seedError}`);
}

/** Denial with zero-leak semantics: genuine 42501, never a syntax/setup accident. */
async function denied42501(run: () => Promise<unknown>) {
  let caught: { code?: string; message?: string } | undefined;
  try { await run(); } catch (e) { caught = e as { code?: string; message?: string }; }
  if (!caught) throw new Error('Authorisation probe completed without the expected 42501 denial.');
  expect(caught.code).toBe('42501');
}

const insertContact = (org: string, uid: string) =>
  db.asRole('authenticated', uid,
    "insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt) values($1,'R13 R04 probe','customer',true,false) returning id",
    [orgs[org].business]);

const seededContactCount = () => db.client
  .query('select count(*)::int n from public.contacts')
  .then((r: { rows: Array<{ n: number }> }) => r.rows[0].n);

test(meta('R04.CONTACTS.WRITER-MATRIX', 'Seeded-role contacts INSERT matrix: cashier/viewer denied with 42501 and zero rows; all other seeded roles unchanged'), async () => {
  ready();
  for (const role of roles) {
    const uid = identities[`A_${role}`].id;
    if (MATRIX_DENIED.includes(role)) {
      await denied42501(() => insertContact('A', uid));
    } else {
      expect(MATRIX_ALLOWED).toContain(role); // matrix drift guard: only these may pass
      const r = await insertContact('A', uid);
      expect(r.rows).toHaveLength(1);
    }
  }
  // Triggered probes are rollbacks; seeded data untouched across the matrix.
  expect(await seededContactCount()).toBe(2);
});

test(meta('R04.CONTACTS.POS-SALE-PATH-PRESERVED', 'Cashier retains the authorised contact path: post_pos_sale resolves/creates the walk-in contact inside the SECURITY DEFINER command'), async () => {
  ready();
  const r = await db.asRole('authenticated', identities.A_cashier.id,
    'select public.post_pos_sale_plan_gated($1::jsonb) data', [JSON.stringify(saleFixture(orgs.A, 201))]);
  // The definer command posts a real document: id, server invoice number, and
  // balanced COGS/journal entries — the cashier's authorised contact path.
  const data = r.rows[0].data as Record<string, unknown>;
  expect(data).toBeTruthy();
  expect(data.id).toBeTruthy();
  expect(data.number).toMatch(/^INV-/);
  expect(data.journal_entry_id).toBeTruthy();
  expect(data.cogs_entry_id).toBeTruthy();
});

test(meta('R04.CONTACTS.CROSS-ORG', 'Caller-supplied foreign business id is denied for every role class; own scope unchanged in both directions'), async () => {
  ready();
  await denied42501(() => insertContact('B', identities.A_cashier.id));
  await denied42501(() => insertContact('B', identities.A_owner.id));
  await denied42501(() => insertContact('A', identities.B_owner.id));
  expect((await insertContact('A', identities.A_owner.id)).rows).toHaveLength(1);
  expect((await insertContact('B', identities.B_owner.id)).rows).toHaveLength(1);
  expect(await seededContactCount()).toBe(2);
});

test(meta('R04.CONTACTS.ANON-DENIED', 'Anonymous and empty-UID authenticated contexts cannot write contacts'), async () => {
  ready();
  await denied42501(() => db.asRole('anon', null,
    "insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt) values($1,'R13 R04 probe','customer',true,false)",
    [orgs.A.business]));
  await denied42501(() => db.asRole('authenticated', null,
    "insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt) values($1,'R13 R04 probe','customer',true,false)",
    [orgs.A.business]));
});

test(meta('R04.CONTACTS.POLICY-END-STATE', 'Contacts policy set is exactly the known uniform set; both writer policies bind only the scoped tier'), async () => {
  ready();
  const rows = (await db.client.query(
    "select policyname, cmd, coalesce(qual,'') qual, coalesce(with_check,'') chk from pg_policies where schemaname='public' and tablename='contacts' order by policyname",
  )).rows as Array<{ policyname: string; cmd: string; qual: string; chk: string }>;
  expect(rows.map((r) => r.policyname).sort()).toEqual([
    'contacts_admin_delete', 'contacts_member_read', 'contacts_platform_admin_read',
    'contacts_writer_insert', 'contacts_writer_update', 'partner_client_accounting_read',
  ].sort());
  const insert = rows.find((r) => r.policyname === 'contacts_writer_insert')!;
  const update = rows.find((r) => r.policyname === 'contacts_writer_update')!;
  expect(insert.chk).toContain('can_write_contacts_data(business_id)');
  expect(update.chk).toContain('can_write_contacts_data(business_id)');
  for (const p of rows) {
    expect(p.qual + p.chk).not.toContain('can_write_business_data');
  }
});

test(meta('R04.CONTACTS.TIER-DEF-MIRROR', 'can_write_contacts_data carries exactly the 17-role equivalent of the shared tier minus cashier'), async () => {
  ready();
  const vDef = (await db.client.query(
    "select pg_get_functiondef('public.can_write_contacts_data(uuid)'::regprocedure) d",
  )).rows[0].d as string;
  for (const role of FULL_TIER) expect(vDef).toContain(`'${role}'`);
  expect(vDef).not.toContain("'cashier'");
  expect(vDef).toContain('minus cashier');
});

test(meta('R04.CONTACTS.TIER-GRANTS', 'can_write_contacts_data grants: closed for anon/PUBLIC, retained for authenticated and service_role'), async () => {
  ready();
  const q = (role: string) => db.client.query(
    "select has_function_privilege($1, 'public.can_write_contacts_data(uuid)', 'EXECUTE') ok", [role],
  ).then((r: { rows: Array<{ ok: boolean }> }) => r.rows[0].ok);
  expect(await q('anon')).toBe(false);
  expect(await q('authenticated')).toBe(true);
  expect(await q('service_role')).toBe(true);
});

test(meta('R04.CONTACTS.READ-UNCHANGED', 'Narrowing writes does not over-narrow reads: member-read unchanged in own org; foreign tenant still invisible'), async () => {
  ready();
  // Cashier and viewer keep their business read tier (own org contact visible).
  expect((await db.asRole('authenticated', identities.A_cashier.id,
    'select count(*)::int n from public.contacts where business_id=$1', [orgs.A.business])).rows[0].n).toBe(1);
  expect((await db.asRole('authenticated', identities.A_viewer.id,
    'select count(*)::int n from public.contacts where business_id=$1', [orgs.A.business])).rows[0].n).toBe(1);
  // Foreign org rows remain invisible to members of the other tenant.
  expect((await db.asRole('authenticated', identities.A_viewer.id,
    'select count(*)::int n from public.contacts where business_id=$1', [orgs.B.business])).rows[0].n).toBe(0);
});

test(meta('R04.FINANCIAL.OPERATIONAL-ROLES-DENIED', 'Cashier and stock_clerk cannot read seeded ledger/bank-statement rows or directly insert journal entries/lines/statements; reporting views honor caller RLS', FINANCIAL_MIGRATION), async () => {
  ready();

  const viewOptions = (await db.client.query(`
    select relname, reloptions from pg_class
    where oid in ('public.v_trial_balance'::regclass, 'public.v_ar_ageing'::regclass)
    order by relname
  `)).rows as Array<{ relname: string; reloptions: string[] }>;
  expect(viewOptions).toEqual([
    { relname: 'v_ar_ageing', reloptions: ['security_invoker=true'] },
    { relname: 'v_trial_balance', reloptions: ['security_invoker=true'] },
  ]);

  const account = await db.client.query(
    'select id from public.accounts where business_id=$1 order by code limit 1',
    [orgs.A.business],
  );
  expect(account.rows).toHaveLength(1);
  const accountId = account.rows[0].id as string;

  const journal = await db.client.query(
    `insert into public.journal_entries(
       business_id, currency, description, entry_date, entry_number, exchange_rate, status
     ) values($1,'MWK','R04 financial-role seed',current_date,'R04-FINANCIAL-ROLE-SEED',1,'draft')
     returning id`,
    [orgs.A.business],
  );
  const journalId = journal.rows[0].id as string;
  await db.client.query(
    `insert into public.journal_lines(
       business_id, journal_entry_id, account_id, line_number, is_debit,
       amount, amount_base, currency, exchange_rate, rate_is_stale, reconciled, tax_amount
     ) values($1,$2,$3,1,true,1,1,'MWK',1,false,false,0)`,
    [orgs.A.business, journalId, accountId],
  );

  const statement = await db.client.query(
    `insert into public.bank_statements(
       business_id, account_id, opening_balance, closing_balance, statement_date, source
     ) values($1,$2,0,1,current_date,'R04 financial-role seed') returning id`,
    [orgs.A.business, accountId],
  );
  const statementId = statement.rows[0].id as string;
  await db.client.query(
    `insert into public.bank_statement_lines(
       business_id, statement_id, transaction_date, description,
       debit_amount, credit_amount, is_reconciled
     ) values($1,$2,current_date,'R04 financial-role seed',1,0,false)`,
    [orgs.A.business, statementId],
  );

  const budget = await db.client.query(
    `insert into public.budgets(business_id, fiscal_year, name, period_start, period_end)
     values($1,'2026','R04 financial-role seed',current_date,current_date) returning id`,
    [orgs.A.business],
  );
  const budgetId = budget.rows[0].id as string;
  const expense = await db.client.query(
    `insert into public.expenses(
       business_id, amount_paid, currency, exchange_rate, expense_date,
       expense_number, expense_type, rate_is_stale, status, subtotal,
       total_amount, vat_amount, wht_amount
     ) values($1,0,'MWK',1,current_date,'R04-EXPENSE-ROLE-SEED','expense',false,
              'draft',1,1,0,0) returning id`,
    [orgs.A.business],
  );
  const expenseId = expense.rows[0].id as string;

  // Positive control: an accounting role sees all seeded financial records.
  for (const [table, id] of [
    ['journal_entries', journalId],
    ['bank_statements', statementId],
    ['budgets', budgetId],
    ['expenses', expenseId],
  ] as const) {
    expect((await db.asRole('authenticated', identities.A_accountant.id,
      `select count(*)::int n from public.${table} where id=$1`, [id])).rows[0].n).toBe(1);
  }

  for (const role of ['cashier', 'stock_clerk'] as const) {
    const uid = identities[`A_${role}`].id;
    for (const [table, id] of [
      ['journal_entries', journalId],
      ['journal_lines', journalId],
      ['bank_statements', statementId],
      ['bank_statement_lines', statementId],
      ['budgets', budgetId],
      ['expenses', expenseId],
    ] as const) {
      const key = table === 'journal_lines' ? 'journal_entry_id'
        : table === 'bank_statement_lines' ? 'statement_id' : 'id';
      const visible = await db.asRole('authenticated', uid,
        `select count(*)::int n from public.${table} where ${key}=$1`, [id]);
      expect(visible.rows[0].n, `${role} must not read ${table}`).toBe(0);
    }

    await denied42501(() => db.asRole('authenticated', uid,
      `insert into public.journal_entries(
         business_id, currency, description, entry_date, entry_number, exchange_rate, status
       ) values($1,'MWK','R04 direct journal probe',current_date,$2,1,'draft')`,
      [orgs.A.business, `R04-DENIED-${role.toUpperCase()}`]));

    await denied42501(() => db.asRole('authenticated', uid,
      `insert into public.journal_lines(
         business_id, journal_entry_id, account_id, line_number, is_debit,
         amount, amount_base, currency, exchange_rate, rate_is_stale, reconciled, tax_amount
       ) values($1,$2,$3,2,false,1,1,'MWK',1,false,false,0)`,
      [orgs.A.business, journalId, accountId]));

    await denied42501(() => db.asRole('authenticated', uid,
      `insert into public.bank_statements(
         business_id, account_id, opening_balance, closing_balance, statement_date
       ) values($1,$2,0,1,current_date)`,
      [orgs.A.business, accountId]));

    await denied42501(() => db.asRole('authenticated', uid,
      `insert into public.budgets(business_id,fiscal_year,name,period_start,period_end)
       values($1,'2026','R04 direct budget probe',current_date,current_date)`,
      [orgs.A.business]));

    await denied42501(() => db.asRole('authenticated', uid,
      `insert into public.expenses(
         business_id, amount_paid, currency, exchange_rate, expense_date,
         expense_number, expense_type, rate_is_stale, status, subtotal,
         total_amount, vat_amount, wht_amount
       ) values($1,0,'MWK',1,current_date,$2,'expense',false,'draft',1,1,0,0)`,
      [orgs.A.business, `R04-EXPENSE-DENIED-${role.toUpperCase()}`]));

    for (const [table, id] of [['budgets', budgetId], ['expenses', expenseId]] as const) {
      const updated = await db.asRole('authenticated', uid,
        `update public.${table} set updated_at=now() where id=$1 returning id`, [id]);
      expect(updated.rows, `${role} must not mutate ${table}`).toHaveLength(0);
    }
  }
});

test(meta('R04.FINANCIAL.CASHIER-SALES-INVOICE-PRESERVED', 'Cashier retains direct scoped sales-invoice creation without gaining general-ledger access', FINANCIAL_MIGRATION), async () => {
  ready();
  const contact = await db.client.query(
    "select id from public.contacts where business_id=$1 and contact_type='customer' order by id limit 1",
    [orgs.A.business],
  );
  expect(contact.rows).toHaveLength(1);
  const inserted = await db.asRole('authenticated', identities.A_cashier.id,
    `insert into public.invoices(
       business_id, contact_id, branch_id, currency, discount_amount, discount_percent,
       exchange_rate, invoice_number, invoice_type, issue_date, rate_is_stale,
       status, subtotal, taxable_amount, total_amount, vat_amount, wht_amount, amount_paid
     ) values($1,$2,$3,'MWK',0,0,1,'R04-CASHIER-SALES-PATH','invoice',current_date,
              false,'draft',1,1,1,0,0,0) returning id`,
    [orgs.A.business, contact.rows[0].id, orgs.A.branch],
  );
  expect(inserted.rows).toHaveLength(1);
});

// ── Supervisor financial visibility (migration 20261225000000) ───────────────
//
// Supervisors sign for goods and receive them; they must be able to read the
// ledger rows, expenses, invoices and purchase orders those documents produce,
// and nothing more. These probes seed a posted transaction of their own inside a
// single rolled-back transaction, so no fixture state is mutated.

const SUPERVISOR_MIGRATION =
  'supabase/migrations/20261225000000_restore_supervisor_transaction_visibility.sql';
const SUPERVISOR_ID = '13000000-1000-4000-8000-000000009900';

type QueryRows = { rows: Array<Record<string, unknown>> };
type Query = (sql: string, values?: unknown[]) => Promise<QueryRows>;

interface SupervisorSeeds {
  postedJournalId: string;
  expenseId: string;
  invoiceId: string;
  purchaseOrderId: string;
  foreignJournalId: string;
}

const firstId = (result: QueryRows) => String(result.rows[0].id);

/**
 * Runs `probe` as an active supervisor of organisation A, inside ONE transaction
 * that is always rolled back: the supervisor's auth identity and membership, the
 * posted ledger transaction, expense, invoice, supplier, site and purchase order
 * are seeded with the setup connection (RLS bypassed on purpose, exactly as
 * `seedFixture` does), the session is then switched to `authenticated` with the
 * supervisor's JWT claims, and everything — refusals included — is discarded.
 */
async function asSupervisor(probe: (query: Query, seeds: SupervisorSeeds) => Promise<void>) {
  ready();
  const client = db.client;
  const query: Query = (sql, values) => client.query(sql, values) as Promise<QueryRows>;
  await client.query('begin');
  try {
    await query(
      'insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3) on conflict (id) do nothing',
      [SUPERVISOR_ID, 'r13-a-supervisor@example.invalid', JSON.stringify({ full_name: 'R13 supervisor' })],
    );
    await query('insert into public.user_profiles(id,full_name) values($1,$2) on conflict (id) do nothing',
      [SUPERVISOR_ID, 'R13 supervisor']);
    // Active membership, org-wide: NULL branch_id is the explicit org-wide
    // assignment choice of the DEC-03 matrix, which is what a site supervisor
    // spanning sites has.
    await query("insert into public.business_users(business_id,user_id,role,is_active) values($1,$2,'supervisor',true)",
      [orgs.A.business, SUPERVISOR_ID]);

    const account = await query('select id from public.accounts where business_id=$1 order by code limit 1',
      [orgs.A.business]);
    expect(account.rows).toHaveLength(1);
    const accountId = String(account.rows[0].id);

    const postedJournalId = firstId(await query(
      `insert into public.journal_entries(
         business_id, branch_id, currency, description, entry_date, entry_number, exchange_rate, status, posting_key
       ) values($1,$2,'MWK','R04 supervisor posted transaction',current_date,'R04-SUPERVISOR-POSTED',1,'posted',
                'r04-supervisor-posted')
       returning id`,
      [orgs.A.business, orgs.A.branch],
    ));
    await query(
      `insert into public.journal_lines(
         business_id, journal_entry_id, account_id, line_number, is_debit,
         amount, amount_base, currency, exchange_rate, rate_is_stale, reconciled, tax_amount
       ) values($1,$2,$3,1,true,1,1,'MWK',1,false,false,0)`,
      [orgs.A.business, postedJournalId, accountId],
    );
    const expenseId = firstId(await query(
      `insert into public.expenses(
         business_id, amount_paid, currency, exchange_rate, expense_date,
         expense_number, expense_type, rate_is_stale, status, subtotal, total_amount, vat_amount, wht_amount
       ) values($1,0,'MWK',1,current_date,'R04-SUPERVISOR-EXPENSE','expense',false,'draft',1,1,0,0)
       returning id`,
      [orgs.A.business],
    ));
    const invoiceId = firstId(await query(
      `insert into public.invoices(
         business_id, contact_id, branch_id, currency, discount_amount, discount_percent,
         exchange_rate, invoice_number, invoice_type, issue_date, rate_is_stale,
         status, subtotal, taxable_amount, total_amount, vat_amount, wht_amount, amount_paid
       ) values($1,$2,$3,'MWK',0,0,1,'R04-SUPERVISOR-INVOICE','invoice',current_date,false,'draft',1,1,1,0,0,0)
       returning id`,
      [orgs.A.business, orgs.A.customer, orgs.A.branch],
    ));
    const supplierId = firstId(await query(
      "insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt) values($1,'R04 supervisor supplier','supplier',true,false) returning id",
      [orgs.A.business],
    ));
    const siteId = firstId(await query(
      `insert into public.construction_procurement_sites(
         business_id, branch_id, location_id, site_code, site_name, project_ref, created_by
       ) values($1,$2,$3,'R04-SUP','R04 supervisor site','R04-SUP-PRJ',$4) returning id`,
      [orgs.A.business, orgs.A.branch, orgs.A.location, SUPERVISOR_ID],
    ));
    const purchaseOrderId = firstId(await query(
      `insert into public.construction_purchase_orders(
         business_id, branch_id, site_id, project_ref, supplier_contact_id, po_number, currency,
         status, client_key, created_by, authorized_by, authorized_at
       ) values($1,$2,$3,'R04-SUP-PRJ',$4,'R04-SUP-PO-1','MWK','authorized',gen_random_uuid(),$5,$5,now())
       returning id`,
      [orgs.A.business, orgs.A.branch, siteId, supplierId, SUPERVISOR_ID],
    ));
    // Another tenant's posted transaction: widening the read tier must not
    // widen the tenant boundary.
    const foreignJournalId = firstId(await query(
      `insert into public.journal_entries(
         business_id, currency, description, entry_date, entry_number, exchange_rate, status
       ) values($1,'MWK','R04 foreign posted transaction',current_date,'R04-SUPERVISOR-FOREIGN',1,'posted')
       returning id`,
      [orgs.B.business],
    ));

    // From here on the session IS the supervisor.
    await query(
      "select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role','authenticated',true)",
      [SUPERVISOR_ID],
    );
    await query('set local role authenticated');

    await probe(query, { postedJournalId, expenseId, invoiceId, purchaseOrderId, foreignJournalId });
  } finally {
    await client.query('rollback');
  }
}

/**
 * A refused statement aborts the surrounding transaction, so each write probe is
 * fenced by a savepoint that is rolled back before the next assertion runs.
 */
async function refusedInTx(query: Query, sql: string, values: unknown[] = []) {
  await query('savepoint r04_probe');
  let caught: { code?: string } | undefined;
  try { await query(sql, values); } catch (e) { caught = e as { code?: string }; }
  await query('rollback to savepoint r04_probe');
  expect(caught?.code, 'the financial write policy must refuse this statement').toBe('42501');
}

test(meta('R04.FINANCIAL.SUPERVISOR-TRANSACTION-VISIBILITY', 'An active supervisor reads posted ledger transactions, expense rows, invoices and construction purchase orders of its own business, and still sees nothing belonging to another tenant', SUPERVISOR_MIGRATION), async () => {
  await asSupervisor(async (query, seeds) => {
    // The helper itself: supervisor of A → true, supervisor is not a member of B.
    expect((await query('select public.can_read_financial_data($1) ok', [orgs.A.business])).rows[0].ok).toBe(true);
    expect((await query('select public.can_read_financial_data($1) ok', [orgs.B.business])).rows[0].ok).toBe(false);

    const visible: Array<[string, string, unknown[]]> = [
      ['journal_entries', 'select count(*)::int n from public.journal_entries where id=$1', [seeds.postedJournalId]],
      ['journal_lines', 'select count(*)::int n from public.journal_lines where journal_entry_id=$1', [seeds.postedJournalId]],
      ['expenses', 'select count(*)::int n from public.expenses where id=$1', [seeds.expenseId]],
      ['invoices', 'select count(*)::int n from public.invoices where id=$1', [seeds.invoiceId]],
      ['construction_purchase_orders', 'select count(*)::int n from public.construction_purchase_orders where id=$1', [seeds.purchaseOrderId]],
    ];
    for (const [table, sql, values] of visible) {
      const result = await query(sql, values);
      expect(result.rows[0].n, `supervisor must read ${table}`).toBe(1);
    }

    // Foreign tenant rows stay invisible to a supervisor of A.
    const foreign = await query('select count(*)::int n from public.journal_entries where id=$1', [seeds.foreignJournalId]);
    expect(foreign.rows[0].n).toBe(0);
  });
});

test(meta('R04.FINANCIAL.SUPERVISOR-READ-ONLY', 'Restored visibility is not authority: supervisors cannot insert journal entries/lines or expenses, cannot edit or delete a posted entry, and direct journal DML stays command-only', SUPERVISOR_MIGRATION), async () => {
  await asSupervisor(async (query, seeds) => {
    // Manual journal entry creation — refused for the supervisor.
    await refusedInTx(query,
      `insert into public.journal_entries(
         business_id, currency, description, entry_date, entry_number, exchange_rate, status
       ) values($1,'MWK','R04 supervisor journal probe',current_date,'R04-SUPERVISOR-DENIED',1,'draft')`,
      [orgs.A.business]);
    await refusedInTx(query,
      `insert into public.journal_lines(
         business_id, journal_entry_id, account_id, line_number, is_debit,
         amount, amount_base, currency, exchange_rate, rate_is_stale, reconciled, tax_amount
       ) values($1,$2,(select id from public.accounts where business_id=$1 order by code limit 1),2,false,1,1,'MWK',1,false,false,0)`,
      [orgs.A.business, seeds.postedJournalId]);
    // Expenses are financial writes too — reading them does not grant posting.
    await refusedInTx(query,
      `insert into public.expenses(
         business_id, amount_paid, currency, exchange_rate, expense_date,
         expense_number, expense_type, rate_is_stale, status, subtotal, total_amount, vat_amount, wht_amount
       ) values($1,0,'MWK',1,current_date,'R04-SUPERVISOR-EXPENSE-DENIED','expense',false,'draft',1,1,0,0)`,
      [orgs.A.business]);

    // Editing a posted transaction: RLS filters the row, so nothing is touched.
    const updated = await query(
      "update public.journal_entries set description='R04 supervisor edit' where id=$1 returning id",
      [seeds.postedJournalId]);
    expect(updated.rows).toHaveLength(0);
    const deleted = await query('delete from public.journal_entries where id=$1 returning id', [seeds.postedJournalId]);
    expect(deleted.rows).toHaveLength(0);

    // The row is still exactly as seeded: the probes changed nothing.
    const unchanged = await query(
      'select description, status::text s from public.journal_entries where id=$1', [seeds.postedJournalId]);
    expect(unchanged.rows[0]).toEqual({ description: 'R04 supervisor posted transaction', s: 'posted' });
  });
});

test(meta('R04.FINANCIAL.READ-HELPER-DEFINITION', 'can_read_financial_data carries the supervisor-inclusive read tier on business_users.is_active (no status column); the write tier stays owner/admin/accountant and excludes supervisors', SUPERVISOR_MIGRATION), async () => {
  ready();
  const definition = (name: string) => db.client.query(
    "select pg_get_functiondef($1::regprocedure) d", [name],
  ).then((r: { rows: Array<{ d: string }> }) => r.rows[0].d.toLowerCase());

  const read = await definition('public.can_read_financial_data(uuid)');
  for (const role of ['owner', 'admin', 'accountant', 'auditor', 'payroll_manager', 'manager', 'board_member',
    'supervisor', 'site_supervisor']) {
    expect(read, `read tier must include ${role}`).toContain(`'${role}'`);
  }
  expect(read).not.toContain("'cashier'");
  expect(read).not.toContain("'stock_clerk'");
  // Keyed on the membership column this schema actually has.
  expect(read).toContain('bu.is_active is true');
  expect(read).not.toMatch(/bu\.status\s*=/);

  const write = await definition('public.can_write_financial_data(uuid)');
  for (const role of ['owner', 'admin', 'accountant']) {
    expect(write, `write tier must include ${role}`).toContain(`'${role}'`);
  }
  for (const role of ['supervisor', 'site_supervisor', 'manager', 'cashier', 'auditor']) {
    expect(write, `write tier must exclude ${role}`).not.toContain(`'${role}'`);
  }
});


// ── Journal posting command (migration 20261225000001) ───────────────────────
// Journal tables are command-only: `post_financial_journal` is the single path a
// browser may use to create ledger entries (Issue Shares, loans, depreciation,
// fixed assets, inventory, tax and payroll accruals all post through it). These
// probes run inside rolled-back transactions, so no fixture row survives.

// The command itself, and the type fix that redefines it for the live
// database's uuid-shaped source_id / created_by / posted_by columns.
const COMMAND_MIGRATION =
  'supabase/migrations/20261225000001_post_financial_journal_rpc.sql + 20261225000002_fix_journal_source_id_uuid_cast.sql';

const COMMAND_SQL = `select public.post_financial_journal(
  $1::uuid, $2::date, $3, null, $4, null, $5::jsonb, 'MWK', 1, null, null, $6, null, null
) as id`;

// Same command with an explicit p_source_id (text parameter), used by the
// source-id probe to prove the value survives the column's physical type.
const WITH_SOURCE_SQL = `select public.post_financial_journal(
  $1::uuid, $2::date, $3, null, $4, $5, $6::jsonb, 'MWK', 1, null, null, $7, null, null
) as id`;

async function accountPair(): Promise<[string, string]> {
  const rows = (await db.client.query(
    'select id from public.accounts where business_id=$1 and is_group=false order by code limit 2',
    [orgs.A.business],
  )).rows as Array<{ id: string }>;
  expect(rows.length).toBeGreaterThanOrEqual(2);
  return [rows[0].id, rows[1].id];
}

const balancedLines = (debit: string, credit: string, amount = 100) => JSON.stringify([
  { account_id: debit, is_debit: true, amount, amount_base: amount, description: 'R04 command debit' },
  { account_id: credit, is_debit: false, amount, amount_base: amount, description: 'R04 command credit' },
]);

/** Runs `probe` as `uid`, then rolls the whole transaction back. */
async function inRolledBackTx(uid: string, probe: () => Promise<void>) {
  await db.beginAsRole('authenticated', uid);
  try {
    await probe();
  } finally {
    await db.rollbackTx();
  }
}

/** A refused statement aborts its transaction; fence it with a savepoint. */
async function refusedInRoleTx(expected: '42501' | '22023', run: () => Promise<unknown>) {
  await db.client.query('savepoint r04_command');
  try {
    await refusedWith(expected, run);
  } finally {
    await db.client.query('rollback to savepoint r04_command');
  }
}

/** A refused command aborts its transaction; expect the given SQLSTATE. */
async function refusedWith(expected: '42501' | '22023', run: () => Promise<unknown>) {
  let caught: { code?: string } | undefined;
  try { await run(); } catch (e) { caught = e as { code?: string }; }
  if (!caught) throw new Error(`Expected SQLSTATE ${expected} but the command succeeded.`);
  expect(caught.code).toBe(expected);
}

test(meta('R04.FINANCIAL.POST-JOURNAL-COMMAND', 'post_financial_journal posts a balanced entry and its lines for owner, admin and accountant; every operational role is refused with 42501 and direct journal DML stays denied', COMMAND_MIGRATION), async () => {
  ready();
  const [debit, credit] = await accountPair();
  const lines = balancedLines(debit, credit);

  for (const role of ['owner', 'admin', 'accountant'] as const) {
    const uid = identities[`A_${role}`].id;
    await inRolledBackTx(uid, async () => {
      const posted = await db.client.query(COMMAND_SQL, [orgs.A.business, DAY, `R04 command ${role}`, 'manual', lines, 'posted']);
      const entryId = String(posted.rows[0].id);
      expect(entryId).toBeTruthy();

      const entry = (await db.client.query(
        'select status::text s, entry_number, currency, created_by from public.journal_entries where id=$1',
        [entryId],
      )).rows[0] as { s: string; entry_number: string; currency: string; created_by: string };
      expect(entry.s).toBe('posted');
      expect(entry.entry_number).toMatch(/^JNL-/);
      expect(entry.currency).toBe('MWK');
      // The command attributes the posting to the JWT identity, not the caller.
      expect(entry.created_by).toBe(uid);

      const totals = (await db.client.query(
        `select count(*)::int n,
                coalesce(sum(case when is_debit then amount_base else 0 end),0)::numeric d,
                coalesce(sum(case when not is_debit then amount_base else 0 end),0)::numeric c
           from public.journal_lines where journal_entry_id=$1`,
        [entryId],
      )).rows[0] as { n: number; d: string; c: string };
      expect(totals.n).toBe(2);
      expect(Number(totals.d)).toBe(Number(totals.c));
    });
  }

  for (const role of ['cashier', 'stock_clerk', 'branch_manager', 'viewer'] as const) {
    const uid = identities[`A_${role}`].id;
    await inRolledBackTx(uid, async () => {
      await refusedWith('42501', () => db.client.query(COMMAND_SQL, [
        orgs.A.business, DAY, `R04 command denied ${role}`, 'manual', lines, 'posted',
      ]));
    });
  }

  // Visibility is not authority: the supervisor probes already prove the same
  // for that role, and here the refusal must come from the command itself.
  await asSupervisor(async (query) => {
    await refusedWith('42501', () => query(COMMAND_SQL, [
      orgs.A.business, DAY, 'R04 supervisor command probe', 'manual', balancedLines(debit, credit), 'posted',
    ]));
  });
});

test(meta('R04.FINANCIAL.POST-JOURNAL-VALIDATION', 'The posting command refuses unbalanced, single-sided, zero-value, foreign-tenant and unknown-account journals with 22023/42501 instead of writing a broken ledger row', COMMAND_MIGRATION), async () => {
  ready();
  const [debit, credit] = await accountPair();
  const uid = identities.A_accountant.id;

  await inRolledBackTx(uid, async () => {
    // debits 100 / credits 60
    await refusedInRoleTx('22023', () => db.client.query(COMMAND_SQL, [
      orgs.A.business, DAY, 'R04 unbalanced', 'manual',
      JSON.stringify([
        { account_id: debit, is_debit: true, amount: 100, amount_base: 100 },
        { account_id: credit, is_debit: false, amount: 60, amount_base: 60 },
      ]), 'posted',
    ]));

    // A single line cannot balance.
    await refusedInRoleTx('22023', () => db.client.query(COMMAND_SQL, [
      orgs.A.business, DAY, 'R04 single line', 'manual',
      JSON.stringify([{ account_id: debit, is_debit: true, amount: 100, amount_base: 100 }]), 'posted',
    ]));

    // Zero-value lines are not entries.
    await refusedInRoleTx('22023', () => db.client.query(COMMAND_SQL, [
      orgs.A.business, DAY, 'R04 zero value', 'manual',
      JSON.stringify([
        { account_id: debit, is_debit: true, amount: 0, amount_base: 0 },
        { account_id: credit, is_debit: false, amount: 0, amount_base: 0 },
      ]), 'posted',
    ]));

    // Debit/credit vocabulary is accepted and normalised.
    const posted = await db.client.query(COMMAND_SQL, [
      orgs.A.business, DAY, 'R04 debit credit vocabulary', 'manual',
      JSON.stringify([
        { account_id: debit, debit: 250, credit: 0 },
        { account_id: credit, debit: 0, credit: 250 },
      ]), 'posted',
    ]);
    expect(String(posted.rows[0].id)).toBeTruthy();
  });

  // Another tenant's business id is refused before anything is written.
  await inRolledBackTx(uid, async () => {
    await refusedWith('42501', () => db.client.query(COMMAND_SQL, [
      orgs.B.business, DAY, 'R04 foreign tenant', 'manual', balancedLines(debit, credit), 'posted',
    ]));
  });

  // An account that is not this business's chart is refused by _ledgr_assert_account.
  const foreignAccount = (await db.client.query(
    'select id from public.accounts where business_id=$1 and is_group=false order by code limit 1',
    [orgs.B.business],
  )).rows[0].id as string;
  await inRolledBackTx(uid, async () => {
    await refusedWith('22023', () => db.client.query(COMMAND_SQL, [
      orgs.A.business, DAY, 'R04 foreign account', 'manual',
      JSON.stringify([
        { account_id: foreignAccount, is_debit: true, amount: 10, amount_base: 10 },
        { account_id: credit, is_debit: false, amount: 10, amount_base: 10 },
      ]), 'posted',
    ]).catch((e: { code?: string; message?: string }) => {
      // _ledgr_assert_account raises P0001 for an unknown/foreign account.
      if (e?.code === 'P0001') throw Object.assign(new Error(e.message), { code: '22023' });
      throw e;
    }));
  });

  // Direct DML remains impossible for an authorised financial writer too: the
  // command is the only client-reachable path.
  await inRolledBackTx(uid, async () => {
    await refusedWith('42501', () => db.client.query(
      `insert into public.journal_entries(
         business_id, currency, description, entry_date, entry_number, exchange_rate, status
       ) values($1,'MWK','R04 direct writer probe',current_date,'R04-DIRECT-ACCOUNTANT',1,'draft')`,
      [orgs.A.business],
    ));
  });
});

test(meta('R04.FINANCIAL.POST-DRAFT-JOURNAL-COMMAND', 'Drafts post through post_draft_financial_journal: the transition is allowed for a financial writer, refused for operational roles, and posted entries stay immutable', COMMAND_MIGRATION), async () => {
  ready();
  const [debit, credit] = await accountPair();

  await inRolledBackTx(identities.A_accountant.id, async () => {
    const drafted = await db.client.query(COMMAND_SQL, [
      orgs.A.business, DAY, 'R04 draft then post', 'manual', balancedLines(debit, credit), 'draft',
    ]);
    const entryId = String(drafted.rows[0].id);

    const statusOf = async () => (await db.client.query(
      'select status::text s from public.journal_entries where id=$1', [entryId],
    )).rows[0].s as string;

    expect(await statusOf()).toBe('draft');

    // An operational role cannot post it.
    await db.client.query('savepoint r04_draft');
    await db.client.query("select set_config('request.jwt.claim.sub',$1,true)", [identities.A_cashier.id]);
    await refusedWith('42501', () => db.client.query(
      'select public.post_draft_financial_journal($1::uuid, null)', [entryId],
    ));
    await db.client.query('rollback to savepoint r04_draft');
    await db.client.query("select set_config('request.jwt.claim.sub',$1,true)", [identities.A_accountant.id]);

    const posted = await db.client.query(
      'select public.post_draft_financial_journal($1::uuid, $2) ok', [entryId, identities.A_accountant.id],
    );
    expect(String(posted.rows[0].ok)).toBe(entryId);
    expect(await statusOf()).toBe('posted');

    // A posted entry is immutable: posting again is refused, not silently reapplied.
    await refusedWith('22023', () => db.client.query(
      'select public.post_draft_financial_journal($1::uuid, null)', [entryId],
    ));
  });
});

test(meta('R04.FINANCIAL.ASSIGN-COST-CENTRE-COMMAND', 'Cost centres are assigned through assign_financial_journal_cost_centre: a financial writer may tag an entry and all of its lines, an operational role may not, and a branch from another business is refused', COMMAND_MIGRATION), async () => {
  ready();
  const [debit, credit] = await accountPair();

  await inRolledBackTx(identities.A_accountant.id, async () => {
    const posted = await db.client.query(COMMAND_SQL, [
      orgs.A.business, DAY, 'R04 cost centre', 'manual', balancedLines(debit, credit), 'posted',
    ]);
    const entryId = String(posted.rows[0].id);

    const assigned = await db.client.query(
      'select public.assign_financial_journal_cost_centre($1::uuid, $2::uuid, null) ok',
      [entryId, orgs.A.branch],
    );
    expect(String(assigned.rows[0].ok)).toBe(entryId);
    expect((await db.client.query(
      'select branch_id from public.journal_entries where id=$1', [entryId],
    )).rows[0].branch_id).toBe(orgs.A.branch);
    expect((await db.client.query(
      'select count(*)::int n from public.journal_lines where journal_entry_id=$1 and branch_id=$2',
      [entryId, orgs.A.branch],
    )).rows[0].n).toBe(2);

    // An operational role cannot re-tag an accounting document.
    await db.client.query('savepoint r04_cost_role');
    await db.client.query("select set_config('request.jwt.claim.sub',$1,true)", [identities.A_cashier.id]);
    await refusedWith('42501', () => db.client.query(
      'select public.assign_financial_journal_cost_centre($1::uuid, null, null)', [entryId],
    ));
    await db.client.query('rollback to savepoint r04_cost_role');
    await db.client.query("select set_config('request.jwt.claim.sub',$1,true)", [identities.A_accountant.id]);

    // A branch belonging to another business is refused, not silently accepted.
    await db.client.query('savepoint r04_cost_tenant');
    await refusedWith('22023', () => db.client.query(
      'select public.assign_financial_journal_cost_centre($1::uuid, $2::uuid, null)', [entryId, orgs.B.branch],
    ));
    await db.client.query('rollback to savepoint r04_cost_tenant');

    expect((await db.client.query(
      'select branch_id from public.journal_entries where id=$1', [entryId],
    )).rows[0].branch_id).toBe(orgs.A.branch);
  });
});

test(meta('R04.FINANCIAL.POST-JOURNAL-SOURCE-ID', 'A posting keeps a uuid source id and stores an empty one as NULL, so the command works on both journal_entries.source_id shapes', COMMAND_MIGRATION), async () => {
  ready();
  const [debit, credit] = await accountPair();
  const sourceId = 'd38e4ce8-6f4a-4a44-9f5e-8a3f1b7c2d10';

  await inRolledBackTx(identities.A_accountant.id, async () => {
    // p_source_id is a text parameter: it must reach a uuid column cast, and a
    // text column verbatim. An empty string is normalised to NULL.
    const withSource = await db.client.query(WITH_SOURCE_SQL, [
      orgs.A.business, DAY, 'R04 source id', 'share_issue', sourceId,
      balancedLines(debit, credit), 'posted',
    ]);
    const entryId = String(withSource.rows[0].id);
    expect((await db.client.query(
      'select source_id::text s from public.journal_entries where id=$1', [entryId],
    )).rows[0].s).toBe(sourceId);

    const blank = await db.client.query(WITH_SOURCE_SQL, [
      orgs.A.business, DAY, 'R04 blank source id', 'manual', '',
      balancedLines(debit, credit), 'posted',
    ]);
    expect((await db.client.query(
      'select source_id from public.journal_entries where id=$1', [String(blank.rows[0].id)],
    )).rows[0].source_id).toBeNull();
  });
});

test(meta('R04.CONTACTS.DATA-UNCHANGED', 'Migration and probes alter no existing fixture data: contacts, memberships and branches stay stable'), async () => {
  ready();
  expect(await seededContactCount()).toBe(2);
  expect((await db.client.query('select count(*)::int n from public.business_users')).rows[0].n).toBe(14);
  expect((await db.client.query('select count(*)::int n from public.branches')).rows[0].n).toBe(4);
});
