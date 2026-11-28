import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const RECONCILED_VERSION = '20261125161314';
const RESTORED_VERSION = '20270105000000';

const reconciledSql = readFileSync(
  `supabase/migrations/${RECONCILED_VERSION}_fix_manufacturing_dashboard_authorization.sql`,
  'utf8',
);
const restoredSql = readFileSync(
  `supabase/migrations/${RESTORED_VERSION}_restore_manufacturing_dashboard_authorization.sql`,
  'utf8',
);

/**
 * Production applied 20261125161314 directly, then the deploy pipeline
 * refused to continue because the checked-out history did not contain it.
 * The reconciled file preserves the remote version; the forward migration
 * re-asserts the Phase D contract that MFG.DASH.CAPABILITY proves against a
 * real PostgreSQL.
 */
describe('manufacturing dashboard authorisation migration reconciliation', () => {
  it('records the production-only version in the local migration chain', () => {
    expect(RECONCILED_VERSION < RESTORED_VERSION).toBe(true);
    expect(reconciledSql).toContain(
      'CREATE OR REPLACE FUNCTION public._mfg_dashboard_authorized(p_business_id uuid)',
    );
    expect(reconciledSql).toContain('PERFORM public._mfg_wo_actor(p_business_id)');
    expect(reconciledSql).toContain(
      'REVOKE ALL ON FUNCTION public._mfg_dashboard_authorized(uuid) FROM PUBLIC, anon, authenticated;',
    );
  });

  it('restores the manufacturing.bom.manage requirement after the reconciled version', () => {
    expect(restoredSql).toContain(
      'CREATE OR REPLACE FUNCTION public._mfg_dashboard_authorized(p_business_id uuid)',
    );
    expect(restoredSql).toContain('PERFORM public._mfg_wo_actor(p_business_id)');
    expect(restoredSql).toContain('FROM public.manufacturing_capability_grants g');
    expect(restoredSql).toContain("g.capability = 'manufacturing.bom.manage'");
    expect(restoredSql).toContain('g.revoked_at IS NULL');
    expect(restoredSql).toContain("ERRCODE = '42501'");
    expect(restoredSql).toContain(
      'REVOKE ALL ON FUNCTION public._mfg_dashboard_authorized(uuid) FROM PUBLIC, anon, authenticated;',
    );
  });
});
