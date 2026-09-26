/**
 * OWNER DECISION 2026-09-26 — invoice edit policy (H04), recommended controls:
 *   PL.PERIOD.*    books closed through a date: no insert/update/delete of dated financial rows in it
 *   PL.APPROVAL.*  four-eyes invoice approval before issue (role list / amount threshold)
 * Synthetic identities; every probe rolled back.
 */
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, DAY, key, saleFixture } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

const test = evidenceSuite('pl-period-approval');
const LAYER = 'real PostgreSQL17 roles/JWT claims; synthetic identities; full migration replay (incl. 20261014000000)';
const MS = 'supabase/migrations/20261014000000_period_lock_and_invoice_approval.sql';
const meta = (id: string, expected: string) => ({ id, expected, remediation: 'OWNER-DECISIONS-2026-09-26', source: MS, layer: LAYER });

type C = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, any>[] }> };
let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let replayError = ''; let seedError = '';
beforeAll(async () => {
  try { db = await createDatabaseFixture(); }
  catch (e) { replayError = String((e as Error).message).startsWith('Migration ') ? (e as Error).message : safeError(e); return; }
  try { orgs = await seedFixture(db.client); } catch (e) { seedError = safeError(e); }
}, 600000);
afterAll(async () => { if (db) await db.cleanup(); });
function ready() {
  if (!db) throw new Blocked(`Database bootstrap/replay unavailable: ${replayError}`);
  if (!orgs) throw new Blocked(`Synthetic fixture setup unavailable: ${seedError}`);
}
let sp = 0;
async function failsWith(c: C, run: () => Promise<unknown>, codes: string[], message?: RegExp) {
  const name = `pl_sp_${++sp}`;
  await c.query(`savepoint ${name}`);
  let caught: { code?: string; message?: string } | undefined;
  try { await run(); } catch (e) { caught = e as { code?: string; message?: string }; }
  await c.query(`rollback to savepoint ${name}`);
  if (!caught) throw new Error(`Probe completed without the expected denial (${codes.join('/')}).`);
  expect(codes).toContain(caught.code);
  if (message) expect(caught.message ?? '').toMatch(message);
}
const as = async (c: C, uid: string | null, role = 'authenticated') => {
  await c.query('reset role');
  await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role',$2,true)", [uid ?? '', role]);
  await c.query(`set local role ${role}`);
};
const su = (c: C) => c.query('reset role');
const TODAY = async (c: C) => String((await c.query("select to_char(current_date,'YYYY-MM-DD') d")).rows[0].d);

const header = (over: Record<string, unknown> = {}) => ({
  business_id: orgs.A.business, contact_id: orgs.A.customer, branch_id: orgs.A.branch,
  invoice_type: 'invoice', status: 'sent', issue_date: DAY, due_date: DAY,
  currency: 'MWK', original_currency: 'MWK', exchange_rate: 1, functional_currency: 'MWK',
  subtotal: 1000, taxable_amount: 1000, discount_amount: 0, discount_percent: 0, vat_amount: 0, wht_amount: 0,
  total_amount: 1000, original_amount: 1000, functional_amount: 1000, amount_paid: 0, rate_date: DAY, rate_is_stale: false, ...over,
});
const line = (n: number) => ({ line_number: n, description: `PL line ${n}`, quantity: 1, unit_price: 500,
  discount_percent: 0, discount_amount: 0, tax_code: 'none', tax_rate: 0, tax_amount: 0, line_total: 500 });
const createInvoice = async (c: C, k: string, over: Record<string, unknown> = {}) =>
  (await c.query('select public.create_invoice_with_lines($1::jsonb,$2::jsonb,$3::uuid) r',
    [JSON.stringify(header(over)), JSON.stringify([line(1), line(2)]), k])).rows[0].r.invoice as Record<string, any>;
/** September 1 → fixture day as an accounting period (created open, as superuser, in the probe transaction). */
const period = async (c: C, start = '2026-09-01', end = DAY) => {
  await c.query('reset role');
  return String((await c.query('insert into public.accounting_periods(business_id,name,period_start,period_end,is_closed) values($1,$2,$3,$4,false) returning id',
    [orgs.A.business, `PL ${start}..${end}`, start, end])).rows[0].id);
};
const closeP = (c: C, id: string, reason = 'Month-end close') =>
  c.query('select public.close_accounting_period($1,$2) r', [id, reason]).then((r) => r.rows[0].r);
const reopenP = (c: C, id: string, reason: string) =>
  c.query('select public.reopen_accounting_period($1,$2) r', [id, reason]).then((r) => r.rows[0].r);
/** Create the period and close it as `uid` (default: accountant), returning to `back` afterwards. */
const close = async (c: C, _day: string, back: string = identities.A_owner.id) => {
  const id = await period(c);
  await as(c, identities.A_accountant.id); await closeP(c, id);
  await as(c, back);
  return id;
};
const grants = async (c: C, uid: string) => {
  await su(c); await c.query('grant update, delete on public.invoices, public.invoice_lines to authenticated'); await as(c, uid);
};
const pay = (c: C, invoiceId: string, amount: number, k: string, date: string) =>
  c.query('select public.record_invoice_payment($1::jsonb,$2::uuid) r', [JSON.stringify({
    invoice_id: invoiceId, amount, payment_date: date, payment_method: 'cash', currency: 'MWK', exchange_rate: 1, functional_amount: amount,
  }), k]).then((r) => r.rows[0].r);

// ═══════════════════════════ PERIOD LOCK ═══════════════════════════════════
test(meta('PL.PERIOD.CLOSE-AUTHORITY', 'Closing an accounting_periods row is a server command: only owner, admin or accountant (viewer, cashier, branch_manager, B owner → 42501; anon → 42501); a period that has not ended is refused 22023; a period with draft journal entries is refused 22023; closing twice is refused 22023; the close is logged (actor, reason) and stamps closed_by/closed_at'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_viewer.id, async (c: C) => {
    const pid = await period(c);
    const current = await period(c, '2026-09-22', '2099-12-31');
    for (const who of ['A_viewer', 'A_cashier', 'A_branch_manager', 'B_owner']) { await as(c, identities[who].id); await failsWith(c, () => closeP(c, pid), ['42501']); }
    await as(c, identities.A_accountant.id);
    await failsWith(c, () => closeP(c, current), ['22023'], /after it has ended/);
    await su(c);
    await c.query("insert into public.journal_entries(business_id,entry_number,entry_date,description,status,currency,exchange_rate) values($1,'PL-DRAFT-1',$2,'draft probe','draft','MWK',1)", [orgs.A.business, DAY]);
    await as(c, identities.A_accountant.id);
    await failsWith(c, () => closeP(c, pid), ['22023'], /draft journal/);
    await su(c); await c.query("delete from public.journal_entries where entry_number='PL-DRAFT-1' and business_id=$1", [orgs.A.business]);
    await as(c, identities.A_accountant.id);
    await closeP(c, pid, 'September close');
    await failsWith(c, () => closeP(c, pid), ['22023'], /already closed/);
    await su(c);
    const ev = (await c.query('select action, reason, actor from public.accounting_period_events where period_id=$1', [pid])).rows;
    expect(ev).toEqual([{ action: 'close', reason: 'September close', actor: identities.A_accountant.id }]);
    const row = (await c.query('select is_closed, closed_by from public.accounting_periods where id=$1', [pid])).rows[0];
    expect(row).toEqual({ is_closed: true, closed_by: identities.A_accountant.id });
  });
  await db.asRole('anon', null, async (c: C) => { await failsWith(c, () => closeP(c, '00000000-0000-4000-8000-000000000000'), ['42501']); });
});

test(meta('PL.PERIOD.CLOSED-WRITES-REFUSED', 'With books closed through the fixture day, every writer (owner via RPC, superuser/service path) is refused 22023 period-closed for: a new invoice dated in the period, editing or deleting an existing invoice/line of the period, a journal entry (inventory journal command) dated in it, a stock movement dated in it, an expense dated in it. The same documents dated today still post'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await grants(c, identities.A_owner.id);
    const old = await createInvoice(c, key(1401));
    const oldDraft = await createInvoice(c, key(1402), { status: 'draft' });
    await close(c, DAY);
    await failsWith(c, () => createInvoice(c, key(1403)), ['22023'], /period-closed/);
    await failsWith(c, () => c.query('update public.invoices set total_amount=1 where id=$1', [oldDraft.id]), ['22023', '42501']);
    await failsWith(c, () => c.query("update public.invoice_lines set description='x' where invoice_id=$1", [oldDraft.id]), ['22023'], /period-closed/);
    await failsWith(c, () => c.query('delete from public.invoices where id=$1', [oldDraft.id]), ['22023'], /period-closed/);
    await failsWith(c, () => c.query('select public.record_inventory_journal_movement($1::jsonb)', [JSON.stringify({
      business_id: orgs.A.business, location_id: orgs.A.location, movement_date: DAY, movement_type: 'adjustment_in', client_key: key(1404),
      lines: [{ product_id: orgs.A.product, quantity: 1, unit_cost: 900 }] })]), ['22023'], /period-closed/);
    await su(c);
    await failsWith(c, () => c.query("insert into public.stock_movements(business_id,product_id,location_id,movement_type,movement_date,quantity,unit_cost,source_type,source_id) values($1,$2,$3,'adjustment_in',$4,1,900,'manual','pl')", [orgs.A.business, orgs.A.product, orgs.A.location, DAY]), ['22023'], /period-closed/);
    await failsWith(c, () => c.query('delete from public.invoices where id=$1', [old.id]), ['22023'], /period-closed/);
    await as(c, identities.A_owner.id);
    const today = await TODAY(c);
    const fresh = await createInvoice(c, key(1405), { issue_date: today, due_date: today, rate_date: today });
    expect(fresh.id).toBeTruthy();
  });
});

test(meta('PL.PERIOD.SETTLEMENT-ALLOWED', 'A payment received TODAY on an invoice issued in the closed period posts (amount_paid 0→400, status partially_paid) — only settlement fields change; a payment dated inside the closed period is refused 22023'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const inv = await createInvoice(c, key(1411));
    await close(c, DAY);
    await failsWith(c, () => pay(c, inv.id, 100, key(1412), DAY), ['22023'], /period-closed/);
    const p = await pay(c, inv.id, 400, key(1413), await TODAY(c));
    expect(p.invoice.status).toBe('partially_paid');
    expect(Number(p.invoice.amount_paid)).toBe(400);
  });
});

test(meta('PL.PERIOD.REOPEN-OWNER-ONLY', 'Reopening needs the OWNER (accountant/admin → 42501) and a written reason ≥ 10 chars (22023); reopening an open period is refused 22023; after reopening the period accepts writes again; close and reopen are both in accounting_period_events'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const pid = await close(c, DAY);
    for (const who of ['A_accountant', 'A_admin']) { await as(c, identities[who].id); await failsWith(c, () => reopenP(c, pid, 'Correcting a posting error'), ['42501']); }
    await as(c, identities.A_owner.id);
    await failsWith(c, () => reopenP(c, pid, 'oops'), ['22023'], /written reason/);
    await reopenP(c, pid, 'Correcting a posting error found by the auditor');
    await failsWith(c, () => reopenP(c, pid, 'Correcting a posting error again'), ['22023'], /not closed/);
    expect((await createInvoice(c, key(1421))).id).toBeTruthy();
    await su(c);
    expect((await c.query('select array_agg(action order by id) a from public.accounting_period_events where period_id=$1', [pid])).rows[0].a).toEqual(['close', 'reopen']);
  });
});

test(meta('PL.PERIOD.NO-DIRECT-WRITES', 'A period status can only change through the commands: a direct UPDATE of accounting_periods.is_closed is refused 42501 even for the superuser/service path; a closed period cannot be deleted or have its dates moved (22023); a row inserted as closed is stored open; accounting_period_events / invoice_approval_policies / invoice_approvals cannot be written by authenticated callers (42501)'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const pid = await close(c, DAY);
    await su(c);
    await failsWith(c, () => c.query('update public.accounting_periods set is_closed=false where id=$1', [pid]), ['42501']);
    await failsWith(c, () => c.query("update public.accounting_periods set period_end='2026-09-10' where id=$1", [pid]), ['22023']);
    await failsWith(c, () => c.query('delete from public.accounting_periods where id=$1', [pid]), ['22023']);
    const sneaky = String((await c.query("insert into public.accounting_periods(business_id,name,period_start,period_end,is_closed) values($1,'PL sneaky','2026-08-01','2026-08-31',true) returning id", [orgs.A.business])).rows[0].id);
    expect((await c.query('select is_closed from public.accounting_periods where id=$1', [sneaky])).rows[0].is_closed).toBe(false);
    await as(c, identities.A_owner.id);
    await failsWith(c, () => c.query("insert into public.accounting_period_events(business_id,period_id,action,reason) values($1,$2,'reopen','x')", [orgs.A.business, pid]), ['42501']);
    await failsWith(c, () => c.query('insert into public.invoice_approval_policies(business_id,enabled) values($1,false)', [orgs.A.business]), ['42501']);
  });
});

// ═══════════════════════════ APPROVAL ══════════════════════════════════════
const policy = async (c: C, enabled: boolean, threshold: number | null, roles: string[] | null) => {
  await as(c, identities.A_admin.id);
  await c.query('select public.set_invoice_approval_policy($1,$2,$3,$4)', [orgs.A.business, enabled, threshold, roles]);
};
const approve = (c: C, id: string) => c.query('select public.approve_invoice($1) r', [id]);

test(meta('PL.APPROVAL.ROLE-REQUIRES-SECOND-PERSON', 'Policy roles include branch_manager: a branch_manager issuing an invoice directly (sent) is refused 22023 invoice-approval-required; saved as draft it cannot be sent unapproved; the creator (not an approver role) cannot approve (42501); the accountant approves; the branch_manager then sends it'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await policy(c, true, null, ['branch_manager']);
    await grants(c, identities.A_branch_manager.id);
    await failsWith(c, () => createInvoice(c, key(1431)), ['22023'], /invoice-approval-required/);
    const d = await createInvoice(c, key(1432), { status: 'draft' });
    await failsWith(c, () => c.query("update public.invoices set status='sent' where id=$1", [d.id]), ['22023'], /invoice-approval-required/);
    await failsWith(c, () => approve(c, d.id), ['42501']);
    await as(c, identities.A_accountant.id); await approve(c, d.id);
    await as(c, identities.A_branch_manager.id);
    await c.query("update public.invoices set status='sent' where id=$1", [d.id]);
    await su(c);
    const r = (await c.query('select i.status::text s, a.approved_by, i.submitted_by from public.invoices i join public.invoice_approvals a on a.invoice_id=i.id and a.revoked_at is null where i.id=$1', [d.id])).rows[0];
    expect(r).toEqual({ s: 'sent', approved_by: identities.A_accountant.id, submitted_by: identities.A_branch_manager.id });
  });
});

test(meta('PL.APPROVAL.THRESHOLD-AND-SELF-APPROVAL', 'Threshold 500: an accountant issuing a 1000 invoice needs approval (22023); the accountant cannot approve their own invoice (22023); the owner approves it; the owner issuing a 1000 invoice is not blocked (owner exempt from the amount rule); a 400 invoice by the accountant needs none'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await policy(c, true, 500, []);
    await grants(c, identities.A_accountant.id);
    await failsWith(c, () => createInvoice(c, key(1441)), ['22023'], /invoice-approval-required/);
    const d = await createInvoice(c, key(1442), { status: 'draft' });
    await failsWith(c, () => approve(c, d.id), ['22023'], /cannot approve/);
    await as(c, identities.A_owner.id); await approve(c, d.id);
    await as(c, identities.A_accountant.id); await c.query("update public.invoices set status='sent' where id=$1", [d.id]);
    await c.query('select public.create_invoice_with_lines($1::jsonb,$2::jsonb,$3::uuid)', [JSON.stringify(header({ subtotal: 400, taxable_amount: 400, total_amount: 400, original_amount: 400, functional_amount: 400 })),
      JSON.stringify([{ ...line(1), unit_price: 400, line_total: 400 }]), key(1443)]);
    await as(c, identities.A_owner.id);
    expect((await createInvoice(c, key(1444))).id).toBeTruthy();
  });
});

test(meta('PL.APPROVAL.EDIT-REVOKES-AND-NO-FORGERY', 'Editing an approved draft (a line, or the total) REVOKES the approval (row kept with revoked_at — append-only history) so it cannot be sent (22023); invoice_approvals cannot be inserted or un-revoked directly by the API (42501)'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    await policy(c, true, null, ['branch_manager']);
    await grants(c, identities.A_branch_manager.id);
    const d = await createInvoice(c, key(1451), { status: 'draft' });
    await as(c, identities.A_accountant.id); await approve(c, d.id);
    await as(c, identities.A_branch_manager.id);
    await c.query("update public.invoice_lines set unit_price=5000, line_total=5000 where invoice_id=$1 and line_number=1", [d.id]);
    await su(c);
    expect((await c.query('select count(*) filter (where revoked_at is null)::int live, count(*)::int total from public.invoice_approvals where invoice_id=$1', [d.id])).rows[0]).toEqual({ live: 0, total: 1 });
    await as(c, identities.A_accountant.id); await approve(c, d.id);
    await as(c, identities.A_branch_manager.id);
    await c.query('update public.invoices set total_amount=9000 where id=$1', [d.id]);
    await failsWith(c, () => c.query("update public.invoices set status='sent' where id=$1", [d.id]), ['22023'], /invoice-approval-required/);
    await failsWith(c, () => c.query('insert into public.invoice_approvals(business_id,invoice_id,approved_by) values($1,$2,$3)', [orgs.A.business, d.id, identities.A_owner.id]), ['42501']);
    await failsWith(c, () => c.query('update public.invoice_approvals set revoked_at=null where invoice_id=$1', [d.id]), ['42501']);
    await su(c);
    expect((await c.query('select count(*)::int n from public.invoice_approvals where invoice_id=$1', [d.id])).rows[0].n).toBe(2);  // history kept: nothing deleted
  });
});

test(meta('PL.APPROVAL.POS-EXEMPT-AND-DEFAULTS', 'With NO policy row the default applies (sales_clerk, data_entry, cashier): till sales by a cashier through post_pos_sale are exempt and post normally; owners/admins/accountants issue invoices without approval; only owner/admin may change the policy (accountant → 42501)'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_cashier.id, async (c: C) => {
    const r = (await c.query('select public.post_pos_sale($1::jsonb) r', [JSON.stringify(saleFixture(orgs.A, 1461))])).rows[0].r;
    expect(r.id).toBeTruthy();
    await as(c, identities.A_owner.id); expect((await createInvoice(c, key(1462))).id).toBeTruthy();
    await as(c, identities.A_accountant.id); expect((await createInvoice(c, key(1463))).id).toBeTruthy();
    await failsWith(c, () => c.query('select public.set_invoice_approval_policy($1,false,null,null)', [orgs.A.business]), ['42501']);
  });
});

test(meta('PL.PERIOD.REVERSAL-MARK-ALLOWED', 'A journal entry in the closed period may still be marked reversed (status/reversed_by only — the reversal itself is dated in the open period); any other change to it (description) or its lines is refused 22023'), async () => {
  ready();
  await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
    const r = (await c.query('select public.record_inventory_journal_movement($1::jsonb) r', [JSON.stringify({
      business_id: orgs.A.business, location_id: orgs.A.location, movement_date: DAY, movement_type: 'adjustment_in', client_key: key(1471),
      lines: [{ product_id: orgs.A.product, quantity: 1, unit_cost: 900 }] })])).rows[0].r;
    const entry = String(r.journal_entry_id);
    await close(c, DAY);
    await su(c);
    await failsWith(c, () => c.query("update public.journal_entries set description='tamper' where id=$1", [entry]), ['22023'], /period-closed/);
    await failsWith(c, () => c.query('update public.journal_lines set amount=1, amount_base=1 where journal_entry_id=$1', [entry]), ['22023'], /period-closed/);
    await c.query("update public.journal_entries set status='reversed' where id=$1", [entry]);
    expect((await c.query('select status::text s from public.journal_entries where id=$1', [entry])).rows[0].s).toBe('reversed');
  });
});
