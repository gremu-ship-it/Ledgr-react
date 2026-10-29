/**
 * Manufacturing Phase C — work orders & production: release evidence (isolated
 * local layer).
 *
 * WHAT THIS SUITE PROVES (and what it does not)
 *   Layer: real PostgreSQL 17 (embedded), full synthetic migration replay including
 *   20261105000000_stock_movement_type_manufacturing.sql and
 *   20261105000001_manufacturing_work_orders.sql, synthetic authenticated
 *   identities bound through request.jwt.claim.*, probes as the `authenticated`
 *   role. It is NOT official Supabase Auth/PostgREST, NOT a deployed-policy check
 *   and NOT production verification. No production or shared database was
 *   contacted.
 *
 * Covered:
 *   * schema: the status vocabulary, positive planned quantity, per-business
 *     work order number uniqueness, positive run output and positive material
 *     transaction quantity;
 *   * commands: create (sequential WO-YYYY-NNN, active BOM required), release
 *     (BOM frozen into work_order_lines and locked), start, record run
 *     (proportional backflush, cumulative quantity, 10% overproduction ceiling),
 *     manual consumption and return, complete (implicit backflush when no runs),
 *     close, cancel (reversal of stock and journals, conditional BOM unlock) and
 *     yield;
 *   * RLS: a non-member reads nothing; a member of any role reads, and only
 *     owner/admin/manager write;
 *   * integration: the full draft → release → run → complete → close lifecycle
 *     moves stock through the existing public.stock_movements single writer and
 *     posts balanced double-entry journals through the existing
 *     public._ledger_post_entry_keyed mechanism, with WIP debited on issue and
 *     cleared on receipt.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

const test = evidenceSuite('manufacturing-work-orders');
const MS = 'supabase/migrations/20261105000001_manufacturing_work_orders.sql';
const LAYER = 'real PostgreSQL17 roles + JWT claims; synthetic identities; full migration replay (incl. 20261105000000/20261105000001); probes as authenticated';
const meta = (id: string, expected: string) => ({
  id,
  expected,
  remediation: 'MANUFACTURING-WORK-ORDERS-2026-11-05',
  source: MS,
  layer: LAYER,
});

type C = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, any>[] }> };

let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let replayError = '';
let seedError = '';

/** M = the manufacturing business. Every id the suite needs hangs off it. */
const M: Record<string, string> = {};

let sku = 9500;
const nextSku = () => `R13WO-${++sku}`;

const value = async (sql: string, values: unknown[] = []) => {
  const rows = (await db.client.query(sql, values)).rows;
  return rows.length ? rows[0] : null;
};
const scalar = async (sql: string, values: unknown[] = []) => {
  const row = await value(sql, values);
  if (!row) return null;
  const k = Object.keys(row)[0];
  return row[k];
};
const num = async (sql: string, values: unknown[] = []) => Number((await scalar(sql, values)) ?? 0);

/** Commit a statement as an authenticated identity; return every row it gave. */
const commitRows = async (uid: string, sql: string, values: unknown[] = []) =>
  (await db.commitAsRole('authenticated', uid, async (client: any) => {
    const result = await (client as C).query(sql, values);
    return result.rows;
  })) as Record<string, any>[];

/** Read rows as an authenticated identity (no commit — a read-only probe). */
const rowsAs = async (uid: string, sql: string, values: unknown[] = []) =>
  (await db.asRole('authenticated', uid, async (client: any) => {
    const result = await (client as C).query(sql, values);
    return result.rows;
  })) as Record<string, any>[];

/** Commit a statement as an authenticated identity; return its first column. */
const commitScalar = async (uid: string, sql: string, values: unknown[] = []): Promise<any> => {
  const rows = await commitRows(uid, sql, values);
  return rows.length ? Object.values(rows[0])[0] : null;
};

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

async function newProduct(name: string, productType: string, purchasePrice: number) {
  const id = (await scalar(
    `insert into public.products(business_id,name,sku,sale_price,purchase_price,currency,product_type,track_inventory,sales_tax_code,purchase_tax_code)
     values($1,$2,$3,0,$4,'MWK',$5,true,'none','none') returning id`,
    [M.id, `R13 ${name}`, nextSku(), purchasePrice, productType],
  )) as string;
  return id;
}

/**
 * A draft work order for `productId`, released when `release` is set. Each call
 * creates a fresh output product and BOM so the tests never share state.
 */
async function newWorkOrder(
  plannedQty: number,
  components: Array<{ product: string; quantity: number; scrapPct?: number }>,
  { release = false }: { release?: boolean } = {},
) {
  const owner = identities.A_owner.id;
  const output = await newProduct(`output ${nextSku()}`, 'finished_good', 0);
  const bom = (await commitScalar(
    owner,
    `insert into public.manufacturing_boms(business_id,product_id,version,status,created_by)
     values($1,$2,1,'draft',$3) returning id`,
    [M.id, output, owner],
  )) as string;
  for (const c of components) {
    await db.client.query(
      `insert into public.manufacturing_bom_lines(bom_id,component_product_id,quantity,unit_of_measure,scrap_pct)
       values($1,$2,$3,'pcs',$4)`,
      [bom, c.product, c.quantity, c.scrapPct ?? 0],
    );
  }
  await commitScalar(owner, 'select public.manufacturing_bom_activate($1)', [bom]);
  const wo = (await commitScalar(
    owner,
    'select public.manufacturing_wo_create($1,$2,$3,null,null,null,null,null) as r',
    [M.id, output, plannedQty],
  )) as string;
  if (release) {
    await commitScalar(owner, 'select public.manufacturing_wo_release($1)', [wo]);
  }
  return { wo, bom, output };
}

async function setup() {
  orgs = await seedFixture(db.client);
  const owner = identities.A_owner.id;

  M.id = (await commitScalar(
    owner,
    `select public.create_business_with_owner(
       'R13 Work Orders Co','R13',null,null,null,false,'MWK','07-01','UTC',
       null,null,'Malawi',null,null,null,'INV','EXP','PAY','FOR_PROFIT',
       array['MANUFACTURING']) as id`,
  )) as string;

  await commitScalar(owner, 'select public.provision_manufacturing_defaults($1,$2)', [
    M.id,
    owner,
  ]);
  await commitScalar(owner, 'select public.provision_manufacturing_coa_accounts($1)', [M.id]);

  // Members of M at the roles this suite needs. `cashier` and `viewer` come
  // straight from the shared fixture; `manager` — the lowest role the write tier
  // admits — is not one of the fixture's roles, so it is created here.
  M.manager = '13000000-0000-4000-8000-0000000000f1';
  await db.client.query('insert into auth.users(id,email) values($1,$2)', [
    M.manager,
    'r13-mfg-manager@example.invalid',
  ]);
  await db.client.query(
    'insert into public.user_profiles(id,full_name) values($1,$2) on conflict (id) do nothing',
    [M.manager, 'R13 manager'],
  );
  await db.client.query(
    `insert into public.business_users(business_id,user_id,role,is_active)
     values($1,$2,'manager',true)`,
    [M.id, M.manager],
  );
  // The fixture's cashier and viewer belong to organisation A, not to M, so
  // they are enrolled here to probe M's own policies.
  for (const [role, id] of [
    ['cashier', identities.A_cashier.id],
    ['viewer', identities.A_viewer.id],
  ] as const) {
    await db.client.query(
      `insert into public.business_users(business_id,user_id,role,is_active)
       values($1,$2,$3,true)
       on conflict (business_id,user_id) do update set role = excluded.role, is_active = true`,
      [M.id, id, role],
    );
  }

  M.raw = (await scalar(
    `select id from public.inventory_locations where business_id=$1 and location_type='raw_materials_store'`,
    [M.id],
  )) as string;
  M.fg = (await scalar(
    `select id from public.inventory_locations where business_id=$1 and location_type='finished_goods_store'`,
    [M.id],
  )) as string;
  M.steel = await newProduct('Steel Bar', 'raw_material', 100);
  M.bolt = await newProduct('Bolt Pack', 'raw_material', 50);
  M.wip = (await scalar(
    `select id from public.accounts where business_id=$1 and lower(btrim(name))='wip inventory' and deleted_at is null limit 1`,
    [M.id],
  )) as string;
  M.rm = (await scalar(
    `select id from public.accounts where business_id=$1 and btrim(code)='1143' and deleted_at is null limit 1`,
    [M.id],
  )) as string;
  M.fgAccount = (await scalar(
    `select id from public.accounts where business_id=$1 and btrim(code)='1142' and deleted_at is null limit 1`,
    [M.id],
  )) as string;

  // Opening stock, seeded through the single stock-movement writer.
  await db.client.query(
    `insert into public.stock_movements(business_id,product_id,location_id,movement_type,movement_date,quantity,unit_cost,source_type,created_by)
     values($1,$2,$3,'opening_balance',current_date,$4,$5,'seed',$6),
           ($1,$7,$3,'opening_balance',current_date,$4,$8,'seed',$6)`,
    [M.id, M.steel, M.raw, 10000, 100, identities.A_owner.id, M.bolt, 50],
  );
}

beforeAll(async () => {
  try {
    db = await createDatabaseFixture();
    // Adversarial effective-ACL assumption, NOT a change to the migration-only
    // R13 bootstrap and NOT a product migration edit — the same convention
    // tests/release/r01-security.test.ts uses for user_profiles and
    // business_users. The bootstrap deliberately installs no blanket public
    // grants, so without this the membership sub-select inside every
    // manufacturing RLS policy fails with 42501 instead of deciding the row,
    // and the policies could not be exercised at all. On a hosted project the
    // platform's default privileges supply this.
    await db.client.query(
      'grant select on public.business_users, public.business_members to authenticated',
    );
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
    console.error('MFG work-order fixture setup failed:', seedError);
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
// Schema
// ─────────────────────────────────────────────────────────────────────────────
test(meta('MFG.WO.STATUS.VALID',
  'a work order accepts every status in the forward-only lifecycle and rejects any other value'),
async () => {
  ready();
  const { wo } = await newWorkOrder(1, [{ product: M.steel, quantity: 1 }]);
  for (const status of ['draft', 'released', 'in_progress', 'completed', 'closed', 'cancelled']) {
    expect(
      await attempt('update public.manufacturing_work_orders set status=$1 where id=$2', [status, wo]),
      `status '${status}' must be accepted`,
    ).toBe('ok');
  }
  expect(
    await attempt('update public.manufacturing_work_orders set status=$1 where id=$2', ['reversing', wo]),
  ).toBe('23514');
});

test(meta('MFG.WO.QTY.POSITIVE',
  'a work order with a planned quantity of zero or less is rejected'),
async () => {
  ready();
  const { output } = await newWorkOrder(1, [{ product: M.steel, quantity: 1 }]);
  const owner = identities.A_owner.id;
  for (const qty of [0, -5]) {
    const result = await db.asRole('authenticated', owner, async (client: any) => {
      try {
        await (client as C).query('select public.manufacturing_wo_create($1,$2,$3,null,null,null,null,null)', [
          M.id,
          output,
          qty,
        ]);
        return 'ok';
      } catch (e) {
        return (e as { code?: string }).code ?? 'unknown';
      }
    });
    expect(result, `planned quantity ${qty} must be refused`).toBe('22023');
  }
  // The table CHECK refuses it even if a future caller bypasses the command.
  expect(
    await attempt(
      `insert into public.manufacturing_work_orders(business_id,work_order_number,product_id,bom_id,planned_quantity,status,created_by)
       values($1,'WO-2026-900',$2,(select id from public.manufacturing_boms where business_id=$1 limit 1),0,'draft',$3)`,
      [M.id, output, identities.A_owner.id],
    ),
  ).toBe('23514');
});

test(meta('MFG.WO.NUMBER.UNIQUE',
  'the work order number is unique per business and may repeat across businesses'),
async () => {
  ready();
  const { wo } = await newWorkOrder(1, [{ product: M.steel, quantity: 1 }]);
  const number = (await scalar('select work_order_number from public.manufacturing_work_orders where id=$1', [
    wo,
  ])) as string;
  expect(
    await attempt(
      `insert into public.manufacturing_work_orders(business_id,work_order_number,product_id,bom_id,planned_quantity,status,created_by)
       values($1,$2,(select product_id from public.manufacturing_work_orders where id=$3),(select bom_id from public.manufacturing_work_orders where id=$3),1,'draft',$4)`,
      [M.id, number, wo, identities.A_owner.id],
    ),
  ).toBe('23505');
  // The same number in a different business is fine — the scope is the business.
  const other = (await scalar(
    "select id from public.businesses where name = 'R13 Organisation B' and deleted_at is null limit 1",
  )) as string;
  expect(
    await attempt(
      `insert into public.manufacturing_work_orders(business_id,work_order_number,product_id,bom_id,planned_quantity,status,created_by)
       values($1,$2,(select product_id from public.manufacturing_work_orders where id=$3),(select bom_id from public.manufacturing_work_orders where id=$3),1,'draft',$4)`,
      [other, number, wo, identities.B_owner.id],
    ),
  ).toBe('ok');
});

test(meta('MFG.WO.RUN.OUTPUT_POSITIVE',
  'a production run with an output quantity of zero or less is rejected'),
async () => {
  ready();
  const { wo } = await newWorkOrder(10, [{ product: M.steel, quantity: 1 }]);
  expect(
    await attempt(
      `insert into public.manufacturing_production_runs(work_order_id,run_number,output_quantity,status,created_by)
       values($1,1,0,'completed',$2)`,
      [wo, identities.A_owner.id],
    ),
  ).toBe('23514');
  expect(
    await attempt(
      `insert into public.manufacturing_production_runs(work_order_id,run_number,output_quantity,status,created_by)
       values($1,2,-3,'completed',$2)`,
      [wo, identities.A_owner.id],
    ),
  ).toBe('23514');
});

test(meta('MFG.WO.TXN.QTY_POSITIVE',
  'a material transaction with a quantity of zero or less is rejected'),
async () => {
  ready();
  const { wo } = await newWorkOrder(10, [{ product: M.steel, quantity: 1 }]);
  for (const qty of [0, -1]) {
    expect(
      await attempt(
        `insert into public.manufacturing_material_transactions(work_order_id,component_product_id,quantity,transaction_type,recorded_by)
         values($1,$2,$3,'consume',$4)`,
        [wo, M.steel, qty, identities.A_owner.id],
      ),
      `material transaction quantity ${qty} must be refused`,
    ).toBe('23514');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// manufacturing_wo_create
// ─────────────────────────────────────────────────────────────────────────────
test(meta('MFG.WO.CREATE.SEQUENCE',
  'manufacturing_wo_create generates sequential WO-YYYY-NNN numbers per business'),
async () => {
  ready();
  const owner = identities.A_owner.id;
  const output = await newProduct('sequenced output', 'finished_good', 0);
  const bom = (await commitScalar(
    owner,
    `insert into public.manufacturing_boms(business_id,product_id,version,status,created_by)
     values($1,$2,1,'draft',$3) returning id`,
    [M.id, output, owner],
  )) as string;
  await db.client.query(
    `insert into public.manufacturing_bom_lines(bom_id,component_product_id,quantity,scrap_pct) values($1,$2,1,0)`,
    [bom, M.steel],
  );
  await commitScalar(owner, 'select public.manufacturing_bom_activate($1)', [bom]);

  // Earlier fixtures have already taken numbers in this business, so the test
  // asserts the sequence continues from wherever it is rather than from 001.
  const before = await num(
    `select coalesce(max(nullif(regexp_replace(work_order_number,'^WO-[0-9]{4}-',''),'')::int),0) n
       from public.manufacturing_work_orders where business_id=$1`,
    [M.id],
  );
  const numbers: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    const wo = (await commitScalar(
      owner,
      'select public.manufacturing_wo_create($1,$2,$3,null,null,null,null,null) as r',
      [M.id, output, 10 + i],
    )) as string;
    numbers.push((await scalar('select work_order_number from public.manufacturing_work_orders where id=$1', [
      wo,
    ])) as string);
  }
  const year = new Date().getFullYear();
  const pad = (n: number) => String(n).padStart(3, '0');
  expect(numbers[0]).toBe(`WO-${year}-${pad(before + 1)}`);
  expect(numbers[1]).toBe(`WO-${year}-${pad(before + 2)}`);
  expect(numbers[2]).toBe(`WO-${year}-${pad(before + 3)}`);
  // Every new order starts in draft and references the active BOM.
  expect(
    await num('select count(*)::int n from public.manufacturing_work_orders where bom_id=$1 and status=$2', [
      bom,
      'draft',
    ]),
  ).toBe(3);
});

test(meta('MFG.WO.CREATE.NO_ACTIVE_BOM',
  'manufacturing_wo_create refuses a product with no active bill of materials'),
async () => {
  ready();
  const owner = identities.A_owner.id;
  const orphan = await newProduct('orphan output', 'finished_good', 0);
  const draftOnly = await newProduct('draft-only output', 'finished_good', 0);
  const draftBom = (await commitScalar(
    owner,
    `insert into public.manufacturing_boms(business_id,product_id,version,status,created_by)
     values($1,$2,1,'draft',$3) returning id`,
    [M.id, draftOnly, owner],
  )) as string;
  await db.client.query(
    `insert into public.manufacturing_bom_lines(bom_id,component_product_id,quantity,scrap_pct) values($1,$2,1,0)`,
    [draftBom, M.steel],
  );

  for (const [label, product] of [['no BOM at all', orphan], ['only a draft BOM', draftOnly]] as const) {
    const result = await db.asRole('authenticated', owner, async (client: any) => {
      try {
        await (client as C).query('select public.manufacturing_wo_create($1,$2,$3,null,null,null,null,null)', [
          M.id,
          product,
          5,
        ]);
        return 'ok';
      } catch (e) {
        return (e as { code?: string }).code ?? 'unknown';
      }
    });
    expect(result, `creating for a product with ${label} must be refused`).toBe('22023');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// manufacturing_wo_release
// ─────────────────────────────────────────────────────────────────────────────
test(meta('MFG.WO.RELEASE.FREEZE',
  'release copies the BOM lines into work_order_lines with scrap-inflated order quantities'),
async () => {
  ready();
  const { wo } = await newWorkOrder(10, [
    { product: M.steel, quantity: 2, scrapPct: 0 },
    { product: M.bolt, quantity: 4, scrapPct: 10 }, // 4 × 1.10 × 10 = 44
  ]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_release($1)', [wo]);

  expect(await num('select count(*)::int n from public.manufacturing_work_order_lines where work_order_id=$1', [wo])).toBe(2);
  // The BOM expresses one unit of output, so every line is × planned_quantity.
  expect(
    await num(
      'select planned_quantity n from public.manufacturing_work_order_lines where work_order_id=$1 and component_product_id=$2',
      [wo, M.steel],
    ),
  ).toBe(20);
  // Scrap inflation is applied: 4 × (1 + 10/100) × 10 = 44.
  expect(
    await num(
      'select planned_quantity n from public.manufacturing_work_order_lines where work_order_id=$1 and component_product_id=$2',
      [wo, M.bolt],
    ),
  ).toBe(44);
  expect(
    await num(
      'select scrap_pct n from public.manufacturing_work_order_lines where work_order_id=$1 and component_product_id=$2',
      [wo, M.bolt],
    ),
  ).toBe(10);
  expect(await scalar('select status from public.manufacturing_work_orders where id=$1', [wo])).toBe('released');
  // Nothing has been consumed yet: release only freezes the plan.
  expect(
    await num('select coalesce(sum(actual_quantity_consumed),0)::int n from public.manufacturing_work_order_lines where work_order_id=$1', [wo]),
  ).toBe(0);
});

test(meta('MFG.WO.RELEASE.LOCKS_BOM',
  'release sets bom_locked_at on the referenced BOM'),
async () => {
  ready();
  const { wo, bom } = await newWorkOrder(5, [{ product: M.steel, quantity: 1 }]);
  expect(await num('select count(*)::int n from public.manufacturing_boms where id=$1 and bom_locked_at is null', [bom])).toBe(1);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_release($1)', [wo]);
  expect(await num('select count(*)::int n from public.manufacturing_boms where id=$1 and bom_locked_at is not null', [bom])).toBe(1);
});

test(meta('MFG.WO.RELEASE.NON_DRAFT',
  'release refuses a work order that is no longer a draft'),
async () => {
  ready();
  const { wo } = await newWorkOrder(5, [{ product: M.steel, quantity: 1 }]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_release($1)', [wo]);
  const result = await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
    try {
      await (client as C).query('select public.manufacturing_wo_release($1)', [wo]);
      return 'ok';
    } catch (e) {
      return (e as { code?: string }).code ?? 'unknown';
    }
  });
  expect(result).toBe('22023');
});

// ─────────────────────────────────────────────────────────────────────────────
// manufacturing_wo_record_run
// ─────────────────────────────────────────────────────────────────────────────
test(meta('MFG.WO.RUN.BACKFLUSH',
  'a production run backflushes materials in proportion to its output'),
async () => {
  ready();
  // 10 planned; 2 steel and 4 bolts per unit. A run of 4 consumes 8 and 16.
  const { wo } = await newWorkOrder(10, [
    { product: M.steel, quantity: 2 },
    { product: M.bolt, quantity: 4 },
  ]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_release($1)', [wo]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_record_run($1,$2,$3,$4)', [
    wo,
    4,
    1,
    'run one',
  ]);

  expect(
    await num(
      'select actual_quantity_consumed n from public.manufacturing_work_order_lines where work_order_id=$1 and component_product_id=$2',
      [wo, M.steel],
    ),
  ).toBe(8);
  expect(
    await num(
      'select actual_quantity_consumed n from public.manufacturing_work_order_lines where work_order_id=$1 and component_product_id=$2',
      [wo, M.bolt],
    ),
  ).toBe(16);

  // One consume transaction per component, tied to the run.
  expect(
    await num(
      "select count(*)::int n from public.manufacturing_material_transactions where work_order_id=$1 and transaction_type='consume'",
      [wo],
    ),
  ).toBe(2);
  expect(
    await num(
      `select count(*)::int n from public.manufacturing_material_transactions t
         join public.manufacturing_production_runs r on r.id = t.run_id
        where t.work_order_id=$1 and r.run_number = 1`,
      [wo],
    ),
  ).toBe(2);

  // Stock left the Raw Materials Store, and the output reached Finished Goods.
  expect(
    await num(
      "select quantity_on_hand n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3",
      [M.id, M.steel, M.raw],
    ),
  ).toBe(10000 - 8);
  expect(
    await num(
      `select coalesce(quantity_on_hand,0) n from public.inventory_balances
        where business_id=$1 and product_id=(select product_id from public.manufacturing_work_orders where id=$2) and location_id=$3`,
      [M.id, wo, M.fg],
    ),
  ).toBe(4);
});

test(meta('MFG.WO.RUN.QUANTITIES',
  'a production run adds its output and scrap to the order totals and auto-starts a released order'),
async () => {
  ready();
  const { wo } = await newWorkOrder(20, [{ product: M.steel, quantity: 1 }]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_release($1)', [wo]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_record_run($1,$2,$3,$4)', [
    wo,
    6,
    2,
    'first',
  ]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_record_run($1,$2,$3,$4)', [
    wo,
    4,
    1,
    'second',
  ]);

  const row = (await value(
    'select status, completed_quantity, scrapped_quantity, actual_start_date from public.manufacturing_work_orders where id=$1',
    [wo],
  )) as Record<string, any>;
  expect(row.status).toBe('in_progress');
  expect(Number(row.completed_quantity)).toBe(10);
  expect(Number(row.scrapped_quantity)).toBe(3);
  expect(row.actual_start_date).toBeTruthy();
  expect(
    await num('select count(*)::int n from public.manufacturing_production_runs where work_order_id=$1', [wo]),
  ).toBe(2);
  expect(
    await num('select max(run_number)::int n from public.manufacturing_production_runs where work_order_id=$1', [wo]),
  ).toBe(2);
});

test(meta('MFG.WO.RUN.OVERPRODUCTION',
  'a run that would take output beyond planned + 10% is refused, and exactly +10% is allowed'),
async () => {
  ready();
  const { wo } = await newWorkOrder(10, [{ product: M.steel, quantity: 1 }]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_release($1)', [wo]);

  const attemptRun = (qty: number) =>
    db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      try {
        await (client as C).query('select public.manufacturing_wo_record_run($1,$2,0,null)', [wo, qty]);
        return 'ok';
      } catch (e) {
        return (e as { code?: string }).code ?? 'unknown';
      }
    });

  // Exactly planned × 1.10 is inside the tolerance — committed, so the next
  // probe measures cumulative output against it.
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_record_run($1,$2,0,null)', [wo, 11]);
  expect(
    await num('select completed_quantity::int n from public.manufacturing_work_orders where id=$1', [wo]),
  ).toBe(11);
  // Cumulative output is what is measured: 11 + 1 = 12 > 11.
  expect(await attemptRun(1)).toBe('22023');
  expect(
    await num('select completed_quantity::int n from public.manufacturing_work_orders where id=$1', [wo]),
  ).toBe(11);
});

test(meta('MFG.WO.RUN.WIP_JOURNAL',
  'issuing materials debits WIP and credits Raw Materials, and the receipt clears WIP to Finished Goods'),
async () => {
  ready();
  // 2 steel @ 100 and 4 bolts @ 50 = 400 per unit; a run of 3 consumes 1200.
  const { wo, output } = await newWorkOrder(10, [
    { product: M.steel, quantity: 2 },
    { product: M.bolt, quantity: 4 },
  ]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_release($1)', [wo]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_record_run($1,$2,0,null)', [
    wo,
    3,
  ]);

  // Net movement per account, scoped to this work order's own entries.
  const balance = (account: string) =>
    num(
      `select coalesce(sum(case when jl.is_debit then jl.amount_base else -jl.amount_base end),0) n
         from public.journal_lines jl
         join public.journal_entries je on je.id = jl.journal_entry_id
        where jl.business_id=$1 and jl.account_id=$2 and je.source_type='manufacturing_work_order'
          and je.source_id::text = $3`,
      [M.id, account, wo],
    );
  void output;

  // DR WIP 1200 / CR Raw Materials 1200, then DR Finished Goods 1200 / CR WIP 1200.
  expect(await balance(M.wip)).toBe(0);
  expect(await balance(M.rm)).toBe(-1200);
  expect(await balance(M.fgAccount)).toBe(1200);
  // Every entry is balanced and already posted.
  expect(
    await num(
      `select count(*)::int n from (
         select je.id from public.journal_entries je
           join public.journal_lines jl on jl.journal_entry_id = je.id
          where je.business_id=$1 and je.source_type='manufacturing_work_order'
          group by je.id having abs(sum(case when jl.is_debit then jl.amount_base else -jl.amount_base end)) > 0.005) x`,
      [M.id],
    ),
  ).toBe(0);
  expect(
    await num(
      `select count(*)::int n from public.journal_entries
        where business_id=$1 and source_type='manufacturing_work_order' and source_id::text = $2 and status='posted'`,
      [M.id, wo],
    ),
  ).toBe(2);
});

// ─────────────────────────────────────────────────────────────────────────────
// manufacturing_wo_record_consumption / _return
// ─────────────────────────────────────────────────────────────────────────────
test(meta('MFG.WO.CONSUMPTION.ACTUAL',
  'manufacturing_wo_record_consumption increases actual_quantity_consumed and issues stock'),
async () => {
  ready();
  const { wo } = await newWorkOrder(10, [{ product: M.steel, quantity: 1 }]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_release($1)', [wo]);
  const before = await num(
    'select quantity_on_hand n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
    [M.id, M.steel, M.raw],
  );
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_record_consumption($1,null,$2,$3,null,null)', [wo, M.steel, 7]);
  expect(
    await num(
      'select actual_quantity_consumed n from public.manufacturing_work_order_lines where work_order_id=$1 and component_product_id=$2',
      [wo, M.steel],
    ),
  ).toBe(7);
  expect(
    await num(
      'select quantity_on_hand n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
      [M.id, M.steel, M.raw],
    ),
  ).toBe(before - 7);
  expect(
    await num(
      "select count(*)::int n from public.manufacturing_material_transactions where work_order_id=$1 and transaction_type='consume' and quantity=7",
      [wo],
    ),
  ).toBe(1);
});

test(meta('MFG.WO.RETURN.ACTUAL',
  'manufacturing_wo_record_return decreases actual_quantity_consumed and puts stock back'),
async () => {
  ready();
  const { wo } = await newWorkOrder(10, [{ product: M.steel, quantity: 1 }]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_release($1)', [wo]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_record_consumption($1,null,$2,$3,null,null)', [wo, M.steel, 9]);
  const afterConsume = await num(
    'select quantity_on_hand n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
    [M.id, M.steel, M.raw],
  );
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_record_return($1,null,$2,$3,null,null)', [wo, M.steel, 4]);
  expect(
    await num(
      'select actual_quantity_consumed n from public.manufacturing_work_order_lines where work_order_id=$1 and component_product_id=$2',
      [wo, M.steel],
    ),
  ).toBe(5);
  expect(
    await num(
      'select quantity_on_hand n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
      [M.id, M.steel, M.raw],
    ),
  ).toBe(afterConsume + 4);
  expect(
    await num(
      "select count(*)::int n from public.manufacturing_material_transactions where work_order_id=$1 and transaction_type='return'",
      [wo],
    ),
  ).toBe(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// manufacturing_wo_complete / _close
// ─────────────────────────────────────────────────────────────────────────────
test(meta('MFG.WO.COMPLETE.IMPLICIT',
  'completing a work order with no runs performs one implicit backflush for the planned quantity'),
async () => {
  ready();
  // 3 steel per unit, 7 planned → 21 consumed.
  const { wo } = await newWorkOrder(7, [{ product: M.steel, quantity: 3 }]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_release($1)', [wo]);
  const runCountBefore = await num(
    'select count(*)::int n from public.manufacturing_production_runs where work_order_id=$1',
    [wo],
  );
  expect(runCountBefore).toBe(0);

  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_complete($1)', [wo]);

  const row = (await value(
    'select status, completed_quantity, actual_end_date from public.manufacturing_work_orders where id=$1',
    [wo],
  )) as Record<string, any>;
  expect(row.status).toBe('completed');
  expect(Number(row.completed_quantity)).toBe(7);
  expect(row.actual_end_date).toBeTruthy();
  expect(
    await num(
      'select actual_quantity_consumed n from public.manufacturing_work_order_lines where work_order_id=$1 and component_product_id=$2',
      [wo, M.steel],
    ),
  ).toBe(21);
  // Backflush-only completion stays backflush-only: no run row is invented.
  expect(
    await num('select count(*)::int n from public.manufacturing_production_runs where work_order_id=$1', [wo]),
  ).toBe(0);
});

test(meta('MFG.WO.COMPLETE.NO_OUTPUT',
  'a work order with no completed output cannot be completed'),
async () => {
  ready();
  const { wo } = await newWorkOrder(10, [{ product: M.steel, quantity: 1 }]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_release($1)', [wo]);
  // A run of 10 leaves output; remove it by cancelling every run so the order
  // has produced nothing, then completing must be refused.
  await db.client.query(
    "update public.manufacturing_production_runs set status='cancelled' where work_order_id=$1",
    [wo],
  );
  await db.client.query(
    `insert into public.manufacturing_production_runs(work_order_id,run_number,output_quantity,scrap_quantity,status,created_by)
     values($1,1,1,0,'cancelled',$2)`,
    [wo, identities.A_owner.id],
  );
  await db.client.query('update public.manufacturing_work_orders set completed_quantity=0 where id=$1', [wo]);
  const result = await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
    try {
      await (client as C).query('select public.manufacturing_wo_complete($1)', [wo]);
      return 'ok';
    } catch (e) {
      return (e as { code?: string }).code ?? 'unknown';
    }
  });
  expect(result).toBe('22023');
});

test(meta('MFG.WO.CLOSE.FINAL',
  'close moves completed → closed and refuses to move anything else'),
async () => {
  ready();
  const { wo } = await newWorkOrder(5, [{ product: M.steel, quantity: 1 }]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_release($1)', [wo]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_complete($1)', [wo]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_close($1)', [wo]);
  expect(await scalar('select status from public.manufacturing_work_orders where id=$1', [wo])).toBe('closed');

  // Closed is final: nothing further is accepted.
  for (const rpc of ['manufacturing_wo_release', 'manufacturing_wo_complete', 'manufacturing_wo_cancel']) {
    const result = await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      try {
        await (client as C).query(`select public.${rpc}($1)`, [wo]);
        return 'ok';
      } catch (e) {
        return (e as { code?: string }).code ?? 'unknown';
      }
    });
    expect(result, `${rpc} must be refused on a closed order`).not.toBe('ok');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// manufacturing_wo_cancel
// ─────────────────────────────────────────────────────────────────────────────
test(meta('MFG.WO.CANCEL.REVERSAL',
  'cancelling reverses every material movement and journal posting'),
async () => {
  ready();
  const { wo, output } = await newWorkOrder(10, [
    { product: M.steel, quantity: 2 },
    { product: M.bolt, quantity: 4 },
  ]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_release($1)', [wo]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_record_run($1,$2,0,null)', [
    wo,
    4,
  ]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_record_consumption($1,null,$2,$3,null,null)', [wo, M.steel, 5]);

  const steelBefore = await num(
    'select quantity_on_hand n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
    [M.id, M.steel, M.raw],
  );
  const boltBefore = await num(
    'select quantity_on_hand n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
    [M.id, M.bolt, M.raw],
  );
  const fgBefore = await num(
    'select coalesce(quantity_on_hand,0) n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
    [M.id, output, M.fg],
  );

  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_cancel($1)', [wo]);

  // 8 backflushed + 5 manual = 13 steel, and 16 bolts, all returned.
  expect(
    await num(
      'select quantity_on_hand n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
      [M.id, M.steel, M.raw],
    ),
  ).toBe(steelBefore + 13);
  expect(
    await num(
      'select quantity_on_hand n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
      [M.id, M.bolt, M.raw],
    ),
  ).toBe(boltBefore + 16);
  // The four received units go back out.
  expect(
    await num(
      'select coalesce(quantity_on_hand,0) n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
      [M.id, output, M.fg],
    ),
  ).toBe(fgBefore - 4);

  // The reversal is expressed as return transactions, never as a delete.
  expect(
    await num(
      "select count(*)::int n from public.manufacturing_material_transactions where work_order_id=$1 and transaction_type='return'",
      [wo],
    ),
  ).toBeGreaterThanOrEqual(2);
  expect(
    await num(
      'select coalesce(sum(actual_quantity_consumed),0)::int n from public.manufacturing_work_order_lines where work_order_id=$1',
      [wo],
    ),
  ).toBe(0);

  // WIP, Raw Materials and Finished Goods all net back to zero: the reversals
  // cancel the originals exactly.
  const net = (account: string) =>
    num(
      `select coalesce(sum(case when jl.is_debit then jl.amount_base else -jl.amount_base end),0) n
         from public.journal_lines jl
         join public.journal_entries je on je.id = jl.journal_entry_id
        where jl.business_id=$1 and jl.account_id=$2 and je.source_type='manufacturing_work_order'
          and je.source_id::text = $3`,
      [M.id, account, wo],
    );
  expect(await net(M.wip)).toBe(0);
  expect(await net(M.rm)).toBe(0);
  expect(await net(M.fgAccount)).toBe(0);

  expect(await scalar('select status from public.manufacturing_work_orders where id=$1', [wo])).toBe('cancelled');
  expect(
    await num(
      `select count(*)::int n from (
         select je.id from public.journal_entries je
           join public.journal_lines jl on jl.journal_entry_id = je.id
          where je.business_id=$1 and je.source_type='manufacturing_work_order'
          group by je.id having abs(sum(case when jl.is_debit then jl.amount_base else -jl.amount_base end)) > 0.005) x`,
      [M.id],
    ),
  ).toBe(0);
});

test(meta('MFG.WO.CANCEL.UNLOCK',
  'cancelling unlocks the BOM when no other live work order references it'),
async () => {
  ready();
  const { wo, bom } = await newWorkOrder(5, [{ product: M.steel, quantity: 1 }]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_release($1)', [wo]);
  expect(await num('select count(*)::int n from public.manufacturing_boms where id=$1 and bom_locked_at is not null', [bom])).toBe(1);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_cancel($1)', [wo]);
  expect(await num('select count(*)::int n from public.manufacturing_boms where id=$1 and bom_locked_at is null', [bom])).toBe(1);
});

test(meta('MFG.WO.CANCEL.KEEP_LOCK',
  'cancelling leaves the BOM locked while another live work order still references it'),
async () => {
  ready();
  const owner = identities.A_owner.id;
  const output = await newProduct('shared output', 'finished_good', 0);
  const bom = (await commitScalar(
    owner,
    `insert into public.manufacturing_boms(business_id,product_id,version,status,created_by)
     values($1,$2,1,'draft',$3) returning id`,
    [M.id, output, owner],
  )) as string;
  await db.client.query(
    `insert into public.manufacturing_bom_lines(bom_id,component_product_id,quantity,scrap_pct) values($1,$2,1,0)`,
    [bom, M.steel],
  );
  await commitScalar(owner, 'select public.manufacturing_bom_activate($1)', [bom]);

  const create = async () =>
    (await commitScalar(
      owner,
      'select public.manufacturing_wo_create($1,$2,$3,null,null,null,null,null) as r',
      [M.id, output, 5],
    )) as string;

  const first = await create();
  const second = await create();
  await commitScalar(owner, 'select public.manufacturing_wo_release($1)', [first]);
  await commitScalar(owner, 'select public.manufacturing_wo_release($1)', [second]);
  await commitScalar(owner, 'select public.manufacturing_wo_cancel($1)', [first]);

  // `second` is still released, so the lock stays.
  expect(await num('select count(*)::int n from public.manufacturing_boms where id=$1 and bom_locked_at is not null', [bom])).toBe(1);

  // Once the last live order goes, so does the lock.
  await commitScalar(owner, 'select public.manufacturing_wo_cancel($1)', [second]);
  expect(await num('select count(*)::int n from public.manufacturing_boms where id=$1 and bom_locked_at is null', [bom])).toBe(1);
});

test(meta('MFG.WO.CANCEL.CLOSED_REFUSED',
  'a closed work order cannot be cancelled'),
async () => {
  ready();
  const { wo } = await newWorkOrder(5, [{ product: M.steel, quantity: 1 }]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_release($1)', [wo]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_complete($1)', [wo]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_close($1)', [wo]);
  const result = await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
    try {
      await (client as C).query('select public.manufacturing_wo_cancel($1)', [wo]);
      return 'ok';
    } catch (e) {
      return (e as { code?: string }).code ?? 'unknown';
    }
  });
  expect(result).toBe('22023');
});

// ─────────────────────────────────────────────────────────────────────────────
// manufacturing_wo_yield
// ─────────────────────────────────────────────────────────────────────────────
test(meta('MFG.WO.YIELD.PERCENT',
  'manufacturing_wo_yield returns the yield percentage and per-component variance'),
async () => {
  ready();
  // 10 planned, 1 steel per unit. 8 completed with 2 scrapped → 80% yield.
  const { wo } = await newWorkOrder(10, [{ product: M.steel, quantity: 1 }]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_release($1)', [wo]);
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_record_run($1,$2,$3,null)', [
    wo,
    8,
    2,
  ]);

  const row = (await rowsAs(
    identities.A_owner.id,
    `select planned_quantity, completed_quantity, scrapped_quantity, yield_pct,
            component_planned_quantity, component_actual_quantity, consumption_variance
       from public.manufacturing_wo_yield($1)`,
    [wo],
  ))[0] as Record<string, any>;
  expect(Number(row.planned_quantity)).toBe(10);
  expect(Number(row.completed_quantity)).toBe(8);
  expect(Number(row.scrapped_quantity)).toBe(2);
  expect(Number(row.yield_pct)).toBe(80);
  // Backflush consumed exactly the planned 8, and a manual issue of 2 tips the
  // component over its plan.
  expect(Number(row.component_planned_quantity)).toBe(10);
  expect(Number(row.component_actual_quantity)).toBe(8);
  expect(Number(row.consumption_variance)).toBe(-2);

  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_record_consumption($1,null,$2,$3,null,null)', [wo, M.steel, 4]);
  const after = (await rowsAs(
    identities.A_owner.id,
    'select component_actual_quantity, consumption_variance from public.manufacturing_wo_yield($1)',
    [wo],
  ))[0] as Record<string, any>;
  expect(Number(after.component_actual_quantity)).toBe(12);
  expect(Number(after.consumption_variance)).toBe(2);
  // Yield is unaffected by material over-consumption.
  expect(
    Number(
      (await rowsAs(identities.A_owner.id, 'select yield_pct from public.manufacturing_wo_yield($1)', [wo]))[0]
        ?.yield_pct,
    ),
  ).toBe(80);
});

// ─────────────────────────────────────────────────────────────────────────────
// RLS
// ─────────────────────────────────────────────────────────────────────────────
test(meta('MFG.WO.RLS.NON_MEMBER',
  'a user who is not a member of the business cannot read its work orders'),
async () => {
  ready();
  const { wo } = await newWorkOrder(5, [{ product: M.steel, quantity: 1 }]);
  const outsider = identities.B_owner.id;

  expect(
    await db.asRole('authenticated', outsider, async (client: any) =>
      (await (client as C).query('select count(*)::int n from public.manufacturing_work_orders where id=$1', [wo]))
        .rows[0].n),
  ).toBe(0);
  // Neither can the outsider insert into the business. The row is built from
  // values read as the setup client, so the failure is the policy's WITH CHECK
  // and not an unreadable source sub-query.
  const source = (await value('select product_id, bom_id from public.manufacturing_work_orders where id=$1', [
    wo,
  ])) as Record<string, string>;
  expect(
    await attemptAs(
      outsider,
      `insert into public.manufacturing_work_orders(business_id,work_order_number,product_id,bom_id,planned_quantity,status,created_by)
       values($1,'WO-2026-998',$2,$3,1,'draft',$4)`,
      [M.id, source.product_id, source.bom_id, outsider],
    ),
  ).toBe('42501');
  expect(
    await db.asRole('authenticated', outsider, async (client: any) =>
      (await (client as C).query('select count(*)::int n from public.manufacturing_work_order_lines where work_order_id=$1', [wo]))
        .rows[0].n),
  ).toBe(0);
  expect(
    await db.asRole('authenticated', outsider, async (client: any) =>
      (await (client as C).query('select count(*)::int n from public.manufacturing_production_runs where work_order_id=$1', [wo]))
        .rows[0].n),
  ).toBe(0);
  expect(
    await db.asRole('authenticated', outsider, async (client: any) =>
      (await (client as C).query(
        'select count(*)::int n from public.manufacturing_material_transactions where work_order_id=$1',
        [wo],
      )).rows[0].n),
  ).toBe(0);
});

test(meta('MFG.WO.RLS.MEMBER_READ_NOT_WRITE',
  'a member reads work orders but cannot write them unless they are owner, admin or manager'),
async () => {
  ready();
  const { wo } = await newWorkOrder(5, [{ product: M.steel, quantity: 1 }]);

  for (const role of ['cashier', 'viewer']) {
    const uid = identities[`A_${role}`].id;
    // Read: admitted.
    expect(
      await db.asRole('authenticated', uid, async (client: any) =>
        (await (client as C).query('select count(*)::int n from public.manufacturing_work_orders where id=$1', [wo]))
          .rows[0].n),
      `${role} must be able to read`,
    ).toBe(1);
    // Write: refused by the policy. An UPDATE whose USING clause admits no row
    // is silent rather than an error, so the probe counts what it reached.
    expect(
      await db.asRole('authenticated', uid, async (client: any) =>
        (await (client as C).query(
          `with touched as (
             update public.manufacturing_work_orders set notes=$1 where id=$2 returning 1
           ) select count(*)::int n from touched`,
          ['hacked', wo],
        )).rows[0].n),
      `${role} must not be able to write`,
    ).toBe(0);
    // An INSERT is denied outright by the WITH CHECK clause.
    expect(
      await attemptAs(
        uid,
        `insert into public.manufacturing_work_orders(business_id,work_order_number,product_id,bom_id,planned_quantity,status,created_by)
         select $1,'WO-2026-997',product_id,bom_id,1,'draft',$2 from public.manufacturing_work_orders where id=$3`,
        [M.id, uid, wo],
      ),
      `${role} must not be able to insert`,
    ).toBe('42501');
    // And by the command's own authorisation, not only by RLS.
    expect(
      await attemptAs(uid, 'select public.manufacturing_wo_release($1)', [wo]),
      `${role} must not be able to release`,
    ).toBe('42501');
    expect(
      await attemptAs(uid, 'select public.manufacturing_wo_record_run($1,1,0,null)', [wo]),
      `${role} must not be able to record a run`,
    ).toBe('42501');
  }

  // A manager is the lowest role the write tier admits.
  await commitScalar(M.manager, 'select public.manufacturing_wo_release($1)', [wo]);
  expect(await scalar('select status from public.manufacturing_work_orders where id=$1', [wo])).toBe('released');
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration: the full forward-only lifecycle
// ─────────────────────────────────────────────────────────────────────────────
test(meta('MFG.WO.LIFECYCLE',
  'draft → release → run → complete → close moves stock and posts balanced WIP journals through the existing mechanisms'),
async () => {
  ready();
  const owner = identities.A_owner.id;

  // 10 frames: 2 steel @ 100 and 4 bolts @ 50 → 400 material cost per unit.
  const { wo, output } = await newWorkOrder(10, [
    { product: M.steel, quantity: 2 },
    { product: M.bolt, quantity: 4 },
  ]);

  const steelStart = await num(
    'select quantity_on_hand n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
    [M.id, M.steel, M.raw],
  );
  const boltStart = await num(
    'select quantity_on_hand n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
    [M.id, M.bolt, M.raw],
  );

  const statuses: string[] = [];
  const record = async () => statuses.push((await scalar('select status from public.manufacturing_work_orders where id=$1', [wo])) as string);

  await record(); // draft
  await commitScalar(owner, 'select public.manufacturing_wo_release($1)', [wo]);
  await record(); // released
  await commitScalar(owner, 'select public.manufacturing_wo_start($1)', [wo]);
  await record(); // in_progress
  await commitScalar(owner, 'select public.manufacturing_wo_record_run($1,$2,$3,null)', [wo, 6, 1]);
  await commitScalar(owner, 'select public.manufacturing_wo_record_run($1,$2,$3,null)', [wo, 4, 0]);
  await commitScalar(owner, 'select public.manufacturing_wo_complete($1)', [wo]);
  await record(); // completed
  await commitScalar(owner, 'select public.manufacturing_wo_close($1)', [wo]);
  await record(); // closed

  expect(statuses).toEqual(['draft', 'released', 'in_progress', 'completed', 'closed']);

  // Ten units: 20 steel and 40 bolts consumed through public.stock_movements.
  expect(
    await num(
      'select quantity_on_hand n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
      [M.id, M.steel, M.raw],
    ),
  ).toBe(steelStart - 20);
  expect(
    await num(
      'select quantity_on_hand n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
      [M.id, M.bolt, M.raw],
    ),
  ).toBe(boltStart - 40);
  expect(
    await num(
      'select coalesce(quantity_on_hand,0) n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3',
      [M.id, output, M.fg],
    ),
  ).toBe(10);

  // Movements are recorded through the existing single-writer table only.
  expect(
    await num(
      `select count(*)::int n from public.stock_movements
        where business_id=$1 and source_type='manufacturing_work_order' and source_id::text = $2
          and movement_type::text = 'manufacturing_issue'`,
      [M.id, wo],
    ),
  ).toBe(4); // two components × two runs
  expect(
    await num(
      `select count(*)::int n from public.stock_movements
        where business_id=$1 and source_type='manufacturing_work_order' and source_id::text = $2
          and movement_type::text = 'manufacturing_receipt' and quantity > 0`,
      [M.id, wo],
    ),
  ).toBe(2);

  // 10 × 400 = 4000 issued to WIP and cleared into Finished Goods.
  const net = async (account: string) =>
    num(
      `select coalesce(sum(case when jl.is_debit then jl.amount_base else -jl.amount_base end),0) n
         from public.journal_lines jl
         join public.journal_entries je on je.id = jl.journal_entry_id
        where jl.business_id=$1 and jl.account_id=$2 and je.source_type='manufacturing_work_order' and je.source_id::text = $3`,
      [M.id, account, wo],
    );
  expect(await net(M.rm)).toBe(-4000);
  expect(await net(M.fgAccount)).toBe(4000);
  expect(await net(M.wip)).toBe(0);

  // Every entry posted for this order is balanced and already posted.
  expect(
    await num(
      `select count(*)::int n from (
         select je.id from public.journal_entries je
           join public.journal_lines jl on jl.journal_entry_id = je.id
          where je.business_id=$1 and je.source_type='manufacturing_work_order' and je.source_id::text = $2
          group by je.id having abs(sum(case when jl.is_debit then jl.amount_base else -jl.amount_base end)) > 0.005) x`,
      [M.id, wo],
    ),
  ).toBe(0);
  expect(
    await num(
      `select count(*)::int n from public.journal_entries
        where business_id=$1 and source_type='manufacturing_work_order' and source_id::text = $2 and status='posted'`,
      [M.id, wo],
    ),
  ).toBe(4); // two runs × (issue + receipt)

  // Closing is final: the order can no longer be changed.
  expect(await attemptAs(owner, 'select public.manufacturing_wo_record_run($1,1,0,null)', [wo])).toBe('22023');
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5B-2a: routing, recursive order requirements, and production runs
// ─────────────────────────────────────────────────────────────────────────────
const executionMeta = (id: string, expected: string) => ({
  id,
  expected,
  remediation: 'Phase 5B-2a',
  source: 'supabase/migrations/20261121000000_manufacturing_execution_routings_and_runs.sql',
  layer: 'Isolated PostgreSQL 17 full migration replay; synthetic tenants; authenticated RPCs; existing stock-movement trigger.',
});

async function makeActiveBom(
  productId: string,
  components: Array<{ component_product_id: string | null; component_bom_id: string | null; quantity: number; scrap_pct: number }>,
) {
  const owner = identities.A_owner.id;
  const bomId = (await commitScalar(owner,
    'select public.save_bom_version($1::uuid,null,$2::uuid,null,$3::jsonb) as id',
    [M.id, productId, JSON.stringify(components.map((component) => ({ ...component, unit_of_measure: 'ea', notes: null })))],
  )) as string;
  await commitScalar(owner, 'select public.manufacturing_bom_activate($1::uuid)', [bomId]);
  return bomId;
}

async function createExecutionWorkOrder({ productId, bomId, quantity, priority = 'normal', routingId = null }:
  { productId: string; bomId: string; quantity: number; priority?: string; routingId?: string | null }) {
  return (await commitScalar(identities.A_owner.id,
    `select public.create_work_order_from_bom($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::numeric,$6::text,$7::date,$8::date,$9::text,$10::uuid,$11::uuid,$12::text) as id`,
    [M.id, productId, bomId, routingId, quantity, null, null, null, priority, M.raw, M.fg, 'Phase 5B-2a execution evidence'],
  )) as string;
}

test(executionMeta('MFG.EXECUTION.BOM-EXPLOSION.QUANTITY',
  'Creating an order multiplies nested per-unit component usage and scrap factors by planned quantity, then release preserves the frozen leaf requirements.'), async () => {
  ready();
  const subassembly = await newProduct('Nested assembly', 'wip', 0);
  const output = await newProduct('Nested output', 'finished_good', 0);
  const childBom = await makeActiveBom(subassembly, [
    { component_product_id: M.steel, component_bom_id: null, quantity: 2, scrap_pct: 10 },
  ]);
  const rootBom = await makeActiveBom(output, [
    { component_product_id: null, component_bom_id: childBom, quantity: 3, scrap_pct: 20 },
    { component_product_id: M.bolt, component_bom_id: null, quantity: 4, scrap_pct: 0 },
  ]);
  const workOrderId = await createExecutionWorkOrder({ productId: output, bomId: rootBom, quantity: 5, priority: 'high' });
  expect(await num('select planned_quantity n from public.manufacturing_work_orders where id=$1', [workOrderId])).toBe(5);
  expect(await num('select count(*)::int n from public.manufacturing_work_order_lines where work_order_id=$1', [workOrderId])).toBe(2);
  expect(await num('select planned_quantity n from public.manufacturing_work_order_lines where work_order_id=$1 and component_product_id=$2', [workOrderId, M.steel])).toBe(39.6);
  expect(await num('select planned_quantity n from public.manufacturing_work_order_lines where work_order_id=$1 and component_product_id=$2', [workOrderId, M.bolt])).toBe(20);
  expect(await scalar('select priority from public.manufacturing_work_orders where id=$1', [workOrderId])).toBe('high');
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_release($1::uuid)', [workOrderId]);
  expect(await num('select planned_quantity n from public.manufacturing_work_order_lines where work_order_id=$1 and component_product_id=$2', [workOrderId, M.steel])).toBe(39.6);
});

test(executionMeta('MFG.EXECUTION.ROUTING.ACTIVATE',
  'A routing with a same-business active work centre can be saved and activated; its versioned steps and computed time totals are persisted.'), async () => {
  ready();
  const output = await newProduct('Routed output', 'finished_good', 0);
  const bomId = await makeActiveBom(output, [
    { component_product_id: M.steel, component_bom_id: null, quantity: 1, scrap_pct: 0 },
  ]);
  const centreId = (await commitScalar(identities.A_owner.id,
    `insert into public.work_centres(business_id,code,name,centre_type,capacity_hours_per_day,cost_rate_per_hour)
     values($1,'CUT-01','Cutting cell','cell',8,12.5) returning id`, [M.id])) as string;
  const routingId = (await commitScalar(identities.A_owner.id,
    `insert into public.routings(business_id,product_id,bom_version_id,code,name,version_number,status)
     values($1,$2,$3,'ROUTE-01','Cut and inspect',1,'draft') returning id`, [M.id, output, bomId])) as string;
  await commitRows(identities.A_owner.id,
    `insert into public.routing_steps(routing_id,business_id,sequence,work_centre_id,operation_name,setup_time_minutes,run_time_per_unit_minutes,queue_time_minutes,is_quality_checkpoint)
     values($1,$2,1,$3,'Cut',5,2.5,1,true) returning id`, [routingId, M.id, centreId]);
  await commitScalar(identities.A_owner.id,
    `update public.routings set total_setup_minutes=5,total_run_minutes_per_unit=2.5 where id=$1`, [routingId]);
  await commitScalar(identities.A_owner.id, `update public.routings set status='active' where id=$1`, [routingId]);
  expect(await scalar('select status from public.routings where id=$1', [routingId])).toBe('active');
  expect(await num('select total_setup_minutes n from public.routings where id=$1', [routingId])).toBe(5);
  expect(await num('select total_run_minutes_per_unit n from public.routings where id=$1', [routingId])).toBe(2.5);
  expect(await num('select count(*)::int n from public.routing_steps where routing_id=$1 and is_quality_checkpoint', [routingId])).toBe(1);
});

test(executionMeta('MFG.EXECUTION.RUN.ATOMIC-INVENTORY',
  'Completing a run consumes materials for good plus scrapped units and receives good output only through stock_movements, atomically updating inventory balances.'), async () => {
  ready();
  const output = await newProduct('Run output', 'finished_good', 0);
  const bomId = await makeActiveBom(output, [
    { component_product_id: M.steel, component_bom_id: null, quantity: 2, scrap_pct: 10 },
  ]);
  const workOrderId = await createExecutionWorkOrder({ productId: output, bomId, quantity: 10 });
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_release($1::uuid)', [workOrderId]);
  const runId = (await commitScalar(identities.A_owner.id,
    `insert into public.manufacturing_production_runs(work_order_id,run_number,output_quantity,scrap_quantity,status,created_by,output_location_id)
     values($1,0,0,0,'in_progress',$2,$3) returning id`, [workOrderId, identities.A_owner.id, M.fg])) as string;
  const otherLocation = (await scalar("select id from public.inventory_locations where business_id <> $1 and is_active limit 1", [M.id])) as string;
  const rejected = await attemptAs(identities.A_owner.id,
    'select public.complete_production_run($1::uuid,$2::uuid,4,1,$3::text,$4::uuid)', [M.id, runId, 'Quality defect', otherLocation]);
  expect(rejected).toBe('23514');
  expect(await scalar('select status from public.manufacturing_production_runs where id=$1', [runId])).toBe('in_progress');
  expect(await num("select count(*)::int n from public.stock_movements where source_type='production_run' and source_id::text=$1", [runId])).toBe(0);

  const steelBefore = await num('select quantity_on_hand n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3', [M.id, M.steel, M.raw]);
  await commitScalar(identities.A_owner.id,
    'select public.complete_production_run($1::uuid,$2::uuid,4,1,$3::text,$4::uuid)', [M.id, runId, 'Quality defect', M.fg]);
  expect(await scalar('select status from public.manufacturing_production_runs where id=$1', [runId])).toBe('completed');
  expect(await num('select quantity_consumed n from public.manufacturing_production_run_lines where production_run_id=$1 and component_product_id=$2', [runId, M.steel])).toBe(11);
  expect(await num('select actual_quantity_consumed n from public.manufacturing_work_order_lines where work_order_id=$1 and component_product_id=$2', [workOrderId, M.steel])).toBe(11);
  expect(await num('select quantity_on_hand n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3', [M.id, M.steel, M.raw])).toBe(steelBefore - 11);
  expect(await num('select quantity_on_hand n from public.inventory_balances where business_id=$1 and product_id=$2 and location_id=$3', [M.id, output, M.fg])).toBe(4);
  expect(await num("select count(*)::int n from public.stock_movements where business_id=$1 and source_type='production_run' and source_id::text=$2 and movement_type::text='manufacturing_issue' and quantity<0", [M.id, runId])).toBe(1);
  expect(await num("select count(*)::int n from public.stock_movements where business_id=$1 and source_type='production_run' and source_id::text=$2 and movement_type::text='manufacturing_receipt' and quantity>0", [M.id, runId])).toBe(1);
  expect(await num('select count(*)::int n from public.manufacturing_material_transactions where run_id=$1 and transaction_type=\'consume\'', [runId])).toBe(1);
});

test(executionMeta('MFG.EXECUTION.RUN.ABORT',
  'Aborting an in-progress run is an authorized table transition and creates no stock movements.'), async () => {
  ready();
  const output = await newProduct('Aborted run output', 'finished_good', 0);
  const bomId = await makeActiveBom(output, [
    { component_product_id: M.steel, component_bom_id: null, quantity: 1, scrap_pct: 0 },
  ]);
  const workOrderId = await createExecutionWorkOrder({ productId: output, bomId, quantity: 3 });
  await commitScalar(identities.A_owner.id, 'select public.manufacturing_wo_release($1::uuid)', [workOrderId]);
  const runId = (await commitScalar(identities.A_owner.id,
    `insert into public.manufacturing_production_runs(work_order_id,run_number,output_quantity,scrap_quantity,status,created_by,output_location_id)
     values($1,0,0,0,'in_progress',$2,$3) returning id`, [workOrderId, identities.A_owner.id, M.fg])) as string;
  await commitScalar(identities.A_owner.id,
    `update public.manufacturing_production_runs set status='aborted',completed_at=now() where id=$1`, [runId]);
  expect(await scalar('select status from public.manufacturing_production_runs where id=$1', [runId])).toBe('aborted');
  expect(await scalar('select status from public.manufacturing_work_orders where id=$1', [workOrderId])).toBe('in_progress');
  expect(await num("select count(*)::int n from public.stock_movements where source_type='production_run' and source_id::text=$1", [runId])).toBe(0);
});

test(executionMeta('MFG.EXECUTION.RLS.MEMBER-READ-MANAGER-WRITE',
  'Manufacturing members may read execution master data, while a viewer cannot create a work centre.'), async () => {
  ready();
  expect(await rowsAs(identities.A_viewer.id, 'select id from public.work_centres where business_id=$1', [M.id])).toHaveLength(1);
  expect(await attemptAs(identities.A_viewer.id,
    `insert into public.work_centres(business_id,code,name) values($1,'VIEWER-01','Denied')`, [M.id])).toBe('42501');
});
