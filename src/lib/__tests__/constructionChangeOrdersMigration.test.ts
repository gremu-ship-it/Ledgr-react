import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261130000002_construction_change_orders.sql'),
  'utf8',
);

describe('Construction Change Orders migration contract', () => {
  it('uses the required construction references, text evidence, and checked text status', () => {
    expect(migration).toContain('references public.construction_projects(id) on delete restrict');
    expect(migration).toContain('references public.construction_procurement_sites(id) on delete set null');
    expect(migration).toContain('evidence_reference text');
    expect(migration).toMatch(/status text not null default 'draft'[\s\S]*check \(status in \('draft', 'submitted', 'approved', 'rejected', 'cancelled'\)\)/i);
    expect(migration).not.toMatch(/create type\s+public\.[a-z_]*change_order/i);
  });

  it('enables member RLS and exposes only draft direct updates/deletes', () => {
    expect(migration).toContain('alter table public.construction_change_orders enable row level security');
    expect(migration).toContain('public.is_business_member(business_id)');
    expect(migration).toMatch(/using \([\s\S]*public\.is_business_member\(business_id\)[\s\S]*status = 'draft'/);
    expect(migration).toContain('revoke all on public.construction_change_orders from public, anon, authenticated');
    expect(migration).toContain('grant update (');
    expect(migration).toContain("status = 'draft'");
  });

  it('restricts module access to active Enterprise project-based businesses', () => {
    expect(migration).toContain('public._construction_change_orders_entitled(business_id)');
    expect(migration).toContain("public.effective_plan_tier(b.plan_tier, b.plan_expires_at) = 'enterprise'");
    expect(migration).toContain("'PROJECT_BASED' = any(coalesce(b.operating_models, array[]::text[]))");
    expect(migration).toContain('grant execute on function public._construction_change_orders_entitled(uuid) to authenticated, service_role');
  });

  it('guards serialized status transitions in a security-definer RPC', () => {
    const start = migration.indexOf('create or replace function public.transition_construction_co');
    const body = migration.slice(start, migration.indexOf('as $$', start));
    expect(body).toMatch(/security definer/i);
    expect(body).toMatch(/set search_path = public/i);
    expect(migration).toContain('for update');
    expect(migration).toContain("p_new_status = 'rejected' and nullif(trim(p_rejection_reason), '') is null");
    expect(migration).toContain('approved_by = case when p_new_status = \'approved\' then auth.uid()');
  });
});
