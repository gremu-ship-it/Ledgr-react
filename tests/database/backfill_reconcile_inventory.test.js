// Pre-deploy verification for 20260926000001_fix_backfill_and_recalculate_inventory.sql.
//
// The Warehouse "Reconcile stock levels" tool calls
// backfill_and_recalculate_inventory(). The 20260730000005 version ended by
// REWRITING every inventory_balances row as sum(stock_movements.quantity); on
// production (2026-09-24) that proposed on_hand = -3 for a live product and
// died on chk_inventory_balances_on_hand_nonneg (SQLSTATE 23514), rolling the
// whole run back. This harness replays every migration onto an embedded
// Postgres in the PRODUCTION shape (quantity_available STORED GENERATED, the
// canonical delta trigger of 20260925000001 installed) and proves the fixed
// RPC:
//
//   1. backfills missing purchase and sale movements with the right costing
//      (sales at weighted-average inbound cost, never the selling price),
//   2. records implied opening stock for sales whose units were never
//      received on the ledger, instead of driving a balance negative,
//   3. NEVER rewrites a balance from the ledger — a product with pre-ledger
//      opening stock keeps its balance minus the backfilled sale (the exact
//      row that produced the -3 incident),
//   4. is idempotent, keeps quantity_available in sync on the generated
//      shape, enforces its authorization, and still answers the NULL
//      all-businesses form for service_role.
//
// Run: node tests/database/backfill_reconcile_inventory.test.js
// (requires `embedded-postgres` + `pg`, e.g. npm i -D embedded-postgres pg)
import EPkg from 'embedded-postgres';
import { Client } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const EP = EPkg.default ?? EPkg;
const requireFromHere = createRequire(import.meta.url);

/** Extension dir of the Postgres build this process will actually run. */
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
const TARGET = '20260926000001_fix_backfill_and_recalculate_inventory.sql';
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

/** Boot an embedded Postgres that looks like Supabase (production shape:
 *  quantity_available STORED GENERATED) and replay every migration that ships
 *  before the target. */
async function bootScenario({ name, port, dataDir }) {
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

  // Production carries quantity_available as a STORED generated column; patch
  // the base schema DDL before replaying (same technique as
  // stock_movement_balance_trigger.test.js).
  const base = fs.readFileSync(path.join(MIG_DIR, BEFORE_TARGET[0]), 'utf8');
  const patchedBase = base.replace(
    /quantity_available numeric  -- \[CONVENTION\]/,
    'quantity_available numeric generated always as (quantity_on_hand - quantity_reserved) stored  -- [CONVENTION]',
  );
  assert(patchedBase !== base, 'could not patch the base schema quantity_available column');

  for (const f of BEFORE_TARGET) {
    const sql = f === BEFORE_TARGET[0] ? patchedBase : fs.readFileSync(path.join(MIG_DIR, f), 'utf8');
    try {
      await c.query(sql);
    } catch (err) {
      fail(`replay ${f}`, err.message.split('\n')[0]);
      await teardown(c, PG);
      process.exit(1);
    }
  }
  console.log(`[${name}] replayed ${BEFORE_TARGET.length} migrations (target held back)`);

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
  const asService = async (sql, params) => {
    await c.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await c.query(`select set_config('request.jwt.claim.role', 'service_role', false)`);
    await c.query('set role service_role');
    try {
      return await c.query(sql, params);
    } finally {
      await c.query('reset role');
    }
  };
  const biz = (
    await asUser(`select public.create_business_with_owner('Backfill Co','Owner',null,null,null,true,'MWK','07-01','Africa/Blantyre',null,'Blantyre','Malawi',null,null,null,'INV','EXP','PAY') as id`)
  ).rows[0].id;
  const loc = (
    await asUser(`insert into public.inventory_locations (business_id, name, is_default, is_active) values ($1,'Main Warehouse',true,true) returning id`, [biz])
  ).rows[0].id;

  const product = async (name, sku, purchasePrice, salePrice) =>
    (
      await asUser(
        `insert into public.products (business_id, name, sku, product_type, currency, purchase_price, purchase_tax_code, sale_price, sales_tax_code, track_inventory, is_active)
         values ($1,$2,$3,'goods','MWK',$4,'none',$5,'none',true,true) returning id`,
        [biz, name, sku, purchasePrice, salePrice],
      )
    ).rows[0].id;

  const balanceOf = async (productId) =>
    (
      await asUser(
        `select quantity_on_hand, quantity_available, quantity_reserved, average_cost from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3`,
        [biz, productId, loc],
      )
    ).rows[0];

  return { name, PG, c, asUser, asService, biz, loc, product, balanceOf };
}

(async () => {
  const PORT = 54353;

  console.log('\n=== Reconcile stock levels RPC on the production shape (quantity_available GENERATED, canonical delta trigger) ===');
  const s = await bootScenario({
    name: 'production',
    port: PORT,
    dataDir: '/tmp/pgtest/data-backfill-rpc',
  });

  // ── Fixtures ──────────────────────────────────────────────────────────────
  // W "Widget": an expense and an invoice recorded before tracking existed.
  //   purchase 5 @ 600, then sale 3 — sale must cost at 600 (WAC), NOT at
  //   the 1000 selling price.
  const widget = await s.product('Widget', 'W-1', 600, 1000);
  // G "Ghost": an invoice with NO purchase history anywhere — the sale's units
  //   were never received on the ledger. Must not drive the balance negative.
  const ghost = await s.product('Ghost', 'G-1', 1200, 5000);
  // L "Legacy": real on-hand stock that predates the ledger (10 units, set as
  //   a balance row; only the later sales are movements). The -3 incident row:
  //   rewriting its balance to sum(ledger) is exactly what blew up.
  const legacy = await s.product('Legacy', 'L-1', 600, 1500);
  // D "Done": expense and invoice that already have their movements.
  const done = await s.product('Done', 'D-1', 700, 1500);

  const contact = (
    await s.asUser(
      `insert into public.contacts (business_id, name, contact_type, is_active, wht_exempt) values ($1,'Customer A','customer',true,false) returning id`,
      [s.biz],
    )
  ).rows[0].id;

  const expense = async (number, date, productId, qty, unitPrice) => {
    const e = (
      await s.asUser(
        `insert into public.expenses (business_id, expense_number, expense_type, expense_date, status, currency, exchange_rate, rate_is_stale,
           subtotal, discount_percent, total_amount, vat_amount, wht_amount, amount_paid)
         values ($1,$2,'stock',$3,'paid','MWK',1,false,$4,0,$4,0,0,$4) returning id`,
        [s.biz, number, date, qty * unitPrice],
      )
    ).rows[0].id;
    await s.asUser(
      `insert into public.expense_lines (business_id, expense_id, line_number, description, product_id, quantity, unit_price, line_total, tax_code, tax_rate, tax_amount, discount_percent)
       values ($1,$2,1,'stock in',$3,$4,$5,$6,'none',0,0,0)`,
      [s.biz, e, productId, qty, unitPrice, qty * unitPrice],
    );
    return e;
  };
  const invoice = async (number, date, productId, qty, unitPrice) => {
    const i = (
      await s.asUser(
        `insert into public.invoices (business_id, invoice_number, invoice_type, issue_date, status, contact_id, currency, exchange_rate, rate_is_stale,
           subtotal, discount_percent, discount_amount, taxable_amount, total_amount, vat_amount, wht_amount, amount_paid)
         values ($1,$2,'standard',$3,'paid',$4,'MWK',1,false,$5,0,0,$5,$5,0,0,0) returning id`,
        [s.biz, number, date, contact, qty * unitPrice],
      )
    ).rows[0].id;
    await s.asUser(
      `insert into public.invoice_lines (business_id, invoice_id, line_number, description, product_id, quantity, unit_price, line_total, tax_code, tax_rate, tax_amount, discount_percent)
       values ($1,$2,1,'goods sold',$3,$4,$5,$6,'none',0,0,0)`,
      [s.biz, i, productId, qty, unitPrice, qty * unitPrice],
    );
    return i;
  };

  const exp1 = await expense('EXP-1', '2026-07-01', widget, 5, 600); // missing purchase
  await invoice('INV-1', '2026-07-10', widget, 3, 1000); // missing sale
  await invoice('INV-2', '2026-07-15', ghost, 3, 5000); // missing sale, nothing ever received
  await invoice('INV-3', '2026-08-10', legacy, 4, 1500); // missing sale against pre-ledger stock
  const exp2 = await expense('EXP-2', '2026-07-05', done, 2, 700); // already has movements
  const inv4 = await invoice('INV-4', '2026-07-20', done, 1, 1500); // already has movements

  // Legacy product: its on-hand 10 predate the ledger; only the POS sale is a
  // movement (written before any trigger fires, like the -1829 row in the
  // 20260925000001 incident).
  await s.c.query('alter table public.stock_movements disable trigger user');
  await s.asUser(
    `insert into public.stock_movements (business_id, product_id, location_id, movement_type, movement_date, quantity, unit_cost, source_type, reference)
     values ($1,$2,$3,'sale','2026-08-01',-10,600,'pos','POS-HIST')`,
    [s.biz, legacy, s.loc],
  );
  await s.c.query('alter table public.stock_movements enable trigger user');
  await s.asUser(
    `insert into public.inventory_balances (business_id, product_id, location_id, quantity_on_hand, quantity_reserved, average_cost, last_movement_at, updated_at)
     values ($1,$2,$3,10,0,600,'2026-08-01',now())`,
    [s.biz, legacy, s.loc],
  );

  // Done product: its movements exist (each applied by the canonical trigger,
  // which also creates the balance row: +2 @ 700, then -1), and the balance
  // already agrees with them.
  await s.asUser(
    `insert into public.stock_movements (business_id, product_id, location_id, movement_type, movement_date, quantity, unit_cost, source_type, source_id, reference)
     values ($1,$2,$3,'purchase','2026-07-05',2,700,'expense',$4,'EXP-2')`,
    [s.biz, done, s.loc, exp2],
  );
  await s.asUser(
    `insert into public.stock_movements (business_id, product_id, location_id, movement_type, movement_date, quantity, unit_cost, source_type, source_id, reference)
     values ($1,$2,$3,'sale','2026-07-20',-1,700,'invoice',$4,'INV-4')`,
    [s.biz, done, s.loc, inv4],
  );

  // Apply the migration under test.
  let applied = null;
  try {
    await s.c.query(fs.readFileSync(path.join(MIG_DIR, TARGET), 'utf8'));
  } catch (err) {
    applied = err;
  }
  await check('the migration applies on the production shape', async () => {
    assert(applied === null, applied && applied.message.split('\n')[0]);
  });
  if (applied !== null) {
    await teardown(s.c, s.PG);
    console.log(`\n${pass} passed, ${failures} failed`);
    process.exit(1);
  }

  await check('the old rewrite would still violate chk_inventory_balances_on_hand_nonneg (why the RPC must not do it)', async () => {
    let code = null;
    try {
      await s.c.query(
        `update public.inventory_balances ib
            set quantity_on_hand = coalesce((select sum(sm.quantity) from public.stock_movements sm
                 where sm.business_id = ib.business_id and sm.product_id = ib.product_id and sm.location_id = ib.location_id), 0)
          where ib.product_id = $1`,
        [legacy],
      );
    } catch (err) {
      code = err.code;
    }
    assert(code === '23514', `expected SQLSTATE 23514, got ${code} (legacy ledger nets to -10)`);
  });

  // ── The reconcile run ─────────────────────────────────────────────────────
  let result = null;
  await check('the RPC completes as the tenant owner (previously: 23514 abort)', async () => {
    const { rows } = await s.asUser(`select * from public.backfill_and_recalculate_inventory($1)`, [s.biz]);
    assert(rows.length === 1, `expected 1 row, got ${rows.length}`);
    result = rows[0];
  });

  if (result) {
    await check('counts: 3 sales + 1 purchase backfilled, 1 implied opening-stock movement, 3 balances updated', async () => {
      assert(Number(result.sales_backfilled) === 3, `sales=${result.sales_backfilled}`);
      assert(Number(result.purchases_backfilled) === 1, `purchases=${result.purchases_backfilled}`);
      assert(Number(result.adjustments_inserted) === 1, `adjustments=${result.adjustments_inserted}`);
      assert(Number(result.balances_updated) === 3, `balances=${result.balances_updated}`);
    });
  }

  await check('the missing purchase landed as a movement with the expense as its source', async () => {
    const { rows } = await s.asUser(
      `select movement_type, quantity, unit_cost, source_type from public.stock_movements where source_id = $1::text`,
      [exp1],
    );
    assert(rows.length === 1, `movements for EXP-1: ${rows.length}`);
    assert(rows[0].movement_type === 'purchase' && Number(rows[0].quantity) === 5 && Number(rows[0].unit_cost) === 600, JSON.stringify(rows[0]));
  });

  await check('the widget sale was costed at the weighted-average inbound cost (600), not the 1000 selling price', async () => {
    const { rows } = await s.asUser(
      `select quantity, unit_cost from public.stock_movements where source_type='invoice' and product_id=$1 and source_id in (select id::text from public.invoices where invoice_number='INV-1')`,
      [widget],
    );
    assert(rows.length === 1, `movements for INV-1: ${rows.length}`);
    assert(Number(rows[0].quantity) === -3 && Number(rows[0].unit_cost) === 600, JSON.stringify(rows[0]));
    const b = await s.balanceOf(widget);
    assert(Number(b.quantity_on_hand) === 2, `widget on_hand=${b.quantity_on_hand}`);
    assert(Number(b.quantity_available) === 2, `widget available=${b.quantity_available} (generated column in sync)`);
    assert(Number(b.average_cost) === 600, `widget avg=${b.average_cost}`);
  });

  await check('the ghost product got an opening_balance movement for the units it never received, then absorbed its sale at 0 on hand', async () => {
    const { rows } = await s.asUser(
      `select movement_type, quantity, unit_cost, source_type, movement_date from public.stock_movements where product_id=$1 order by quantity desc`,
      [ghost],
    );
    assert(rows.length === 2, `ghost movements: ${rows.length}`);
    const opening = rows.find((r) => Number(r.quantity) > 0);
    const sale = rows.find((r) => Number(r.quantity) < 0);
    assert(opening.movement_type === 'opening_balance' && Number(opening.quantity) === 3 && Number(opening.unit_cost) === 1200, `opening: ${JSON.stringify(opening)}`);
    // movement_date is the earliest missing sale's issue date (pg may hand
    // back a Date or a string depending on version).
    assert(
      opening.source_type === 'inventory_backfill' && new Date(opening.movement_date).toISOString().startsWith('2026-07-15'),
      `opening meta: ${JSON.stringify(opening)}`,
    );
    assert(sale.movement_type === 'sale' && Number(sale.quantity) === -3 && Number(sale.unit_cost) === 1200, `sale: ${JSON.stringify(sale)}`);
    const b = await s.balanceOf(ghost);
    assert(Number(b.quantity_on_hand) === 0, `ghost on_hand=${b.quantity_on_hand}`);
    assert(Number(b.quantity_available) === 0, `ghost available=${b.quantity_available}`);
  });

  await check('the legacy product kept its pre-ledger stock: 10 − 4 = 6, never rewritten toward the -14 ledger sum', async () => {
    const b = await s.balanceOf(legacy);
    assert(Number(b.quantity_on_hand) === 6, `legacy on_hand=${b.quantity_on_hand}`);
    assert(Number(b.quantity_available) === 6, `legacy available=${b.quantity_available}`);
    const { rows } = await s.asUser(
      `select quantity, unit_cost from public.stock_movements where source_type='invoice' and product_id=$1`,
      [legacy],
    );
    assert(rows.length === 1 && Number(rows[0].quantity) === -4, `legacy sale movement: ${JSON.stringify(rows)}`);
    // No inbound history existed, so the sale costs at the purchase_price fallback.
    assert(Number(rows[0].unit_cost) === 600, `legacy sale unit_cost=${rows[0].unit_cost}`);
  });

  await check('the already-reconciled product was left completely untouched', async () => {
    const { rows } = await s.asUser(`select count(*)::int as n from public.stock_movements where product_id=$1`, [done]);
    assert(rows[0].n === 2, `done movements: ${rows[0].n}`);
    const b = await s.balanceOf(done);
    assert(Number(b.quantity_on_hand) === 1 && Number(b.average_cost) === 700, JSON.stringify(b));
  });

  await check('the ledger is now complete for every invoice/expense line (the diagnostic headline reads zero)', async () => {
    const { rows } = await s.asUser(
      `select count(*)::int as n
         from public.invoices i
         join public.invoice_lines il on il.invoice_id = i.id
         join public.products p on p.id = il.product_id
        where i.business_id=$1 and i.deleted_at is null and p.track_inventory and il.quantity > 0
          and not exists (select 1 from public.stock_movements sm
                           where sm.business_id=i.business_id and sm.source_id::text=i.id::text and sm.source_type='invoice' and sm.product_id=il.product_id)`,
      [s.biz],
    );
    assert(rows[0].n === 0, `still-missing sale lines: ${rows[0].n}`);
  });

  await check('the drift view lists only the legacy product (+20: pre-ledger opening stock plus pre-ledger POS history), nothing else', async () => {
    // balance 6 − ledger (−10 POS-HIST − 4 backfilled sale) = 6 − (−14) = +20.
    // That is the "leave it alone" shape documented for
    // v_inventory_balance_ledger_drift: history the ledger cannot vouch for.
    const { rows } = await s.asUser(
      `select product_id, difference from public.v_inventory_balance_ledger_drift where business_id=$1 order by difference`,
      [s.biz],
    );
    assert(rows.length === 1, `drift rows: ${JSON.stringify(rows)}`);
    assert(rows[0].product_id === legacy && Number(rows[0].difference) === 20, JSON.stringify(rows[0]));
  });

  await check('a second run is a no-op (idempotent; no duplicate movements, no extra opening stock)', async () => {
    const before = await s.asUser(`select count(*)::int as n from public.stock_movements where business_id=$1`, [s.biz]);
    const { rows } = await s.asUser(`select * from public.backfill_and_recalculate_inventory($1)`, [s.biz]);
    assert(Number(rows[0].sales_backfilled) === 0, `sales=${rows[0].sales_backfilled}`);
    assert(Number(rows[0].purchases_backfilled) === 0, `purchases=${rows[0].purchases_backfilled}`);
    assert(Number(rows[0].adjustments_inserted) === 0, `adjustments=${rows[0].adjustments_inserted}`);
    assert(Number(rows[0].balances_updated) === 0, `balances=${rows[0].balances_updated}`);
    const after = await s.asUser(`select count(*)::int as n from public.stock_movements where business_id=$1`, [s.biz]);
    assert(before.rows[0].n === after.rows[0].n, `movements ${before.rows[0].n} -> ${after.rows[0].n}`);
  });

  await check('authorization: authenticated callers cannot pass NULL (22004)', async () => {
    let code = null;
    try {
      await s.asUser(`select * from public.backfill_and_recalculate_inventory(null)`, []);
    } catch (err) {
      code = err.code;
    }
    assert(code === '22004', `expected 22004, got ${code}`);
  });

  await check('authorization: a business the caller cannot write is refused (42501)', async () => {
    let code = null;
    try {
      await s.asUser(`select * from public.backfill_and_recalculate_inventory($1)`, ['00000000-0000-0000-0000-000000000000']);
    } catch (err) {
      code = err.code;
    }
    assert(code === '42501', `expected 42501, got ${code}`);
  });

  await check('service_role may run the all-businesses (NULL) form', async () => {
    const { rows } = await s.asService(`select * from public.backfill_and_recalculate_inventory(null)`, []);
    assert(rows.length >= 1, `expected at least 1 business row, got ${rows.length}`);
    const ours = rows.find((r) => r.out_business_id === s.biz);
    assert(ours, 'our business missing from the NULL form');
    assert(
      Number(ours.sales_backfilled) === 0 && Number(ours.purchases_backfilled) === 0 && Number(ours.adjustments_inserted) === 0,
      `expected a quiet no-op run, got ${JSON.stringify(ours)}`,
    );
  });

  await check(`the ${AFTER_TARGET.length} migration(s) after it still replay`, async () => {
    for (const f of AFTER_TARGET) {
      await s.c.query(fs.readFileSync(path.join(MIG_DIR, f), 'utf8'));
    }
  });

  await teardown(s.c, s.PG);
  console.log(`\n${pass} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
})().catch(async (err) => {
  console.error('HARNESS ERROR', err);
  process.exit(2);
});
