import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261201000000_cash_deposits.sql'),
  'utf8',
);

describe('Cash Deposits migration contract', () => {
  it('uses checked text statuses and tenant-scoped member RLS', () => {
    expect(migration).toMatch(/status\s+text\s+not null[\s\S]+check\s*\(status in \('draft', 'posted', 'voided'\)\)/i);
    expect(migration).not.toMatch(/create type\s+public\.cash_deposit/i);
    expect(migration).toContain('public.is_business_member(business_id)');
    expect(migration).toContain('alter table public.cash_deposits enable row level security');
    expect(migration).toContain('alter table public.cash_deposit_lines enable row level security');
  });

  it('atomically saves, posts and reverses deposits through protected functions', () => {
    for (const name of ['save_cash_deposit_draft', 'post_cash_deposit', 'void_cash_deposit']) {
      const start = migration.indexOf(`create or replace function public.${name}`);
      expect(start).toBeGreaterThanOrEqual(0);
      const body = migration.slice(start, migration.indexOf('as $$', start));
      expect(body).toMatch(/security definer/i);
      expect(body).toMatch(/set search_path = public/i);
    }
    expect(migration).toContain('for update');
    expect(migration).toContain("'reversal'");
    expect(migration).toContain('reversal_of');
    expect(migration).toContain("set status = 'reversed', reversed_by = v_reversal_id");
    expect(migration).toContain("set status = 'voided'");
  });

  it('posts only asset-account transfers in the business functional currency', () => {
    expect(migration).toContain("a.account_type = 'asset'");
    expect(migration).toContain("a.is_bank_account = true");
    expect(migration).toContain("not (a.code like '111%' or a.code like '112%')");
    expect(migration).toContain('or a.is_bank_account is true');
    expect(migration).toContain('coalesce(a.currency, v_currency) = v_currency');
    expect(migration).toContain('coalesce(a.currency, v_currency) <> v_currency');
    expect(migration).toContain("'cash_deposit'");
    expect(migration).not.toMatch(/account_type\s*=\s*'(income|expense)'/i);
  });
});
