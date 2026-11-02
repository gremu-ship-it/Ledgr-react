-- 5B-4d: Construction Scheduling MVP (WBS + dependencies)

CREATE TABLE IF NOT EXISTS public.construction_schedule_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.construction_projects(id) ON DELETE CASCADE,
  site_id UUID REFERENCES public.construction_procurement_sites(id) ON DELETE SET NULL,
  parent_task_id UUID REFERENCES public.construction_schedule_tasks(id) ON DELETE CASCADE,
  wbs_code TEXT NOT NULL,
  task_name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'in_progress', 'completed', 'on_hold', 'cancelled')),
  planned_start DATE,
  planned_finish DATE,
  actual_start DATE,
  actual_finish DATE,
  progress_percent INTEGER NOT NULL DEFAULT 0
    CHECK (progress_percent >= 0 AND progress_percent <= 100),
  boq_section_id UUID REFERENCES public.boq_sections(id) ON DELETE SET NULL,
  subcontract_id UUID REFERENCES public.subcontracts(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, project_id, wbs_code)
);

CREATE TABLE IF NOT EXISTS public.construction_task_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  predecessor_id UUID NOT NULL REFERENCES public.construction_schedule_tasks(id) ON DELETE CASCADE,
  successor_id UUID NOT NULL REFERENCES public.construction_schedule_tasks(id) ON DELETE CASCADE,
  dependency_type TEXT NOT NULL DEFAULT 'FS'
    CHECK (dependency_type IN ('FS', 'SS', 'FF', 'SF')),
  lag_days INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (predecessor_id, successor_id)
);

CREATE INDEX IF NOT EXISTS idx_schedule_tasks_project
  ON public.construction_schedule_tasks(business_id, project_id);
CREATE INDEX IF NOT EXISTS idx_schedule_tasks_parent
  ON public.construction_schedule_tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_predecessor
  ON public.construction_task_dependencies(predecessor_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_successor
  ON public.construction_task_dependencies(successor_id);

ALTER TABLE public.construction_schedule_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.construction_task_dependencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tasks_select" ON public.construction_schedule_tasks
  FOR SELECT TO authenticated USING (public.is_business_member(business_id));
CREATE POLICY "tasks_insert" ON public.construction_schedule_tasks
  FOR INSERT TO authenticated WITH CHECK (public.is_business_member(business_id));
CREATE POLICY "tasks_update" ON public.construction_schedule_tasks
  FOR UPDATE TO authenticated USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));
CREATE POLICY "tasks_delete" ON public.construction_schedule_tasks
  FOR DELETE TO authenticated USING (public.is_business_member(business_id));

CREATE POLICY "deps_select" ON public.construction_task_dependencies
  FOR SELECT TO authenticated USING (public.is_business_member(business_id));
CREATE POLICY "deps_insert" ON public.construction_task_dependencies
  FOR INSERT TO authenticated WITH CHECK (public.is_business_member(business_id));
CREATE POLICY "deps_update" ON public.construction_task_dependencies
  FOR UPDATE TO authenticated USING (public.is_business_member(business_id))
  WITH CHECK (public.is_business_member(business_id));
CREATE POLICY "deps_delete" ON public.construction_task_dependencies
  FOR DELETE TO authenticated USING (public.is_business_member(business_id));

CREATE OR REPLACE FUNCTION public.update_task_progress(
  p_task_id UUID,
  p_progress INTEGER
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bid UUID;
  v_new_status TEXT;
BEGIN
  SELECT business_id INTO v_bid
  FROM public.construction_schedule_tasks
  WHERE id = p_task_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Task not found'; END IF;
  IF NOT public.is_business_member(v_bid) THEN RAISE EXCEPTION 'Not a member'; END IF;
  IF p_progress < 0 OR p_progress > 100 THEN RAISE EXCEPTION 'Progress must be 0-100'; END IF;

  v_new_status := CASE
    WHEN p_progress = 0 THEN 'not_started'
    WHEN p_progress = 100 THEN 'completed'
    ELSE 'in_progress'
  END;

  UPDATE public.construction_schedule_tasks SET
    progress_percent = p_progress,
    status = v_new_status,
    actual_start = CASE WHEN p_progress > 0 AND actual_start IS NULL THEN CURRENT_DATE ELSE actual_start END,
    actual_finish = CASE WHEN p_progress = 100 THEN CURRENT_DATE ELSE NULL END,
    updated_at = now()
  WHERE id = p_task_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_task_progress(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_task_progress(UUID, INTEGER) TO authenticated;
