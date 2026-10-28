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
type MigrationHookContext = {
  client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: { legacy_label?: string }[] }> };
  name: string;
  source: string;
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
const legacyProjectId = '00000000-0000-4000-8000-000000000123';
beforeAll(async () => {
  // Reproduce an unrelated `projects` relation named in the reported failure
  // before the construction-project migrations run. It must remain intact while
  // the feature builds against construction_projects instead.
  db = await createDatabaseFixture({
    beforeMigration: async ({ client, name }: MigrationHookContext) => {
      if (name !== '20261028000000_construction_projects.sql') return;
      await client.query(`
        create table public.projects (
          id uuid primary key,
          legacy_label text not null
        );
        insert into public.projects(id, legacy_label)
        values ('${legacyProjectId}', 'preserve legacy table');
      `);
    },
  });
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
    'LEGACY_NAME_COLLISION',
    'An unrelated public.projects table survives migration replay while the feature uses construction_projects',
  ),
  async () => {
    const legacy = await db.client.query(
      'select id, legacy_label from public.projects where id=$1',
      [legacyProjectId],
    );
    expect(legacy.rows).toEqual([
      { id: legacyProjectId, legacy_label: 'preserve legacy table' },
    ]);
    const columns = await db.client.query(
      `select column_name from information_schema.columns
        where table_schema='public' and table_name='projects'
        order by ordinal_position`,
    );
    expect(columns.rows.map((row: { column_name: string }) => row.column_name)).toEqual([
      'id',
      'legacy_label',
    ]);
    const constructionTable = await db.client.query(
      "select relkind from pg_class where oid=to_regclass('public.construction_projects')",
    );
    expect(constructionTable.rows[0]?.relkind).toBe('r');
  },
);
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
          (await c.query('select * from public.construction_projects where id=$1', [p.id]))
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
        "update public.construction_projects set status='closed' where id=$1",
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
            await c.query('select * from public.construction_projects where id=$1', [
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

test(
  meta(
    'PHASE_D_PROJECT_PNL_AND_TREND',
    'get_project_pnl and get_project_valuation_trend return accurate aggregates, exclude draft valuations, handle zero state, and compute negative variance',
  ),
  async () => {
    await db.asRole('authenticated', owner, async (c: C) => {
      // 1. Project with zero valuations and zero costs returns zeros (no division by zero)
      const zeroProj = await rpc(
        c,
        "select * from public.create_project($1,'Zero Project','Zero Client',0,10,0,null,null)",
        [orgs.A.business],
      );
      const zeroPnl = await rpc(
        c,
        'select * from public.get_project_pnl($1)',
        [zeroProj.id],
      );
      expect(Number(zeroPnl.contract_sum)).toBe(0);
      expect(Number(zeroPnl.boq_total)).toBe(0);
      expect(Number(zeroPnl.total_costs)).toBe(0);
      expect(Number(zeroPnl.total_billed)).toBe(0);
      expect(Number(zeroPnl.billing_pct)).toBe(0);
      expect(Number(zeroPnl.completion_pct)).toBe(0);
      expect(Number(zeroPnl.profit_margin)).toBe(0);

      // 2. Full project with BOQ, 2 invoiced valuations + 1 draft valuation, PO + issue + return, retention release, and invoice payment
      const proj = await rpc(
        c,
        "select * from public.create_project($1,'Lilongwe Bypass','Roads Authority',10000,10,2000,'2026-01-01','2026-12-31')",
        [orgs.A.business],
      );

      // Create 2 BOQ lines while in tender status: Line 1 = 10 * 600 = 6000, Line 2 = 4 * 1000 = 4000 (total BOQ = 10000)
      const boq1 = await rpc(
        c,
        "select * from public.create_boq_line($1,'1.0','Earthworks',10,'m3',600,1)",
        [proj.id],
      );
      const boq2 = await rpc(
        c,
        "select * from public.create_boq_line($1,'2.0','Culverts',4,'no',1000,2)",
        [proj.id],
      );

      await c.query(
        "select * from public.transition_project_status($1,'active','Start work')",
        [proj.id],
      );

      // Ensure construction CoA accounts exist
      await c.query('select public.provision_construction_coa_accounts($1)', [
        orgs.A.business,
      ]);

      // Valuation 1: Line 1 at 50% (3000), Line 2 at 25% (1000) => gross = 4000, retention (10%) = 400, net = 3600
      const val1Doc = (
        await rpc(
          c,
          'select public.create_valuation($1,$2,$3,$4,$5::jsonb,$6) r',
          [
            proj.id,
            '2026-08-15',
            '2026-08-01',
            '2026-08-15',
            JSON.stringify([
              { boq_line_id: boq1.id, cumulative_pct: 50, notes: null },
              { boq_line_id: boq2.id, cumulative_pct: 25, notes: null },
            ]),
            'IPC 1',
          ],
        )
      ).r;
      await c.query('select public.submit_valuation($1)', [
        val1Doc.valuation.id,
      ]);
      const val1Invoiced = (
        await rpc(c, 'select public.generate_invoice_from_valuation($1) r', [
          val1Doc.valuation.id,
        ])
      ).r;

      // Valuation 2: Line 1 at 80% (4800, delta 1800), Line 2 at 50% (2000, delta 1000) => gross = 2800, retention = 280, net = 2520
      const val2Doc = (
        await rpc(
          c,
          'select public.create_valuation($1,$2,$3,$4,$5::jsonb,$6) r',
          [
            proj.id,
            '2026-09-15',
            '2026-08-16',
            '2026-09-15',
            JSON.stringify([
              { boq_line_id: boq1.id, cumulative_pct: 80, notes: null },
              { boq_line_id: boq2.id, cumulative_pct: 50, notes: null },
            ]),
            'IPC 2',
          ],
        )
      ).r;
      await c.query('select public.submit_valuation($1)', [
        val2Doc.valuation.id,
      ]);
      await c.query('select public.generate_invoice_from_valuation($1)', [
        val2Doc.valuation.id,
      ]);

      // Valuation 3 (DRAFT): Line 1 at 100%, Line 2 at 100% => must be EXCLUDED from total_billed and trend!
      await c.query(
        'select public.create_valuation($1,$2,$3,$4,$5::jsonb,$6)',
        [
          proj.id,
          '2026-10-01',
          '2026-09-16',
          '2026-10-01',
          JSON.stringify([
            { boq_line_id: boq1.id, cumulative_pct: 100, notes: null },
            { boq_line_id: boq2.id, cumulative_pct: 100, notes: null },
          ]),
          'IPC 3 Draft',
        ],
      );

      // Record a customer payment of 2000 on Valuation 1's invoice
      await c.query('reset role');
      await c.query(
        "insert into public.invoice_payments (business_id, invoice_id, amount, payment_date, payment_method, currency, exchange_rate) values ($1, $2, 2000, $3, $4, 'MWK', 1)",
        [orgs.A.business, val1Invoiced.invoice.id, '2026-09-20', 'bank_transfer'],
      );
      await c.query("update public.products set unit_of_measure='BAG' where id=$1", [
        orgs.A.product,
      ]);
      const supplierId = (
        await rpc(
          c,
          "insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt) values($1,'Phase D Supplier','supplier',true,false) returning id",
          [orgs.A.business],
        )
      ).id;
      await c.query('set local role authenticated');

      // Transition to practical_completion to release 180 of retention
      await c.query(
        "select * from public.transition_project_status($1,'practical_completion','Substantial completion')",
        [proj.id],
      );
      await c.query('select public.release_retention($1, 180, $2)', [
        proj.id,
        'Partial retention release',
      ]);

      // Add procurement costs: PO = 1500, Issue = 2 * 900 = 1800, Return = 1 * 900 = 900 => Total cost = 1500 + 1800 - 900 = 2400 (> budget 2000!)
      await c.query(
        "select public.approve_construction_receipt_posting_policy($1,true,'Phase D test','Signed policy')",
        [orgs.A.business],
      );
      const site = (
        await rpc(
          c,
          'select public.register_construction_procurement_site($1,$2,$3,$4,$5,$6) r',
          [
            orgs.A.business,
            orgs.A.branch,
            orgs.A.location,
            'S-PHD',
            'Phase D Site',
            'SITE',
          ],
        )
      ).r;
      const poPayload = {
        business_id: orgs.A.business,
        site_id: site.id,
        supplier_contact_id: supplierId,
        currency: 'MWK',
        lines: [
          {
            product_id: orgs.A.product,
            uom: 'BAG',
            quantity_ordered: 3,
            expected_unit_price: 500,
          },
        ],
      };
      await c.query(
        'select public.create_project_purchase_order($1::jsonb,$2,$3)',
        [JSON.stringify(poPayload), key(++n), proj.id],
      );
      const issue = (
        await rpc(
          c,
          'select public.issue_project_materials($1::jsonb,$2,$3) r',
          [
            JSON.stringify({
              business_id: orgs.A.business,
              site_id: site.id,
              product_id: orgs.A.product,
              uom: 'BAG',
              quantity: 2,
              issue_date: DAY,
              evidence_reference: 'Phase D issue',
            }),
            key(++n),
            proj.id,
          ],
        )
      ).r;
      await c.query('select public.return_project_materials($1::jsonb,$2,$3)', [
        JSON.stringify({
          business_id: orgs.A.business,
          source_issue_id: issue.id,
          quantity: 1,
          return_date: DAY,
          condition: 'usable',
          reason: 'Surplus',
          evidence_reference: 'Phase D return',
        }),
        key(++n),
        proj.id,
      ]);

      // Verify get_project_pnl
      const pnl = await rpc(c, 'select * from public.get_project_pnl($1)', [
        proj.id,
      ]);
      expect(pnl.project_name).toBe('Lilongwe Bypass');
      expect(pnl.client_name).toBe('Roads Authority');
      expect(pnl.status).toBe('practical_completion');
      expect(Number(pnl.contract_sum)).toBe(10000);
      expect(Number(pnl.budget)).toBe(2000);
      expect(Number(pnl.retention_pct)).toBe(10);
      expect(Number(pnl.boq_total)).toBe(10000);
      expect(Number(pnl.total_po_value)).toBe(1500);
      expect(Number(pnl.total_issued_value)).toBe(1800);
      expect(Number(pnl.total_returned_value)).toBe(900);
      expect(Number(pnl.total_costs)).toBe(2400);
      // Only invoiced valuations 1 (net 3600) and 2 (net 2520) included = 6120; draft valuation 3 excluded
      expect(Number(pnl.total_billed)).toBe(6120);
      expect(Number(pnl.total_retention_withheld)).toBe(680);
      expect(Number(pnl.total_retention_released)).toBe(180);
      expect(Number(pnl.retention_balance)).toBe(500);
      expect(Number(pnl.total_paid)).toBe(2000);
      // Over budget: budget (2000) - total_costs (2400) = -400
      expect(Number(pnl.cost_variance)).toBe(-400);
      // billing_pct: 6120 / 10000 * 100 = 61.2%
      expect(Number(pnl.billing_pct)).toBe(61.2);
      // completion_pct: weighted avg across BOQ from Valuation 2: (6000*80 + 4000*50) / 10000 = 68%
      expect(Number(pnl.completion_pct)).toBe(68);
      // profit_margin: (6120 - 2400) / 6120 * 100 = 60.78%
      expect(Number(pnl.profit_margin)).toBeCloseTo(60.78, 2);

      // Verify get_project_valuation_trend (and alias get_valuation_trend)
      const trend = (
        await c.query(
          'select * from public.get_project_valuation_trend($1)',
          [proj.id],
        )
      ).rows;
      expect(trend).toHaveLength(2);
      expect(Number(trend[0].valuation_number)).toBe(1);
      expect(Number(trend[0].gross_amount)).toBe(4000);
      expect(Number(trend[0].net_amount)).toBe(3600);
      expect(Number(trend[0].cumulative_billed)).toBe(3600);
      expect(Number(trend[1].valuation_number)).toBe(2);
      expect(Number(trend[1].gross_amount)).toBe(2800);
      expect(Number(trend[1].net_amount)).toBe(2520);
      expect(Number(trend[1].cumulative_billed)).toBe(6120);

      const aliasTrend = (
        await c.query('select * from public.get_valuation_trend($1)', [
          proj.id,
        ])
      ).rows;
      expect(aliasTrend).toHaveLength(2);
    });
  },
);

test(
  meta(
    'PHASE_D_PORTFOLIO_RETENTION_DASHBOARD_COSTS_AND_AUTH',
    'Portfolio summary, retention aging, dashboard metrics, cost breakdown, and authorization checks work accurately',
  ),
  async () => {
    await db.asRole('authenticated', owner, async (c: C) => {
      await c.query('select public.provision_construction_coa_accounts($1)', [
        orgs.A.business,
      ]);
      await c.query(
        "select public.approve_construction_receipt_posting_policy($1,true,'Phase D portfolio','Signed policy')",
        [orgs.A.business],
      );
      await c.query('reset role');
      await c.query("update public.products set unit_of_measure='BAG' where id=$1", [
        orgs.A.product,
      ]);
      const supplierId = (
        await rpc(
          c,
          "insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt) values($1,'Portfolio Supplier','supplier',true,false) returning id",
          [orgs.A.business],
        )
      ).id;
      await c.query('set local role authenticated');

      const site = (
        await rpc(
          c,
          'select public.register_construction_procurement_site($1,$2,$3,$4,$5,$6) r',
          [
            orgs.A.business,
            orgs.A.branch,
            orgs.A.location,
            'S-PORT',
            'Portfolio Site',
            'SITE',
          ],
        )
      ).r;

      // Project 1 (active, over budget, older retention)
      const p1 = await rpc(
        c,
        "select * from public.create_project($1,'Project Alpha','Client Alpha',10000,10,500,'2025-01-01','2026-12-31')",
        [orgs.A.business],
      );
      const boq1 = await rpc(
        c,
        "select * from public.create_boq_line($1,'A1','Foundation',10,'m3',1000,1)",
        [p1.id],
      );
      await c.query(
        "select * from public.transition_project_status($1,'active','Start Alpha')",
        [p1.id],
      );
      const v1 = (
        await rpc(
          c,
          'select public.create_valuation($1,$2,$3,$4,$5::jsonb,$6) r',
          [
            p1.id,
            '2025-11-01',
            '2025-10-01',
            '2025-11-01',
            JSON.stringify([
              { boq_line_id: boq1.id, cumulative_pct: 50, notes: null },
            ]),
            'Alpha IPC 1',
          ],
        )
      ).r;
      await c.query('select public.submit_valuation($1)', [v1.valuation.id]);
      await c.query('select public.generate_invoice_from_valuation($1)', [
        v1.valuation.id,
      ]);

      // Tagged PO on p1 = 1000 (over budget 500)
      await c.query(
        'select public.create_project_purchase_order($1::jsonb,$2,$3)',
        [
          JSON.stringify({
            business_id: orgs.A.business,
            site_id: site.id,
            supplier_contact_id: supplierId,
            currency: 'MWK',
            lines: [
              {
                product_id: orgs.A.product,
                uom: 'BAG',
                quantity_ordered: 2,
                expected_unit_price: 500,
              },
            ],
          }),
          key(++n),
          p1.id,
        ],
      );

      // Untagged PO = 5000 (must be excluded from project reports!)
      await c.query(
        'select public.create_construction_purchase_order($1::jsonb,$2)',
        [
          JSON.stringify({
            business_id: orgs.A.business,
            site_id: site.id,
            supplier_contact_id: supplierId,
            currency: 'MWK',
            lines: [
              {
                product_id: orgs.A.product,
                uom: 'BAG',
                quantity_ordered: 10,
                expected_unit_price: 500,
              },
            ],
          }),
          key(++n),
        ],
      );

      // Project 2 (active, newer retention)
      const p2 = await rpc(
        c,
        "select * from public.create_project($1,'Project Beta','Client Beta',20000,5,15000,'2026-01-01','2026-12-31')",
        [orgs.A.business],
      );
      const boq2 = await rpc(
        c,
        "select * from public.create_boq_line($1,'B1','Structure',20,'m3',1000,1)",
        [p2.id],
      );
      await c.query(
        "select * from public.transition_project_status($1,'active','Start Beta')",
        [p2.id],
      );
      const v2 = (
        await rpc(
          c,
          'select public.create_valuation($1,$2,$3,$4,$5::jsonb,$6) r',
          [
            p2.id,
            '2026-10-01',
            '2026-09-01',
            '2026-10-01',
            JSON.stringify([
              { boq_line_id: boq2.id, cumulative_pct: 25, notes: null },
            ]),
            'Beta IPC 1',
          ],
        )
      ).r;
      await c.query('select public.submit_valuation($1)', [v2.valuation.id]);
      await c.query('select public.generate_invoice_from_valuation($1)', [
        v2.valuation.id,
      ]);

      // Backdate p1's retention ledger entry created_at so p1 has higher days_held than p2
      await c.query('reset role');
      await c.query(
        "update public.project_retention_ledger set created_at = current_date - interval '200 days' where project_id = $1",
        [p1.id],
      );
      await c.query('set local role authenticated');

      // 1. get_portfolio_summary excludes untagged PO (5000) and aggregates across projects
      const summary = await rpc(
        c,
        'select * from public.get_portfolio_summary($1)',
        [orgs.A.business],
      );
      expect(Number(summary.active_projects)).toBeGreaterThanOrEqual(2);
      expect(Number(summary.total_billed)).toBe(9250); // net 4500 + net 4750
      expect(Number(summary.total_costs)).toBe(1000); // Only tagged PO (1000), untagged PO (5000) excluded!
      expect(Number(summary.total_retention_held)).toBe(750); // 500 + 250
      expect(Number(summary.projects_over_budget)).toBe(1);

      // 2. get_retention_aging returns only projects with retention_balance > 0 ordered by days_held DESC
      const aging = (
        await c.query('select * from public.get_retention_aging($1)', [
          orgs.A.business,
        ])
      ).rows;
      expect(aging).toHaveLength(2);
      expect(aging[0].project_id).toBe(p1.id);
      expect(aging[1].project_id).toBe(p2.id);
      expect(Number(aging[0].days_held)).toBeGreaterThan(
        Number(aging[1].days_held),
      );

      // 3. get_dashboard_metrics filters to last 12 months
      const metrics = await rpc(
        c,
        'select * from public.get_dashboard_metrics($1)',
        [orgs.A.business],
      );
      expect(Number(metrics.active_projects)).toBeGreaterThanOrEqual(2);
      expect(Number(metrics.total_billed_this_period)).toBe(9250);
      expect(Number(metrics.total_costs_this_period)).toBe(1000);

      // 4. get_cost_breakdown_by_project returns projects with costs > 0 ordered by net_cost DESC
      const costBreakdown = (
        await c.query(
          'select * from public.get_cost_breakdown_by_project($1)',
          [orgs.A.business],
        )
      ).rows;
      expect(costBreakdown).toHaveLength(1);
      expect(costBreakdown[0].project_id).toBe(p1.id);
      expect(Number(costBreakdown[0].net_cost)).toBe(1000);
      expect(Number(costBreakdown[0].variance)).toBe(-500);

      // 5. Rejects caller without procurement.* grants (A_cashier has no procurement grants)
      await c.query("select set_config('request.jwt.claim.sub',$1,true)", [
        identities.A_cashier.id,
      ]);
      for (const [sql, arg] of [
        ['select * from public.get_project_pnl($1)', p1.id],
        ['select * from public.get_portfolio_summary($1)', orgs.A.business],
        ['select * from public.get_project_valuation_trend($1)', p1.id],
        ['select * from public.get_retention_aging($1)', orgs.A.business],
        ['select * from public.get_dashboard_metrics($1)', orgs.A.business],
        [
          'select * from public.get_cost_breakdown_by_project($1)',
          orgs.A.business,
        ],
      ] as const) {
        await rejects(c, sql, [arg], '42501');
      }

      // 6. Rejects cross-business access (B_owner accessing Org A's business/project)
      await c.query("select set_config('request.jwt.claim.sub',$1,true)", [
        identities.B_owner.id,
      ]);
      for (const [sql, arg] of [
        ['select * from public.get_project_pnl($1)', p1.id],
        ['select * from public.get_portfolio_summary($1)', orgs.A.business],
        ['select * from public.get_project_valuation_trend($1)', p1.id],
        ['select * from public.get_retention_aging($1)', orgs.A.business],
        ['select * from public.get_dashboard_metrics($1)', orgs.A.business],
        [
          'select * from public.get_cost_breakdown_by_project($1)',
          orgs.A.business,
        ],
      ] as const) {
        await rejects(c, sql, [arg], '42501');
      }
    });
  },
);
