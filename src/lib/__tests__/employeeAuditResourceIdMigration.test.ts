import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20261222000000_fix_employee_audit_resource_id_type.sql',
  'utf8',
);

const functionSql = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.log_employee_audit_event()'),
  migration.indexOf('$verify$'),
);

describe('employee audit resource ID migration', () => {
  it('keeps the audit resource ID UUID-typed for audit_log inserts', () => {
    expect(functionSql).toMatch(/v_resource_id\s+uuid;/);
    expect(functionSql).toContain('v_resource_id := NEW.id;');
    expect(functionSql).toContain('v_resource_id := OLD.id;');
    expect(functionSql).toMatch(/'employees',\s*v_resource_id,/);
    expect(functionSql).not.toMatch(/v_resource_id\s+text;/);
  });

  it('casts the resource ID to text only for the hash function', () => {
    expect(functionSql).toContain('v_resource_id::text, v_resource_ref');
    expect(functionSql).toContain('public.audit_chain_hash(');
  });

  it('preserves employee audit triggers and verifies the deployed function definition', () => {
    expect(migration).not.toMatch(/DROP\s+TRIGGER|DISABLE\s+TRIGGER/i);
    expect(migration).toContain("pg_get_functiondef('public.log_employee_audit_event()'::regprocedure)");
    expect(migration).toContain("position('v_resource_id uuid' IN v_definition)");
  });
});
