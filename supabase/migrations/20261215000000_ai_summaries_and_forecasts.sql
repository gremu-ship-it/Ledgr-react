-- Phase 6G-2: persisted deterministic executive summaries and working-capital snapshots.
-- Summary text and bullet fields store ai.summary.* translation keys; values in
-- metrics are interpolation data for the client-side localized presentation.

CREATE TABLE IF NOT EXISTS public.ai_financial_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  health_score integer NOT NULL CHECK (health_score BETWEEN 0 AND 100),
  executive_summary text NOT NULL,
  key_risks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(key_risks) = 'array'),
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(recommendations) = 'array'),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metrics) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_financial_summaries_period_check CHECK (period_start <= period_end)
);

CREATE INDEX IF NOT EXISTS ai_financial_summaries_business_created_idx
  ON public.ai_financial_summaries (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_financial_summaries_business_period_idx
  ON public.ai_financial_summaries (business_id, period_end DESC);

CREATE OR REPLACE FUNCTION public.can_access_ai_financial_summaries(p_business_id uuid)
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
REVOKE ALL ON FUNCTION public.can_access_ai_financial_summaries(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_ai_financial_summaries(uuid) TO authenticated, service_role;

ALTER TABLE public.ai_financial_summaries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_financial_summaries FROM PUBLIC, anon;
GRANT SELECT, INSERT ON public.ai_financial_summaries TO authenticated;

DROP POLICY IF EXISTS ai_financial_summaries_member_read ON public.ai_financial_summaries;
CREATE POLICY ai_financial_summaries_member_read ON public.ai_financial_summaries
  FOR SELECT TO authenticated
  USING (public.can_access_ai_financial_summaries(business_id));

DROP POLICY IF EXISTS ai_financial_summaries_enterprise_insert ON public.ai_financial_summaries;
CREATE POLICY ai_financial_summaries_enterprise_insert ON public.ai_financial_summaries
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_ai_financial_summaries(business_id));

COMMENT ON TABLE public.ai_financial_summaries IS
  'Append-only, business-scoped Enterprise financial-health snapshots. Commentary and bullet columns contain localized ai.summary.* keys; metrics contains deterministic interpolation values and projections.';
COMMENT ON FUNCTION public.can_access_ai_financial_summaries(uuid) IS
  'Allows financial-summary snapshots only to authenticated members of an active Enterprise business.';

NOTIFY pgrst, 'reload schema';
