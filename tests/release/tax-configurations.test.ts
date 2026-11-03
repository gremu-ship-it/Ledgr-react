/**
 * EFFECTIVE-DATED TAX CONFIGURATIONS — release evidence (local, isolated).
 *
 * `public.tax_configurations` stores a business's dated tax rates, but until
 * 20261022000000 nothing kept two periods of the same tax_code apart and
 * nothing required a non-zero rate to cite its evidence. Every reader goes
 * through TaxRepository.findByCode → maybeSingle(), so an overlap did not
 * surface as "two rates", it surfaced as a lost rate (PostgREST refuses an
 * ambiguous single-row match). The migration closes that with three CHECK
 * constraints, a GiST exclusion constraint (btree_gist) and an RLS assertion;
 * this suite exercises the deployed behaviour on a full migration replay with
 * synthetic identities and NO real customer data.
 *
 * What this proves: the catalog state after replay, the refusal each malformed
 * write gets (SQLSTATE + message), the refusal a legacy row now gets on update,
 * the documented 16.5% → 17.5% workflow at the boundary dates, what the
 * deployed policy set's predicates allow and deny, and that writing a rate has
 * no stock or GL effect.
 *
 * What this does NOT prove: any deployed Supabase project, any real business's
 * stored schedule, or the resolver's behaviour inside the React app (that is
 * `src/lib/tax/__tests__/taxConfiguration.test.ts`, which cannot prove
 * authorisation at all). The DML privileges of `authenticated` are part of the
 * deployed ACL profile, not of this migration chain, so the policy record
 * grants them synthetically inside a rolled-back transaction — the local
 * profile is migration-only.
 */
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

const test = evidenceSuite('tax-configurations');
const MIG = 'supabase/migrations/20261022000000_effective_dated_tax_configurations.sql';
const LAYER = 'real PostgreSQL17 roles/JWT claims; synthetic identities; full migration replay incl. 20261022000000';
const meta = (id: string, expected: string, source = MIG) => ({ id, expected, source, remediation: 'R13', layer: LAYER });

type C = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, any>[]; rowCount?: number | null }> };
let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let replayError = '';
let seedError = '';
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

const as = async (c: C, uid: string | null, role = 'authenticated') => {
  await c.query('reset role');
  await c.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role',$2,true)", [uid ?? '', role]);
  await c.query(`set local role ${role}`);
};
const su = (c: C) => c.query('reset role');
let sp = 0;
async function failsWith(c: C, run: () => Promise<unknown>, codes: string[], message?: RegExp) {
  const name = `tc_sp_${++sp}`;
  await c.query(`savepoint ${name}`);
  let caught: { code?: string; message?: string } | undefined;
  try { await run(); } catch (e) { caught = e as { code?: string; message?: string }; }
  await c.query(`rollback to savepoint ${name}`);
  if (!caught) throw new Error(`Probe completed without the expected denial (${codes.join('/')}).`);
  expect(codes).toContain(caught.code);
  if (message) expect(caught.message ?? '').toMatch(message);
  return caught;
}
/** Superuser transaction that is always rolled back: records share no state. */
async function rolledBack(fn: (c: C) => Promise<void>) {
  const c = db.client as unknown as C;
  await c.query('begin');
  try { await fn(c); } finally { await c.query('rollback'); }
}

const EVIDENCE = 'VAT Act Cap 42:02 as amended (2025) — 17.5% from 2026-01-01';
const insertConfig = (c: C, over: Record<string, unknown> = {}) => {
  const row = { business_id: orgs.A.business, tax_code: 'vat_standard', name: 'VAT — Standard Rate',
    rate: 17.5, employer_rate: null, employee_rate: null, mra_reference: EVIDENCE,
    effective_from: '2026-01-01', effective_to: null, ...over };
  return c.query('insert into public.tax_configurations (business_id, tax_code, name, rate, employer_rate, employee_rate, mra_reference, effective_from, effective_to) values ($1,$2::tax_code,$3,$4,$5,$6,$7,$8,$9)',
    [row.business_id, row.tax_code, row.name, row.rate, row.employer_rate, row.employee_rate,
     row.mra_reference, row.effective_from, row.effective_to]);
};
const countOf = async (c: C, business: string, code: string) =>
  Number((await c.query('select count(*)::int n from public.tax_configurations where business_id=$1 and tax_code=$2::tax_code', [business, code])).rows[0].n);
/** The schedule a date resolves to, read exactly as src/lib/tax/taxConfiguration.ts reads it. */
const resolveAt = (c: C, business: string, date: string, code = 'vat_standard') =>
  c.query(`select rate, effective_from::text as effective_from, effective_to::text as effective_to, mra_reference
    from public.tax_configurations
    where business_id=$1 and tax_code=$2::tax_code and is_active
      and effective_from <= $3::date and (effective_to is null or effective_to >= $3::date)`, [business, code, date])
  .then((r) => r.rows);

// ═════════════════════════════ DEPLOYED SHAPE ═══════════════════════════════
test(meta('TAXCONFIG.SCHEMA.INVARIANTS', 'After the replay the table carries exactly: the validated GiST exclusion constraint with btree_gist installed, the three row-level checks (period, rate range, evidence) present but NOT VALID so legacy rows are grandfathered, RLS enabled with the five phase-8b policies, and ZERO anon privileges; the local migration-only profile also holds no authenticated DML for this table (which is why the policy record grants it synthetically)'), async () => {
  ready();
  const c = db.client as unknown as C;
  expect((await c.query("select 1 from pg_extension where extname='btree_gist'")).rows.length).toBe(1);
  const cons = (await c.query(`select conname, contype, convalidated, pg_get_constraintdef(oid) as def
    from pg_constraint where conrelid='public.tax_configurations'::regclass and conname in
      ('tax_configurations_no_overlap','tax_configurations_period_chk','tax_configurations_rate_chk','tax_configurations_evidence_chk')
    order by conname`)).rows;
  expect(cons.map((r) => [r.conname, r.contype, r.convalidated])).toEqual([
    ['tax_configurations_evidence_chk', 'c', false],
    ['tax_configurations_no_overlap', 'x', true],
    ['tax_configurations_period_chk', 'c', false],
    ['tax_configurations_rate_chk', 'c', false],
  ]);
  const defs = Object.fromEntries(cons.map((r) => [r.conname, r.def as string]));
  expect(defs.tax_configurations_no_overlap).toMatch(/EXCLUDE USING gist/i);
  expect(defs.tax_configurations_no_overlap).toMatch(/business_id WITH =/i);
  expect(defs.tax_configurations_no_overlap).toMatch(/tax_code WITH =/i);
  expect(defs.tax_configurations_no_overlap).toMatch(/daterange\(effective_from, effective_to\) WITH &&/i);
  expect(defs.tax_configurations_period_chk).toMatch(/effective_to IS NULL/i);
  expect(defs.tax_configurations_period_chk).toMatch(/effective_to > effective_from/i);
  expect(defs.tax_configurations_rate_chk).toMatch(/rate >= \(0\)::numeric/i);
  expect(defs.tax_configurations_rate_chk).toMatch(/rate <= \(100\)::numeric/i);
  expect(defs.tax_configurations_rate_chk).toMatch(/employer_rate/i);
  expect(defs.tax_configurations_rate_chk).toMatch(/employee_rate/i);
  expect(defs.tax_configurations_evidence_chk).toMatch(/GREATEST\(rate/i);
  expect(defs.tax_configurations_evidence_chk).toMatch(/btrim\(coalesce\(mra_reference/i);
  expect(defs.tax_configurations_evidence_chk).toMatch(/IS NOT NULL/i);
  expect((await c.query("select relrowsecurity from pg_class where oid='public.tax_configurations'::regclass")).rows[0].relrowsecurity).toBe(true);
  expect((await c.query("select policyname from pg_policies where schemaname='public' and tablename='tax_configurations' order by policyname")).rows
    .map((r) => r.policyname)).toEqual([
    'tax_configurations_admin_delete', 'tax_configurations_member_read', 'tax_configurations_platform_admin_read',
    'tax_configurations_writer_insert', 'tax_configurations_writer_update',
  ]);
  const grants = (await c.query(`select grantee, count(*)::int n from information_schema.role_table_grants
    where table_schema='public' and table_name='tax_configurations' and grantee in ('anon','authenticated')
    group by grantee order by grantee`)).rows;
  expect(grants).toEqual([]);
});

// ═══════════════════════════ ONE RATE PER DAY ═══════════════════════════════
test(meta('TAXCONFIG.NON-OVERLAP.REFUSALS', 'A second period of the same tax_code covering an already-covered day is refused 23P01 and nothing is written — identical period, straddling overlap, and a successor while the existing period is still open-ended — while a period that merely TOUCHES the stored one (2023-12-31 ends before it starts), another business and another tax_code are all accepted: ranges are half-open'), async () => {
  ready();
  await rolledBack(async (c) => {
    await insertConfig(c, { tax_code: 'wht_10', name: 'WHT 10%', rate: 10, mra_reference: 'Income Tax Act Cap 13:02', effective_from: '2024-01-01', effective_to: '2025-12-31' });
    expect(await countOf(c, orgs.A.business, 'wht_10')).toBe(1);
    await failsWith(c, () => insertConfig(c, { tax_code: 'wht_10', name: 'duplicate', rate: 10, mra_reference: 'x', effective_from: '2024-01-01', effective_to: '2025-12-31' }),
      ['23P01'], /tax_configurations_no_overlap/);
    await failsWith(c, () => insertConfig(c, { tax_code: 'wht_10', name: 'shifted', rate: 10, mra_reference: 'x', effective_from: '2025-06-01', effective_to: '2026-06-30' }),
      ['23P01'], /tax_configurations_no_overlap/);
    await failsWith(c, () => insertConfig(c, { tax_code: 'wht_10', name: 'straddling', rate: 10, mra_reference: 'x', effective_from: '2023-06-01', effective_to: '2024-06-30' }),
      ['23P01'], /tax_configurations_no_overlap/);
    expect(await countOf(c, orgs.A.business, 'wht_10')).toBe(1);
    // a period that ends the day before the stored one starts does not overlap it
    await insertConfig(c, { tax_code: 'wht_10', name: 'WHT 10% (earlier schedule)', rate: 10, mra_reference: 'x', effective_from: '2023-01-01', effective_to: '2023-12-31' });
    expect(await countOf(c, orgs.A.business, 'wht_10')).toBe(2);
    // an open-ended row covers everything from its start, so a successor is refused until it is closed
    await insertConfig(c, { tax_code: 'wht_20', name: 'WHT 20%', rate: 20, mra_reference: 'Income Tax Act Cap 13:02', effective_from: '2024-01-01' });
    await failsWith(c, () => insertConfig(c, { tax_code: 'wht_20', name: 'successor', rate: 20, mra_reference: 'x', effective_from: '2026-01-01' }),
      ['23P01'], /tax_configurations_no_overlap/);
    expect(await countOf(c, orgs.A.business, 'wht_20')).toBe(1);
    // ...while another business and another tax_code are untouched by A's schedule
    await insertConfig(c, { business_id: orgs.B.business, tax_code: 'wht_10', name: 'WHT 10%', rate: 10, mra_reference: 'Income Tax Act Cap 13:02', effective_from: '2024-01-01', effective_to: '2025-12-31' });
    await insertConfig(c, { tax_code: 'wht_15', name: 'WHT 15%', rate: 15, mra_reference: 'Income Tax Act Cap 13:02', effective_from: '2024-01-01', effective_to: '2025-12-31' });
    expect(await countOf(c, orgs.B.business, 'wht_10')).toBe(1);
    expect(await countOf(c, orgs.A.business, 'wht_15')).toBe(1);
  });
});

// ═════════════════════════ STEPPING OVER THE BOUNDARY ═══════════════════════
test(meta('TAXCONFIG.SCHEDULE.2026-BOUNDARY', 'The documented change is expressible and resolves at the boundary: with only a 16.5% period stored, a 17.5% successor from 2026-01-01 is refused 23P01; after the 16.5% period is closed on 2025-12-31 the successor is accepted and the schedule answers 16.5% for 2025-12-31, 17.5% for 2026-01-01 and 17.5% for 2026-01-02 — exactly one row per date, never two — while a tax_code with no stored period resolves to NOTHING (the database never invents a rate)'), async () => {
  ready();
  await rolledBack(async (c) => {
    await insertConfig(c, { rate: 16.5, mra_reference: 'VAT Act Cap 42:02 — 16.5% schedule (period end evidenced 2025-12-31)', effective_from: '2024-01-01' });
    await failsWith(c, () => insertConfig(c, { rate: 17.5, effective_from: '2026-01-01' }), ['23P01'], /tax_configurations_no_overlap/);
    await c.query(`update public.tax_configurations set effective_to='2025-12-31'
      where business_id=$1 and tax_code='vat_standard'`, [orgs.A.business]);
    await insertConfig(c, { rate: 17.5, effective_from: '2026-01-01' });
    for (const [date, rate] of [['2025-12-31', 16.5], ['2026-01-01', 17.5], ['2026-01-02', 17.5]] as const) {
      const rows = await resolveAt(c, orgs.A.business, date);
      expect(rows.length).toBe(1);
      expect(Number(rows[0].rate)).toBe(rate);
    }
    // Outside the stored schedule there is no answer at all — the database never infers a rate.
    expect((await resolveAt(c, orgs.A.business, '2023-12-31')).length).toBe(0);
    expect((await resolveAt(c, orgs.B.business, '2026-01-01', 'cit')).length).toBe(0);
  });
});

// ═══════════════════════════ EVIDENCE REQUIRED ══════════════════════════════
test(meta('TAXCONFIG.EVIDENCE', 'A non-zero rate with no reference — or only whitespace — is refused 23514; a dual-rate tpr_pension row is judged on its employer/employee rates; zero-rated and exempt rows are accepted without one; and removing the reference from a stored non-zero row is refused'), async () => {
  ready();
  await rolledBack(async (c) => {
    await insertConfig(c, { tax_code: 'wht_10', name: 'WHT 10%', rate: 10, mra_reference: 'Income Tax Act Cap 13:02', effective_from: '2024-01-01', effective_to: '2025-12-31' });
    await failsWith(c, () => insertConfig(c, { tax_code: 'fbt', name: 'FBT', rate: 30, mra_reference: null, effective_from: '2026-01-01' }),
      ['23514'], /tax_configurations_evidence_chk/);
    await failsWith(c, () => insertConfig(c, { tax_code: 'fbt', name: 'FBT', rate: 30, mra_reference: '   ', effective_from: '2026-01-01' }),
      ['23514'], /tax_configurations_evidence_chk/);
    await failsWith(c, () => insertConfig(c, { tax_code: 'tpr_pension', name: 'TPR Pension', rate: 0, employer_rate: 10, employee_rate: 5, mra_reference: null, effective_from: '2011-01-01' }),
      ['23514'], /tax_configurations_evidence_chk/);
    await insertConfig(c, { tax_code: 'vat_exempt', name: 'VAT — Exempt', rate: 0, mra_reference: null, effective_from: '2024-01-01' });
    await insertConfig(c, { tax_code: 'paye', name: 'PAYE', rate: 0, mra_reference: null, effective_from: '2024-01-01' });
    await insertConfig(c, { tax_code: 'tpr_pension', name: 'TPR Pension', rate: 0, employer_rate: 10, employee_rate: 5, mra_reference: 'Pension Act 2011', effective_from: '2011-01-01' });
    await failsWith(c, () => c.query(`update public.tax_configurations set mra_reference=null where business_id=$1 and tax_code='wht_10'`, [orgs.A.business]),
      ['23514'], /tax_configurations_evidence_chk/);
    await c.query(`update public.tax_configurations set rate=100 where business_id=$1 and tax_code='wht_10'`, [orgs.A.business]);   // a valid edit still works
    expect(await countOf(c, orgs.A.business, 'fbt')).toBe(0);
    expect(await countOf(c, orgs.A.business, 'tpr_pension')).toBe(1);
  });
});

// ═════════════════════════════ LEGACY ROWS ═════════════════════════════════
test(meta('TAXCONFIG.LEGACY.GRANDFATHERED-THEN-ENFORCED', 'Reproducing the migration inside a rolled-back transaction: a pre-existing 30% cit row with no reference stays legal while the CHECK is NOT VALID, but the next UPDATE of that row — even of an unrelated column — is refused 23514 until the reference is supplied; once supplied, validate constraint succeeds and the constraint is validated'), async () => {
  ready();
  await rolledBack(async (c) => {
    await c.query('alter table public.tax_configurations drop constraint tax_configurations_evidence_chk');
    await insertConfig(c, { tax_code: 'cit', name: 'CIT legacy', rate: 30, mra_reference: null, effective_from: '2020-01-01' });
    await c.query(`alter table public.tax_configurations add constraint tax_configurations_evidence_chk
      check (greatest(rate, coalesce(employer_rate, 0), coalesce(employee_rate, 0)) = 0
        or nullif(btrim(coalesce(mra_reference, '')), '') is not null) not valid`);
    expect(await countOf(c, orgs.A.business, 'cit')).toBe(1);
    await failsWith(c, () => c.query(`update public.tax_configurations set is_active=false where business_id=$1 and tax_code='cit'`, [orgs.A.business]),
      ['23514'], /tax_configurations_evidence_chk/);
    await c.query(`update public.tax_configurations set mra_reference='Income Tax Act Cap 13:02' where business_id=$1 and tax_code='cit'`, [orgs.A.business]);
    await c.query('alter table public.tax_configurations validate constraint tax_configurations_evidence_chk');
    expect((await c.query(`select convalidated from pg_constraint where conrelid='public.tax_configurations'::regclass and conname='tax_configurations_evidence_chk'`)).rows[0].convalidated).toBe(true);
  });
});

// ═══════════════════════ POLICY PREDICATES + TENANCY ════════════════════════
test(meta('TAXCONFIG.POLICY.PREDICATES', 'With DML granted synthetically inside a rolled-back transaction (the local profile is migration-only), the deployed policies behave per business: an owner writes and updates its own schedule; a viewer\'s insert is refused 42501 and its update changes 0 rows; anon reads 0 rows, its insert is refused 42501 and its update changes 0 rows; a foreign owner reads 0 rows, changes 0 rows and leaves the row untouched'), async () => {
  ready();
  await rolledBack(async (c) => {
    await c.query('grant select, insert, update, delete on public.tax_configurations to authenticated, anon');
    await as(c, identities.A_owner.id);
    await insertConfig(c, { tax_code: 'vat_zero', name: 'VAT — Zero Rated', rate: 0, mra_reference: null, effective_from: '2024-01-01', effective_to: '2025-12-31' });
    await c.query(`update public.tax_configurations set name='VAT — Zero Rated (0%)' where business_id=$1 and tax_code='vat_zero'`, [orgs.A.business]);
    await su(c);
    // A member still reads the schedule (member_read), but cannot write it, and RLS makes a
    // refused UPDATE silent: zero rows, no error — the caller must not report success.
    await as(c, identities.A_viewer.id);
    expect((await resolveAt(c, orgs.A.business, '2024-06-01', 'vat_zero')).length).toBe(1);
    await failsWith(c, () => insertConfig(c, { tax_code: 'vat_standard', name: 'sneaky', rate: 17.5, effective_from: '2024-01-01' }), ['42501']);
    const viewerUpdate = await c.query(`update public.tax_configurations set rate=99 where business_id=$1 and tax_code='vat_zero'`, [orgs.A.business]);
    expect(viewerUpdate.rowCount).toBe(0);
    await su(c);
    await as(c, identities.B_owner.id);
    expect((await resolveAt(c, orgs.A.business, '2024-06-01', 'vat_zero')).length).toBe(0);
    const foreignUpdate = await c.query(`update public.tax_configurations set rate=99 where business_id=$1 and tax_code='vat_zero'`, [orgs.A.business]);
    expect(foreignUpdate.rowCount).toBe(0);
    await su(c);
    // anon is refused outright — the platform-admin policy calls a function anon may not execute (42501)
    await as(c, null, 'anon');
    await failsWith(c, () => c.query('select count(*)::int n from public.tax_configurations'), ['42501']);
    await failsWith(c, () => insertConfig(c, { tax_code: 'vat_standard', name: 'anon', rate: 17.5, effective_from: '2030-01-01' }), ['42501']);
    await failsWith(c, () => c.query(`update public.tax_configurations set rate=99 where business_id=$1 and tax_code='vat_zero'`, [orgs.A.business]), ['42501']);
    await su(c);
    const stored = (await c.query(`select rate, name, effective_from::text as f, effective_to::text as t from public.tax_configurations where business_id=$1 and tax_code='vat_zero'`, [orgs.A.business])).rows[0];
    expect(Number(stored.rate)).toBe(0);
    expect(stored.name).toBe('VAT — Zero Rated (0%)');
  });
});

// ══════════════════════════ NO MONEY SIDE EFFECTS ══════════════════════════
test(meta('TAXCONFIG.NO-SIDE-EFFECTS', 'Writing or changing a tax configuration creates no journal entry, no stock movement and no invoice or expense row — it is reference data, not a transaction'), async () => {
  ready();
  await rolledBack(async (c) => {
    const tally = async () => (await c.query(`select (select count(*) from public.journal_entries)::int j,
        (select count(*) from public.stock_movements)::int m, (select count(*) from public.invoices)::int i,
        (select count(*) from public.expenses)::int e`)).rows[0];
    const before = await tally();
    await insertConfig(c, { tax_code: 'none', name: 'None / Not Applicable', rate: 0, mra_reference: null, effective_from: '2024-01-01' });
    await c.query(`update public.tax_configurations set is_active=true where business_id=$1 and tax_code='none'`, [orgs.A.business]);
    expect(await tally()).toEqual(before);
  });
});
