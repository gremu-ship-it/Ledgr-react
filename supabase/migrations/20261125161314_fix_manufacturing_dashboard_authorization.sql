-- Reconciled from production on 2026-11-27.
--
-- Version 20261125161314 was applied directly to project hsuhuvuxfuufrlejsatw
-- on 2026-11-25, before its file existed in this repository. The deploy
-- pipeline detected it as remote-only migration history. The statements below
-- are committed verbatim so the local chain matches the remote ledger.
--
-- This version relaxed _mfg_dashboard_authorized to any active business
-- member. 20270105000000_restore_manufacturing_dashboard_authorization.sql
-- restores the documented manufacturing.bom.manage contract enforced by
-- MFG.DASH.CAPABILITY and the security audit.
--
-- Dashboard RPCs are read-only: authorise any active business member,
-- not only holders of the manufacturing.bom.manage write grant.
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

  -- Shared membership boundary for manufacturing SECURITY DEFINER reads.
  PERFORM public._mfg_wo_actor(p_business_id);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public._mfg_dashboard_authorized(uuid) FROM PUBLIC, anon, authenticated;
