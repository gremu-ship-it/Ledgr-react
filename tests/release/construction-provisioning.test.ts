/**
 * Construction operating-model provisioning — release evidence (isolated local layer).
 *
 * WHAT THIS SUITE PROVES (and what it does not)
 *   Layer: real PostgreSQL 17 (embedded), full synthetic migration replay including
 *   20261027000000_construction_operating_model_defaults.sql, synthetic authenticated
 *   identities bound through request.jwt.claim.*, probes running as the `authenticated`
 *   role so RLS and/or function authority genuinely applies.
 *   It is NOT official Supabase Auth/PostgREST, NOT a deployed-policy check and NOT
 *   production verification. No production or shared database was contacted.
 *
 * Covered:
 *   * a business created with the CONSTRUCTION operating model is accepted by
 *     create_business_with_owner (the RPC validates the vocabulary itself), and
 *     provision_construction_defaults creates exactly one "Main Site" branch, its
 *     "Main Store" location and the twelve procurement capability grants, tagged
 *     source = 'registration_bootstrap' and granted_by = the owner;
 *   * a second call is a no-op: no second branch, no second location, no duplicate
 *     live grant (the partial unique index is the defence);
 *   * provisioning refuses a business that has not selected CONSTRUCTION, refuses a
 *     caller who is not an owner/admin member, refuses a nominated "owner" who is not
 *     an owner/admin member, and is not executable by anon;
 *   * Settings can add CONSTRUCTION to an existing business through
 *     update_business_operating_models, that write is audited once (a repeat save is a
 *     no-op), and the same provisioning then runs for it;
 *   * the bootstrap does not weaken the shipped command layer: the owner still cannot
 *     self-grant a capability (22023) and still cannot authorise their own purchase
 *     order (22023); a second granted member can authorise it.
 *
 * Dependency note: the command surface itself (capability denial, replay, forgery,
 * receipt posting, material issues and returns) is covered by
 * construction-procurement.test.ts / construction-returns.test.ts. This suite covers
 * the provisioning path that gives the owner their first grants.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, afterAll, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, key } from './fixtures';
import { evidenceSuite, Blocked, safeError } from './evidence';

const test = evidenceSuite('construction-provisioning');
const MS = 'supabase/migrations/20261027000000_construction_operating_model_defaults.sql';
const LAYER = 'real PostgreSQL17 roles + JWT claims; synthetic identities; full migration replay (incl. 20261027000000); probes as authenticated; every probe rolled back';
const meta = (id: string, expected: string) => ({
  id,
  expected,
  remediation: 'CONSTRUCTION-OPERATING-MODEL-2026-10-17',
  source: MS,
  layer: LAYER,
});

type C = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, any>[] }> };

const CAPS = [
  'procurement.master.manage',
  'procurement.po.manage',
  'procurement.po.authorize',
  'procurement.delivery_note.record',
  'procurement.grn.record',
  'procurement.receipt.inspect',
  'procurement.exception.authorize',
  'procurement.bill.match',
  'procurement.receipt.post',
  'procurement.policy.approve',
  'procurement.material.issue',
  'procurement.material.return',
] as const;

let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
let replayError = '';
let seedError = '';

/** C = the business created with CONSTRUCTION at registration. */
const C: Record<string, string> = {};
/** Initial provisioning result captured from the registration path. */
let firstProvision: Record<string, any> = {};

const count = async (sql: string, values: unknown[] = []) =>
  Number((await db.client.query(sql, values)).rows[0].n);

/** Run one statement as an authenticated identity; return 'ok' or its SQLSTATE. */
const attempt = async (uid: string, sql: string, values: unknown[] = []) =>
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

let ck = 8100;
const ckey = () => key(++ck);

async function setup() {
  orgs = await seedFixture(db.client);
  const owner = identities.A_owner.id;

  // 1. Registration path: the owner creates a second business and selects
  //    CONSTRUCTION. This must be accepted by the RPC's own validation, not only
  //    by the table CHECK.
  C.id = await db.commitAsRole('authenticated', owner, async (client: any) => {
    const res = await (client as C).query(
      `select public.create_business_with_owner(
         'R13 Construction Co','R13',null,null,null,false,'MWK','07-01','UTC',
         null,null,'Malawi',null,null,null,'INV','EXP','PAY','FOR_PROFIT',
         array['CONSTRUCTION']) as id`,
    );
    return res.rows[0].id as string;
  });

  // 2. The registration flow then calls the provisioning RPC (separate call, so a
  //    failure cannot roll back the business). Committed as a fixture.
  firstProvision = await db.commitAsRole('authenticated', owner, async (client: any) => {
    const res = await (client as C).query(
      'select public.provision_construction_defaults($1,$2) as r',
      [C.id, owner],
    );
    return res.rows[0].r;
  });

  // 3. Ground truth rows used by the command probes.
  const insertId = async (sql: string, values: unknown[]) =>
    (await db.client.query(sql, values)).rows[0].id as string;
  C.product = await insertId(
    `insert into public.products(business_id,name,sku,sale_price,purchase_price,currency,product_type,track_inventory,sales_tax_code,purchase_tax_code,unit_of_measure)
     values($1,'R13 CPV bag',$2,1500,900,'MWK','product',true,'none','none','BAG') returning id`,
    [C.id, `CPV-${C.id.slice(0, 8)}`],
  );
  C.supplier = await insertId(
    "insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt) values($1,'R13 CPV supplier','supplier',true,false) returning id",
    [C.id],
  );
  // A second person in the construction business, for the two-person probe. Membership
  // is a fixture write; the capability itself is granted through the shipped command.
  await db.client.query(
    "insert into public.business_users(business_id,user_id,role,is_active) values($1,$2,'admin',true)",
    [C.id, identities.A_admin.id],
  );
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
    console.error('CPV fixture setup failed:', seedError);
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
// Registration bootstrap
// ─────────────────────────────────────────────────────────────────────────────
test(meta('CPV.REGISTRATION.DEFAULTS',
  'A business registered with CONSTRUCTION gets one Main Site branch, its Main Store location and the twelve bootstrap grants held by the owner'),
  async () => {
    ready();
    expect(String(firstProvision.grants_created)).toBe('12');
    expect(firstProvision.branch_created).toBe(true);
    expect(firstProvision.location_created).toBe(true);
    expect(String(firstProvision.grants_in_force)).toBe('12');

    expect(await count(
      "select count(*)::int n from public.branches where business_id=$1 and name='Main Site' and deleted_at is null",
      [C.id])).toBe(1);
    const branch = (await db.client.query(
      "select id from public.branches where business_id=$1 and name='Main Site'", [C.id])).rows[0].id;

    expect(await count(
      'select count(*)::int n from public.inventory_locations where business_id=$1 and branch_id=$2 and name=$3',
      [C.id, branch, 'Main Store'])).toBe(1);
    expect(await count(
      'select count(*)::int n from public.inventory_locations where business_id=$1 and branch_id=$2 and is_default',
      [C.id, branch])).toBe(1);

    expect(await count(
      'select count(*)::int n from public.construction_procurement_grants where business_id=$1 and revoked_at is null',
      [C.id])).toBe(12);
    expect(await count(
      'select count(*)::int n from public.construction_procurement_grants where business_id=$1 and revoked_at is null and source=$2',
      [C.id, 'registration_bootstrap'])).toBe(12);
    expect(await count(
      'select count(*)::int n from public.construction_procurement_grants where business_id=$1 and revoked_at is null and user_id=$2 and granted_by=$2',
      [C.id, identities.A_owner.id])).toBe(12);
    expect(await count(
      "select count(*)::int n from public.construction_procurement_grants where business_id=$1 and revoked_at is null and grant_reason='Automatic provisioning for construction business at registration'",
      [C.id])).toBe(12);
    // Exactly the twelve catalogue codes, nothing else.
    const codes = (await db.client.query(
      'select capability from public.construction_procurement_grants where business_id=$1 and revoked_at is null',
      [C.id])).rows.map((row: { capability: string }) => row.capability);
    // Compare as sets: the database's collation ordering is not under test.
    expect(codes.sort()).toEqual([...CAPS].sort());

    // No leakage into the other seeded businesses.
    expect(await count(
      "select count(*)::int n from public.branches where business_id=any($1::uuid[]) and name='Main Site'",
      [[orgs.A.business, orgs.B.business]])).toBe(0);
  });

test(meta('CPV.BOOTSTRAP.IDEMPOTENT',
  'Re-running provisioning creates nothing: no second branch, no second location and no duplicate live grant'),
  async () => {
    ready();
    const second = await rpcAs(identities.A_owner.id,
      'select public.provision_construction_defaults($1,$2) as r', [C.id, identities.A_owner.id]);
    expect(String(second.grants_created)).toBe('0');
    expect(second.branch_created).toBe(false);
    expect(second.location_created).toBe(false);
    expect(String(second.grants_in_force)).toBe('12');

    // The probe's own transaction now sees both calls; nothing was duplicated.
    await db.asRole('authenticated', identities.A_owner.id, async (client: any) => {
      const c = client as C;
      const one = async (sql: string, values: unknown[] = []) =>
        Number((await c.query(sql, values)).rows[0].n);
      expect(await one(
        "select count(*)::int n from public.branches where business_id=$1 and name='Main Site'",
        [C.id])).toBe(1);
      expect(await one(
        'select count(*)::int n from public.inventory_locations where business_id=$1 and name=$2',
        [C.id, 'Main Store'])).toBe(1);
      expect(await one(
        'select count(*)::int n from public.construction_procurement_grants where business_id=$1 and revoked_at is null',
        [C.id])).toBe(12);
      expect(await one(
        'select count(distinct capability)::int n from public.construction_procurement_grants where business_id=$1 and revoked_at is null',
        [C.id])).toBe(12);
    });
  });

test(meta('CPV.BOOTSTRAP.REQUIRES.MODEL',
  'Provisioning refuses a business that has not selected CONSTRUCTION, so it cannot become a general grant injector'),
  async () => {
    ready();
    const code = await attempt(identities.B_owner.id,
      'select public.provision_construction_defaults($1,$2)', [orgs.B.business, identities.B_owner.id]);
    expect(code).toBe('22023');
    expect(await count(
      'select count(*)::int n from public.construction_procurement_grants where business_id=$1',
      [orgs.B.business])).toBe(0);
    expect(await count(
      "select count(*)::int n from public.branches where business_id=$1 and name='Main Site'",
      [orgs.B.business])).toBe(0);
  });

test(meta('CPV.BOOTSTRAP.AUTHORITY',
  'Only an owner/admin member can provision, only for an owner/admin nominee, and anon cannot execute the function at all'),
  async () => {
    ready();
    // Non-owner member of the construction business.
    expect(await attempt(identities.A_cashier.id,
      'select public.provision_construction_defaults($1,$2)', [C.id, identities.A_cashier.id])).toBe('42501');
    // Owner of another business cannot provision this one.
    expect(await attempt(identities.B_owner.id,
      'select public.provision_construction_defaults($1,$2)', [C.id, identities.B_owner.id])).toBe('42501');
    // The nominee must be an owner/admin member of this business.
    expect(await attempt(identities.A_owner.id,
      'select public.provision_construction_defaults($1,$2)', [C.id, identities.B_owner.id])).toBe('42501');
    // anon has no EXECUTE privilege at all (defence in depth above the SECURITY DEFINER check).
    expect((await db.client.query(
      "select has_function_privilege('anon','public.provision_construction_defaults(uuid,uuid)','execute') as n")).rows[0].n)
      .toBe(false);
    expect((await db.client.query(
      "select has_function_privilege('anon','public.update_business_operating_models(uuid,text[])','execute') as n")).rows[0].n)
      .toBe(false);
    // None of the refused probes changed the grant set.
    expect(await count(
      'select count(*)::int n from public.construction_procurement_grants where business_id=$1 and revoked_at is null',
      [C.id])).toBe(12);
  });

// ─────────────────────────────────────────────────────────────────────────────
// Settings path for an existing business
// ─────────────────────────────────────────────────────────────────────────────
test(meta('CPV.SETTINGS.ADD',
  'An existing business can add CONSTRUCTION from Settings (audited once) and then receives the same provisioning'),
  async () => {
    ready();
    const saved = await db.commitAsRole('authenticated', identities.B_owner.id, async (client: any) =>
      (await (client as C).query(
        'select public.update_business_operating_models($1,$2) as r',
        [orgs.B.business, ['CONSTRUCTION']])).rows[0].r as string[]);
    expect(saved).toEqual(['CONSTRUCTION']);

    expect(await count(
      "select count(*)::int n from public.audit_log where business_id=$1 and event_type='business_operating_models_updated'",
      [orgs.B.business])).toBe(1);
    const audit = (await db.client.query(
      "select old_values, new_values from public.audit_log where business_id=$1 and event_type='business_operating_models_updated' order by id desc limit 1",
      [orgs.B.business])).rows[0];
    expect(audit.new_values).toEqual(['CONSTRUCTION']);
    expect(audit.old_values).toEqual([]);

    // A no-op save writes no second audit entry.
    const again = await db.commitAsRole('authenticated', identities.B_owner.id, async (client: any) =>
      (await (client as C).query(
        'select public.update_business_operating_models($1,$2) as r',
        [orgs.B.business, ['CONSTRUCTION']])).rows[0].r as string[]);
    expect(again).toEqual(['CONSTRUCTION']);
    expect(await count(
      "select count(*)::int n from public.audit_log where business_id=$1 and event_type='business_operating_models_updated'",
      [orgs.B.business])).toBe(1);

    // Provisioning now runs for the same business and keeps its existing branches.
    const provisioned = await db.commitAsRole('authenticated', identities.B_owner.id, async (client: any) =>
      (await (client as C).query(
        'select public.provision_construction_defaults($1,$2) as r',
        [orgs.B.business, identities.B_owner.id])).rows[0].r as Record<string, any>);
    expect(String(provisioned.grants_created)).toBe('12');
    expect(String(provisioned.grants_in_force)).toBe('12');
    expect(await count(
      'select count(*)::int n from public.construction_procurement_grants where business_id=$1 and revoked_at is null and source=$2',
      [orgs.B.business, 'registration_bootstrap'])).toBe(12);
    // The seeded A1/B1 branches are untouched; only "Main Site" is added.
    expect(await count(
      'select count(*)::int n from public.branches where business_id=$1',
      [orgs.B.business])).toBe(3);

    // Removing the model revokes nothing (the settings contract).
    const removed = await db.commitAsRole('authenticated', identities.B_owner.id, async (client: any) =>
      (await (client as C).query(
        'select public.update_business_operating_models($1,$2) as r',
        [orgs.B.business, []])).rows[0].r as string[]);
    expect(removed).toEqual([]);
    expect(await count(
      'select count(*)::int n from public.construction_procurement_grants where business_id=$1 and revoked_at is null',
      [orgs.B.business])).toBe(12);
    expect(await count(
      "select count(*)::int n from public.branches where business_id=$1 and name='Main Site'",
      [orgs.B.business])).toBe(1);
  });

test(meta('CPV.SETTINGS.AUTHORITY',
  'Only an owner/admin may change the operating models, and an invalid value is refused with 22023'),
  async () => {
    ready();
    expect(await attempt(identities.A_viewer.id,
      'select public.update_business_operating_models($1,$2)', [orgs.A.business, ['RETAIL']])).toBe('42501');
    expect(await attempt(identities.B_owner.id,
      'select public.update_business_operating_models($1,$2)', [orgs.A.business, ['RETAIL']])).toBe('42501');
    expect(await attempt(identities.A_owner.id,
      'select public.update_business_operating_models($1,$2)', [orgs.A.business, ['NOT_A_MODEL']])).toBe('22023');
    expect(await attempt(identities.A_owner.id,
      'select public.update_business_operating_models($1,$2)', [orgs.A.business, ['RETAIL', 'RETAIL']])).toBe('22023');
    // A NULL selection normalises to the empty array, which preserves the no-op contract.
    expect(await count(
      "select count(*)::int n from public.businesses where id=$1 and operating_models='{}'::text[]",
      [orgs.A.business])).toBe(1);
  });

// ─────────────────────────────────────────────────────────────────────────────
// The bootstrap does not weaken the command layer
// ─────────────────────────────────────────────────────────────────────────────
test(meta('CPV.COMMANDS.BOOTSTRAP-GRANTS-WORK',
  'The bootstrapped owner can register a site and create a PO but still cannot authorise their own PO; a second granted member can'),
  async () => {
    ready();
    const site = await db.commitAsRole('authenticated', identities.A_owner.id, async (client: any) => {
      const c = client as C;
      const branch = (await c.query(
        "select id from public.branches where business_id=$1 and name='Main Site'", [C.id])).rows[0].id;
      const location = (await c.query(
        'select id from public.inventory_locations where business_id=$1 and branch_id=$2', [C.id, branch])).rows[0].id;
      const res = await c.query(
        'select public.register_construction_procurement_site($1,$2,$3,$4,$5,$6) as r',
        [C.id, branch, location, 'CPV-SITE-1', 'CPV site one', 'CPV-PROJECT-1']);
      return res.rows[0].r.id as string;
    });

    const po = await db.commitAsRole('authenticated', identities.A_owner.id, async (client: any) =>
      (await (client as C).query(
        'select public.create_construction_purchase_order($1::jsonb,$2::uuid) as r',
        [JSON.stringify({
          business_id: C.id,
          site_id: site,
          supplier_contact_id: C.supplier,
          currency: 'MWK',
          lines: [{ product_id: C.product, uom: 'BAG', quantity_ordered: 3 }],
        }), ckey()])).rows[0].r.id as string);

    // Four eyes: the creator cannot authorise.
    expect(await attempt(identities.A_owner.id,
      'select public.authorize_construction_purchase_order($1)', [po])).toBe('22023');
    expect(await count(
      "select count(*)::int n from public.construction_purchase_orders where id=$1 and status='draft'",
      [po])).toBe(1);

    // The shipped self-grant prohibition is untouched by the direct bootstrap insert.
    expect(await attempt(identities.A_owner.id,
      'select public.grant_construction_procurement_capability($1,$2,$3,$4)',
      [C.id, identities.A_owner.id, 'procurement.po.authorize', 'CPV self grant'])).toBe('22023');

    // A different member, granted through the shipped command, can authorise.
    // This grant is committed (it is fixture state for the next probe), unlike the
    // rolled-back refusal probes above.
    await db.commitAsRole('authenticated', identities.A_owner.id, async (client: any) => {
      await (client as C).query(
        'select public.grant_construction_procurement_capability($1,$2,$3,$4)',
        [C.id, identities.A_admin.id, 'procurement.po.authorize', 'CPV second approver'],
      );
    });
    const authorized = await db.commitAsRole('authenticated', identities.A_admin.id, async (client: any) =>
      (await (client as C).query(
        'select public.authorize_construction_purchase_order($1) as r', [po])).rows[0].r);
    expect(authorized.status).toBe('authorized');
    expect(await count(
      'select count(*)::int n from public.construction_procurement_grants where business_id=$1 and user_id=$2 and capability=$3 and source=$4',
      [C.id, identities.A_admin.id, 'procurement.po.authorize', 'manual_grant'])).toBe(1);
  });

test(meta('CPV.STATIC.NO-RLS-CHANGE',
  'The migration adds no policy, enables no RLS and grants no table write path; it only adds SECURITY DEFINER functions'),
  async () => {
    ready();
    const sql = readFileSync(fileURLToPath(new URL(`../../${MS}`, import.meta.url)), 'utf8');
    expect(sql).not.toMatch(/\b(?:CREATE|ALTER|DROP)\s+POLICY\b/i);
    expect(sql).not.toMatch(/\bENABLE\s+ROW\s+LEVEL\s+SECURITY\b/i);
    expect(sql).not.toMatch(/\bGRANT\s+(?:INSERT|UPDATE|DELETE|ALL)\s+ON\s+(?:TABLE\s+)?public\./i);
    expect(sql).not.toMatch(/\b(?:journal_entries|journal_lines)\b/i);
    // The shipped grant command is not redefined here.
    expect(sql).not.toMatch(/FUNCTION\s+public\.grant_construction_procurement_capability/i);
    expect(sql).toMatch(/SECURITY DEFINER/);
  });
