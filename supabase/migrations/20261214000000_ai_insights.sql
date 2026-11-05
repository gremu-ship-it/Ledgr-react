-- Phase 6G-1: persisted, explainable AI ledger-health findings.
-- The application computes deterministic/z-score/fuzzy-match candidates; this
-- boundary validates Enterprise entitlement, business membership and source
-- ownership before persisting any finding.

CREATE TABLE IF NOT EXISTS public.ai_anomaly_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN (
    'duplicate_invoice', 'unallocated_cost_center', 'missing_tax_tag',
    'amount_outlier', 'payroll_variance'
  )),
  severity text NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  title text NOT NULL,
  description text NOT NULL,
  source_table text CHECK (source_table IS NULL OR source_table IN ('expenses', 'expense_lines', 'journal_entries', 'payroll_runs')),
  source_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_anomaly_resolution_shape CHECK (
    (NOT is_resolved AND resolved_at IS NULL AND resolved_by IS NULL)
    OR (is_resolved AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS ai_anomaly_logs_business_created_idx
  ON public.ai_anomaly_logs (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_anomaly_logs_business_open_idx
  ON public.ai_anomaly_logs (business_id, severity)
  WHERE is_resolved = false;
CREATE UNIQUE INDEX IF NOT EXISTS ai_anomaly_logs_active_source_key
  ON public.ai_anomaly_logs (business_id, category, source_table, source_id)
  WHERE source_id IS NOT NULL AND is_resolved = false;

ALTER TABLE public.ai_anomaly_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_anomaly_logs FROM PUBLIC, anon;
GRANT SELECT ON public.ai_anomaly_logs TO authenticated;
GRANT UPDATE (is_resolved, resolved_at, resolved_by) ON public.ai_anomaly_logs TO authenticated;

DROP POLICY IF EXISTS ai_anomaly_logs_member_read ON public.ai_anomaly_logs;
CREATE POLICY ai_anomaly_logs_member_read ON public.ai_anomaly_logs
  FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

DROP POLICY IF EXISTS ai_anomaly_logs_member_resolve ON public.ai_anomaly_logs;
CREATE POLICY ai_anomaly_logs_member_resolve ON public.ai_anomaly_logs
  FOR UPDATE TO authenticated
  USING (public.is_business_member(business_id) AND is_resolved = false)
  WITH CHECK (
    public.is_business_member(business_id)
    AND is_resolved = true
    AND resolved_at IS NOT NULL
    AND resolved_by = auth.uid()
  );

CREATE OR REPLACE FUNCTION public.can_run_ai_anomaly_scan(p_business_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.is_business_member(p_business_id)
    AND EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = p_business_id
        AND public.effective_plan_tier(b.plan_tier, b.plan_expires_at) = 'enterprise'
    );
$$;
REVOKE ALL ON FUNCTION public.can_run_ai_anomaly_scan(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_run_ai_anomaly_scan(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.run_ai_anomaly_scan(p_business_id uuid, p_anomalies jsonb)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  anomaly jsonb;
  source_table_name text;
  source_row_id uuid;
  source_is_owned boolean;
  inserted_count integer := 0;
  rows_inserted integer := 0;
BEGIN
  IF NOT public.can_run_ai_anomaly_scan(p_business_id) THEN
    RAISE EXCEPTION 'AI anomaly diagnostics require an active Enterprise business membership.'
      USING ERRCODE = '42501';
  END IF;
  IF p_anomalies IS NULL OR jsonb_typeof(p_anomalies) <> 'array' OR jsonb_array_length(p_anomalies) > 2000 THEN
    RAISE EXCEPTION 'Invalid anomaly scan payload.' USING ERRCODE = '22023';
  END IF;

  FOR anomaly IN SELECT value FROM jsonb_array_elements(p_anomalies) AS rows(value)
  LOOP
    source_table_name := NULLIF(anomaly->>'source_table', '');
    source_row_id := NULLIF(anomaly->>'source_id', '')::uuid;

    IF source_row_id IS NOT NULL THEN
      source_is_owned := CASE source_table_name
        WHEN 'expenses' THEN EXISTS (
          SELECT 1 FROM public.expenses e WHERE e.id = source_row_id AND e.business_id = p_business_id
        )
        WHEN 'expense_lines' THEN EXISTS (
          SELECT 1 FROM public.expense_lines el WHERE el.id = source_row_id AND el.business_id = p_business_id
        )
        WHEN 'journal_entries' THEN EXISTS (
          SELECT 1 FROM public.journal_entries je WHERE je.id = source_row_id AND je.business_id = p_business_id
        )
        WHEN 'payroll_runs' THEN EXISTS (
          SELECT 1 FROM public.payroll_runs pr WHERE pr.id = source_row_id AND pr.business_id = p_business_id
        )
        ELSE false
      END;
      IF NOT source_is_owned THEN
        RAISE EXCEPTION 'Anomaly source does not belong to the requested business.' USING ERRCODE = '23503';
      END IF;
    END IF;

    INSERT INTO public.ai_anomaly_logs (
      business_id, category, severity, title, description, source_table,
      source_id, metadata
    ) VALUES (
      p_business_id,
      anomaly->>'category',
      anomaly->>'severity',
      anomaly->>'title',
      anomaly->>'description',
      source_table_name,
      source_row_id,
      COALESCE(anomaly->'metadata', '{}'::jsonb)
    )
    ON CONFLICT (business_id, category, source_table, source_id)
      WHERE source_id IS NOT NULL AND is_resolved = false
      DO NOTHING;

    GET DIAGNOSTICS rows_inserted = ROW_COUNT;
    inserted_count := inserted_count + rows_inserted;
  END LOOP;

  RETURN inserted_count;
END;
$$;
REVOKE ALL ON FUNCTION public.run_ai_anomaly_scan(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.run_ai_anomaly_scan(uuid, jsonb) TO authenticated, service_role;

COMMENT ON TABLE public.ai_anomaly_logs IS
  'Business-scoped, explainable AI ledger diagnostics. Finding title/description fields contain ai.* translation keys; metadata carries numeric interpolation values.';
COMMENT ON FUNCTION public.run_ai_anomaly_scan(uuid, jsonb) IS
  'Persists client-calculated deterministic diagnostic candidates only for an active Enterprise member and only when each source belongs to that business.';

NOTIFY pgrst, 'reload schema';
