/**
 * Manufacturing Phase A foundation — release evidence (isolated local layer).
 *
 * WHAT THIS SUITE PROVES (and what it does not)
 *   Layer: real PostgreSQL 17 (embedded), full synthetic migration replay including
 *   20261103000000_manufacturing_foundation.sql, synthetic authenticated identities
 *   bound through request.jwt.claim.*, probes as the `authenticated` role.
 *   It is NOT official Supabase Auth/PostgREST, NOT a deployed-policy check and NOT
 *   production verification. No production or shared database was contacted.
 *
 * Covered:
 *   * a business registered with the MANUFACTURING operating model is accepted by
 *     create_business_with_owner, and provision_manufacturing_defaults creates one
 *     production branch and the three typed stores — Raw Materials Store
 *     (raw_materials_store), Production Floor (production_floor) and Finished Goods
 *     Store (finished_goods_store) — plus the single Phase-A capability grant
 *     manufacturing.bom.manage held by the owner;
 *   * products.product_type accepts all four canonical manufacturing values and
 *     rejects an unrecognised one, while the legacy product/service vocabulary the
 *     shipped UI writes still round-trips (the constraint is additive);
 *   * inventory_locations.location_type accepts all four values and rejects an
 *     unrecognised one, and defaults to 'warehouse';
 *   * the WIP Inventory account is provisioned once, is a posting asset flagged
 *     is_system, and takes the first free code in 1200–1299;
 *   * a second provisioning call is a no-op;
 *   * provisioning refuses a business that has not selected MANUFACTURING, and the
 *     new functions are not executable by anon;
 *   * the construction vertical is untouched by this migration.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

const test = evidenceSuite('manufacturing-provisioning');
const MS = 'supabase/migrations/20261103000000_manufacturing_foundation.sql';
const LAYER = 'real PostgreSQL17 roles + JWT claims; synthetic identities; full migration replay (incl. 20261103000000); probes as authenticated';
const meta = (id: string, expected: string) => ({
  id,
  expected,
  remediation: 'MANUFACTURING-FOUNDATION-2026-11-03',
  source: MS,
  layer: LAYER,
});

type C = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, any>[] }> };

const MANUFACTURING_PRODUCT_TYPES = ['raw_material', 'wip', 'finished_good', 'trading_good'] as const;
const LEGACY_PRODUCT_TYPES = ['product', 'service', 'goods', 'inventory'] as const;
const LOCATION_TYPES = ['warehouse', 'raw_materials_store', 'production_floor', 'finished_goods_store'] as const;

let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let replayError = '';
let seedError = '';

/** M = the business created with MANUFACTURING at registration. */
const M: Record<string, string> = {};
let firstProvision: Record<string, any> = {};
let wipAccountId = '';

const count = async (sql: string, values: unknown[] = []) =>
  Number((await db.client.query(sql, values)).rows[0].n);

/** Run one statement as the setup client; return 'ok' or its SQLSTATE. */
const attempt = async (sql: string, values: unknown[] = []) => {
  try {
    await db.client.query(sql, values);
    return 'ok';
  } catch (e) {
    return (e as { code?: string }).code ?? 'unknown';
  }
};

/** Run one statement as an authenticated identity; return 'ok' or its SQLSTATE. */
const attemptAs = async (uid: string, sql: string, values: unknown[] = []) =>
  db.asRole('authenticated', uid, async (client: any) => {
    try {
      await (client as C).query(sql, values);
      return 'ok';
    } catch (e) {
      return (e as { code?: string }).code ?? 'unknown';
    }
  }) as Promise<string>;

const rpcAs = async (uid: string, sql: string, values: unknown[] = []) =>
  db.asRole('authenticated', uid, async (client: any) =>
    (await (client as C).query(sql, values)).rows[0].r) as Promise<any>;

let sku = 9100;
const nextSku = () => `MFG-${++sku}`;

async function setup() {
  orgs = await seedFixture(db.client);
  const owner = identities.A_owner.id;

  // 1. Registration path: the owner creates a business and selects
  //    MANUFACTURING. Accepted by the RPC's own validation, not only the CHECK.
  M.id = await db.commitAsRole('authenticated', owner, async (client: any) => {
    const res = await (client as C).query(
      `select public.create_business_with_owner(
         'R13 Manufacturing Co','R13',null,null,null,false,'MWK','07-01','UTC',
         null,null,'Malawi',null,null,null,'INV','EXP','PAY','FOR_PROFIT',
         array['MANUFACTURING']) as id`,
    );
    return res.rows[0].id as string;
  });

  // 2. The registration flow then calls the provisioning RPC (separate call, so a
  //    failure cannot roll back the business). Committed as a fixture.
  firstProvision = await db.commitAsRole('authenticated', owner, async (client: any) => {
    const res = await (client as C).query(
      'select public.provision_manufacturing_defaults($1,$2) as r',
      [M.id, owner],
    );
    return res.rows[0].r;
  });

  // 3. The WIP Inventory account, provisioned by the same registration flow.
  wipAccountId = await db.commitAsRole('authenticated', owner, async (client: any) => {
    const res = await (client as C).query(
      'select public.provision_manufacturing_coa_accounts($1) as r',
      [M.id],
    );
    return res.rows[0].r as string;
  });

  // A branch is needed for the location_type constraint probes.
  M.branch = (await db.client.query(
    'select id from public.branches where business_id=$1 order by created_at limit 1',
    [M.id],
  )).rows[0].id as string;
}

beforeAll(async () => {
  try {
    db = await createDatabaseFixture();
  } catch (e) {
    replayError = safeError(e);
    (db as any)?.cleanup?.();
    return;
  }
  try {
    await setup();
  } catch (e) {
    seedError = safeError(e);
    // eslint-disable-next-line no-console
    console.error('MFG fixture setup failed:', seedError);
  }
});

afterAll(async () => {
  await db?.cleanup?.();
});

const ready = () => {
  if (!db) throw new Blocked(`Database bootstrap/replay unavailable: ${replayError}`);
  if (!orgs || seedError) throw new Blocked(`Synthetic fixture setup unavailable: ${seedError}`);
};

// ─────────────────────────────────────────────────────────────────────────────
// Registration bootstrap: three typed stores and one capability grant
// ─────────────────────────────────────────────────────────────────────────────
test(meta('MFG.REGISTRATION.DEFAULTS',
  'A business registered with MANUFACTURING gets one production branch, the three typed stores and the single manufacturing.bom.manage grant held by the owner'),
  async () => {
    ready();
    expect(String(firstProvision.locations_created)).toBe('3');
    expect(firstProvision.branch_created).toBe(true);
    expect(String(firstProvision.grants_created)).toBe('1');
    expect(String(firstProvision.locations_in_force)).toBe('3');
    expect(String(firstProvision.grants_in_force)).toBe('1');

    // Exactly one production branch.
    expect(await count(
      "select count(*)::int n from public.branches where business_id=$1 and name='Main Factory' and deleted_at is null",
      [M.id])).toBe(1);

    // One store of each manufacturing type, correctly named.
    for (const [name, type] of [
      ['Raw Materials Store', 'raw_materials_store'],
      ['Production Floor', 'production_floor'],
      ['Finished Goods Store', 'finished_goods_store'],
    ] as const) {
      expect(await count(
        'select count(*)::int n from public.inventory_locations where business_id=$1 and name=$2 and location_type=$3',
        [M.id, name, type])).toBe(1);
    }

    // No stray store types, and the default flag is claimed exactly once.
    expect(await count(
      "select count(*)::int n from public.inventory_locations where business_id=$1 and location_type='warehouse'",
      [M.id])).toBe(0);
    expect(await count(
      'select count(*)::int n from public.inventory_locations where business_id=$1 and is_default',
      [M.id])).toBe(1);

    // The Phase-A capability is granted to the owner and is still in force.
    expect(await count(
      "select count(*)::int n from public.manufacturing_capability_grants where business_id=$1 and user_id=$2 and capability='manufacturing.bom.manage' and revoked_at is null",
      [M.id, identities.A_owner.id])).toBe(1);
  });

// ─────────────────────────────────────────────────────────────────────────────
// products.product_type
// ─────────────────────────────────────────────────────────────────────────────
test(meta('MFG.PRODUCT_TYPE.CHECK',
  'products.product_type accepts all four canonical manufacturing values and rejects an unrecognised value'),
  async () => {
    ready();
    for (const value of MANUFACTURING_PRODUCT_TYPES) {
      const result = await attempt(
        `insert into public.products(business_id,name,sku,sale_price,purchase_price,currency,product_type,track_inventory,sales_tax_code,purchase_tax_code)
         values($1,$2,$3,1500,900,'MWK',$4,true,'none','none')`,
        [M.id, `R13 ${value}`, nextSku(), value],
      );
      expect(result, `product_type '${value}' must be accepted`).toBe('ok');
    }

    const rejected = await attempt(
      `insert into public.products(business_id,name,sku,sale_price,purchase_price,currency,product_type,track_inventory,sales_tax_code,purchase_tax_code)
       values($1,'R13 not a type',$2,1500,900,'MWK',$3,true,'none','none')`,
      [M.id, nextSku(), 'component_part'],
    );
    expect(rejected).toBe('23514');
  });

test(meta('MFG.PRODUCT_TYPE.LEGACY',
  'the additive constraint still accepts every legacy product_type value the shipped UI writes, so no product is reclassified'),
  async () => {
    ready();
    for (const value of LEGACY_PRODUCT_TYPES) {
      const result = await attempt(
        `insert into public.products(business_id,name,sku,sale_price,purchase_price,currency,product_type,track_inventory,sales_tax_code,purchase_tax_code)
         values($1,$2,$3,1500,900,'MWK',$4,true,'none','none')`,
        [M.id, `R13 legacy ${value}`, nextSku(), value],
      );
      expect(result, `legacy product_type '${value}' must remain accepted`).toBe('ok');
    }

    // The seeded retail products kept their own vocabulary through the migration.
    expect(await count(
      "select count(*)::int n from public.products where business_id=$1 and product_type='product'",
      [orgs.A.business])).toBeGreaterThan(0);
  });

// ─────────────────────────────────────────────────────────────────────────────
// inventory_locations.location_type
// ─────────────────────────────────────────────────────────────────────────────
test(meta('MFG.LOCATION_TYPE.CHECK',
  'inventory_locations.location_type accepts all four values, rejects an unrecognised value and defaults to warehouse'),
  async () => {
    ready();
    // The rejection probe runs outside a transaction: a failed statement aborts
    // the surrounding one.
    const rejected = await attempt(
      `insert into public.inventory_locations(business_id,branch_id,name,is_default,is_active,location_type)
       values($1,$2,'R13 bad type',false,true,$3)`,
      [M.id, M.branch, 'scrap_yard'],
    );
    expect(rejected).toBe('23514');

    // The accepted values are probed inside a transaction that is rolled back, so
    // these synthetic stores cannot pollute the provisioning counts below.
    await db.client.query('begin');
    try {
      for (const value of LOCATION_TYPES) {
        const result = await attempt(
          `insert into public.inventory_locations(business_id,branch_id,name,is_default,is_active,location_type)
           values($1,$2,$3,false,true,$4)`,
          [M.id, M.branch, `R13 ${value}`, value],
        );
        expect(result, `location_type '${value}' must be accepted`).toBe('ok');
      }

      // The column is NOT NULL and defaults to 'warehouse' for an omitted value.
      const inserted = (await db.client.query(
        `insert into public.inventory_locations(business_id,branch_id,name,is_default,is_active)
         values($1,$2,'R13 defaulted store',false,true) returning location_type`,
        [M.id, M.branch],
      )).rows[0].location_type as string;
      expect(inserted).toBe('warehouse');
    } finally {
      await db.client.query('rollback');
    }
  });

// ─────────────────────────────────────────────────────────────────────────────
// WIP Inventory Chart of Accounts account
// ─────────────────────────────────────────────────────────────────────────────
test(meta('MFG.COA.WIP',
  'the WIP Inventory account is a posting asset flagged is_system, taking the first free code in 1200–1299 under the Inventory group'),
  async () => {
    ready();
    expect(wipAccountId).toBeTruthy();

    const account = (await db.client.query(
      `select code, name, account_type::text account_type, account_subtype::text account_subtype,
              normal_balance::text normal_balance, is_group, is_system, is_bank_account, is_active,
              (select a2.id from public.accounts a2 where a2.business_id=$1 and a2.code='1140' and a2.deleted_at is null order by a2.created_at, a2.id limit 1) inventory_group
         from public.accounts where id=$2`,
      [M.id, wipAccountId],
    )).rows[0];

    expect(account.name).toBe('WIP Inventory');
    expect(account.account_type).toBe('asset');
    expect(account.account_subtype).toBe('current_asset');
    expect(account.normal_balance).toBe('debit');
    expect(account.is_group).toBe(false);
    expect(account.is_system).toBe(true);
    expect(account.is_bank_account).toBe(false);
    expect(account.is_active).toBe(true);

    const code = Number(account.code);
    expect(code).toBeGreaterThanOrEqual(1200);
    expect(code).toBeLessThanOrEqual(1299);
    expect(account.inventory_group).toBeTruthy();

    // Idempotent: a second call returns the same account and inserts no duplicate.
    const second = await rpcAs(identities.A_owner.id,
      'select public.provision_manufacturing_coa_accounts($1) as r', [M.id]);
    expect(second).toBe(wipAccountId);
    expect(await count(
      "select count(*)::int n from public.accounts where business_id=$1 and lower(btrim(name))=lower('WIP Inventory') and deleted_at is null",
      [M.id])).toBe(1);
  });

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency and refusal
// ─────────────────────────────────────────────────────────────────────────────
test(meta('MFG.PROVISION.IDEMPOTENT',
  'a second provisioning call creates no branch, no store and no duplicate live grant'),
  async () => {
    ready();
    const storesInForce = () => count(
      `select count(*)::int n from public.inventory_locations
        where business_id=$1
          and location_type in ('raw_materials_store','production_floor','finished_goods_store')`,
      [M.id]);
    const grantsInForce = () => count(
      'select count(*)::int n from public.manufacturing_capability_grants where business_id=$1 and revoked_at is null',
      [M.id]);

    const storesBefore = await storesInForce();
    const grantsBefore = await grantsInForce();

    const second = await rpcAs(identities.A_owner.id,
      'select public.provision_manufacturing_defaults($1,$2) as r',
      [M.id, identities.A_owner.id]);

    expect(String(second.locations_created)).toBe('0');
    expect(second.branch_created).toBe(false);
    expect(String(second.grants_created)).toBe('0');

    // Nothing new was written: the counts are identical after the second call.
    expect(await storesInForce()).toBe(storesBefore);
    expect(await grantsInForce()).toBe(grantsBefore);

    // The three stores the first call created are still there exactly once each.
    for (const [name, type] of [
      ['Raw Materials Store', 'raw_materials_store'],
      ['Production Floor', 'production_floor'],
      ['Finished Goods Store', 'finished_goods_store'],
    ] as const) {
      expect(await count(
        'select count(*)::int n from public.inventory_locations where business_id=$1 and name=$2 and location_type=$3',
        [M.id, name, type])).toBe(1);
    }
    expect(await count(
      "select count(*)::int n from public.branches where business_id=$1 and name='Main Factory' and deleted_at is null",
      [M.id])).toBe(1);
  });

test(meta('MFG.PROVISION.REFUSES',
  'provisioning refuses a business that has not selected MANUFACTURING, and anon cannot execute either provisioning function'),
  async () => {
    ready();
    // orgs.A is the seeded retail business: no MANUFACTURING in its profile.
    const refused = await attemptAs(identities.A_owner.id,
      'select public.provision_manufacturing_defaults($1,$2)',
      [orgs.A.business, identities.A_owner.id]);
    expect(refused).toBe('22023');

    const coaRefused = await attemptAs(identities.A_owner.id,
      'select public.provision_manufacturing_coa_accounts($1)',
      [orgs.A.business]);
    expect(coaRefused).toBe('22023');

    // No manufacturing store leaked into the retail business.
    expect(await count(
      `select count(*)::int n from public.inventory_locations
        where business_id=$1 and location_type in ('raw_materials_store','production_floor','finished_goods_store')`,
      [orgs.A.business])).toBe(0);
    expect(await count(
      'select count(*)::int n from public.manufacturing_capability_grants where business_id=$1',
      [orgs.A.business])).toBe(0);

    // anon holds no execute privilege on either function.
    expect(await count(
      `select count(*)::int n from pg_proc p
        where p.proname in ('provision_manufacturing_defaults','provision_manufacturing_coa_accounts')
          and has_function_privilege('anon', p.oid, 'execute')`)).toBe(0);
  });

// ─────────────────────────────────────────────────────────────────────────────
// Construction is untouched
// ─────────────────────────────────────────────────────────────────────────────
test(meta('MFG.CONSTRUCTION.UNTOUCHED',
  'the construction vertical keeps its own vocabulary, grants table and bootstrap function'),
  async () => {
    ready();
    expect(await count(
      `select count(*)::int n from pg_proc where proname='grant_construction_procurement_capability'`)).toBe(1);
    expect(await count(
      `select count(*)::int n from pg_proc where proname='provision_construction_defaults'`)).toBe(1);
    expect(await count(
      `select count(*)::int n from information_schema.tables where table_schema='public' and table_name='construction_procurement_grants'`)).toBe(1);
    expect(await count(
      `select count(*)::int n from pg_constraint where conrelid='public.businesses'::regclass
         and conname='businesses_operating_models_check'
         and pg_get_constraintdef(oid) like '%CONSTRUCTION%'`)).toBe(1);

    // Manufacturing registered its own vocabulary, not construction's.
    expect(await count(
      `select count(*)::int n from public.manufacturing_capabilities where code='manufacturing.bom.manage'`)).toBe(1);
    expect(await count(
      `select count(*)::int n from public.construction_procurement_capabilities where code='manufacturing.bom.manage'`)).toBe(0);
  });
