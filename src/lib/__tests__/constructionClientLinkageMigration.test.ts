import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20261107000000_construction_client_linkage.sql',
  'utf8',
);
const VALUATIONS_SQL = readFileSync(
  'supabase/migrations/20261031000001_construction_progress_valuations.sql',
  'utf8',
);

/**
 * Static contract for the P2-3 construction client linkage migration.
 *
 * Guards the promise the phase is built on: the FK is additive and nullable,
 * the backfill reports instead of guessing, the frozen billing bridge is
 * never redefined, and generate_invoice_from_valuation is a byte-identical
 * copy of the 20261031000001 body with exactly one call swapped. Behavioral
 * proofs (real PostgreSQL replay, invoice contact resolution) live in the
 * release-evidence suites.
 */
/**
 * Negative assertions must target executable SQL, not the documentary
 * header (which legitimately NAMES the frozen functions to promise they are
 * untouched). Strip `--` comment lines and work statement-by-statement.
 */
const code = sql
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n');
const statements = code.split(';');

describe('construction client linkage migration contract', () => {
  it('is uniquely versioned and follows the location types migration', () => {
    const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
    const versions = files.map((f) => f.split('_')[0]);
    // Head tracking lives in the newest phase's contract test (P2-4:
    // constructionSiteLifecycleMigration.test.ts); this file keeps the
    // relative ordering of its own version.
    expect(versions).toContain('20261107000000');
    expect(versions.filter((v) => v === '20261107000000')).toHaveLength(1);
    expect(versions.indexOf('20261107000000')).toBe(versions.indexOf('20261106000000') + 1);
  });

  it('adds a nullable FK to contacts with ON DELETE SET NULL, indexed and commented', () => {
    expect(sql).toContain(
      'ADD COLUMN IF NOT EXISTS client_id uuid NULL REFERENCES public.contacts(id) ON DELETE SET NULL',
    );
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_construction_projects_client_id');
    expect(sql).toContain('COMMENT ON COLUMN public.construction_projects.client_id');
  });

  it('keeps client_name as the display cache — never dropped, never altered', () => {
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/ALTER\s+COLUMN\s+client_name/i);
    // The verifier pins the cache contract instead.
    expect(sql).toContain("column_name = 'client_name' AND is_nullable = 'NO'");
  });

  it('backfills by exact case-insensitive name match and reports instead of guessing', () => {
    const backfill = sql.slice(
      sql.indexOf('DO $client_linkage_backfill$'),
      sql.indexOf('$client_linkage_backfill$;'),
    );
    expect(backfill).toContain("lower(trim(c.name)) = lower(trim(proj.client_name))");
    expect(backfill).toContain("c.contact_type IN ('customer', 'both')");
    expect(backfill).toContain('c.deleted_at IS NULL');
    expect(backfill).toContain('RAISE NOTICE \'AMBIGUOUS:');
    expect(backfill).toContain('RAISE NOTICE \'NO MATCH:');
    // Report, not guess: the backfill must never create contacts.
    expect(backfill).not.toMatch(/INSERT\s+INTO\s+public\.contacts/i);
  });

  it('freezes the billing bridge: never redefined, never re-granted, never dropped', () => {
    // No DDL/ACL statement may touch the bridge — it only appears inside the
    // resolver body (as a call), its COMMENT string, and verifier checks.
    for (const statement of statements) {
      const head = statement.trim().slice(0, 40).toUpperCase();
      const mentionsBridge = /_ledgr_construction_billing_contact/.test(statement);
      if (!mentionsBridge) continue;
      expect(head).not.toMatch(/^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+PUBLIC\._LEDGR_CONSTRUCTION_BILLING_CONTACT/);
      expect(head).not.toMatch(/^DROP\s+FUNCTION/);
      expect(head).not.toMatch(/^(GRANT|REVOKE)/);
    }
    expect(code).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\._ledgr_construction_billing_contact/i);
    // The verifier asserts the frozen signature survives.
    expect(sql).toContain("to_regprocedure('public._ledgr_construction_billing_contact(uuid,text)') IS NULL");
  });

  it('resolver prefers the FK, tenant-checks it, and falls back to the bridge with backfill', () => {
    const resolver = sql.slice(
      sql.indexOf('CREATE OR REPLACE FUNCTION public._ledgr_resolve_construction_client'),
      sql.indexOf('COMMENT ON FUNCTION public._ledgr_resolve_construction_client'),
    );
    expect(resolver).toContain('SECURITY DEFINER');
    expect(resolver).toContain('SET search_path = public');
    // Tenant hardening: the FK is only trusted within the project's business.
    expect(resolver).toContain('AND business_id = v_business_id');
    expect(resolver).toContain("AND contact_type IN ('customer', 'both')");
    expect(resolver).toContain('public._ledgr_construction_billing_contact(v_business_id, v_client_name)');
    // Bridge resolutions backfill the FK, guarded against races.
    expect(resolver).toContain('WHERE id = p_project_id AND client_id IS NULL');
    expect(sql).toContain('REVOKE ALL ON FUNCTION public._ledgr_resolve_construction_client(uuid)');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public._ledgr_resolve_construction_client(uuid)');
  });

  it('rewires generate_invoice_from_valuation as a single-call swap of the 20261031000001 body', () => {
    const extract = (source: string) => {
      const start = source.indexOf('CREATE OR REPLACE FUNCTION public.generate_invoice_from_valuation');
      expect(start).toBeGreaterThan(-1);
      return source.slice(start, source.indexOf('\n$$;\n', start) + '\n$$;\n'.length);
    };
    const original = extract(VALUATIONS_SQL);
    const rewired = extract(sql);

    const oldCall = `  v_contact_id := public._ledgr_construction_billing_contact(
    v_project.business_id, v_project.client_name
  );`;
    expect(original).toContain(oldCall);
    expect(rewired).not.toContain('_ledgr_construction_billing_contact');
    expect(rewired).toContain('public._ledgr_resolve_construction_client(v_project.id)');

    // Byte-identical apart from that one call: no opportunistic edits ride along.
    const swapped = rewired.replace(
      `  -- P2-3: prefer the client_id FK; the name bridge remains the fallback.
  v_contact_id := public._ledgr_resolve_construction_client(v_project.id);`,
      oldCall,
    );
    expect(swapped).toBe(original);

    // Everything the 20261031000001 verifier pins survives the swap.
    for (const pinned of [
      'create_invoice_with_lines',
      'credit_note',
      'v_retention_account_id',
      'Only submitted valuations can generate an invoice',
    ]) {
      expect(rewired).toContain(pinned);
    }
  });

  it('extends the project RPCs with a defaulted p_client_id and drops the old overloads', () => {
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.create_project(uuid,text,text,numeric,numeric,numeric,date,date);');
    expect(sql).toContain('DROP FUNCTION IF EXISTS public.update_project(uuid,text,text,numeric,numeric,numeric,date,date);');
    expect(sql).toContain('p_client_id uuid DEFAULT NULL');
    // Linked contacts are validated against the project's business.
    expect(sql).toContain('Linked client contact was not found for this business.');
    expect(sql).toMatch(/c\.business_id = p_business_id/);
    expect(sql).toMatch(/c\.business_id = v_row\.business_id/);
    // update persists explicit link AND unlink intent.
    expect(sql).toContain('client_id=p_client_id');
    // House grant pattern on the new signatures.
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.create_project(uuid,text,text,numeric,numeric,numeric,date,date,uuid) TO authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.update_project(uuid,text,text,numeric,numeric,numeric,date,date,uuid) TO authenticated;');
    // Legacy error vocabulary is preserved for the unlinked paths.
    expect(sql).toContain("'Project name and client name are required.'");
  });

  it('refreshes the compatibility view only through the guarded pattern', () => {
    expect(sql).toContain("obj_description(v_projects_oid, 'pg_class') = 'Ledgr construction projects compatibility view'");
    expect(sql).toContain('CREATE OR REPLACE VIEW public.projects WITH (security_invoker = true) AS SELECT * FROM public.construction_projects');
  });

  it('stays inside the P2-3 mandate: no policies, grants tables, capabilities or provisioning changes', () => {
    // Comment-stripped: the header NAMES these to promise they are untouched.
    expect(code).not.toMatch(/CREATE\s+POLICY/i);
    expect(code).not.toMatch(/DROP\s+POLICY/i);
    expect(code).not.toContain('grant_construction_procurement_capability');
    expect(code).not.toContain('capability_overrides');
    expect(code).not.toMatch(/provision_construction_defaults/);
    expect(code).not.toMatch(/ALTER\s+TABLE\s+public\.contacts/i);
    // release_retention keeps its direct bridge call in this phase.
    expect(code).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.release_retention/i);
  });

  it('ships a replay verifier for every invariant above', () => {
    expect(sql).toContain('DO $client_linkage_verify$');
    for (const assertion of [
      'construction_projects.client_id must exist as a nullable uuid column',
      'client_id must reference contacts(id) with ON DELETE SET NULL',
      'The billing bridge signature must not change',
      'The billing bridge must not be executable by authenticated',
      'Valuation invoicing must resolve clients through the FK-first resolver',
      'The old 8-argument project RPC overloads must be dropped (PostgREST ambiguity).',
    ]) {
      expect(sql).toContain(assertion);
    }
  });
});
