// Focused PostgreSQL test for the P&L-only reversed-pair RPC.
// Run with: node tests/database/profit_loss_reversal_filter.test.js
import EmbeddedPostgresPkg from 'embedded-postgres';
import { Client } from 'pg';
import fs from 'node:fs';

const EmbeddedPostgres = EmbeddedPostgresPkg.default ?? EmbeddedPostgresPkg;
const port = 55380;
const dataDir = '/tmp/ledgr-pnl-reversal-test';
const migration = fs.readFileSync(
  new URL('../../supabase/migrations/20261130000001_profit_loss_exclude_reversal_pairs.sql', import.meta.url),
  'utf8',
);
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: true });
let client;
try {
  fs.rmSync(dataDir, { recursive: true, force: true });
  await pg.initialise();
  await pg.start();
  client = new Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres' });
  await client.connect();
  await client.query(`
    create role anon nologin;
    create role authenticated nologin;
    create type public.journal_status as enum ('draft','posted','reversed');
    create table public.branches (id uuid primary key, business_id uuid not null);
    create table public.accounts (
      id uuid primary key, business_id uuid not null, code text not null, name text not null,
      account_type text not null, parent_id uuid, level integer not null default 0
    );
    create table public.journal_entries (
      id uuid primary key, business_id uuid not null, entry_date date not null,
      branch_id uuid, status public.journal_status not null, reversal_of uuid, reversed_by uuid
    );
    create table public.journal_lines (
      id uuid primary key, business_id uuid not null, journal_entry_id uuid not null,
      account_id uuid not null, branch_id uuid, is_debit boolean not null, amount_base numeric not null
    );
    create function public.is_business_member(uuid) returns boolean language sql stable as $$ select true $$;
    create function public.can_access_branch(uuid, uuid) returns boolean language sql stable as $$ select true $$;
    create function public.get_trial_balance(
      p_business_id uuid, p_date_from date, p_date_to date, p_branch_id uuid default null
    ) returns table (
      account_id uuid, account_code text, account_name text, account_type text,
      parent_account_id uuid, total_debit numeric, total_credit numeric, balance numeric, level integer
    ) language sql stable as $tb$
      with totals as (
        select jl.account_id,
               sum(case when jl.is_debit then jl.amount_base else 0::numeric end) as debit_total,
               sum(case when not jl.is_debit then jl.amount_base else 0::numeric end) as credit_total
          from public.journal_lines jl
          join public.journal_entries je on je.id = jl.journal_entry_id and je.business_id = jl.business_id
         where jl.business_id = p_business_id
           and je.status::text in ('posted','reversed')
           and je.entry_date between p_date_from and p_date_to
           and (p_branch_id is null or je.branch_id = p_branch_id)
         group by jl.account_id
      )
      select a.id, a.code, a.name, a.account_type, a.parent_id,
             coalesce(t.debit_total,0::numeric), coalesce(t.credit_total,0::numeric),
             coalesce(t.debit_total,0::numeric) - coalesce(t.credit_total,0::numeric), a.level
        from public.accounts a
        left join totals t on t.account_id = a.id
       where a.business_id = p_business_id
       order by a.code, a.id
    $tb$;
  `);
  await client.query(migration);

  const businessId = '10000000-0000-0000-0000-000000000001';
  const revenueId = '20000000-0000-0000-0000-000000000001';
  const originalId = '30000000-0000-0000-0000-000000000001';
  const reversalId = '30000000-0000-0000-0000-000000000002';
  const ordinaryId = '30000000-0000-0000-0000-000000000003';
  await client.query(`insert into public.accounts values ($1,$2,'4112','Service Revenue','income',null,0)`, [revenueId,businessId]);
  await client.query(`
    insert into public.journal_entries (id,business_id,entry_date,status,reversal_of,reversed_by) values
      ($1,$3,'2026-10-02','reversed',null,$2),
      ($2,$3,'2026-11-02','posted',$1,null),
      ($4,$3,'2026-11-02','posted',null,null)
  `, [originalId,reversalId,businessId,ordinaryId]);
  await client.query(`
    insert into public.journal_lines (id,business_id,journal_entry_id,account_id,is_debit,amount_base) values
      ('40000000-0000-0000-0000-000000000001',$1,$2,$3,false,2184000),
      ('40000000-0000-0000-0000-000000000002',$1,$4,$3,true,2184000),
      ('40000000-0000-0000-0000-000000000003',$1,$5,$3,false,100)
  `, [businessId,originalId,revenueId,reversalId,ordinaryId]);

  const standard = await client.query(
    `select balance from public.get_trial_balance($1,'2026-11-01','2026-11-02',null) where account_id=$2`,
    [businessId,revenueId],
  );
  const pnl = await client.query(
    `select total_debit,total_credit,balance from public.get_profit_loss_trial_balance($1,'2026-11-01','2026-11-02',null) where account_id=$2`,
    [businessId,revenueId],
  );
  assert(Number(standard.rows[0].balance) === 2183900, 'canonical trial balance no longer includes the complete posted/reversed ledger');
  assert(Number(pnl.rows[0].total_debit) === 0, 'P&L RPC retained the linked reversal debit');
  assert(Number(pnl.rows[0].total_credit) === 100, 'P&L RPC dropped an ordinary posted revenue credit');
  assert(Number(pnl.rows[0].balance) === -100, 'P&L RPC did not preserve the ordinary posted revenue balance');

  console.log('PASS: P&L-only RPC excludes linked reversal pairs while canonical trial balance remains unchanged');
} finally {
  if (client) await client.end().catch(() => {});
  await pg.stop().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
}
