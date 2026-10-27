import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20261102000000_remove_legacy_pos_pin_non_retail.sql',
  'utf8',
);

/**
 * Static contract for the legacy POS capability-pin cleanup (P3-1 audit item).
 *
 * The feature audit asked P3-1 for a `pos_capability_cleanup` migration; the
 * work had already shipped as 20261102000000 (removing the Phase-1
 * Strategy-A `pos: true` pin from businesses without RETAIL in their
 * operating_models). Production confirms it applied: zero businesses match
 * the violating predicate today. This file is the regression pin that was
 * missing — it locks the cleanup's semantics so the audit item cannot be
 * silently undone or "re-cleaned" with different behavior:
 *
 *   * data-only: no schema, function, trigger, grant or policy statements;
 *   * deletes the `pos` KEY (never sets it false — a later RETAIL selection
 *     must not be blocked by a stale override);
 *   * guarded by BOTH conditions (non-retail AND pin present) → idempotent;
 *   * RETAIL rows and the sibling pins (sales/inventory/services) untouched;
 *   * snapshot verifier proves nothing outside the `pos` key moved.
 *
 * Negative assertions run against comment-stripped SQL; the header
 * legitimately names the frozen surfaces.
 */
const code = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');

describe('legacy pos pin cleanup migration contract (P3-1 audit item)', () => {
  it('is uniquely versioned and sits between the valuations and manufacturing foundation migrations', () => {
    const files = readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const versions = files.map((f) => f.split('_')[0]);
    expect(versions.filter((v) => v === '20261102000000')).toHaveLength(1);
    expect(versions.indexOf('20261102000000')).toBeGreaterThan(
      versions.indexOf('20261031000001'),
    );
    expect(versions.indexOf('20261102000000')).toBeLessThan(
      versions.indexOf('20261103000000'),
    );
    // No duplicate cleanup was added later; the additive P4-1 report RPC and
    // P4B-1/2 bank reconciliation migrations extend the migration head.
    expect(versions[versions.length - 1]).toBe('20261110000001');
    expect(
      files.filter((f) => f.toLowerCase().includes('pos_capability_cleanup')),
    ).toHaveLength(0);
  });

  it('deletes exactly the pos key with both prompt conditions, key removal not false', () => {
    expect(code).toContain(
      "SET capability_overrides = capability_overrides - 'pos',",
    );
    expect(code).toContain("WHERE NOT ('RETAIL' = ANY(operating_models))");
    expect(code).toContain("AND capability_overrides ? 'pos';");
    // Deletion (not `false`) keeps a later RETAIL selection unblocked.
    expect(code).not.toContain("'pos', false");
    expect(code).not.toContain("'pos'::text, false");
    // Vertical-isolation convention: text[] membership via = ANY().
    expect(code).toContain("= ANY(operating_models)");
  });

  it('is idempotent — one guard-scoped UPDATE, never unconditional', () => {
    expect(code.match(/UPDATE public\.businesses/g)).toHaveLength(1);
    const updateAt = code.indexOf('UPDATE public.businesses');
    const whereAt = code.indexOf('WHERE', updateAt);
    const semicolonAt = code.indexOf(';', updateAt);
    expect(whereAt).toBeGreaterThan(updateAt);
    expect(whereAt).toBeLessThan(semicolonAt);
  });

  it('is data-only — no schema, function, trigger, grant or policy statements', () => {
    expect(code).not.toMatch(/\bALTER\s+TABLE\b/i);
    expect(code).not.toMatch(/\bCREATE\s+(TABLE\s+public|FUNCTION|INDEX|TRIGGER|POLICY|VIEW|OR\s+REPLACE)\b/i);
    expect(code).not.toMatch(/\bDROP\s+(TABLE|FUNCTION|INDEX|TRIGGER|POLICY|VIEW|COLUMN)\b/i);
    expect(code).not.toMatch(/\b(GRANT|REVOKE)\b/i);
    expect(code).not.toMatch(/\bTRUNCATE\b/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code).not.toMatch(/\bINSERT\s+INTO\b/i);
    // The only CREATE is the self-destructing snapshot temp table.
    expect(code).toContain('CREATE TEMP TABLE _pos_pin_snapshot ON COMMIT DROP');
  });

  it('never touches operating_models, sibling pins, or capability machinery', () => {
    expect(code).not.toMatch(/SET\s+operating_models/i);
    expect(code).not.toContain('operating_models =');
    expect(code).not.toContain("- 'sales'");
    expect(code).not.toContain("- 'inventory'");
    expect(code).not.toContain("- 'services'");
    expect(code).not.toContain('grant_construction_procurement_capability');
    expect(code).not.toContain('deriveOrganisationCapabilityDefaults(');
    // Housekeeping only: the UPDATE SET list is the pos removal + updated_at.
    expect(code).toContain('updated_at = now()');
  });

  it('ships a snapshot verifier proving only the pos key moved', () => {
    expect(code.split('$verify$').length - 1).toBe(2);
    // 1. Zero non-retail rows keep the pin afterwards (the prompt's
    //    verification query as a hard gate).
    expect(code).toContain('pos pin removal incomplete');
    // 2. RETAIL pins survive unchanged.
    expect(code).toContain('RETAIL pos overrides changed');
    // 3. Byte-level diff: every row equals its snapshot minus only `pos`
    //    for non-retail businesses.
    expect(code).toContain(
      'capability_overrides changed outside the pos key',
    );
    expect(code).toContain('IS DISTINCT FROM');
  });
});
