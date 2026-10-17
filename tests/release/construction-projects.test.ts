/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities, key, DAY } from './fixtures';
import { evidenceSuite, ObservedFailure } from './evidence';

const test = evidenceSuite('construction-projects');
const meta = (id: string, expected: string) => ({
  id: `CPA.${id}`,
  expected,
  source: 'supabase/migrations/20261028000000_construction_projects.sql',
  remediation: 'CONSTRUCTION-PHASE-A',
  layer:
    'Local PostgreSQL 17 full migration replay; real authenticated roles and synthetic JWT identities',
});
let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
type C = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }>;
};
const owner = identities.A_owner.id;
const rpc = async (c: C, sql: string, values: unknown[] = []) =>
  (await c.query(sql, values)).rows[0];
const create = (c: C) =>
  rpc(
    c,
    "select * from public.create_project($1,'Hospital','Client',1000,10,800,'2026-10-01','2027-10-01')",
    [orgs.A.business],
  );
const statuses = [
  'tender',
  'active',
  'practical_completion',
  'defect_liability',
  'closed',
];
let n = 24000;
let foreignProject: string;
beforeAll(async () => {
  db = await createDatabaseFixture();
  orgs = await seedFixture(db.client);
  await db.client.query(
    "update public.businesses set operating_models=array['CONSTRUCTION'],plan_tier='enterprise',plan_expires_at='2099-01-01' where id=$1",
    [orgs.A.business],
  );
  await db.commitAsRole(
    'authenticated',
    owner,
    'select public.provision_construction_defaults($1,$2)',
    [orgs.A.business, owner],
  );
  await db.client.query(
    "update public.businesses set operating_models=array['CONSTRUCTION'] where id=$1",
    [orgs.B.business],
  );
  await db.commitAsRole(
    'authenticated',
    identities.B_owner.id,
    'select public.provision_construction_defaults($1,$2)',
    [orgs.B.business, identities.B_owner.id],
  );
  foreignProject = await db.commitAsRole(
    'authenticated',
    identities.B_owner.id,
    async (c: C) =>
      (
        await rpc(
          c,
          "select * from public.create_project($1,'Other business','Other client',0,0,0,null,null)",
          [orgs.B.business],
        )
      ).id,
  );
});
afterAll(async () => {
  await db?.cleanup();
});

async function rejects(
  c: C,
  sql: string,
  values: unknown[],
  code: string,
  message?: string,
) {
  await c.query('savepoint project_probe');
  let error: any;
  try {
    await c.query(sql, values);
  } catch (e) {
    error = e;
  }
  await c.query('rollback to savepoint project_probe');
  if (error?.code !== code)
    throw new ObservedFailure(
      `Expected SQLSTATE ${code}, observed ${error?.code ?? 'success'}.`,
    );
  if (message) expect(error?.message).toContain(message);
}

test(
  meta(
    'CREATE',
    'Valid project starts in tender; fields and caller are stored',
  ),
  async () => {
    await db.asRole('authenticated', owner, async (c: C) => {
      const p = await create(c);
      expect(p.status).toBe('tender');
      expect(p.created_by).toBe(owner);
      expect(Number(p.retention_pct)).toBe(10);
      expect(p.client_name).toBe('Client');
    });
  },
);
test(
  meta(
    'VALIDATION',
    'Negative amounts, invalid retention, dates and blank names are rejected',
  ),
  async () => {
    await db.asRole('authenticated', owner, async (c: C) => {
      const sql = 'select public.create_project($1,$2,$3,$4,$5,$6,$7,$8)';
      for (const args of [
        ['', 'Client', 1, 10, 0, null, null],
        ['Name', '', 1, 10, 0, null, null],
        ['Name', 'Client', -1, 10, 0, null, null],
        ['Name', 'Client', 1, 101, 0, null, null],
        ['Name', 'Client', 1, -1, 0, null, null],
        ['Name', 'Client', 1, 10, -1, null, null],
        ['Name', 'Client', 1, 10, 0, '2026-10-02', '2026-10-01'],
      ])
        await rejects(c, sql, [orgs.A.business, ...args], '22023');
    });
  },
);
test(
  meta('NO_GRANT', 'Business membership alone does not authorize creation'),
  async () => {
    await db.asRole('authenticated', identities.A_admin.id, async (c: C) => {
      await rejects(
        c,
        "select public.create_project($1,'Name','Client',1,10,0,null,null)",
        [orgs.A.business],
        '42501',
      );
    });
  },
);
for (const [i, from] of statuses.entries())
  for (const to of statuses) {
    test(
      meta(
        `TRANSITION.${from}.${to}`,
        'Only the next lifecycle state succeeds, atomically recording actor/reason/from/to',
      ),
      async () => {
        await db.asRole('authenticated', owner, async (c: C) => {
          const p = await create(c);
          for (const status of statuses.slice(1, i + 1))
            await c.query(
              'select public.transition_project_status($1,$2,null)',
              [p.id, status],
            );
          if (statuses[i + 1] === to) {
            const row = await rpc(
              c,
              'select * from public.transition_project_status($1,$2,$3)',
              [p.id, to, 'Agreed handover'],
            );
            expect(row.status).toBe(to);
            const log = await rpc(
              c,
              'select * from public.project_status_log where project_id=$1 and to_status=$2',
              [p.id, to],
            );
            expect(log.from_status).toBe(from);
            expect(log.changed_by).toBe(owner);
            expect(log.reason).toBe('Agreed handover');
          } else
            await rejects(
              c,
              'select public.transition_project_status($1,$2,null)',
              [p.id, to],
              '22023',
              `Invalid status transition from ${from} to ${to}`,
            );
        });
      },
    );
  }
test(
  meta('UPDATE', 'Metadata updates cannot change status and validate inputs'),
  async () => {
    await db.asRole('authenticated', owner, async (c: C) => {
      const p = await create(c);
      const row = await rpc(
        c,
        "select * from public.update_project($1,'Clinic','New Client',2000,5,1600,null,null)",
        [p.id],
      );
      expect(row.name).toBe('Clinic');
      expect(row.status).toBe('tender');
      await rejects(
        c,
        "select public.update_project($1,'Clinic','Client',-1,5,0,null,null)",
        [p.id],
        '22023',
      );
    });
  },
);
test(
  meta(
    'SITES',
    'Link/unlink accepts same-business locations, rejects cross-business and relinking',
  ),
  async () => {
    await db.asRole('authenticated', owner, async (c: C) => {
      const p = await create(c);
      const p2 = await create(c);
      await rejects(
        c,
        'select public.link_site_to_project($1,$2)',
        [orgs.A.location, foreignProject],
        '22023',
        'same business',
      );
      expect(
        (
          await rpc(c, 'select * from public.link_site_to_project($1,$2)', [
            orgs.A.location,
            p.id,
          ])
        ).project_id,
      ).toBe(p.id);
      await rejects(
        c,
        'select public.link_site_to_project($1,$2)',
        [orgs.A.location, p2.id],
        '22023',
      );
      await rejects(
        c,
        'select public.link_site_to_project($1,$2)',
        [orgs.B.location, p.id],
        '42501',
      );
      expect(
        (
          await rpc(c, 'select * from public.unlink_site_from_project($1)', [
            orgs.A.location,
          ])
        ).project_id,
      ).toBeNull();
    });
  },
);
test(
  meta(
    'RLS',
    'Cross-business and grantless users cannot read projects/logs or call commands; direct status writes blocked',
  ),
  async () => {
    const p = await db.commitAsRole('authenticated', owner, async (c: C) => {
      const p = await create(c);
      await c.query(
        "select public.transition_project_status($1,'active','test')",
        [p.id],
      );
      return p;
    });
    for (const uid of [identities.B_owner.id, identities.A_admin.id])
      await db.asRole('authenticated', uid, async (c: C) => {
        expect(
          (await c.query('select * from public.projects where id=$1', [p.id]))
            .rows,
        ).toHaveLength(0);
        expect(
          (
            await c.query(
              'select * from public.project_status_log where project_id=$1',
              [p.id],
            )
          ).rows,
        ).toHaveLength(0);
        await rejects(
          c,
          "select public.transition_project_status($1,'practical_completion',null)",
          [p.id],
          '42501',
        );
        await rejects(
          c,
          'select * from public.get_project_cost_summary($1)',
          [p.id],
          '42501',
        );
      });
    await db.asRole('authenticated', owner, async (c: C) => {
      await rejects(
        c,
        "update public.projects set status='closed' where id=$1",
        [p.id],
        '42501',
      );
      await rejects(
        c,
        'delete from public.project_status_log where project_id=$1',
        [p.id],
        '42501',
      );
    });
  },
);
test(
  meta(
    'COST_AND_TAGS',
    'Enterprise construction flow links a site, tags PO/issues/returns and aggregates values without changing procurement rules',
  ),
  async () => {
    await db.asRole('authenticated', owner, async (c: C) => {
      const p = await create(c);
      const empty = await rpc(
        c,
        'select * from public.get_project_cost_summary($1)',
        [p.id],
      );
      expect(Object.values(empty).map(Number)).toEqual([0, 0, 0, 0]);
      await c.query('select public.link_site_to_project($1,$2)', [
        orgs.A.location,
        p.id,
      ]);
      const site = (
        await rpc(
          c,
          "select public.register_construction_procurement_site($1,$2,$3,'CPA','Hospital','CPA') r",
          [orgs.A.business, orgs.A.branch, orgs.A.location],
        )
      ).r;
      // Supplier and product UOM are synthetic fixture setup, never bypass command authorization.
      await c.query('reset role');
      const supplier = (
        await rpc(
          c,
          "insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt) values($1,'CPA Supplier','supplier',true,false) returning id",
          [orgs.A.business],
        )
      ).id;
      await c.query(
        "update public.products set unit_of_measure='BAG' where id=$1",
        [orgs.A.product],
      );
      await c.query('set local role authenticated');
      const payload = {
        business_id: orgs.A.business,
        site_id: site.id,
        supplier_contact_id: supplier,
        currency: 'MWK',
        lines: [
          {
            product_id: orgs.A.product,
            uom: 'BAG',
            quantity_ordered: 10,
            expected_unit_price: 100,
          },
        ],
      };
      const poKey = key(++n);
      const po = (
        await rpc(
          c,
          'select public.create_project_purchase_order($1::jsonb,$2,$3) r',
          [JSON.stringify(payload), poKey, p.id],
        )
      ).r;
      expect(
        (
          await rpc(
            c,
            'select project_id from public.construction_purchase_orders where id=$1',
            [po.id],
          )
        ).project_id,
      ).toBe(p.id);
      const poCost = await rpc(
        c,
        'select * from public.get_project_cost_summary($1)',
        [p.id],
      );
      expect(Number(poCost.total_po_value)).toBe(1000);
      const replay = (
        await rpc(
          c,
          'select public.create_project_purchase_order($1::jsonb,$2,$3) r',
          [JSON.stringify(payload), poKey, p.id],
        )
      ).r;
      expect(replay.idempotent).toBe(true);
      const other = await create(c);
      await rejects(
        c,
        'select public.create_project_purchase_order($1::jsonb,$2,$3)',
        [JSON.stringify(payload), poKey, other.id],
        '22023',
        'Replay key',
      );
      await rejects(
        c,
        'select public.create_project_purchase_order($1::jsonb,$2,$3)',
        [
          JSON.stringify({ ...payload, business_id: orgs.B.business }),
          key(++n),
          p.id,
        ],
        '22023',
        'same business',
      );
      const untagged = (
        await rpc(
          c,
          'select public.create_construction_purchase_order($1::jsonb,$2) r',
          [JSON.stringify(payload), key(++n)],
        )
      ).r;
      expect(
        (
          await rpc(
            c,
            'select project_id from public.construction_purchase_orders where id=$1',
            [untagged.id],
          )
        ).project_id,
      ).toBeNull();

      // Existing two-person rule remains in force.
      await rejects(
        c,
        'select public.authorize_construction_purchase_order($1)',
        [po.id],
        '22023',
        'Authorization requires a different person',
      );
      await c.query(
        "select public.approve_construction_receipt_posting_policy($1,true,'Phase A test','Signed policy approval')",
        [orgs.A.business],
      );
      const issuePayload = {
        business_id: orgs.A.business,
        site_id: site.id,
        product_id: orgs.A.product,
        uom: 'BAG',
        quantity: 2,
        issue_date: DAY,
        evidence_reference: 'Signed CPA issue',
      };
      const issue = (
        await rpc(
          c,
          'select public.issue_project_materials($1::jsonb,$2,$3) r',
          [JSON.stringify(issuePayload), key(++n), p.id],
        )
      ).r;
      const returnPayload = {
        business_id: orgs.A.business,
        source_issue_id: issue.id,
        quantity: 1,
        return_date: DAY,
        condition: 'usable',
        reason: 'Surplus CPA',
        evidence_reference: 'Signed CPA return',
      };
      await c.query('select public.return_project_materials($1::jsonb,$2,$3)', [
        JSON.stringify(returnPayload),
        key(++n),
        p.id,
      ]);
      const cost = await rpc(
        c,
        'select * from public.get_project_cost_summary($1)',
        [p.id],
      );
      expect(Number(cost.total_issued_value)).toBe(1800);
      expect(Number(cost.total_returned_value)).toBe(900);
      expect(Number(cost.net_cost)).toBe(100);
      const p2 = await create(c);
      await rejects(
        c,
        'select public.return_project_materials($1::jsonb,$2,$3)',
        [JSON.stringify(returnPayload), key(++n), p2.id],
        '22023',
      );
      const inherited = (
        await rpc(
          c,
          'select public.return_construction_materials_to_store($1::jsonb,$2) r',
          [JSON.stringify(returnPayload), key(++n)],
        )
      ).r;
      expect(
        (
          await rpc(
            c,
            'select project_id from public.construction_material_returns where id=$1',
            [inherited.id],
          )
        ).project_id,
      ).toBe(p.id);
      expect(
        Number(
          (
            await rpc(c, 'select * from public.get_project_cost_summary($1)', [
              p.id,
            ])
          ).net_cost,
        ),
      ).toBe(-800);
    });
  },
);

test(
  meta(
    'READ_ONLY_GRANT',
    'Any procurement grant permits project reads and costs, but does not permit management commands',
  ),
  async () => {
    const projectId = await db.commitAsRole(
      'authenticated',
      owner,
      async (c: C) => (await create(c)).id,
    );
    await db.commitAsRole(
      'authenticated',
      owner,
      "select public.grant_construction_procurement_capability($1,$2,'procurement.po.manage','Phase A reader')",
      [orgs.A.business, identities.A_branch_manager.id],
    );
    await db.asRole(
      'authenticated',
      identities.A_branch_manager.id,
      async (c: C) => {
        expect(
          (
            await c.query('select * from public.projects where id=$1', [
              projectId,
            ])
          ).rows,
        ).toHaveLength(1);
        expect(
          Number(
            (
              await rpc(
                c,
                'select * from public.get_project_cost_summary($1)',
                [projectId],
              )
            ).net_cost,
          ),
        ).toBe(0);
        await rejects(
          c,
          "select public.transition_project_status($1,'active',null)",
          [projectId],
          '42501',
        );
        await rejects(
          c,
          "select public.update_project($1,'Name','Client',0,0,0,null,null)",
          [projectId],
          '42501',
        );
        await rejects(
          c,
          'select public.link_site_to_project($1,$2)',
          [orgs.A.location, projectId],
          '42501',
        );
        await rejects(
          c,
          'select public.unlink_site_from_project($1)',
          [orgs.A.location],
          '42501',
        );
      },
    );
  },
);

test(
  meta(
    'BRANCH_COST',
    'Project cost RPC preserves existing branch-scoped procurement reads',
  ),
  async () => {
    await db.asRole('authenticated', owner, async (c: C) => {
      const p = await create(c);
      await c.query(
        "select public.grant_construction_procurement_capability($1,$2,'procurement.po.manage','Phase A branch read')",
        [orgs.A.business, identities.A_stock_clerk.id],
      );
      await c.query('reset role');
      const location2 = (
        await rpc(
          c,
          "insert into public.inventory_locations(business_id,branch_id,name,is_default) values($1,$2,'Branch 2 store',false) returning id",
          [orgs.A.business, orgs.A.branch2],
        )
      ).id;
      const supplier = (
        await rpc(
          c,
          "insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt) values($1,'Branch test supplier','supplier',true,false) returning id",
          [orgs.A.business],
        )
      ).id;
      await c.query(
        "update public.products set unit_of_measure='BAG' where id=$1",
        [orgs.A.product],
      );
      await c.query('set local role authenticated');
      for (const [branch, location, price] of [
        [orgs.A.branch, orgs.A.location, 100],
        [orgs.A.branch2, location2, 200],
      ]) {
        const site = (
          await rpc(
            c,
            'select public.register_construction_procurement_site($1,$2,$3,$4,$5,$6) r',
            [
              orgs.A.business,
              branch,
              location,
              `S-${price}`,
              `Site ${price}`,
              'BRANCH',
            ],
          )
        ).r;
        const payload = {
          business_id: orgs.A.business,
          site_id: site.id,
          supplier_contact_id: supplier,
          currency: 'MWK',
          lines: [
            {
              product_id: orgs.A.product,
              uom: 'BAG',
              quantity_ordered: 1,
              expected_unit_price: price,
            },
          ],
        };
        await c.query(
          'select public.create_project_purchase_order($1::jsonb,$2,$3)',
          [JSON.stringify(payload), key(++n), p.id],
        );
      }
      expect(
        Number(
          (
            await rpc(c, 'select * from public.get_project_cost_summary($1)', [
              p.id,
            ])
          ).total_po_value,
        ),
      ).toBe(300);
      await c.query("select set_config('request.jwt.claim.sub',$1,true)", [
        identities.A_stock_clerk.id,
      ]);
      expect(
        Number(
          (
            await rpc(c, 'select * from public.get_project_cost_summary($1)', [
              p.id,
            ])
          ).total_po_value,
        ),
      ).toBe(100);
    });
  },
);

test(
  meta(
    'CONCURRENT_TRANSITION',
    'Concurrent status commands serialize: exactly one transition and audit entry commit',
  ),
  async () => {
    const p = await db.commitAsRole(
      'authenticated',
      owner,
      async (c: C) => await create(c),
    );
    const second = await db.createSecondClient();
    try {
      const sql =
        "select public.transition_project_status($1,'active','Concurrent confirmation')";
      const results = await Promise.allSettled([
        db.commitAsRole('authenticated', owner, sql, [p.id]),
        second.commitAsRole('authenticated', owner, sql, [p.id]),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      const rejected = results.find(
        (result) => result.status === 'rejected',
      ) as PromiseRejectedResult;
      expect(rejected.reason.code).toBe('22023');
      await db.asRole('authenticated', owner, async (c: C) =>
        expect(
          (
            await c.query(
              'select * from public.project_status_log where project_id=$1',
              [p.id],
            )
          ).rows,
        ).toHaveLength(1),
      );
    } finally {
      await second.close();
    }
  },
);
