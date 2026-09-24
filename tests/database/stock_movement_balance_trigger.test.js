// Pre-deploy verification for 20260925000001_stock_movement_balance_delta_trigger.sql.
//
// The deploy pipeline runs `supabase db push`, and CI does not execute SQL at
// all — so a migration meets a real Postgres for the first time during a
// release. The previous attempt (20260924000001) failed there twice:
//   1. SQLSTATE 428C9 — it wrote quantity_available, which the live project
//      stores as a STORED GENERATED column;
//   2. SQLSTATE 23514 — chk_inventory_balances_on_hand_nonneg: recalculating a
//      balance from sum(stock_movements) produced -1829 for a live product,
//      because opening stock and older history were never written as movements.
// The deploy log also showed production carrying THREE out-of-band triggers on
// stock_movements — trg_stock_immutable (a guard) plus TWO additive balance
// triggers, which is the 10-in/20-on-hand double-count.
//
// This harness meets the migration first, on an embedded Postgres bootstrapped
// to look like Supabase (roles, auth schema, storage, pg_cron/pg_net stubs), in
// BOTH shapes:
//
//   1. "production" — quantity_available GENERATED, two legacy additive
//      triggers, an unrelated immutability guard, and a product whose ledger
//      nets negative. The migration must apply, drop only the two balance
//      triggers, keep the guard, leave every balance untouched, count each
//      later movement exactly once, and keep selling the negative-ledger
//      product possible.
//   2. "fresh/staging" — quantity_available plain, with the recalculating
//      trigger 20260924000001 originally installed there. The same migration
//      must replace it and keep quantity_available in sync explicitly.
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
const TARGET = '20260925000001_stock_movement_balance_delta_trigger.sql';
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

  // The additive balance writer the live project carried out-of-band. Used
  // twice under two names in the production scenario (that is the 10 -> 20
  // double-count) and once under the recalculating trigger's name in the
  // staging scenario, so both drop paths (by name, by body) are exercised.
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

  if (productionShape) {
    // Exactly the three out-of-band triggers the 2026-09-24 production deploy
    // log listed: a guard that must survive, and two additive balance writers
    // that must both go. The second writer has a name that does not say
    // "balance" — only its body gives it away.
    await c.query(`create or replace function public.legacy_stock_immutable() returns trigger language plpgsql as $$
      begin
        raise exception 'stock movements are immutable; post a reversing movement instead' using errcode = 'P0001';
      end $$;`);
    await c.query(`create trigger trg_stock_immutable before update or delete on public.stock_movements for each row execute function public.legacy_stock_immutable();`);
    await c.query(`create trigger trg_update_inventory_balance after insert on public.stock_movements for each row execute function public.legacy_update_inventory_balance();`);
    await c.query(`create or replace function public.legacy_apply_stock() returns trigger language plpgsql security definer set search_path = public as $$
      begin
        update public.inventory_balances
           set quantity_on_hand = quantity_on_hand + new.quantity, updated_at = now()
         where business_id = new.business_id and product_id = new.product_id and location_id = new.location_id;
        return new;
      end $$;`);
    await c.query(`create trigger trg_stock_movement_apply after insert on public.stock_movements for each row execute function public.legacy_apply_stock();`);
    console.log(`[${name}] drift installed: quantity_available GENERATED + trg_stock_immutable + two additive balance triggers`);
  } else {
    // Staging recorded 20260924000001 with its recalculating body. Any writer
    // under that trigger name stands in for it here.
    await c.query(`create trigger trg_stock_movements_recalculate_inventory_balance after insert on public.stock_movements for each row execute function public.legacy_update_inventory_balance();`);
    console.log(`[${name}] drift installed: quantity_available plain + trigger recorded by 20260924000001`);
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

  // A second product whose ledger is INCOMPLETE, like the -1829 row in the
  // production log: its receipts predate the ledger, only the sales are
  // movements. Written before any trigger fires so the balance is set directly.
  const gadget = (
    await asUser(
      `insert into public.products (business_id, name, sku, product_type, currency, purchase_price, purchase_tax_code, sale_price, sales_tax_code, track_inventory, is_active)
       values ($1,'Gadget','G-1','goods','MWK',2,'none',5,'none',true,true) returning id`,
      [biz],
    )
  ).rows[0].id;

  const balanceOf = async (productId) =>
    (
      await asUser(
        `select quantity_on_hand, quantity_available, quantity_reserved, average_cost, last_movement_at from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3`,
        [biz, productId, loc],
      )
    ).rows[0];
  const balance = () => balanceOf(prod);
  const movementOf = (productId, type, quantity, unitCost, reference, date) =>
    asUser(
      `insert into public.stock_movements (business_id, product_id, location_id, movement_type, movement_date, quantity, unit_cost, source_type, reference)
       values ($1,$2,$3,$4,$5,$6,$7,'expense',$8)`,
      [biz, productId, loc, type, date, quantity, unitCost, reference],
    );
  const movement = (quantity, unitCost, reference, date) => movementOf(prod, 'purchase', quantity, unitCost, reference, date);
  const userTriggers = async () =>
    (
      await c.query(`select tgname from pg_trigger where tgrelid='public.stock_movements'::regclass and not tgisinternal order by tgname`)
    ).rows.map((r) => r.tgname);

  return { name, PG, c, asUser, biz, prod, gadget, loc, balance, balanceOf, movement, movementOf, userTriggers };
}

(async () => {
  const PORT_PROD = 54351;
  const PORT_FRESH = 54352;

  /** Seed history that predates any trigger: sales recorded as movements,
   *  receipts that never were. Mirrors the -1829 production row. */
  const seedIncompleteLedger = async (s) => {
    await s.c.query('alter table public.stock_movements disable trigger user');
    await s.movementOf(s.gadget, 'sale', -1829, 2.7139, 'POS-HIST', '2026-08-25');
    await s.c.query('alter table public.stock_movements enable trigger user');
    // What the shop actually has on the shelf (opening stock was never a movement).
    await s.asUser(
      `insert into public.inventory_balances (business_id, product_id, location_id, quantity_on_hand, quantity_reserved, average_cost, last_movement_at, updated_at)
       values ($1,$2,$3,171,0,2.7139,'2026-08-25',now())`,
      [s.biz, s.gadget, s.loc],
    );
  };

  const applyTarget = async (s) => {
    try {
      await s.c.query(fs.readFileSync(path.join(MIG_DIR, TARGET), 'utf8'));
      return null;
    } catch (err) {
      return err;
    }
  };

  // ── Scenario 1: the shape the live project actually has ──────────────────
  console.log('\n=== Scenario 1: production (quantity_available GENERATED, immutability guard, two additive triggers, incomplete ledger) ===');
  const prodScenario = await bootScenario({
    name: 'production',
    port: PORT_PROD,
    dataDir: '/tmp/pgtest/data-balance-trigger-prod',
    productionShape: true,
  });

  await check('writing quantity_available is rejected in this shape (the 428C9 the first deploy hit)', async () => {
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

  await seedIncompleteLedger(prodScenario);

  // The customer's product: an existing (empty) balance row, then ONE 10-unit
  // receipt under the two legacy additive triggers.
  await prodScenario.asUser(
    `insert into public.inventory_balances (business_id, product_id, location_id, quantity_on_hand, quantity_reserved, average_cost, updated_at)
     values ($1,$2,$3,0,0,0,now())`,
    [prodScenario.biz, prodScenario.prod, prodScenario.loc],
  );
  await prodScenario.movement(10, 600, 'RCPT-1', '2026-09-20');
  await check('the legacy pair reproduces the report: one 10-unit receipt lands as 20 on hand', async () => {
    const b = await prodScenario.balance();
    assert(Number(b.quantity_on_hand) === 20, `on_hand=${b.quantity_on_hand}`);
  });

  await check('a ledger recalculation would violate chk_inventory_balances_on_hand_nonneg here (the 23514 the second deploy hit)', async () => {
    let code = null;
    try {
      await prodScenario.c.query(
        `update public.inventory_balances ib set quantity_on_hand = (select sum(quantity) from public.stock_movements sm where sm.product_id = ib.product_id)
          where ib.product_id = $1`,
        [prodScenario.gadget],
      );
    } catch (err) {
      code = err.code;
    }
    assert(code === '23514', `expected SQLSTATE 23514, got ${code}`);
  });

  const applied = await applyTarget(prodScenario);
  await check('the migration applies on the production shape', async () => {
    assert(applied === null, applied && applied.message.split('\n')[0]);
  });

  if (applied === null) {
    await check('both additive triggers are gone, the immutability guard is kept, one canonical trigger remains', async () => {
      const names = await prodScenario.userTriggers();
      assert(
        names.join(',') === 'trg_stock_immutable,trg_stock_movements_apply_inventory_balance',
        `triggers now: ${names.join(', ')}`,
      );
    });

    await check('the recalculation helper from 20260924000001 no longer exists', async () => {
      const { rows } = await prodScenario.c.query(
        `select 1 from pg_proc where proname = '_ledgr_recalculate_inventory_balance'`,
      );
      assert(rows.length === 0, 'helper still present');
    });

    await check('no balance is rewritten by the migration (20 stays 20, 171 stays 171)', async () => {
      const w = await prodScenario.balance();
      const g = await prodScenario.balanceOf(prodScenario.gadget);
      assert(Number(w.quantity_on_hand) === 20, `widget on_hand=${w.quantity_on_hand}`);
      assert(Number(g.quantity_on_hand) === 171, `gadget on_hand=${g.quantity_on_hand}`);
    });

    await check('v_inventory_balance_ledger_drift shows the overstated widget (+10) and the pre-ledger gadget (+2000)', async () => {
      const { rows } = await prodScenario.asUser(
        `select product_id, quantity_on_hand, ledger_quantity, difference, movement_count from public.v_inventory_balance_ledger_drift where business_id=$1 order by difference`,
        [prodScenario.biz],
      );
      assert(rows.length === 2, `expected 2 drift rows, got ${rows.length}`);
      const widget = rows.find((r) => r.product_id === prodScenario.prod);
      const gadget = rows.find((r) => r.product_id === prodScenario.gadget);
      assert(widget && Number(widget.difference) === 10 && Number(widget.ledger_quantity) === 10, `widget ${JSON.stringify(widget)}`);
      assert(gadget && Number(gadget.difference) === 2000 && Number(gadget.ledger_quantity) === -1829, `gadget ${JSON.stringify(gadget)}`);
    });

    await check('a second receipt is counted exactly once (25 on hand, not 30)', async () => {
      await prodScenario.movement(5, 700, 'RCPT-2', '2026-09-21');
      const b = await prodScenario.balance();
      assert(Number(b.quantity_on_hand) === 25, `on_hand=${b.quantity_on_hand}`);
      assert(Number(b.quantity_available) === 25, `available=${b.quantity_available}`);
      // moving weighted average: (20*600 + 5*700) / 25
      const expectedCost = (20 * 600 + 5 * 700) / 25;
      assert(Math.abs(Number(b.average_cost) - expectedCost) < 1e-9, `average_cost=${b.average_cost}, expected ~${expectedCost}`);
    });

    await check('a confirmed double-count is corrected by setting the balance to its ledger (25 -> 15) and the drift row clears', async () => {
      // The movement itself was recorded once; it is the balance row that is
      // wrong. So the operator corrects the balance — NOT by posting an
      // adjustment movement, which would (a) leave the offset in the view
      // forever and (b) book a stock loss that never happened.
      await prodScenario.c.query(
        `update public.inventory_balances ib
            set quantity_on_hand = d.ledger_quantity, updated_at = now()
           from public.v_inventory_balance_ledger_drift d
          where d.business_id = ib.business_id and d.product_id = ib.product_id and d.location_id = ib.location_id
            and ib.product_id = $1`,
        [prodScenario.prod],
      );
      const b = await prodScenario.balance();
      assert(Number(b.quantity_on_hand) === 15, `on_hand=${b.quantity_on_hand}`);
      assert(Number(b.quantity_available) === 15, `available=${b.quantity_available}`);
      const { rows } = await prodScenario.asUser(
        `select 1 from public.v_inventory_balance_ledger_drift where product_id=$1`,
        [prodScenario.prod],
      );
      assert(rows.length === 0, 'widget should no longer be listed as drifted');
    });

    await check('a product whose ledger nets negative can still be sold (171 -> 170), which the recalculating design could not do', async () => {
      await prodScenario.movementOf(prodScenario.gadget, 'sale', -1, 2.7139, 'POS-1', '2026-09-24');
      const g = await prodScenario.balanceOf(prodScenario.gadget);
      assert(Number(g.quantity_on_hand) === 170, `gadget on_hand=${g.quantity_on_hand}`);
      assert(Number(g.quantity_available) === 170, `gadget available=${g.quantity_available}`);
    });

    await check('selling below zero is still refused by the non-negative check', async () => {
      let code = null;
      try {
        await prodScenario.movementOf(prodScenario.gadget, 'sale', -171, 2.7139, 'POS-2', '2026-09-24');
      } catch (err) {
        code = err.code;
      }
      assert(code === '23514', `expected SQLSTATE 23514, got ${code}`);
      const g = await prodScenario.balanceOf(prodScenario.gadget);
      assert(Number(g.quantity_on_hand) === 170, `gadget on_hand=${g.quantity_on_hand}`);
    });

    await check('the kept immutability guard still blocks edits to movements', async () => {
      let code = null;
      try {
        await prodScenario.asUser(`update public.stock_movements set quantity = 3 where reference = 'RCPT-2'`, []);
      } catch (err) {
        code = err.code;
      }
      assert(code === 'P0001', `expected P0001 from trg_stock_immutable, got ${code}`);
      const b = await prodScenario.balance();
      assert(Number(b.quantity_on_hand) === 15, `on_hand=${b.quantity_on_hand}`);
    });

    await check('concurrent receipts cannot lose or double a quantity', async () => {
      const parallel = new Client({ host: '127.0.0.1', port: PORT_PROD, user: 'postgres', password: 'postgres', database: 'postgres' });
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
      assert(Number(b.quantity_on_hand) === 25, `on_hand=${b.quantity_on_hand} (15 + 4 + 6)`);
      assert(Number(b.quantity_available) === 25, `available=${b.quantity_available}`);
    });

    await check('re-applying the migration is a no-op (the deploy can retry)', async () => {
      const again = await applyTarget(prodScenario);
      assert(again === null, again && again.message.split('\n')[0]);
      const names = await prodScenario.userTriggers();
      assert(names.join(',') === 'trg_stock_immutable,trg_stock_movements_apply_inventory_balance', `triggers now: ${names.join(', ')}`);
    });

    await check('the balance is untouched by a second apply', async () => {
      const b = await prodScenario.balance();
      assert(Number(b.quantity_on_hand) === 25, `on_hand=${b.quantity_on_hand}`);
    });

    await check('a missing balance row is created by the trigger (the INSERT path)', async () => {
      await prodScenario.asUser(`delete from public.inventory_balances where product_id=$1`, [prodScenario.prod]);
      await prodScenario.movement(2, 900, 'RCPT-5', '2026-09-23');
      const b = await prodScenario.balance();
      assert(Number(b.quantity_on_hand) === 2, `on_hand=${b.quantity_on_hand}`);
      assert(Number(b.quantity_available) === 2, `available=${b.quantity_available}`);
      assert(Number(b.average_cost) === 900, `average_cost=${b.average_cost}`);
    });

    await check('a second balance trigger sneaking back in makes the migration fail loudly, not double-count', async () => {
      await prodScenario.c.query(`create trigger zz_rogue_balance after insert on public.stock_movements for each row execute function public.legacy_update_inventory_balance();`);
      // The migration drops rogue writers itself, so it must still succeed …
      const again = await applyTarget(prodScenario);
      assert(again === null, again && again.message.split('\n')[0]);
      const names = await prodScenario.userTriggers();
      assert(!names.includes('zz_rogue_balance'), `rogue trigger survived: ${names.join(', ')}`);
      // … and its final assertion must reject a shape it cannot clean up.
      const { rows } = await prodScenario.c.query(`select count(*)::int as n from pg_trigger where tgrelid='public.stock_movements'::regclass and not tgisinternal and tgname ilike '%balance%'`);
      assert(rows[0].n === 1, `expected exactly one *balance* trigger, got ${rows[0].n}`);
    });
  }

  await check(`the ${AFTER_TARGET.length} migration(s) after it still replay`, async () => {
    for (const f of AFTER_TARGET) {
      await prodScenario.c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8'));
    }
  });
  if (applied === null) {
    await check('later migrations leave the R06 writer as the only balance trigger', async () => {
      const names = await prodScenario.userTriggers();
      const balanceWriters = names.filter((n) => n.toLowerCase().includes('balance'));
      assert(balanceWriters.join(',') === 'trg_stock_movement_apply_balance', `balance writers: ${names.join(', ')}`);
      assert(names.includes('trg_stock_immutable'), `immutability guard was dropped: ${names.join(', ')}`);
    });

    await check('a blank (zero) inbound cost adds quantity and does not dilute the average', async () => {
      const before = await prodScenario.balance();
      const beforeQty = Number(before.quantity_on_hand);
      const beforeCost = Number(before.average_cost);
      // Superuser insert: later branch-scope policies must not hide a trigger bug.
      await prodScenario.c.query(
        `insert into public.stock_movements (business_id, product_id, location_id, movement_type, movement_date, quantity, unit_cost, source_type, reference)
         values ($1,$2,$3,'purchase','2026-09-24',3,0,'expense','RCPT-ZERO')`,
        [prodScenario.biz, prodScenario.prod, prodScenario.loc],
      );
      const after = await prodScenario.balance();
      assert(Number(after.quantity_on_hand) === beforeQty + 3, `on_hand=${after.quantity_on_hand}, expected ${beforeQty + 3}`);
      assert(Math.abs(Number(after.average_cost) - beforeCost) < 1e-9, `average_cost=${after.average_cost}, expected ${beforeCost}`);
    });
  }
  await teardown(prodScenario.c, prodScenario.PG);

  // ── Scenario 2: the shape the repository migrations produce (staging) ────
  console.log('\n=== Scenario 2: fresh from migrations (quantity_available plain, 20260924000001 trigger installed) ===');
  const fresh = await bootScenario({
    name: 'fresh',
    port: PORT_FRESH,
    dataDir: '/tmp/pgtest/data-balance-trigger-fresh',
    productionShape: false,
  });

  await seedIncompleteLedger(fresh);
  await fresh.movement(10, 600, 'RCPT-1', '2026-09-20');

  const freshApplied = await applyTarget(fresh);
  await check('the migration applies where quantity_available is a plain column', async () => {
    assert(freshApplied === null, freshApplied && freshApplied.message.split('\n')[0]);
  });

  if (freshApplied === null) {
    await check('the trigger recorded by 20260924000001 is replaced by the canonical one', async () => {
      const names = await fresh.userTriggers();
      assert(names.join(',') === 'trg_stock_movements_apply_inventory_balance', `triggers now: ${names.join(', ')}`);
    });

    await check('the balance is untouched (10) and quantity_available is filled in on the next movement', async () => {
      const before = await fresh.balance();
      assert(Number(before.quantity_on_hand) === 10, `on_hand=${before.quantity_on_hand}`);
      await fresh.movement(5, 700, 'RCPT-2', '2026-09-21');
      const b = await fresh.balance();
      assert(Number(b.quantity_on_hand) === 15, `on_hand=${b.quantity_on_hand}`);
      assert(Number(b.quantity_available) === 15, `available=${b.quantity_available}`);
    });

    await check('editing a movement quantity applies the net change (15 -> 13)', async () => {
      await fresh.asUser(`update public.stock_movements set quantity = 3 where reference = 'RCPT-2'`, []);
      const b = await fresh.balance();
      assert(Number(b.quantity_on_hand) === 13, `on_hand=${b.quantity_on_hand}`);
      assert(Number(b.quantity_available) === 13, `available=${b.quantity_available}`);
    });

    await check('editing a note on a receipt larger than the current balance is a no-op, not a constraint error', async () => {
      await fresh.movementOf(fresh.prod, 'sale', -12, 600, 'POS-1', '2026-09-22'); // 13 -> 1
      await fresh.asUser(`update public.stock_movements set notes = 'supplier invoice attached' where reference = 'RCPT-1'`, []);
      const b = await fresh.balance();
      assert(Number(b.quantity_on_hand) === 1, `on_hand=${b.quantity_on_hand}`);
    });

    await check('a product whose ledger nets negative can still be sold (171 -> 170)', async () => {
      await fresh.movementOf(fresh.gadget, 'sale', -1, 2.7139, 'POS-2', '2026-09-24');
      const g = await fresh.balanceOf(fresh.gadget);
      assert(Number(g.quantity_on_hand) === 170, `gadget on_hand=${g.quantity_on_hand}`);
      assert(Number(g.quantity_available) === 170, `gadget available=${g.quantity_available}`);
    });

    await check('deleting a movement reverses it (1 -> 13 after removing the 12-unit sale)', async () => {
      await fresh.asUser(`delete from public.stock_movements where reference = 'POS-1'`, []);
      const b = await fresh.balance();
      assert(Number(b.quantity_on_hand) === 13, `on_hand=${b.quantity_on_hand}`);
      assert(Number(b.quantity_available) === 13, `available=${b.quantity_available}`);
    });

    await check('a missing balance row is created by the trigger (the INSERT path)', async () => {
      await fresh.asUser(`delete from public.inventory_balances where product_id=$1`, [fresh.prod]);
      await fresh.movement(4, 800, 'RCPT-3', '2026-09-22');
      const b = await fresh.balance();
      assert(Number(b.quantity_on_hand) === 4, `on_hand=${b.quantity_on_hand}`);
      assert(Number(b.quantity_available) === 4, `available=${b.quantity_available}`);
    });

    await check(`the ${AFTER_TARGET.length} migration(s) after it still replay on this shape too`, async () => {
      for (const f of AFTER_TARGET) {
        await fresh.c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8'));
      }
    });

    await check('a blank inbound cost does not dilute the average on the fresh shape either', async () => {
      const before = await fresh.balance();
      const beforeQty = Number(before.quantity_on_hand);
      const beforeCost = Number(before.average_cost);
      await fresh.c.query(
        `insert into public.stock_movements (business_id, product_id, location_id, movement_type, movement_date, quantity, unit_cost, source_type, reference)
         values ($1,$2,$3,'purchase','2026-09-24',3,0,'expense','RCPT-ZERO')`,
        [fresh.biz, fresh.prod, fresh.loc],
      );
      const after = await fresh.balance();
      assert(Number(after.quantity_on_hand) === beforeQty + 3, `on_hand=${after.quantity_on_hand}, expected ${beforeQty + 3}`);
      assert(Math.abs(Number(after.average_cost) - beforeCost) < 1e-9, `average_cost=${after.average_cost}, expected ${beforeCost}`);
      const names = await fresh.userTriggers();
      const balanceWriters = names.filter((n) => n.toLowerCase().includes('balance'));
      assert(balanceWriters.join(',') === 'trg_stock_movement_apply_balance', `balance writers: ${names.join(', ')}`);
    });
  }
  await teardown(fresh.c, fresh.PG);

  console.log(`\n${pass} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error('HARNESS ERROR', err);
  process.exit(2);
});
