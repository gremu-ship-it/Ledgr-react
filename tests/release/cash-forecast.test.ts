/**
 * 5B-3c cash forecast RPC and named assumptions on isolated PostgreSQL 17.
 * Uses the full local migration chain, synthetic tenants, and authenticated
 * JWT claims only; no production or connected Supabase data is accessed.
 */
import { afterAll, beforeAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { evidenceSuite, Blocked, safeError } from './evidence';
import { identities, seedFixture } from './fixtures';

const test = evidenceSuite('cash-forecast');
const MIGRATION = 'supabase/migrations/20261126000000_cash_flow_forecasting.sql';
const LAYER = 'real embedded PostgreSQL 17; full local migration replay; synthetic tenants; authenticated JWT claims; no production data';
const meta = (id: string, expected: string) => ({
  id,
  expected,
  remediation: '5B-3c',
  source: MIGRATION,
  layer: LAYER,
  productionVerificationRequired: false,
});

let db: Awaited<ReturnType<typeof createDatabaseFixture>> | undefined;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let setupError = '';

async function setup() {
  db = await createDatabaseFixture();
  orgs = await seedFixture(db.client);
  await db.client.query(
    `insert into public.accounts(
       business_id, branch_id, code, name, account_type, normal_balance,
       currency, opening_balance, is_bank_account, is_active, is_group, is_system
     ) values($1,$2,'9888','5B3C forecast bank','asset','debit','MWK',500,true,true,false,false)`,
    [orgs.A.business, orgs.A.branch],
  );
  await db.client.query(
    `insert into public.invoices(
       business_id, contact_id, invoice_number, invoice_type, issue_date, due_date,
       currency, exchange_rate, functional_currency, functional_amount, rate_is_stale,
       status, subtotal, taxable_amount, total_amount, amount_paid,
       discount_amount, discount_percent, vat_amount, wht_amount, branch_id
     ) values($1,$2,'5B3C-AR-1','invoice',current_date,current_date,
       'MWK',1,'MWK',300,false,'sent',300,300,300,0,0,0,0,0,$3)`,
    [orgs.A.business, orgs.A.customer, orgs.A.branch],
  );
  await db.client.query(
    `insert into public.expenses(
       business_id, expense_number, expense_type, status, expense_date, due_date,
       currency, exchange_rate, functional_currency, functional_amount, rate_is_stale,
       subtotal, vat_amount, wht_amount, total_amount, amount_paid, branch_id
     ) values($1,'5B3C-AP-1','supplier_bill','approved',current_date,current_date,
       'MWK',1,'MWK',200,false,200,0,0,200,0,$2)`,
    [orgs.A.business, orgs.A.branch],
  );
}

beforeAll(async () => {
  try { await setup(); }
  catch (error) { setupError = safeError(error); }
});

afterAll(async () => { await db?.cleanup(); });

function ready() {
  if (!db || setupError) throw new Blocked(`Local migration replay/fixture unavailable: ${setupError || 'database not initialized'}`);
}

function forecast(uid: string, businessId: string, horizon = 3) {
  ready();
  return db!.asRole('authenticated', uid,
    'select public.generate_cash_forecast($1::uuid,$2::integer,0,0,0,false) as forecast',
    [businessId, horizon]);
}

test(meta('CASH-FORECAST.ROLL-FORWARD', 'Returns the requested rolling monthly horizon in base currency; each opening equals the previous closing and closing equals opening plus inflows less outflows'), async () => {
  const result = await forecast(identities.A_owner.id, orgs.A.business, 3);
  const data = result.rows[0].forecast as {
    opening_balance: number;
    base_currency: string;
    months: { opening: number; inflows: number; outflows: number; net: number; closing: number }[];
    source_counts: Record<string, number>;
  };
  expect(data.base_currency).toBe('MWK');
  expect(Number(data.opening_balance)).toBe(500);
  expect(data.months).toHaveLength(3);
  expect(data.source_counts.receivables).toBe(1);
  expect(data.source_counts.payables).toBe(1);
  expect(Number(data.months[0].inflows)).toBe(300);
  expect(Number(data.months[0].outflows)).toBe(200);
  expect(Number(data.months[0].opening)).toBe(500);
  for (let index = 0; index < data.months.length; index += 1) {
    const month = data.months[index];
    expect(Number(month.net)).toBe(Number(month.inflows) - Number(month.outflows));
    expect(Number(month.closing)).toBe(Number(month.opening) + Number(month.net));
    if (index > 0) expect(Number(month.opening)).toBe(Number(data.months[index - 1].closing));
  }
});

test(meta('CASH-FORECAST.MEMBERSHIP', 'A non-member cannot call the security-definer forecast RPC for another tenant'), async () => {
  await expect(forecast(identities.B_owner.id, orgs.A.business))
    .rejects.toMatchObject({ code: '42501' });
});

test(meta('CASH-FORECAST.SCENARIO-RLS', 'Members can persist named assumption sets for their own business while another tenant cannot read them'), async () => {
  ready();
  const owner = identities.A_owner.id;
  await db!.commitAsRole('authenticated', owner,
    `insert into public.cash_forecast_scenarios(
       business_id, name, receivable_delay_days, payable_delay_days,
       payroll_growth_percent, include_construction, horizon_months, created_by
     ) values($1,'5B3C scenario',30,14,4.5,true,6,$2)`,
    [orgs.A.business, owner]);

  const ownRows = await db!.asRole('authenticated', owner,
    'select name, receivable_delay_days, horizon_months from public.cash_forecast_scenarios where business_id=$1',
    [orgs.A.business]);
  expect(ownRows.rows).toEqual([{ name: '5B3C scenario', receivable_delay_days: 30, horizon_months: 6 }]);

  const foreignRows = await db!.asRole('authenticated', identities.B_owner.id,
    'select id from public.cash_forecast_scenarios where business_id=$1', [orgs.A.business]);
  expect(foreignRows.rows).toEqual([]);
});
