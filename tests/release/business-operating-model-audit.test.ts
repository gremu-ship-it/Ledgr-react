import { beforeAll, afterAll, expect } from 'vitest';
import { createDatabaseFixture } from './database.mjs';
import { seedFixture, identities } from './fixtures';
import { evidenceSuite } from './evidence';

const test = evidenceSuite('business-operating-model-audit');
const meta = (id: string, expected: string) => ({
  id: `BUSINESS.AUDIT.${id}`,
  expected,
  source:
    'supabase/migrations/20261029000000_business_operating_models_audit_resource_id.sql',
  remediation: 'BUSINESS-AUDIT-RESOURCE-ID',
  layer:
    'Disposable PostgreSQL 17 full migration replay; synthetic identities; actual authenticated-role RPC; text and UUID audit resource column shapes',
});
let db: Awaited<ReturnType<typeof createDatabaseFixture>>;
let orgs: Awaited<ReturnType<typeof seedFixture>>;
type C = {
  query: (
    sql: string,
    values?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
};

beforeAll(async () => {
  db = await createDatabaseFixture();
  orgs = await seedFixture(db.client);
});
afterAll(async () => {
  await db?.cleanup();
});

for (const shape of ['text', 'uuid']) {
  test(
    meta(
      `${shape}.SAVE`,
      `Operating models and their hash-consistent audit entry save with a ${shape} resource_id column; identical saves remain no-ops`,
    ),
    async () => {
      await db.asRole('authenticated', identities.A_owner.id, async (c: C) => {
        // Explicit fixture-only DDL; the application probe still runs as authenticated.
        if (shape === 'uuid') {
          await c.query('reset role');
          await c.query(
            'alter table public.audit_log alter column resource_id type uuid using resource_id::uuid',
          );
          await c.query('set local role authenticated');
        }
        const values = [orgs.A.business, ['CONSTRUCTION', 'RETAIL']];
        const sql =
          'select public.update_business_operating_models($1,$2) models';
        expect((await c.query(sql, values)).rows[0].models).toEqual(values[1]);
        expect((await c.query(sql, values)).rows[0].models).toEqual(values[1]);
        await c.query('reset role');
        expect(
          (
            await c.query(
              'select operating_models from public.businesses where id=$1',
              [orgs.A.business],
            )
          ).rows[0].operating_models,
        ).toEqual(values[1]);
        // Audit internals are inspected privileged only after the real actor command.
        await c.query('reset role');
        const rows = (
          await c.query(
            `select resource_id::text resource_id, old_values, new_values,
        entry_hash = public.audit_chain_hash(prev_hash,business_id,user_id,occurred_at,
          event_type,resource_type,resource_id::text,resource_ref,old_values,new_values,notes) hash_valid
        from public.audit_log where business_id=$1 and event_type='business_operating_models_updated'`,
            [orgs.A.business],
          )
        ).rows;
        expect(rows).toHaveLength(1);
        expect(rows[0].resource_id).toBe(orgs.A.business);
        expect(rows[0].new_values).toEqual(values[1]);
        expect(rows[0].hash_valid).toBe(true);
      });
    },
  );
  test(
    meta(
      `${shape}.DENIED`,
      `The audit type fix does not allow a non-owner/admin or a cross-business actor to update operating models (${shape})`,
    ),
    async () => {
      for (const uid of [identities.A_viewer.id, identities.B_owner.id]) {
        let code: string | undefined;
        try {
          await db.asRole('authenticated', uid, async (c: C) => {
            if (shape === 'uuid') {
              await c.query('reset role');
              await c.query(
                'alter table public.audit_log alter column resource_id type uuid using resource_id::uuid',
              );
              await c.query('set local role authenticated');
            }
            await c.query(
              "select public.update_business_operating_models($1,array['CONSTRUCTION'])",
              [orgs.A.business],
            );
          });
        } catch (error) {
          code = (error as { code?: string }).code;
        }
        expect(code).toBe('42501');
      }
    },
  );
}
