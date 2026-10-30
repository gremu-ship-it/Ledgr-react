import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20261129000000_extend_construction_rfis.sql', 'utf8');

describe('construction RFI extension migration contract', () => {
  it('adds the optional project-reference and response fields idempotently', () => {
    for (const column of ['proposed_solution', 'boq_item_id', 'subcontract_id', 'drawing_reference', 'answered_by']) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
    expect(migration).toContain('REFERENCES public.boq_items(id) ON DELETE SET NULL');
    expect(migration).toContain('REFERENCES public.subcontracts(id) ON DELETE SET NULL');
  });

  it('supports both the legacy open and the full submitted/cancelled lifecycle', () => {
    expect(migration).toContain("CHECK (status IN ('draft', 'open', 'submitted', 'answered', 'closed', 'cancelled'))");
    expect(migration).toContain("v_rfi.status = 'draft' AND p_new_status IN ('open', 'submitted', 'cancelled')");
    expect(migration).toContain("v_rfi.status = 'submitted' AND p_new_status IN ('answered', 'closed', 'cancelled')");
    expect(migration).toContain("closed_at = CASE WHEN p_new_status IN ('closed', 'cancelled') THEN now()");
  });

  it('keeps project-scoped reference validation inside authorized command functions', () => {
    expect(migration).toContain('public._ledgr_construction_rfi_actor(p_business_id)');
    expect(migration).toContain('BOQ item is outside the requested project and business.');
    expect(migration).toContain('Subcontract is outside the requested project and business.');
    expect(migration).toContain('NOTIFY pgrst, \'reload schema\'');
  });
});
