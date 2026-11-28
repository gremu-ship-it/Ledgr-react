-- Restore the documented manufacturing dashboard authorisation contract.
--
-- Production carried a remote-only hotfix (20261125161314) that allowed any
-- active business member to execute the read-only manufacturing dashboard
-- RPCs. Phase D, the release evidence MFG.DASH.CAPABILITY and
-- docs/audits/SECURITY_AND_ISO_AUDIT_2026.md require the existing
-- manufacturing.bom.manage grant. This forward migration re-issues the
-- canonical body after the reconciled remote version, so a fresh replay and
-- production converge on the same contract.
--
-- Idempotent: CREATE OR REPLACE + REVOKE only. No table, policy or history row
-- is changed.

CREATE OR REPLACE FUNCTION public._mfg_dashboard_authorized(p_business_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = p_business_id) THEN
    RETURN false;
  END IF;

  -- Reuse the Phase C membership check so SECURITY DEFINER reporting follows
  -- the same business-membership boundary as manufacturing work-order RPCs.
  PERFORM public._mfg_wo_actor(p_business_id);

  -- Manufacturing has one operation grant for the complete module.
  IF NOT EXISTS (
    SELECT 1
    FROM public.manufacturing_capability_grants g
    WHERE g.business_id = p_business_id
      AND g.user_id = auth.uid()
      AND g.capability = 'manufacturing.bom.manage'
      AND g.revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'The manufacturing.bom.manage capability is required.'
      USING ERRCODE = '42501';
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public._mfg_dashboard_authorized(uuid) FROM PUBLIC, anon, authenticated;
