/**
 * Behaviour of the in-memory PostgREST stand-in used in demo mode.
 *
 * These tests run the *actual* query shapes the repositories use (copied from
 * `BusinessRepository.findMembershipsWithRole`, `IncomeRepository`,
 * `AccountRepository`, `BaseRepository`…), because the whole demo depends on
 * the app being unable to tell this client from Supabase.
 */
import { describe, expect, it } from 'vitest';
import { DemoQueryBuilder } from '@/lib/demo/queryBuilder';
import { buildDemoDataset, type DemoRow, type DemoTables } from '@/lib/demo/dataset';
import { DEMO_BUSINESS_ID, DEMO_USER_ID } from '@/lib/demo/constants';

const tables: DemoTables = buildDemoDataset(new Date('2026-09-17T09:00:00Z'));

function from(table: string): DemoQueryBuilder {
  return new DemoQueryBuilder(table, tables);
}

async function rows(builder: DemoQueryBuilder): Promise<DemoRow[]> {
  const { data, error } = await builder;
  expect(error).toBeNull();
  return (data ?? []) as DemoRow[];
}

describe('demo query builder — reads', () => {
  it('returns every row for a plain select *', async () => {
    const data = await rows(from('contacts').select('*'));
    expect(data).toHaveLength(tables.contacts!.length);
    expect(data[0]).toHaveProperty('name');
  });

  it('projects only the requested columns and honours aliases', async () => {
    const data = await rows(from('businesses').select('id, name, biz:base_currency').eq('id', DEMO_BUSINESS_ID));
    expect(data).toHaveLength(1);
    expect(Object.keys(data[0]).sort()).toEqual(['biz', 'id', 'name']);
    expect(data[0].biz).toBe('MWK');
  });

  it('reads an unknown table as empty instead of throwing', async () => {
    const data = await rows(from('a_table_that_does_not_exist').select('*'));
    expect(data).toEqual([]);
  });

  it('filters with eq / neq / in / is / gte / lte / ilike', async () => {
    expect(await rows(from('invoices').select('*').eq('business_id', DEMO_BUSINESS_ID))).toHaveLength(
      tables.invoices!.length,
    );
    expect(await rows(from('invoices').select('*').eq('status', 'paid'))).not.toHaveLength(0);
    expect(
      await rows(from('invoices').select('*').neq('status', 'paid')),
    ).toHaveLength(tables.invoices!.filter((i) => i.status !== 'paid').length);

    const statuses = ['sent', 'overdue'];
    const inResult = await rows(from('invoices').select('*').in('status', statuses));
    expect(inResult.every((r) => statuses.includes(String(r.status)))).toBe(true);

    expect(await rows(from('invoices').select('*').is('deleted_at', null))).toHaveLength(
      tables.invoices!.length,
    );

    const late = await rows(from('invoices').select('*').gte('issue_date', '2026-08-01'));
    expect(late.every((r) => String(r.issue_date) >= '2026-08-01')).toBe(true);
    expect(late.length).toBeGreaterThan(0);

    const early = await rows(from('invoices').select('*').lte('issue_date', '2026-05-31'));
    expect(early.every((r) => String(r.issue_date) <= '2026-05-31')).toBe(true);

    const search = await rows(from('contacts').select('*').ilike('name', '%traders%'));
    expect(search.some((c) => String(c.name).includes('Traders'))).toBe(true);
  });

  it('supports .or() expressions like AccountRepository and TaxRepository use', async () => {
    // AccountRepository.getCashAccounts: .or('is_bank_account.eq.true,code.eq.1110,code.eq.1115')
    const cash = await rows(
      from('accounts')
        .select('code, name, is_bank_account')
        .eq('business_id', DEMO_BUSINESS_ID)
        .or('is_bank_account.eq.true,code.eq.1110,code.eq.1115'),
    );
    expect(cash.length).toBeGreaterThan(3);
    expect(cash.every((a) => a.is_bank_account === true || ['1110', '1115'].includes(String(a.code)))).toBe(true);
    expect(cash.some((a) => a.code === '1110')).toBe(true);

    // TaxRepository.findByCode: .or('effective_to.is.null,effective_to.gte.<date>')
    const configs = await rows(
      from('tax_configurations')
        .select('*')
        .eq('tax_code', 'vat_standard')
        .eq('is_active', true)
        .lte('effective_from', '2026-09-17')
        .or('effective_to.is.null,effective_to.gte.2026-09-17'),
    );
    expect(configs).toHaveLength(1);
    expect(Number(configs[0].rate)).toBeCloseTo(17.5, 5);
  });

  it('orders ascending and descending, nulls last by default', async () => {
    const desc = await rows(from('invoices').select('issue_date, invoice_number').order('issue_date', { ascending: false }));
    const dates = desc.map((r) => String(r.issue_date));
    expect(dates).toEqual([...dates].sort().reverse());

    const asc = await rows(from('accounts').select('code').order('code', { ascending: true }));
    const codes = asc.map((r) => String(r.code));
    expect(codes).toEqual([...codes].sort());
  });

  it('applies limit and range paging', async () => {
    const limited = await rows(from('journal_lines').select('*').limit(5));
    expect(limited).toHaveLength(5);

    const page = await rows(from('journal_lines').select('*').order('id').range(2, 4));
    expect(page).toHaveLength(3);

    const all = await rows(from('journal_lines').select('*').order('id'));
    expect(page.map((r) => r.id)).toEqual(all.slice(2, 5).map((r) => r.id));
  });

  it('single() returns one row and errors on zero or many', async () => {
    const one = await from('businesses').select('*').eq('id', DEMO_BUSINESS_ID).single();
    expect(one.error).toBeNull();
    expect((one.data as DemoRow).name).toBeTruthy();

    const none = await from('businesses').select('*').eq('id', 'does-not-exist').single();
    expect(none.data).toBeNull();
    expect(none.error?.code).toBe('PGRST116');

    const many = await from('invoices').select('*').single();
    expect(many.error?.code).toBe('PGRST116');
  });

  it('maybeSingle() returns null when nothing matches', async () => {
    const none = await from('businesses').select('*').eq('id', 'nope').maybeSingle();
    expect(none.error).toBeNull();
    expect(none.data).toBeNull();

    const one = await from('user_profiles').select('*').eq('id', DEMO_USER_ID).maybeSingle();
    expect(one.error).toBeNull();
    expect((one.data as DemoRow).id).toBe(DEMO_USER_ID);
  });

  it('reports exact counts, with and without head', async () => {
    const headed = await from('accounts')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', DEMO_BUSINESS_ID);
    expect(headed.data).toBeNull();
    expect(headed.count).toBe(tables.accounts!.length);

    const withRows = await from('invoices').select('*', { count: 'exact' }).eq('status', 'paid');
    expect(Array.isArray(withRows.data)).toBe(true);
    expect(withRows.count).toBe((withRows.data as DemoRow[]).length);
  });
});

describe('demo query builder — embedded resources', () => {
  it('runs the exact membership query the app boots with', async () => {
    // BusinessRepository.findMembershipsWithRole — multi-line select string
    // with an aliased !inner embed and dotted filters on the embedded table.
    const { data, error } = await from('business_users')
      .select(`
        role,
        is_active,
        business:businesses!inner (
          *
        )
      `)
      .eq('user_id', DEMO_USER_ID)
      .eq('is_active', true)
      .eq('businesses.is_active', true)
      .is('businesses.deleted_at', null);

    expect(error).toBeNull();
    const memberships = data as DemoRow[];
    expect(memberships).toHaveLength(1);
    expect(memberships[0].role).toBe('owner');

    const business = memberships[0].business as DemoRow;
    expect(business.id).toBe(DEMO_BUSINESS_ID);
    expect(business.name).toBeTruthy();
    expect(business.plan_tier).toBe('pro');
  });

  it('drops parents whose !inner embed does not satisfy a dotted filter', async () => {
    const inactiveBusiness = {
      ...tables.businesses![0],
      id: 'de110000-0000-4000-8000-0000000000ff',
      name: 'Closed Co',
      is_active: false,
    };
    const localTables: DemoTables = {
      ...tables,
      businesses: [...tables.businesses!, inactiveBusiness],
      business_users: [
        ...tables.business_users!,
        {
          id: 'de110000-0000-4000-8000-0000000000fe',
          business_id: inactiveBusiness.id,
          user_id: DEMO_USER_ID,
          role: 'owner',
          is_active: true,
        },
      ],
    };

    const { data } = await new DemoQueryBuilder('business_users', localTables)
      .select('role, business:businesses!inner(*)')
      .eq('user_id', DEMO_USER_ID)
      .eq('businesses.is_active', true)
      .is('businesses.deleted_at', null);

    const memberships = data as DemoRow[];
    expect(memberships).toHaveLength(1);
    expect((memberships[0].business as DemoRow).id).toBe(DEMO_BUSINESS_ID);
  });

  it('embeds many-to-one with an alias and a column list', async () => {
    const data = await rows(
      from('invoices')
        .select('invoice_number, total_amount, contact:contacts(name, city)')
        .limit(3),
    );
    expect(data).toHaveLength(3);
    for (const invoice of data) {
      const contact = invoice.contact as DemoRow;
      expect(contact).toBeTruthy();
      expect(Object.keys(contact).sort()).toEqual(['city', 'name']);
    }
  });

  it('embeds one-to-many child collections', async () => {
    const data = await rows(
      from('invoices').select('invoice_number, invoice_lines(id, quantity, line_total)').limit(2),
    );
    for (const invoice of data) {
      const lines = invoice.invoice_lines as DemoRow[];
      expect(Array.isArray(lines)).toBe(true);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines[0]).toHaveProperty('line_total');
    }

    const aliased = await rows(from('payroll_runs').select('run_number, lines:payroll_employee_lines(*)'));
    expect(aliased).toHaveLength(6);
    expect((aliased[0].lines as DemoRow[]).length).toBe(3);
  });

  it('resolves journal_lines → journal_entries!inner like the reports do', async () => {
    const data = await rows(
      from('journal_lines')
        .select('account_id, is_debit, amount_base, journal_entries!inner(entry_date, status, business_id)')
        .limit(5),
    );
    expect(data).toHaveLength(5);
    for (const line of data) {
      const entry = line.journal_entries as DemoRow;
      expect(entry.status).toBe('posted');
      expect(entry.business_id).toBe(DEMO_BUSINESS_ID);
    }
  });

  it('reads computed views through from()', async () => {
    const trial = await rows(from('v_trial_balance').select('*').eq('business_id', DEMO_BUSINESS_ID));
    expect(trial.length).toBeGreaterThan(50);
    expect(trial[0]).toHaveProperty('balance');

    const cashFlow = await rows(from('v_cash_flow').select('*').order('period', { ascending: false }));
    expect(cashFlow.length).toBeGreaterThan(0);
    expect(cashFlow[0]).toHaveProperty('net_change');
  });
});

describe('demo query builder — writes', () => {
  function sandbox(): DemoTables {
    // Deep-ish copy so write tests never leak into the read tests.
    return JSON.parse(JSON.stringify(tables)) as DemoTables;
  }

  it('inserts a row, fills id/created_at and returns it via select().single()', async () => {
    const local = sandbox();
    const { data, error } = await new DemoQueryBuilder('contacts', local)
      .insert({ business_id: DEMO_BUSINESS_ID, name: 'Test Customer', contact_type: 'customer' })
      .select('*')
      .single();

    expect(error).toBeNull();
    const created = data as DemoRow;
    expect(created.name).toBe('Test Customer');
    expect(String(created.id)).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.created_at).toBeTruthy();
    expect(local.contacts).toHaveLength(tables.contacts!.length + 1);
  });

  it('updates rows matching the filters and returns the updated row', async () => {
    const local = sandbox();
    const target = local.invoices![0];
    const { data, error } = await new DemoQueryBuilder('invoices', local)
      .update({ status: 'void', notes: 'cancelled in demo' })
      .eq('id', target.id)
      .select('*')
      .maybeSingle();

    expect(error).toBeNull();
    expect((data as DemoRow).status).toBe('void');
    expect((data as DemoRow).notes).toBe('cancelled in demo');
    expect(local.invoices![0].status).toBe('void');
  });

  it('upserts on a composite conflict key', async () => {
    const local = sandbox();
    const existing = local.inventory_balances![0];
    const { data } = await new DemoQueryBuilder('inventory_balances', local)
      .upsert(
        {
          business_id: existing.business_id,
          product_id: existing.product_id,
          location_id: existing.location_id,
          quantity_on_hand: 999,
        },
        { onConflict: 'business_id,product_id,location_id' },
      )
      .select('*');

    expect((data as DemoRow[])[0].quantity_on_hand).toBe(999);
    expect(local.inventory_balances).toHaveLength(tables.inventory_balances!.length);
  });

  it('deletes rows matching the filters', async () => {
    const local = sandbox();
    const before = local.invoice_payments!.length;
    const target = local.invoice_payments![0];
    const { error } = await new DemoQueryBuilder('invoice_payments', local)
      .delete()
      .eq('id', target.id);

    expect(error).toBeNull();
    expect(local.invoice_payments).toHaveLength(before - 1);
  });

  it('soft-deletes via update, and the soft-deleted row is excluded by .is(deleted_at, null)', async () => {
    const local = sandbox();
    const target = local.expenses![0];
    await new DemoQueryBuilder('expenses', local)
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', target.id)
      .select('*');

    const visible = await rows(
      new DemoQueryBuilder('expenses', local).select('*').is('deleted_at', null).eq('id', target.id),
    );
    expect(visible).toHaveLength(0);
  });

  it('refuses writes to a view', async () => {
    const local = sandbox();
    const { error } = await new DemoQueryBuilder('v_trial_balance', local)
      .insert({ business_id: DEMO_BUSINESS_ID })
      .select('*');
    expect(error).not.toBeNull();
  });
});
