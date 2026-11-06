-- Phase 6F-2: delegated client portfolios, read-only partner context, and
-- consolidated subscription reporting. Staff identities remain in
-- partner_admins (partner_id, user_id); client entities remain businesses.

CREATE TABLE IF NOT EXISTS public.partner_staff_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  staff_user_id uuid NOT NULL,
  business_id uuid NOT NULL,
  assigned_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_staff_assignments_staff_fk
    FOREIGN KEY (partner_id, staff_user_id)
    REFERENCES public.partner_admins(partner_id, user_id) ON DELETE CASCADE,
  CONSTRAINT partner_staff_assignments_client_fk
    FOREIGN KEY (partner_id, business_id)
    REFERENCES public.partner_clients(partner_id, business_id) ON DELETE CASCADE,
  CONSTRAINT partner_staff_assignments_unique UNIQUE (partner_id, staff_user_id, business_id)
);

CREATE INDEX IF NOT EXISTS partner_staff_assignments_staff_idx
  ON public.partner_staff_assignments (partner_id, staff_user_id);
CREATE INDEX IF NOT EXISTS partner_staff_assignments_client_idx
  ON public.partner_staff_assignments (partner_id, business_id);
ALTER TABLE public.partner_staff_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.partner_staff_assignments FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.partner_staff_assignments TO authenticated;

CREATE OR REPLACE FUNCTION public.is_partner_manager(p_uid uuid, p_partner_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.is_platform_admin(p_uid) OR EXISTS (
    SELECT 1 FROM public.partner_admins pa
    WHERE pa.partner_id = p_partner_id AND pa.user_id = p_uid AND pa.role = 'admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_access_partner_client(p_uid uuid, p_partner_id uuid, p_business_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.partner_clients pc
    WHERE p_uid = auth.uid()
      AND pc.partner_id = p_partner_id AND pc.business_id = p_business_id
      AND (
        public.is_partner_manager(p_uid, p_partner_id)
        OR EXISTS (
          SELECT 1 FROM public.partner_staff_assignments a
          WHERE a.partner_id = pc.partner_id
            AND a.business_id = pc.business_id
            AND a.staff_user_id = p_uid
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_current_user_access_partner_client(p_partner_id uuid, p_business_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.can_access_partner_client(auth.uid(), p_partner_id, p_business_id);
$$;

CREATE OR REPLACE FUNCTION public.can_manage_partner_assignment(p_uid uuid, p_partner_id uuid, p_business_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT p_uid = auth.uid()
    AND public.is_partner_manager(p_uid, p_partner_id)
    AND EXISTS (
      SELECT 1 FROM public.partner_clients pc
      WHERE pc.partner_id = p_partner_id AND pc.business_id = p_business_id
    );
$$;

CREATE OR REPLACE FUNCTION public.can_read_partner_client(pid uuid, bid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT public.can_access_partner_client(auth.uid(), pid, bid)
    OR EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = bid AND bu.user_id = auth.uid() AND bu.is_active
    )
    OR (
      EXISTS (SELECT 1 FROM public.partners p WHERE p.id = pid AND p.allow_client_visibility)
      AND EXISTS (
        SELECT 1 FROM public.partner_clients mine
        JOIN public.business_users bu ON bu.business_id = mine.business_id
        WHERE mine.partner_id = pid AND bu.user_id = auth.uid() AND bu.is_active
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.is_partner_business_admin(bid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.partner_clients pc
    WHERE pc.business_id = bid
      AND public.can_access_partner_client(auth.uid(), pc.partner_id, pc.business_id)
  );
$$;

REVOKE ALL ON FUNCTION public.is_partner_manager(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_partner_client(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_current_user_access_partner_client(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_partner_assignment(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_partner_manager(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_partner_client(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_current_user_access_partner_client(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_partner_assignment(uuid, uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_partner_client(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_partner_business_admin(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS partner_staff_assignments_read ON public.partner_staff_assignments;
CREATE POLICY partner_staff_assignments_read ON public.partner_staff_assignments
  FOR SELECT USING (
    public.is_partner_manager(auth.uid(), partner_id)
    OR staff_user_id = auth.uid()
  );
DROP POLICY IF EXISTS partner_staff_assignments_manage ON public.partner_staff_assignments;
CREATE POLICY partner_staff_assignments_manage ON public.partner_staff_assignments
  FOR ALL USING (public.can_manage_partner_assignment(auth.uid(), partner_id, business_id))
  WITH CHECK (
    public.can_manage_partner_assignment(auth.uid(), partner_id, business_id)
    AND assigned_by = auth.uid()
  );

DROP POLICY IF EXISTS partner_clients_read ON public.partner_clients;
CREATE POLICY partner_clients_read ON public.partner_clients
  FOR SELECT USING (public.can_read_partner_client(partner_id, business_id));
DROP POLICY IF EXISTS partner_clients_write ON public.partner_clients;
CREATE POLICY partner_clients_write ON public.partner_clients
  FOR ALL USING (public.is_partner_manager(auth.uid(), partner_id))
  WITH CHECK (public.is_partner_manager(auth.uid(), partner_id));
DROP POLICY IF EXISTS businesses_partner_admin_read ON public.businesses;
CREATE POLICY businesses_partner_admin_read ON public.businesses
  FOR SELECT USING (public.is_partner_business_admin(id));

-- A verified partner manager or explicitly assigned accountant may inspect
-- the linked client's core accounting records in context. These are SELECT-only
-- policies; payroll, employee records, business memberships, credentials, and
-- write policies are deliberately excluded. Existing client membership policies
-- remain in place and are OR-combined with this narrowly scoped read path.
DO $$
DECLARE
  target_table text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'accounts', 'branches', 'departments', 'contacts',
    'journal_entries', 'journal_lines', 'invoices', 'invoice_lines',
    'invoice_payments', 'expenses', 'expense_lines', 'expense_payments'
  ] LOOP
    IF to_regclass(format('public.%I', target_table)) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS partner_client_accounting_read ON public.%I', target_table);
      EXECUTE format(
        'CREATE POLICY partner_client_accounting_read ON public.%I FOR SELECT USING (public.is_partner_business_admin(business_id))',
        target_table
      );
    END IF;
  END LOOP;
END;
$$;

-- Preserve the Phase 6F-1 summary contract and add only billing/usage fields.
-- This owner-rights view exposes business metadata and aggregate counts only;
-- every result is explicitly limited to a partner admin or assigned staff.
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
  ) AS total_activity_count,
  b.plan_expires_at,
  (
    (SELECT count(*) FROM public.journal_entries je WHERE je.business_id = b.id AND je.created_at >= date_trunc('month', now()))
    + (SELECT count(*) FROM public.invoices i WHERE i.business_id = b.id AND i.deleted_at IS NULL AND i.created_at >= date_trunc('month', now()))
    + (SELECT count(*) FROM public.pay_runs pr WHERE pr.business_id = b.id AND pr.created_at >= date_trunc('month', now()))
    + (SELECT count(*) FROM public.payroll_runs pr WHERE pr.business_id = b.id AND pr.created_at >= date_trunc('month', now()))
  ) AS monthly_transaction_count
FROM public.partner_clients pc
JOIN public.businesses b ON b.id = pc.business_id
WHERE b.deleted_at IS NULL
  AND public.can_access_partner_client(auth.uid(), pc.partner_id, b.id);

COMMENT ON VIEW public.v_partner_client_usage IS
  'Partner-scoped read-only client health and subscription summary. Explicit can_access_partner_client guard; only aggregate activity counts and billing metadata are exposed.';
REVOKE ALL ON public.v_partner_client_usage FROM anon;
GRANT SELECT ON public.v_partner_client_usage TO authenticated;

CREATE OR REPLACE VIEW public.v_partner_client_activity
  WITH (security_barrier = true)
AS
SELECT events.partner_id, events.business_id, events.business_name,
       events.event_id, events.event_type, events.title, events.event_at, events.status
FROM (
  SELECT pc.partner_id, b.id AS business_id, b.name AS business_name,
         je.id AS event_id, 'journal_entry'::text AS event_type,
         COALESCE(NULLIF(je.entry_number, ''), 'Journal entry') AS title,
         je.created_at AS event_at, je.status::text AS status
    FROM public.partner_clients pc JOIN public.businesses b ON b.id = pc.business_id
    JOIN public.journal_entries je ON je.business_id = b.id
   WHERE b.deleted_at IS NULL AND public.can_access_partner_client(auth.uid(), pc.partner_id, b.id)
  UNION ALL
  SELECT pc.partner_id, b.id, b.name, i.id, 'invoice'::text,
         COALESCE(NULLIF(i.invoice_number, ''), 'Invoice'), i.created_at, i.status::text
    FROM public.partner_clients pc JOIN public.businesses b ON b.id = pc.business_id
    JOIN public.invoices i ON i.business_id = b.id
   WHERE b.deleted_at IS NULL AND i.deleted_at IS NULL
     AND public.can_access_partner_client(auth.uid(), pc.partner_id, b.id)
  UNION ALL
  SELECT pc.partner_id, b.id, b.name, pr.id, 'pay_run'::text,
         'Payroll ' || to_char(pr.period_start, 'Mon YYYY'), pr.created_at, pr.status::text
    FROM public.partner_clients pc JOIN public.businesses b ON b.id = pc.business_id
    JOIN public.pay_runs pr ON pr.business_id = b.id
   WHERE b.deleted_at IS NULL AND public.can_access_partner_client(auth.uid(), pc.partner_id, b.id)
  UNION ALL
  SELECT pc.partner_id, b.id, b.name, pr.id, 'payroll_run'::text,
         COALESCE(NULLIF(pr.run_number, ''), 'Payroll run'), pr.created_at, pr.status::text
    FROM public.partner_clients pc JOIN public.businesses b ON b.id = pc.business_id
    JOIN public.payroll_runs pr ON pr.business_id = b.id
   WHERE b.deleted_at IS NULL AND public.can_access_partner_client(auth.uid(), pc.partner_id, b.id)
) AS events;

COMMENT ON VIEW public.v_partner_client_activity IS
  'Partner-scoped metadata-only activity stream, authorized for partner admins and assigned staff; excludes financial amounts and document details.';
REVOKE ALL ON public.v_partner_client_activity FROM anon;
GRANT SELECT ON public.v_partner_client_activity TO authenticated;
