// Focused Postgres integration test for the additive inventory integrity migration.
// Run with: node tests/database/inventory_movement_integrity.test.js
import EmbeddedPostgresPkg from 'embedded-postgres';
import { Client } from 'pg';
import fs from 'node:fs';

const EmbeddedPostgres = EmbeddedPostgresPkg.default ?? EmbeddedPostgresPkg;
const port = 55379;
const dataDir = '/tmp/ledgr-inventory-integrity-test';
const migration = fs.readFileSync(
  new URL('../../supabase/migrations/20261130000000_inventory_movement_integrity.sql', import.meta.url),
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
    create role service_role nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create function auth.role() returns text language sql stable as $$ select 'service_role'::text $$;
    create type public.stock_movement_type as enum (
      'purchase','sale','adjustment_in','adjustment_out','transfer_in','transfer_out'
    );
    create table public.stock_transfers (
      id uuid primary key, business_id uuid not null, from_location_id uuid not null,
      to_location_id uuid not null, transfer_number text not null, status text not null,
      dispatched_at timestamptz, received_at timestamptz, received_by uuid,
      updated_at timestamptz not null default now()
    );
    create table public.stock_transfer_lines (
      id uuid primary key, business_id uuid not null, transfer_id uuid not null references public.stock_transfers(id),
      product_id uuid not null, quantity_requested numeric not null, quantity_dispatched numeric,
      quantity_received numeric, unit_cost numeric not null
    );
    create table public.stock_movements (
      id uuid primary key default gen_random_uuid(), business_id uuid not null,
      product_id uuid not null, location_id uuid not null, movement_type public.stock_movement_type not null,
      movement_date date not null, quantity numeric not null, unit_cost numeric not null,
      source_type text, source_id text, reference text, notes text, created_by text,
      created_at timestamptz not null default now(), client_key uuid
    );
    create unique index stock_movements_client_key_uidx on public.stock_movements(business_id, client_key);
    create table public.inventory_balances (
      business_id uuid not null, product_id uuid not null, location_id uuid not null,
      quantity_on_hand numeric not null,
      constraint chk_inventory_balances_on_hand_nonneg check (quantity_on_hand >= 0),
      primary key (business_id, product_id, location_id)
    );
    create function public.can_write_business_data(uuid) returns boolean language sql stable as $$ select true $$;
    create function public.can_access_location(uuid, uuid) returns boolean language sql stable as $$ select true $$;
    create function public.apply_test_stock_delta() returns trigger language plpgsql as $$
    begin
      update public.inventory_balances set quantity_on_hand = quantity_on_hand + new.quantity
       where business_id = new.business_id and product_id = new.product_id and location_id = new.location_id;
      if not found then
        insert into public.inventory_balances(business_id, product_id, location_id, quantity_on_hand)
        values(new.business_id, new.product_id, new.location_id, new.quantity);
      end if;
      return new;
    end $$;
    create trigger apply_test_stock_delta after insert on public.stock_movements
      for each row execute function public.apply_test_stock_delta();
  `);
  await client.query(migration);

  const business = '10000000-0000-0000-0000-000000000001';
  const product = '20000000-0000-0000-0000-000000000001';
  const sourceLocation = '30000000-0000-0000-0000-000000000001';
  const destinationLocation = '30000000-0000-0000-0000-000000000002';
  await client.query(`
    insert into public.inventory_balances values ($1,$2,$3,5),($1,$2,$4,0)
  `, [business, product, sourceLocation, destinationLocation]);

  const saleIdentity = '40000000-0000-0000-0000-000000000001';
  const saleInsert = `insert into public.stock_movements
    (business_id,product_id,location_id,movement_type,movement_date,quantity,unit_cost,source_type,source_id,reference)
    values ($1,$2,$3,'sale',current_date,-1,2,'invoice',$4,'INV-1')`;
  await client.query(saleInsert, [business, product, sourceLocation, saleIdentity]);
  await client.query(saleInsert, [business, product, sourceLocation, saleIdentity]);
  let result = await client.query(`select count(*)::int as n from public.stock_movements where source_id=$1`, [saleIdentity]);
  let balance = await client.query(`select quantity_on_hand from public.inventory_balances where location_id=$1`, [sourceLocation]);
  assert(result.rows[0].n === 1, 'a repeated sale source identity created a duplicate movement');
  assert(Number(balance.rows[0].quantity_on_hand) === 4, 'the sale retry changed on-hand stock more than once');

  const tooMuch = '40000000-0000-0000-0000-000000000002';
  let negativeCode = null;
  try {
    await client.query(saleInsert.replace("values ($1,$2,$3,'sale',current_date,-1,2", "values ($1,$2,$3,'sale',current_date,-5,2"), [business, product, sourceLocation, tooMuch]);
  } catch (error) {
    negativeCode = error.code;
  }
  assert(negativeCode === '23514', `negative stock was not rejected with the balance constraint (code ${negativeCode})`);
  result = await client.query(`select count(*)::int as n from public.stock_movements where source_id=$1`, [tooMuch]);
  balance = await client.query(`select quantity_on_hand from public.inventory_balances where location_id=$1`, [sourceLocation]);
  assert(result.rows[0].n === 0 && Number(balance.rows[0].quantity_on_hand) === 4, 'failed negative movement was not rolled back');

  let adjustmentCode = null;
  try {
    await client.query(`insert into public.stock_movements
      (business_id,product_id,location_id,movement_type,movement_date,quantity,unit_cost)
      values ($1,$2,$3,'adjustment_in',current_date,1,2)`, [business, product, sourceLocation]);
  } catch (error) {
    adjustmentCode = error.code;
  }
  assert(adjustmentCode === '22023', 'adjustment without notes/reference was accepted');
  await client.query(`insert into public.stock_movements
    (business_id,product_id,location_id,movement_type,movement_date,quantity,unit_cost,notes)
    values ($1,$2,$3,'adjustment_in',current_date,1,2,'count correction')`, [business, product, sourceLocation]);

  const transferId = '50000000-0000-0000-0000-000000000001';
  const transferLineId = '60000000-0000-0000-0000-000000000001';
  await client.query(`insert into public.stock_transfers
    (id,business_id,from_location_id,to_location_id,transfer_number,status)
    values ($1,$2,$3,$4,'TRF-1','approved')`, [transferId, business, sourceLocation, destinationLocation]);
  await client.query(`insert into public.stock_transfer_lines
    (id,business_id,transfer_id,product_id,quantity_requested,unit_cost)
    values ($1,$2,$3,$4,3,2)`, [transferLineId, business, transferId, product]);
  const transferLines = [{ line_id: transferLineId, quantity_dispatched: 3 }];
  await client.query(`select public.dispatch_stock_transfer_atomically($1,$2,$3::jsonb)`, [transferId, 'user-1', JSON.stringify(transferLines)]);
  await client.query(`select public.dispatch_stock_transfer_atomically($1,$2,$3::jsonb)`, [transferId, 'user-1', JSON.stringify(transferLines)]);
  const paired = await client.query(`select movement_type, sum(quantity) as quantity, count(*)::int as n,
      bool_and(transfer_id=$1) as linked from public.stock_movements where transfer_id=$1 group by movement_type`, [transferId]);
  assert(paired.rows.length === 2, `expected transfer_out and transfer_in, got ${paired.rows.length} types`);
  const out = paired.rows.find((row) => row.movement_type === 'transfer_out');
  const incoming = paired.rows.find((row) => row.movement_type === 'transfer_in');
  assert(out?.n === 1 && incoming?.n === 1, 'dispatch retry created duplicate transfer movements');
  assert(Number(out.quantity) === -3 && Number(incoming.quantity) === 3, 'transfer movement quantities do not pair');
  assert(out.linked && incoming.linked, 'transfer movements are missing transfer_id links');

  let mismatchCode = null;
  try {
    await client.query(`select public.confirm_stock_transfer_receipt_atomically($1,$2,$3::jsonb)`, [
      transferId, '60000000-0000-0000-0000-000000000002', JSON.stringify([{ line_id: transferLineId, quantity_received: 2 }]),
    ]);
  } catch (error) {
    mismatchCode = error.code;
  }
  assert(mismatchCode === '22023', 'transfer receipt accepted a quantity that does not match the pair');
  await client.query(`select public.confirm_stock_transfer_receipt_atomically($1,$2,$3::jsonb)`, [
    transferId, '60000000-0000-0000-0000-000000000002', JSON.stringify([{ line_id: transferLineId, quantity_received: 3 }]),
  ]);
  result = await client.query(`select count(*)::int as n from public.stock_movements where transfer_id=$1`, [transferId]);
  assert(result.rows[0].n === 2, 'receipt confirmation created extra stock movements');

  console.log('PASS: source idempotency, negative-balance rejection, adjustment audit reason, and atomic transfer pairing');
} finally {
  if (client) await client.end().catch(() => {});
  await pg.stop().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
}
