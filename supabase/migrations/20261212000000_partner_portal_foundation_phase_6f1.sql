-- Phase 6F-1 extends Ledgr's existing white-label partner model.
-- This application uses public.partners / public.partner_clients and
-- public.businesses (not an organisations table); keep the existing tenant
-- model and authorization helpers rather than creating parallel tables.

ALTER TABLE public.partner_clients
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;

UPDATE public.partner_clients
   SET onboarded_at = COALESCE(onboarded_at, created_at, now())
 WHERE onboarded_at IS NULL;

ALTER TABLE public.partner_clients
  ALTER COLUMN onboarded_at SET DEFAULT now(),
  ALTER COLUMN onboarded_at SET NOT NULL;

ALTER TABLE public.partner_clients
  DROP CONSTRAINT IF EXISTS partner_clients_status_check;
ALTER TABLE public.partner_clients
  ADD CONSTRAINT partner_clients_status_check
  CHECK (status IN ('active', 'onboarding', 'suspended', 'archived'));

CREATE INDEX IF NOT EXISTS partner_clients_partner_status_idx
  ON public.partner_clients (partner_id, status);

-- The usage view is owner-rights because partner admins must not receive direct
-- read access to client ledgers. Its explicit tenant predicate is essential:
-- never remove it or convert this view to invoker rights without a separate
-- security review.
CREATE OR REPLACE VIEW public.v_partner_client_usage
  WITH (security_barrier = true)
AS
SELECT
  pc.partner_id,
  b.id AS business_id,
  b.name AS business_name,
  public.effective_plan_tier(b.plan_tier, b.plan_expires_at) AS plan_tier,
  b.is_active,
  pc.created_at AS onboarded_at,
  (SELECT count(*) FROM public.journal_entries je WHERE je.business_id = b.id) AS journal_entry_count,
  (SELECT count(*) FROM public.invoices i WHERE i.business_id = b.id AND i.deleted_at IS NULL) AS invoice_count,
  (SELECT count(*) FROM public.business_users bu WHERE bu.business_id = b.id AND bu.is_active) AS user_count,
  GREATEST(
    (SELECT max(je.created_at) FROM public.journal_entries je WHERE je.business_id = b.id),
    (SELECT max(i.created_at) FROM public.invoices i WHERE i.business_id = b.id AND i.deleted_at IS NULL),
    (SELECT max(pr.created_at) FROM public.pay_runs pr WHERE pr.business_id = b.id),
    (SELECT max(pr.created_at) FROM public.payroll_runs pr WHERE pr.business_id = b.id)
  ) AS last_activity_at,
  pc.status,
  pc.notes,
  (SELECT count(*) FROM public.pay_runs pr WHERE pr.business_id = b.id) AS pay_run_count,
  (
    (SELECT count(*) FROM public.journal_entries je WHERE je.business_id = b.id)
    + (SELECT count(*) FROM public.invoices i WHERE i.business_id = b.id AND i.deleted_at IS NULL)
    + (SELECT count(*) FROM public.pay_runs pr WHERE pr.business_id = b.id)
    + (SELECT count(*) FROM public.payroll_runs pr WHERE pr.business_id = b.id)
  ) AS total_activity_count
FROM public.partner_clients pc
JOIN public.businesses b ON b.id = pc.business_id
WHERE b.deleted_at IS NULL
  AND public.is_partner_admin(auth.uid(), pc.partner_id);

COMMENT ON VIEW public.v_partner_client_usage IS
  'Partner-scoped read-only client health summary. Owner-rights counts are protected by the explicit is_partner_admin(auth.uid(), partner_id) predicate.';

REVOKE ALL ON public.v_partner_client_usage FROM anon;
GRANT SELECT ON public.v_partner_client_usage TO authenticated;

-- Small activity summaries only (event type, title, time and state); never
-- expose journal amounts, payroll values, invoice line items, or client notes.
CREATE OR REPLACE VIEW public.v_partner_client_activity
  WITH (security_barrier = true)
AS
SELECT
  events.partner_id,
  events.business_id,
  events.business_name,
  events.event_id,
  events.event_type,
  events.title,
  events.event_at,
  events.status
FROM (
  SELECT pc.partner_id, b.id AS business_id, b.name AS business_name,
         je.id AS event_id, 'journal_entry'::text AS event_type,
         COALESCE(NULLIF(je.entry_number, ''), 'Journal entry') AS title,
         je.created_at AS event_at, je.status::text AS status
    FROM public.partner_clients pc
    JOIN public.businesses b ON b.id = pc.business_id
    JOIN public.journal_entries je ON je.business_id = b.id
   WHERE b.deleted_at IS NULL
     AND public.is_partner_admin(auth.uid(), pc.partner_id)
  UNION ALL
  SELECT pc.partner_id, b.id, b.name,
         i.id, 'invoice'::text,
         COALESCE(NULLIF(i.invoice_number, ''), 'Invoice'),
         i.created_at, i.status::text
    FROM public.partner_clients pc
    JOIN public.businesses b ON b.id = pc.business_id
    JOIN public.invoices i ON i.business_id = b.id
   WHERE b.deleted_at IS NULL AND i.deleted_at IS NULL
     AND public.is_partner_admin(auth.uid(), pc.partner_id)
  UNION ALL
  SELECT pc.partner_id, b.id, b.name,
         pr.id, 'pay_run'::text,
         'Payroll ' || to_char(pr.period_start, 'Mon YYYY'),
         pr.created_at, pr.status::text
    FROM public.partner_clients pc
    JOIN public.businesses b ON b.id = pc.business_id
    JOIN public.pay_runs pr ON pr.business_id = b.id
   WHERE b.deleted_at IS NULL
     AND public.is_partner_admin(auth.uid(), pc.partner_id)
  UNION ALL
  SELECT pc.partner_id, b.id, b.name,
         pr.id, 'payroll_run'::text,
         COALESCE(NULLIF(pr.run_number, ''), 'Payroll run'),
         pr.created_at, pr.status::text
    FROM public.partner_clients pc
    JOIN public.businesses b ON b.id = pc.business_id
    JOIN public.payroll_runs pr ON pr.business_id = b.id
   WHERE b.deleted_at IS NULL
     AND public.is_partner_admin(auth.uid(), pc.partner_id)
) AS events;

COMMENT ON VIEW public.v_partner_client_activity IS
  'Partner-admin-only, metadata-only activity stream for linked businesses. Uses an explicit partner authorization predicate in every source branch and excludes financial amounts and document details.';

REVOKE ALL ON public.v_partner_client_activity FROM anon;
GRANT SELECT ON public.v_partner_client_activity TO authenticated;
