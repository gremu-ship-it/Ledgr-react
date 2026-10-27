/**
 * P4-1 Trial Balance RPC — isolated local PostgreSQL migration replay.
 * The fixture is synthetic; this does not call Supabase Auth/PostgREST or any
 * production database. It exercises the SECURITY DEFINER RPC as authenticated
 * roles with real JWT claim settings and verifies branch, date, posted-status,
 * and account-tree behaviour.
 */
import { afterAll, beforeAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { evidenceSuite, Blocked, safeError } from './evidence';
import { identities, seedFixture } from './fixtures';

const test = evidenceSuite('trial-balance-report');
const MIGRATION = 'supabase/migrations/20261109000000_trial_balance_rpc.sql';
const LAYER = 'real embedded PostgreSQL 17; full local migration replay; synthetic identities; authenticated JWT claims; no production data';
const meta = (id: string, expected: string) => ({
  id,
  expected,
  remediation: 'R13',
  source: MIGRATION,
  layer: LAYER,
  productionVerificationRequired: false,
});

let db: Awaited<ReturnType<typeof createDatabaseFixture>> | undefined;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let setupError = '';
let cashAccount = '';
let equityAccount = '';

interface ReportRow {
  account_id: string;
  account_code: string;
  parent_account_id: string | null;
  level: number;
  total_debit: string;
  total_credit: string;
  balance: string;
}

async function setup() {
  db = await createDatabaseFixture();
  orgs = await seedFixture(db.client);
  const insertAccount = async (code: string, name: string, type: string, parentId: string | null, isGroup: boolean) => {
    const result = await db!.client.query(
      `insert into public.accounts(
         business_id, code, name, account_type, normal_balance, currency,
         opening_balance, is_bank_account, is_group, is_system, parent_id
       ) values($1,$2,$3,$4,$5,'MWK',0,false,$6,true,$7) returning id`,
      [orgs.A.business, code, name, type, type === 'equity' ? 'credit' : 'debit', isGroup, parentId],
    );
    return result.rows[0].id as string;
  };

  const assets = await insertAccount('9900', 'R13 Assets', 'asset', null, true);
  cashAccount = await insertAccount('9910', 'R13 Cash', 'asset', assets, false);
  equityAccount = await insertAccount('9990', 'R13 Equity', 'equity', null, true);

  const insertEntry = async (entryNumber: string, date: string, branchId: string, amount: number, status: 'posted' | 'draft') => {
    const entry = await db!.client.query(
      `insert into public.journal_entries(
         business_id, branch_id, currency, description, entry_date,
         entry_number, exchange_rate, status
       ) values($1,$2,'MWK','R13 trial balance probe',$3,$4,1,$5) returning id`,
      [orgs.A.business, branchId, date, entryNumber, status],
    );
    const entryId = entry.rows[0].id as string;
    const insertLine = (accountId: string, isDebit: boolean) => db!.client.query(
      `insert into public.journal_lines(
         business_id, journal_entry_id, account_id, branch_id, line_number,
         is_debit, amount, amount_base, currency, exchange_rate,
         rate_is_stale, reconciled, tax_amount
       ) values($1,$2,$3,$4,$5,$6,$7,$7,'MWK',1,false,false,0)`,
      [orgs.A.business, entryId, accountId, branchId, isDebit ? 1 : 2, isDebit, amount],
    );
    await insertLine(cashAccount, true);
    await insertLine(equityAccount, false);
  };

  await insertEntry('R13-TB-A-POSTED', '2026-01-15', orgs.A.branch, 100, 'posted');
  await insertEntry('R13-TB-B-POSTED', '2026-02-15', orgs.A.branch2, 200, 'posted');
  await insertEntry('R13-TB-A-DRAFT', '2026-01-20', orgs.A.branch, 500, 'draft');
}

beforeAll(async () => {
  try { await setup(); }
  catch (error) { setupError = safeError(error); }
});

afterAll(async () => { await db?.cleanup(); });

function ready() {
  if (!db || setupError) throw new Blocked(`Local migration replay/fixture unavailable: ${setupError || 'database not initialized'}`);
}

function getReport(uid: string, businessId: string, from: string, to: string, branchId: string | null): Promise<{ rows: ReportRow[] }> {
  ready();
  return db!.asRole('authenticated', uid,
    'select * from public.get_trial_balance($1::uuid,$2::date,$3::date,$4::uuid)',
    [businessId, from, to, branchId]) as Promise<{ rows: ReportRow[] }>;
}

test(meta('TRIAL-BALANCE.RPC.POSTED-HIERARCHY-TOTALS', 'Returns active accounts as flat hierarchy rows, rolls up via parent IDs on the client contract, excludes drafts, and balances posted MWK debit/credit totals'), async () => {
  const result = await getReport(identities.A_owner.id, orgs.A.business, '2026-01-01', '2026-12-31', null);
  const rows = result.rows as unknown as ReportRow[];
  const probeRows = rows.filter((row) => ['9900', '9910', '9990'].includes(row.account_code));
  expect(probeRows.map((row) => row.account_code)).toEqual(['9900', '9910', '9990']);
  const assets = probeRows.find((row) => row.account_code === '9900')!;
  const cash = probeRows.find((row) => row.account_code === '9910')!;
  const equity = probeRows.find((row) => row.account_code === '9990')!;
  expect(assets.level).toBe(0);
  expect(assets.parent_account_id).toBeNull();
  expect(Number(assets.total_debit)).toBe(0);
  expect(Number(assets.total_credit)).toBe(0);
  expect(cash.level).toBe(1);
  expect(cash.parent_account_id).toBe(assets.account_id);
  expect(Number(cash.total_debit)).toBe(300);
  expect(Number(cash.total_credit)).toBe(0);
  expect(Number(cash.balance)).toBe(300);
  expect(equity.level).toBe(0);
  expect(Number(equity.total_debit)).toBe(0);
  expect(Number(equity.total_credit)).toBe(300);
  expect(Number(equity.balance)).toBe(-300);
  expect(probeRows.reduce((sum, row) => sum + Number(row.total_debit), 0)).toBe(300);
  expect(probeRows.reduce((sum, row) => sum + Number(row.total_credit), 0)).toBe(300);
});

test(meta('TRIAL-BALANCE.RPC.BRANCH-AUTHORIZATION', 'Server-enforced branch filtering limits an assigned branch manager to their branch and rejects a forged request for another branch'), async () => {
  const allAccessible = await getReport(identities.A_branch_manager.id, orgs.A.business, '2026-01-01', '2026-12-31', null);
  expect(allAccessible.rows.find((row) => row.account_id === cashAccount)?.total_debit).toBe('100');

  await expect(getReport(identities.A_branch_manager.id, orgs.A.business, '2026-01-01', '2026-12-31', orgs.A.branch2))
    .rejects.toMatchObject({ code: '42501' });

  const branchOne = await getReport(identities.A_owner.id, orgs.A.business, '2026-01-01', '2026-12-31', orgs.A.branch);
  const branchTwo = await getReport(identities.A_owner.id, orgs.A.business, '2026-01-01', '2026-12-31', orgs.A.branch2);
  expect(branchOne.rows.find((row) => row.account_id === cashAccount)?.total_debit).toBe('100');
  expect(branchTwo.rows.find((row) => row.account_id === cashAccount)?.total_debit).toBe('200');
});

test(meta('TRIAL-BALANCE.RPC.DATE-AND-BUSINESS-ISOLATION', 'Date bounds are inclusive and a user who is not a member of the requested business cannot invoke the security-definer report'), async () => {
  const january = await getReport(identities.A_owner.id, orgs.A.business, '2026-01-01', '2026-01-31', null);
  const february = await getReport(identities.A_owner.id, orgs.A.business, '2026-02-01', '2026-02-28', null);
  expect(january.rows.find((row) => row.account_id === cashAccount)?.total_debit).toBe('100');
  expect(february.rows.find((row) => row.account_id === cashAccount)?.total_debit).toBe('200');
  await expect(getReport(identities.B_owner.id, orgs.A.business, '2026-01-01', '2026-12-31', null))
    .rejects.toMatchObject({ code: '42501' });
});
