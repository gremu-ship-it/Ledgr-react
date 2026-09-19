// Pre-deploy verification for the posting-integrity migrations.
//
// The deploy pipeline runs `supabase db push`, and CI does not execute SQL at
// all — so three migrations (20260921000000 / …000001 / …000002) would meet a
// real Postgres for the first time during a release. This harness meets them
// first, on an embedded Postgres bootstrapped to look like Supabase (roles,
// auth schema, storage, pg_cron/pg_net stubs), and asserts the contracts the
// application now depends on:
//
//   1. Every migration replays in order, including the three new ones, and
//      re-applying the new ones is a no-op (they are guarded and idempotent).
//   2. `journal_entries.posting_key` exists with a PARTIAL unique index:
//      (business_id, posting_key) can only exist once, and the many rows with
//      no key at all are unaffected.
//   3. `stock_movements.client_key` is a uuid column, so a readable compound
//      key is rejected with 22P02 (the F6 bug, reproduced) while a derived
//      uuid is accepted — which is why src/lib/clientKeys.ts exists.
//   4. `_ledgr_assert_usage_limit` counts DOCUMENTS (invoices + expenses +
//      payroll runs) and does NOT count journal entries: 49 invoices pass, the
//      50th on a Free plan raises, 60 journal entries change nothing, and one
//      payroll run tips it over.
//   5. `ledgr_monthly_document_count` agrees with the guard, and answers NULL
//      to a non-member (no cross-business usage leak).
//
// Run: node tests/database/posting_integrity_migrations.test.js
// (requires `embedded-postgres` + `pg`, e.g. npm i -D embedded-postgres pg)
//
// Installing those dev-only packages can reconcile the rest of node_modules
// against package.json ranges rather than package-lock.json — that drifted
// eslint-plugin-react-refresh once and produced a bogus lint error. If it
// happens, `npm ci` restores the tree; LEDGR_MIGRATIONS_DIR lets this script
// run with the harness packages installed elsewhere.
import EPkg from 'embedded-postgres';
import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const EP = EPkg.default ?? EPkg;
const requireFromHere = createRequire(import.meta.url);

/**
 * Extension dir of the Postgres build this process will actually run: the
 * pg_cron/pg_net stubs below have to land in the same server's sharedir, or
 * `create extension` fails with "extension is not available". Resolved from the
 * embedded-postgres entry point, since its package.json is not exported.
 */
function extensionDir() {
  const roots = [];
  try {
    const entry = requireFromHere.resolve('embedded-postgres');
    const marker = `${path.sep}embedded-postgres${path.sep}`;
    const at = entry.lastIndexOf(marker);
    const pkgRoot = at === -1 ? path.dirname(entry) : entry.slice(0, at + marker.length - 1);
    roots.push(
      path.join(pkgRoot, 'node_modules/@embedded-postgres/linux-x64/native'),
      path.join(pkgRoot, '../@embedded-postgres/linux-x64/native'),
    );
  } catch {
    /* fall through to the well-known locations */
  }
  roots.push(
    '/home/user/Ledgr-react/node_modules/@embedded-postgres/linux-x64/native',
    '/tmp/node_modules/@embedded-postgres/linux-x64/native',
  );

  const native = roots.find((dir) => fs.existsSync(path.join(dir, 'bin/postgres')));
  assert(native, `could not find the bundled Postgres (looked in ${roots.join(', ')})`);
  return path.join(native, 'share/postgresql/extension');
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 54334;
const DATA_DIR = '/tmp/pgtest-postintegrity/data';
const MIG_DIR =
  process.env.LEDGR_MIGRATIONS_DIR ?? path.resolve(__dirname, '../../supabase/migrations');
const NEW_MIGRATIONS = [
  '20260921000000_journal_posting_key_idempotency.sql',
  '20260921000001_usage_limit_counts_documents.sql',
  '20260921000002_usage_document_count_rpc.sql',
];

let pass = 0;
let failures = 0;
const ok = (label) => {
  pass += 1;
  console.log('  PASS', label);
};
const fail = (label, err) => {
  failures += 1;
  console.log('  FAIL', label, '::', (err && (err.message || err)) || '');
};
const check = async (label, fn) => {
  try {
    await fn();
    ok(label);
  } catch (err) {
    fail(label, err);
  }
};

/** Postgres error code of a rejected statement, or null if it succeeded. */
async function errorCode(client, sql, params = []) {
  try {
    await client.query(sql, params);
    return null;
  } catch (err) {
    return err.code ?? `no-code:${err.message}`;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/** Same construction as src/lib/clientKeys.ts (digest + ordinal in the tail). */
function deriveClientKey(parentKey, ordinal = 0) {
  const fnv = (input, seed) => {
    let hash = seed >>> 0;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  };
  let digest = '';
  for (let lane = 0; digest.length < 18; lane += 1) {
    digest += fnv(parentKey, (0x811c9dc5 ^ Math.imul(lane + 1, 0x9e3779b9)) >>> 0)
      .toString(16)
      .padStart(8, '0');
  }
  const tail = Math.max(0, Math.trunc(ordinal)).toString(16).padStart(12, '0').slice(-12);
  return [
    digest.slice(0, 8),
    digest.slice(8, 12),
    `4${digest.slice(12, 15)}`,
    `8${digest.slice(15, 18)}`,
    tail,
  ].join('-');
}

async function teardown(client, pg) {
  try {
    await client.end();
  } catch {
    /* already closed */
  }
  try {
    await pg.stop();
  } catch {
    /* already stopped */
  }
}

async function main() {
  const PG = new EP({ databaseDir: DATA_DIR, user: 'postgres', password: 'postgres', port: PORT, persistent: true });
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  await PG.initialise();
  await PG.start();
  const c = new Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: 'postgres', database: 'postgres' });
  await c.connect();

  // ── Supabase-flavoured environment (mirrors quick_save_rpc_source_uuid) ──
  await c.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOLOGIN; END IF;
  END $$; GRANT anon, authenticated, service_role TO authenticator;`);
  await c.query(`CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, created_at timestamptz default now());
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role', true) $$;
    GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role; GRANT SELECT ON auth.users TO anon, authenticated, service_role;`);
  await c.query(`CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    CREATE TABLE IF NOT EXISTS storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, created_at timestamptz default now());
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS $$ select string_to_array(name, '/') $$;
    GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
    GRANT ALL ON storage.objects TO anon, authenticated, service_role;
    GRANT ALL ON storage.buckets TO anon, authenticated, service_role;`);
  const EXT = extensionDir();
  assert(fs.existsSync(EXT), `Postgres extension dir not found (looked in ${EXT})`);
  fs.writeFileSync(path.join(EXT, 'pg_cron.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(path.join(EXT, 'pg_cron--1.0.sql'), "create schema if not exists cron;\ncreate table if not exists cron.job (jobid bigint primary key, schedule text, command text, active boolean default true);\ncreate sequence if not exists cron.jobid_seq;\ncreate or replace function cron.schedule(name text, schedule text, command text) returns bigint language plpgsql as $$ declare v bigint; begin insert into cron.job values (nextval('cron.jobid_seq'), schedule, command, true) returning jobid into v; return v; end $$;\n");
  fs.writeFileSync(path.join(EXT, 'pg_net.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(path.join(EXT, 'pg_net--1.0.sql'), "create schema if not exists net;\ncreate type net.http_response as (status integer, message text, body text);\ncreate or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds integer default 5000) returns net.http_response language sql stable as $$ select null::integer, null::text, null::text $$;\n");
  await c.query(`CREATE EXTENSION pg_cron; CREATE EXTENSION pg_net; CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pg_trgm;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;`);
  await c.query('set search_path = "$user", public, extensions');

  // ── 1. Replay every migration, in deploy order ───────────────────────────
  const files = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    try {
      await c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8'));
    } catch (err) {
      fail(`replay ${f}`, err.message.split('\n')[0]);
      console.log(`\n${pass} passed, ${failures} failed`);
      await teardown(c, PG);
      process.exit(1);
    }
  }
  ok(`replay all ${files.length} migrations (incl. the ${NEW_MIGRATIONS.length} new ones)`);

  for (const f of NEW_MIGRATIONS) {
    assert(files.includes(f), `${f} is not in supabase/migrations/`);
  }

  // Re-applying the new migrations must be a no-op (the deploy can retry).
  await check('the new migrations are idempotent', async () => {
    for (const f of NEW_MIGRATIONS) {
      await c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8'));
    }
  });

  // ── 2. posting_key: column, partial uniqueness ───────────────────────────
  const q = (sql, params) => c.query(sql, params);

  const ownerId = '10000000-0000-0000-0000-0000000000bb';
  await q(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'owner@t.com','{"full_name":"Owner"}')`, [ownerId]);
  await q(`select set_config('request.jwt.claim.sub', $1, false)`, [ownerId]);
  await q(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
  const biz = (
    await q(`select public.create_business_with_owner('Posting Co','Posting',null,null,null,true,'MWK','07-01','Africa/Blantyre',null,'Blantyre','Malawi',null,null,null,'INV','EXP','PAY') as id`)
  ).rows[0].id;

  await check('journal_entries.posting_key exists', async () => {
    const { rows } = await q(
      `select data_type from information_schema.columns
        where table_schema='public' and table_name='journal_entries' and column_name='posting_key'`,
    );
    assert(rows.length === 1, 'column posting_key is missing');
    assert(rows[0].data_type === 'text', `expected text, got ${rows[0].data_type}`);
  });

  await check('the posting_key index is unique, partial and per business', async () => {
    const { rows } = await q(
      `select indexdef from pg_indexes
        where schemaname='public' and tablename='journal_entries'
          and indexname='journal_entries_posting_key_uidx'`,
    );
    assert(rows.length === 1, 'journal_entries_posting_key_uidx is missing');
    const def = rows[0].indexdef.toLowerCase();
    assert(def.includes('unique'), `index is not unique: ${def}`);
    assert(def.includes('business_id'), `index does not include business_id: ${def}`);
    assert(def.includes('posting_key is not null'), `index is not partial: ${def}`);
  });

  /** A minimal balanced pair of lines for a keyed entry. */
  const accounts = (
    await q(`select code, id from public.accounts where business_id = $1 and code in ('1131','4112')`, [biz])
  ).rows;
  const accId = (code) => accounts.find((a) => a.code === code).id;
  const seedEntries = async (key) => {
    const entry = (
      await q(
        `insert into public.journal_entries (business_id, entry_number, entry_date, description, currency, exchange_rate, status, source_type, posting_key)
         values ($1, $2, current_date, 'keyed posting', 'MWK', 1, 'draft', 'invoice', $3) returning id`,
        [biz, `JNL-KEY-${key ?? Math.random().toString(36).slice(2, 8)}`, key],
      )
    ).rows[0].id;
    await q(
      `insert into public.journal_lines (journal_entry_id, business_id, line_number, account_id, description, is_debit, amount, amount_base, currency, exchange_rate, tax_amount, reconciled)
       values ($1,$2,1,$3,'x',true,100,100,'MWK',1,0,false), ($1,$2,2,$4,'x',false,100,100,'MWK',1,0,false)`,
      [entry, biz, accId('1131'), accId('4112')],
    );
    return entry;
  };

  await check('a duplicate (business_id, posting_key) is rejected', async () => {
    await seedEntries('invoice:test-1:sale');
    const code = await errorCode(
      c,
      `insert into public.journal_entries (business_id, entry_number, entry_date, description, currency, exchange_rate, status, posting_key)
       values ($1,'JNL-DUP-1',current_date,'dup','MWK',1,'draft','invoice:test-1:sale')`,
      [biz],
    );
    assert(code === '23505', `expected a unique violation (23505), got ${code}`);
  });

  await check('unkeyed and NULL-keyed entries are unaffected', async () => {
    await seedEntries(null);
    await seedEntries(null);
    await seedEntries('invoice:test-2:sale');
    const { rows } = await q(
      `select count(*)::int as n from public.journal_entries where business_id=$1 and posting_key is null`,
      [biz],
    );
    assert(rows[0].n >= 2, `expected the unkeyed rows to exist, got ${rows[0].n}`);
  });

  // ── 3. client_key is a uuid column (the F6 bug, reproduced) ──────────────
  const loc = (
    await q(`insert into public.inventory_locations (business_id, name, is_active, is_default) values ($1,'Main',true,true) returning id`, [biz])
  ).rows[0].id;
  const prod = (
    await q(
      `insert into public.products (business_id, name, sku, product_type, track_inventory, is_active, purchase_price, sale_price, reorder_level, reorder_quantity, purchase_tax_code, sales_tax_code, currency, cogs_account_id, inventory_account_id, sales_account_id)
       select $1,'Widget','WID','product',true,true,500,750,5,10,'none','none','MWK',
              (select id from public.accounts where business_id=$1 and code='5100'),
              (select id from public.accounts where business_id=$1 and code='1141'),
              (select id from public.accounts where business_id=$1 and code='4110') returning id`,
      [biz],
    )
  ).rows[0].id;

  const movement = (clientKey) =>
    q(
      `insert into public.stock_movements (business_id, product_id, location_id, movement_type, movement_date, quantity, unit_cost, source_type, client_key)
       values ($1,$2,$3,'sale',current_date,-1,500,'invoice',$4) returning id`,
      [biz, prod, loc, clientKey],
    );

  await check('a compound client_key is rejected by the uuid column (F6)', async () => {
    const invoiceId = '7f000000-0000-4000-8000-000000000001';
    let thrown = null;
    try {
      await movement(`${invoiceId}:mv:0`);
    } catch (err) {
      thrown = err;
    }
    assert(thrown, 'the compound key was accepted — the column is not uuid');
    assert(
      thrown.code === '22P02',
      `expected 22P02 (invalid input syntax for type uuid), got ${thrown.code}: ${thrown.message}`,
    );
  });

  await check('the derived uuid is accepted, and replays collide instead of duplicating', async () => {
    const invoiceId = '7f000000-0000-4000-8000-000000000002';
    const key = deriveClientKey(invoiceId, 0);
    assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key), `not a v4-shaped uuid: ${key}`);
    await movement(key);

    let thrown = null;
    try {
      await movement(key); // the replay
    } catch (err) {
      thrown = err;
    }
    assert(thrown, 'the replayed movement was accepted — nothing de-duplicates it');
    assert(thrown.code === '23505', `expected a unique violation on the replay, got ${thrown.code}`);
  });

  // ── 4. The plan guard counts documents, not journal entries ──────────────
  const thisMonth = `(date_trunc('month', current_date) + interval '1 day')::date`;
  const contact = (
    await q(
      `insert into public.contacts (business_id, name, contact_type, is_active, wht_exempt) values ($1,'Customer A','customer',true,false) returning id`,
      [biz],
    )
  ).rows[0].id;

  const addInvoice = (n) =>
    q(
      `insert into public.invoices (business_id, invoice_number, invoice_type, contact_id, issue_date, currency, exchange_rate, status,
                                    subtotal, vat_amount, wht_amount, discount_amount, discount_percent, taxable_amount, total_amount, amount_paid)
       values ($1, $2, 'tax_invoice', $3, ${thisMonth}, 'MWK', 1, 'draft', 1000, 0, 0, 0, 0, 1000, 1000, 0)`,
      [biz, `INV-VERIFY-${n}`, contact],
    );
  const addExpense = (n) =>
    q(
      `insert into public.expenses (business_id, expense_number, expense_type, expense_date, currency, exchange_rate, status,
                                    subtotal, vat_amount, wht_amount, total_amount, amount_paid)
       values ($1, $2, 'receipt', ${thisMonth}, 'MWK', 1, 'paid', 500, 0, 0, 500, 500)`,
      [biz, `EXP-VERIFY-${n}`],
    );
  const addPayrollRun = (n) =>
    q(
      `insert into public.payroll_runs (business_id, run_number, payroll_period, period_start, period_end, pay_date, status,
                                        total_gross, total_net, total_paye, total_other_deductions)
       values ($1, $2, 'September', date_trunc('month', current_date)::date, current_date, ${thisMonth}, 'draft', 1000, 900, 100, 0)`,
      [biz, `PAY-VERIFY-${n}`],
    );

  const guardCode = async () => {
    try {
      await q(`select public._ledgr_assert_usage_limit($1)`, [biz]);
      return null;
    } catch (err) {
      return err.code ?? `no-code:${err.message}`;
    }
  };
  const documentCount = async () =>
    Number(
      (
        await q(
          `select ((select count(*) from public.invoices     where business_id=$1 and issue_date   >= date_trunc('month', current_date)::date)
                 + (select count(*) from public.expenses     where business_id=$1 and expense_date >= date_trunc('month', current_date)::date)
                 + (select count(*) from public.payroll_runs where business_id=$1 and pay_date     >= date_trunc('month', current_date)::date))::int as n`,
          [biz],
        )
      ).rows[0].n,
    );

  await check('a Free business at 49 documents passes the guard', async () => {
    await q(`update public.businesses set plan_tier='free' where id=$1`, [biz]);
    for (let i = 1; i <= 49; i += 1) await addInvoice(i);
    assert((await documentCount()) === 49, `expected 49 documents, got ${await documentCount()}`);
    assert((await guardCode()) === null, 'the guard refused a business under its limit');
  });

  await check('the 50th document trips it, with the upgrade message', async () => {
    await addExpense(1);
    const code = await guardCode();
    assert(code === 'P0001', `expected P0001, got ${code}`);
    let message = '';
    try {
      await q(`select public._ledgr_assert_usage_limit($1)`, [biz]);
    } catch (err) {
      message = err.message;
    }
    assert(/Monthly transaction limit reached \(50\)/.test(message), `unexpected message: ${message}`);
  });

  await check('journal entries do NOT count towards the limit', async () => {
    // The regression that motivated 20260921000001: a till sale posts a sale
    // entry, a receipt and a COGS entry, so counting entries tripled usage.
    await q(`delete from public.expenses where business_id=$1 and expense_number='EXP-VERIFY-1'`, [biz]);
    assert((await guardCode()) === null, 'the guard still refuses at 49 documents');
    for (let i = 0; i < 60; i += 1) await seedEntries(`bulk:${i}`);
    assert((await guardCode()) === null, '60 journal entries pushed the business over its document limit');
  });

  await check('a payroll run counts as a document', async () => {
    await addPayrollRun(1);
    const code = await guardCode();
    assert(code === 'P0001', `expected the payroll run to trip the guard, got ${code}`);
  });

  await check('a higher plan lifts the limit', async () => {
    // `trg_enforce_plan_tier_change` (20260726000002) blocks a raw plan upgrade on
    // purpose — plan changes must go through billing. The guard under test only
    // reads the tier, so the trigger is disabled for this statement.
    await q(`alter table public.businesses disable trigger trg_enforce_plan_tier_change`);
    try {
      await q(`update public.businesses set plan_tier='pro' where id=$1`, [biz]);
    } finally {
      await q(`alter table public.businesses enable trigger trg_enforce_plan_tier_change`);
    }
    assert((await guardCode()) === null, 'the guard refused a Pro business well under 2,000 documents');
  });

  // ── 5. The client-facing count agrees with the guard ────────────────────
  await check('ledgr_monthly_document_count agrees with a direct count', async () => {
    const expected = await documentCount();
    const { rows } = await q(`select public.ledgr_monthly_document_count($1)::int as n`, [biz]);
    assert(rows[0].n === expected, `RPC said ${rows[0].n}, direct count says ${expected}`);
  });

  await check('ledgr_monthly_document_count answers NULL to a non-member', async () => {
    const stranger = '10000000-0000-0000-0000-0000000000cc';
    await q(`insert into auth.users (id, email) values ($1,'stranger@t.com')`, [stranger]);
    await q(`select set_config('request.jwt.claim.sub', $1, false)`, [stranger]);
    const { rows } = await q(`select public.ledgr_monthly_document_count($1) as n`, [biz]);
    assert(rows[0].n === null, `a non-member read the usage count: ${rows[0].n}`);
    await q(`select set_config('request.jwt.claim.sub', $1, false)`, [ownerId]);
  });

  await check('authenticated may execute the count RPC', async () => {
    const { rows } = await q(
      `select has_function_privilege('authenticated', 'public.ledgr_monthly_document_count(uuid)', 'execute') as allowed`,
    );
    assert(rows[0].allowed === true, 'authenticated cannot execute ledgr_monthly_document_count');
  });

  console.log(`\n${pass} passed, ${failures} failed`);
  await teardown(c, PG);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('harness crashed:', err);
  process.exit(1);
});
