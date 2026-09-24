// Pre-deploy verification for 20260924000001_fix_stock_movement_balance_trigger.sql.
//
// The deploy pipeline runs `supabase db push`, and CI does not execute SQL at
// all — so this migration meets a real Postgres for the first time during a
// release. It already failed there once, with
//   ERROR: cannot insert a non-DEFAULT value into column "quantity_available"
//   (SQLSTATE 428C9) ... Column "quantity_available" is a generated column.
// because the live project carries inventory_balances.quantity_available as a
// STORED GENERATED column (created out-of-band), while environments built from
// these migrations carry it as a plain nullable column. This harness meets the
// migration first, on an embedded Postgres bootstrapped to look like Supabase
// (roles, auth schema, storage, pg_cron/pg_net stubs), in BOTH shapes:
//
//   1. "production" — quantity_available GENERATED, plus the legacy additive
//      stock_movements trigger that double-counted a single "Receive Stock"
//      submit (10 units in, 20 on hand). The migration must apply, drop the
//      legacy trigger, repair the overstated balance back to ledger truth, and
//      count every later movement exactly once.
//   2. "fresh" — quantity_available plain and no trigger at all, which is what
//      the repository migrations produce. The same migration must apply and
//      keep quantity_available in sync explicitly.
//
// Run: node tests/database/stock_movement_balance_trigger.test.js
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
 * `create extension` fails with "extension is not available".
 */
function extensionDir() {
  const roots = [];
  try {
    const entry = requireFromHere.resolve('embedded-postgres');
    const marker = `${path.sep}embedded-postgres${path.sep}`;
    const at = entry.lastIndexOf(marker);
    if (at !== -1) {
      roots.push(path.join(entry.slice(0, at + marker.length - 1), 'node_modules/@embedded-postgres/linux-x64/native'));
      roots.push(path.join(path.dirname(entry.slice(0, at)), '@embedded-postgres/linux-x64/native'));
    }
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
const MIG_DIR = process.env.LEDGR_MIGRATIONS_DIR ?? path.resolve(__dirname, '../../supabase/migrations');
const TARGET = '20260924000001_fix_stock_movement_balance_trigger.sql';
const ALL_MIGRATIONS = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
const BEFORE_TARGET = ALL_MIGRATIONS.filter((f) => f < TARGET);
const AFTER_TARGET = ALL_MIGRATIONS.filter((f) => f > TARGET);

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
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

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

/** Boot an embedded Postgres that looks like Supabase, replay every migration
 *  that ships before the target, and optionally install the out-of-band drift
 *  the live project carries. */
async function bootScenario({ name, port, dataDir, productionShape }) {
  const PG = new EP({ databaseDir: dataDir, user: 'postgres', password: 'postgres', port, persistent: true });
  fs.rmSync(dataDir, { recursive: true, force: true });
  await PG.initialise();
  await PG.start();
  const c = new Client({ host: '127.0.0.1', port, user: 'postgres', password: 'postgres', database: 'postgres' });
  await c.connect();
  c.on('error', () => {});

  await c.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator') THEN CREATE ROLE authenticator NOLOGIN; END IF;
  END $$; GRANT anon, authenticated, service_role TO authenticator;`);
  await c.query(`CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid primary key, email text, raw_user_meta_data jsonb, created_at timestamptz default now());
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;
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
  fs.writeFileSync(path.join(EXT, 'pg_cron.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(path.join(EXT, 'pg_cron--1.0.sql'), "create schema if not exists cron; create table if not exists cron.job (jobid bigint primary key, schedule text, command text, active boolean default true); create sequence if not exists cron.jobid_seq; create or replace function cron.schedule(name text, schedule text, command text) returns bigint language plpgsql as $$ declare v bigint; begin insert into cron.job values (nextval('cron.jobid_seq'), schedule, command, true) returning jobid into v; return v; end $$;\n");
  fs.writeFileSync(path.join(EXT, 'pg_net.control'), "comment='stub'\ndefault_version='1.0'\nrelocatable=true\n");
  fs.writeFileSync(path.join(EXT, 'pg_net--1.0.sql'), "create schema if not exists net; create type net.http_response as (status integer, message text, body text); create or replace function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds integer default 5000) returns net.http_response language sql stable as $$ select null::integer, null::text, null::text $$;\n");
  await c.query(`CREATE EXTENSION pg_cron; CREATE EXTENSION pg_net; CREATE SCHEMA IF NOT EXISTS extensions; CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions; CREATE EXTENSION IF NOT EXISTS pg_trgm;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role; GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;`);
  await c.query('set search_path = "$user", public, extensions');

  // Production carries quantity_available as a STORED generated column, which
  // PostgreSQL can only express at CREATE/ADD COLUMN time — so patch the base
  // schema DDL before replaying. (ALTER COLUMN ... ADD GENERATED is not a
  // thing; that is why the migration has to tolerate both shapes.)
  let patchedBase = null;
  if (productionShape) {
    const base = fs.readFileSync(path.join(MIG_DIR, BEFORE_TARGET[0]), 'utf8');
    patchedBase = base.replace(
      /quantity_available numeric  -- \[CONVENTION\]/,
      'quantity_available numeric generated always as (quantity_on_hand - quantity_reserved) stored  -- [CONVENTION]',
    );
    assert(patchedBase !== base, 'could not patch the base schema quantity_available column');
  }

  for (const f of BEFORE_TARGET) {
    const sql = f === BEFORE_TARGET[0] && patchedBase ? patchedBase : fs.readFileSync(path.join(MIG_DIR, f), 'utf8');
    try {
      await c.query(sql);
    } catch (err) {
      fail(`replay ${f}`, err.message.split('\n')[0]);
      await teardown(c, PG);
      process.exit(1);
    }
  }
  console.log(`[${name}] replayed ${BEFORE_TARGET.length} migrations (target held back)`);

  if (productionShape) {
    // The out-of-band legacy trigger: additive, so a single 10-unit receipt
    // landed as 20 on hand. It cannot write quantity_available itself (that is
    // the generated column), which is why the customer saw the on-hand double.
    await c.query(`create or replace function public.legacy_update_inventory_balance() returns trigger language plpgsql security definer set search_path = public as $$
      begin
        insert into public.inventory_balances (business_id, product_id, location_id, quantity_on_hand, quantity_reserved, average_cost, last_movement_at, updated_at)
        values (new.business_id, new.product_id, new.location_id, new.quantity, 0, new.unit_cost, now(), now())
        on conflict (business_id, product_id, location_id) do update set
          quantity_on_hand = public.inventory_balances.quantity_on_hand + new.quantity,
          average_cost = new.unit_cost,
          last_movement_at = now(),
          updated_at = now();
        return new;
      end $$;`);
    await c.query(`create trigger trg_legacy_stock_movements_balance after insert on public.stock_movements for each row execute function public.legacy_update_inventory_balance();`);
    console.log(`[${name}] drift installed: quantity_available is GENERATED + legacy additive trigger`);
  }

  const uid = '10000000-0000-0000-0000-000000000001';
  await c.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1,'owner@t.com','{}')`, [uid]);
  const asUser = async (sql, params) => {
    await c.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
    await c.query(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
    await c.query('set role authenticated');
    try {
      return await c.query(sql, params);
    } finally {
      await c.query('reset role');
    }
  };
  const biz = (
    await asUser(`select public.create_business_with_owner('Trigger Co','Owner',null,null,null,true,'MWK','07-01','Africa/Blantyre',null,'Blantyre','Malawi',null,null,null,'INV','EXP','PAY') as id`)
  ).rows[0].id;
  const loc = (
    await asUser(`insert into public.inventory_locations (business_id, name, is_default, is_active) values ($1,'Main Warehouse',true,true) returning id`, [biz])
  ).rows[0].id;
  const prod = (
    await asUser(
      `insert into public.products (business_id, name, sku, product_type, currency, purchase_price, purchase_tax_code, sale_price, sales_tax_code, track_inventory, is_active)
       values ($1,'Widget','W-1','goods','MWK',600,'none',1000,'none',true,true) returning id`,
      [biz],
    )
  ).rows[0].id;

  const balance = async () =>
    (
      await asUser(
        `select quantity_on_hand, quantity_available, quantity_reserved, average_cost from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3`,
        [biz, prod, loc],
      )
    ).rows[0];
  const movement = (quantity, unitCost, reference, date) =>
    asUser(
      `insert into public.stock_movements (business_id, product_id, location_id, movement_type, movement_date, quantity, unit_cost, source_type, reference)
       values ($1,$2,$3,'purchase',$4,$5,$6,'expense',$7)`,
      [biz, prod, loc, date, quantity, unitCost, reference],
    );

  return { name, PG, c, asUser, biz, prod, loc, balance, movement };
}

(async () => {
  // ── Scenario 1: the shape the live project actually has ──────────────────
  console.log('\n=== Scenario 1: production (quantity_available GENERATED, legacy additive trigger) ===');
  const prodScenario = await bootScenario({
    name: 'production',
    port: 54351,
    dataDir: '/tmp/pgtest/data-balance-trigger-prod',
    productionShape: true,
  });

  // The drift is real: writing the derived column is rejected outright.
  await check('writing quantity_available is rejected in this shape (the 428C9 the deploy hit)', async () => {
    let code = null;
    try {
      await prodScenario.c.query(
        `insert into public.inventory_balances (business_id, product_id, location_id, quantity_on_hand, quantity_available, quantity_reserved, average_cost, updated_at)
         values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, 1, 0, 0, now())`,
      );
    } catch (err) {
      code = err.code;
    }
    assert(code === '428C9', `expected SQLSTATE 428C9, got ${code}`);
  });

  // One 10-unit receipt under the legacy additive trigger.
  await prodScenario.movement(10, 600, 'RCPT-1', '2026-09-20');
  const baseline = await prodScenario.balance();
  assert(Number(baseline.quantity_on_hand) === 10, `baseline on_hand should be 10, got ${baseline.quantity_on_hand}`);
  // A balance already overstated by the duplicate trigger before this fix.
  await prodScenario.asUser(`update public.inventory_balances set quantity_on_hand = 20 where product_id=$1`, [prodScenario.prod]);

  let applied = null;
  try {
    await prodScenario.c.query(fs.readFileSync(path.join(MIG_DIR, TARGET), 'utf8'));
  } catch (err) {
    applied = err;
  }
  await check('the migration applies where quantity_available is a generated column', async () => {
    assert(applied === null, applied && applied.message.split('\n')[0]);
  });

  if (applied === null) {
    await check('the legacy additive trigger is gone, exactly one canonical trigger remains', async () => {
      const { rows } = await prodScenario.c.query(
        `select tgname from pg_trigger where tgrelid='public.stock_movements'::regclass and not tgisinternal order by tgname`,
      );
      assert(rows.length === 1, `expected 1 user trigger, got ${rows.map((r) => r.tgname).join(', ')}`);
      assert(rows[0].tgname === 'trg_stock_movements_recalculate_inventory_balance', `unexpected trigger ${rows[0].tgname}`);
    });

    await check('the overstated balance is repaired back to ledger truth (20 -> 10)', async () => {
      const b = await prodScenario.balance();
      assert(Number(b.quantity_on_hand) === 10, `on_hand=${b.quantity_on_hand}`);
      assert(Number(b.quantity_available) === 10, `available=${b.quantity_available}`);
      assert(Number(b.average_cost) === 600, `average_cost=${b.average_cost}`);
    });

    await check('a second receipt is counted exactly once (15 on hand, not 25)', async () => {
      await prodScenario.movement(5, 700, 'RCPT-2', '2026-09-21');
      const b = await prodScenario.balance();
      assert(Number(b.quantity_on_hand) === 15, `on_hand=${b.quantity_on_hand}`);
      assert(Number(b.quantity_available) === 15, `available=${b.quantity_available}`);
      // weighted-average cost over inbound movements: (10*600 + 5*700) / 15
      const expectedCost = (10 * 600 + 5 * 700) / 15;
      assert(Math.abs(Number(b.average_cost) - expectedCost) < 1e-9, `average_cost=${b.average_cost}, expected ~${expectedCost}`);
    });

    await check('editing a movement recalculates from the ledger', async () => {
      await prodScenario.asUser(`update public.stock_movements set quantity = 3 where reference = 'RCPT-2'`, []);
      const b = await prodScenario.balance();
      assert(Number(b.quantity_on_hand) === 13, `on_hand=${b.quantity_on_hand}`);
      assert(Number(b.quantity_available) === 13, `available=${b.quantity_available}`);
    });

    await check('concurrent receipts cannot lose or double a quantity', async () => {
      const parallel = new Client({ host: '127.0.0.1', port: 54351, user: 'postgres', password: 'postgres', database: 'postgres' });
      await parallel.connect();
      parallel.on('error', () => {});
      await parallel.query(`select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', false)`);
      await parallel.query(`select set_config('request.jwt.claim.role', 'authenticated', false)`);
      await Promise.all([
        parallel.query(
          `insert into public.stock_movements (business_id, product_id, location_id, movement_type, movement_date, quantity, unit_cost, source_type, reference)
           values ($1,$2,$3,'purchase','2026-09-22',4,800,'expense','RCPT-3')`,
          [prodScenario.biz, prodScenario.prod, prodScenario.loc],
        ),
        parallel.query(
          `insert into public.stock_movements (business_id, product_id, location_id, movement_type, movement_date, quantity, unit_cost, source_type, reference)
           values ($1,$2,$3,'purchase','2026-09-22',6,800,'expense','RCPT-4')`,
          [prodScenario.biz, prodScenario.prod, prodScenario.loc],
        ),
      ]);
      await parallel.end();
      const b = await prodScenario.balance();
      assert(Number(b.quantity_on_hand) === 23, `on_hand=${b.quantity_on_hand} (13 + 4 + 6)`);
      assert(Number(b.quantity_available) === 23, `available=${b.quantity_available}`);
    });

    await check('re-applying the migration is a no-op (the deploy can retry)', async () => {
      await prodScenario.c.query(fs.readFileSync(path.join(MIG_DIR, TARGET), 'utf8'));
    });

    await check('the balance is untouched by a second apply', async () => {
      const b = await prodScenario.balance();
      assert(Number(b.quantity_on_hand) === 23, `on_hand=${b.quantity_on_hand}`);
    });

    await check('a missing balance row is created by the trigger (the INSERT path)', async () => {
      await prodScenario.asUser(`delete from public.inventory_balances where product_id=$1`, [prodScenario.prod]);
      await prodScenario.movement(2, 900, 'RCPT-5', '2026-09-23');
      const b = await prodScenario.balance();
      assert(Number(b.quantity_on_hand) === 25, `on_hand=${b.quantity_on_hand} (23 + 2)`);
      assert(Number(b.quantity_available) === 25, `available=${b.quantity_available}`);
    });
  }

  await check(`the ${AFTER_TARGET.length} migration(s) after it still replay`, async () => {
    for (const f of AFTER_TARGET) {
      await prodScenario.c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8'));
    }
  });
  await teardown(prodScenario.c, prodScenario.PG);

  // ── Scenario 2: the shape the repository migrations produce ──────────────
  console.log('\n=== Scenario 2: fresh from migrations (quantity_available plain, no trigger) ===');
  const fresh = await bootScenario({
    name: 'fresh',
    port: 54352,
    dataDir: '/tmp/pgtest/data-balance-trigger-fresh',
    productionShape: false,
  });

  // Nothing maintains balances yet, so emulate the app-level backfill write.
  await fresh.asUser(
    `insert into public.inventory_balances (business_id, product_id, location_id, quantity_on_hand, quantity_reserved, quantity_available, average_cost, last_movement_at, updated_at)
     values ($1,$2,$3,10,0,10,600,now(),now())`,
    [fresh.biz, fresh.prod, fresh.loc],
  );
  await fresh.movement(10, 600, 'RCPT-1', '2026-09-20');

  let freshApplied = null;
  try {
    await fresh.c.query(fs.readFileSync(path.join(MIG_DIR, TARGET), 'utf8'));
  } catch (err) {
    freshApplied = err;
  }
  await check('the migration applies where quantity_available is a plain column', async () => {
    assert(freshApplied === null, freshApplied && freshApplied.message.split('\n')[0]);
  });

  if (freshApplied === null) {
    await check('quantity_available is maintained by the trigger (10)', async () => {
      const b = await fresh.balance();
      assert(Number(b.quantity_on_hand) === 10, `on_hand=${b.quantity_on_hand}`);
      assert(Number(b.quantity_available) === 10, `available=${b.quantity_available}`);
    });

    await check('a second receipt keeps the plain column in sync (15)', async () => {
      await fresh.movement(5, 700, 'RCPT-2', '2026-09-21');
      const b = await fresh.balance();
      assert(Number(b.quantity_on_hand) === 15, `on_hand=${b.quantity_on_hand}`);
      assert(Number(b.quantity_available) === 15, `available=${b.quantity_available}`);
    });

    await check('deleting the last movement zeroes the balance (0/0)', async () => {
      await fresh.asUser(`delete from public.stock_movements`, []);
      const b = await fresh.balance();
      assert(Number(b.quantity_on_hand) === 0, `on_hand=${b.quantity_on_hand}`);
      assert(Number(b.quantity_available) === 0, `available=${b.quantity_available}`);
    });

    await check('a missing balance row is created by the trigger (the INSERT path)', async () => {
      await fresh.asUser(`delete from public.inventory_balances where product_id=$1`, [fresh.prod]);
      await fresh.movement(4, 800, 'RCPT-3', '2026-09-22');
      const b = await fresh.balance();
      assert(Number(b.quantity_on_hand) === 4, `on_hand=${b.quantity_on_hand}`);
      assert(Number(b.quantity_available) === 4, `available=${b.quantity_available}`);
    });
  }
  await teardown(fresh.c, fresh.PG);

  console.log(`\n${pass} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error('HARNESS ERROR', err);
  process.exit(2);
});
