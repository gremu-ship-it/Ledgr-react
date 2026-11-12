import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath =
  'supabase/migrations/20261219000000_manufacturing_entitlement_and_partner_projection.sql';
const sql = readFileSync(migrationPath, 'utf8');

function functionDefinition(name: string): string {
  const start = sql.search(
    new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${name}\\s*\\(`, 'i'),
  );
  expect(start, `missing function ${name}`).toBeGreaterThanOrEqual(0);
  const rest = sql.slice(start);
  const delimiter = rest.match(/\bAS\s+(\$[a-zA-Z0-9_]*\$)/i)?.[1];
  expect(delimiter, `missing SQL body delimiter for ${name}`).toBeTruthy();
  const end = rest.indexOf(`${delimiter};`);
  expect(end, `missing SQL body terminator for ${name}`).toBeGreaterThan(0);
  return rest.slice(0, end + delimiter!.length + 1);
}

describe('Phase 8B SEC-02 / SEC-03 migration contract', () => {
  it('defines an active Enterprise plan guard against the repository plan signature', () => {
    const guard = functionDefinition('_mfg_assert_enterprise_plan');
    expect(guard).toMatch(/RETURNS\s+void/i);
    expect(guard).toMatch(/STABLE/i);
    expect(guard).toMatch(/SECURITY\s+DEFINER/i);
    expect(guard).toMatch(/SET\s+search_path\s*=\s*public/i);
    expect(guard).toMatch(
      /effective_plan_tier\s*\(\s*b\.plan_tier\s*,\s*b\.plan_expires_at\s*\)/i,
    );
    expect(guard).toMatch(/b\.id\s*=\s*p_business_id/i);
    expect(guard).toMatch(/lower\(COALESCE\(v_plan_tier,\s*'free'\)\)\s*<>\s*'enterprise'/i);
    expect(guard).toMatch(/Manufacturing requires an active Enterprise plan\./i);
    expect(guard).toMatch(/ERRCODE\s*=\s*'P0001'/i);
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\._mfg_assert_enterprise_plan\(uuid\)\s+FROM\s+PUBLIC,\s*anon/i);
  });

  it.each([
    'save_bom_version',
    'manufacturing_bom_activate',
    'manufacturing_bom_new_version',
    'manufacturing_wo_create',
    'manufacturing_wo_release',
    'manufacturing_wo_start',
    'manufacturing_wo_complete',
    'manufacturing_wo_close',
    'complete_production_run',
    'run_mrp',
  ])('enforces entitlement inside %s', (name) => {
    expect(functionDefinition(name)).toMatch(/PERFORM\s+public\._mfg_assert_enterprise_plan\s*\(/i);
  });

  it('checks entitlement before manufacturing authorization or work begins', () => {
    const create = functionDefinition('manufacturing_wo_create');
    expect(create.indexOf('_mfg_assert_enterprise_plan')).toBeLessThan(
      create.indexOf('_mfg_wo_writer'),
    );
    for (const name of [
      'manufacturing_wo_release',
      'manufacturing_wo_start',
      'manufacturing_wo_complete',
      'manufacturing_wo_close',
    ]) {
      const body = functionDefinition(name);
      expect(body.indexOf('_mfg_assert_enterprise_plan')).toBeLessThan(
        body.indexOf('_mfg_wo_writer'),
      );
    }
    expect(functionDefinition('complete_production_run').indexOf('_mfg_assert_enterprise_plan')).toBeLessThan(
      functionDefinition('complete_production_run').indexOf('IF COALESCE'),
    );
    const mrp = functionDefinition('run_mrp');
    expect(mrp.indexOf('IF p_business_id IS NULL')).toBeLessThan(
      mrp.indexOf('_mfg_assert_enterprise_plan'),
    );
    expect(mrp.indexOf('_mfg_assert_enterprise_plan')).toBeLessThan(
      mrp.indexOf('_mfg_wo_writer'),
    );
  });

  it('replaces peer full-row access with an invoker view over an explicit non-sensitive allowlist', () => {
    expect(sql).toMatch(/DROP\s+POLICY\s+IF\s+EXISTS\s+businesses_partner_peer_read\s+ON\s+public\.businesses/i);
    expect(sql).toMatch(/DROP\s+POLICY\s+IF\s+EXISTS\s+businesses_partner_admin_read\s+ON\s+public\.businesses/i);
    expect(sql).not.toMatch(/CREATE\s+POLICY\s+businesses_partner_(?:peer|admin)_read/i);

    const projection = functionDefinition('_partner_peer_business_projection');
    const projectionFields = projection
      .match(/RETURNS\s+TABLE\s*\(([\s\S]*?)\)\s*LANGUAGE/i)?.[1]
      ?.match(/\b(id|name|trading_name|logo_url|brand_color)\s+(?:uuid|text)\b/gi)
      ?.map((field) => field.trim().split(/\s+/)[0].toLowerCase());
    expect(projectionFields).toEqual(['id', 'name', 'trading_name', 'logo_url', 'brand_color']);
    expect(projection).toMatch(/can_read_partner_peer_business\s*\(\s*b\.id\s*\)/i);

    const viewStart = sql.search(/CREATE\s+OR\s+REPLACE\s+VIEW\s+public\.v_partner_peer_businesses/i);
    expect(viewStart).toBeGreaterThanOrEqual(0);
    const viewEnd = sql.indexOf(';', viewStart);
    const view = sql.slice(viewStart, viewEnd + 1);
    expect(view).toMatch(/WITH\s*\(\s*security_invoker\s*=\s*true\s*\)/i);
    for (const field of ['id', 'name', 'trading_name', 'logo_url', 'brand_color']) {
      expect(view).toMatch(new RegExp(`\\b${field}\\b`, 'i'));
    }
    expect(view).toMatch(/_partner_peer_business_projection\s*\(\s*\)/i);
    expect(view).not.toMatch(/\b(tax|legal|address|phone|email|contact|organisation_type)\w*\b/i);
    expect(sql).toMatch(/GRANT\s+SELECT\s+ON\s+TABLE\s+public\.v_partner_peer_businesses\s+TO\s+authenticated/i);
  });
});
