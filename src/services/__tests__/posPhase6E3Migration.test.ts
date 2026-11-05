import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261208000000_pos_phase_6e3.sql'),
  'utf8',
);

describe('POS Phase 6E-3 database boundary', () => {
  it('persists held carts per shift and automatically expires them on close', () => {
    expect(migration).toContain('create table if not exists public.pos_held_orders');
    expect(migration).toContain('shift_id uuid not null references public.pos_shifts(id)');
    expect(migration).toContain('create trigger pos_shift_expire_held_orders');
    expect(migration).toMatch(/old\.status = 'open' and new\.status = 'closed'/);
    expect(migration).toMatch(/set status = 'expired', expired_at = coalesce\(new\.closed_at, now\(\)\)/);
    expect(migration).toContain('public.resume_pos_held_order_command');
    expect(migration).toContain("v_row.status = 'resumed' and v_row.resumed_by = v_user");
  });

  it('keeps held-order access behind tenant, retail, shift and user authorization, with Growth-only history', () => {
    expect(migration).toContain("'RETAIL' = any(coalesce(b.operating_models");
    expect(migration).toContain("if p_include_history and public.plan_tier_rank(coalesce(v_tier, 'free')) < public.plan_tier_rank('growth') then");
    expect(migration).not.toContain('POS held orders require the Starter plan or higher.');
    expect(migration).toContain('v_shift.cashier_id is distinct from v_user');
    expect(migration).toContain('public._ledgr_is_pos_supervisor');
    expect(migration).toContain('revoke all on public.pos_held_orders from anon, authenticated');
    expect(migration).toContain('grant execute on function public.hold_pos_order_command');
  });

  it('preserves single-tender sales, gates Free and Starter tender counts, and requires exact settlement', () => {
    expect(migration).toContain('create or replace function public.post_pos_sale_plan_gated');
    expect(migration).toContain("jsonb_array_length(v_payments) > 1");
    expect(migration).toContain("jsonb_array_length(v_payments) > 2");
    expect(migration).toContain('round(v_assigned * 100) <> round(v_due * 100)');
    expect(migration).toContain('return public.post_pos_sale(p_payload)');
    expect(migration).toContain('revoke all on function public.post_pos_sale(jsonb) from public, anon, authenticated');
  });

  it('provides a manager-only queue for other users\' price and discount override requests', () => {
    expect(migration).toContain('create or replace function public.list_pos_price_override_requests');
    expect(migration).toContain('public._ledgr_is_pos_supervisor(p_business_id, v_user)');
    expect(migration).toContain('o.requested_by <> v_user');
    expect(migration).toContain("o.authorized_at is null and o.consumed_at is null and o.expires_at > now()");
    expect(migration).toContain('grant execute on function public.list_pos_price_override_requests(uuid) to authenticated');
  });

  it('server-gates discount threshold writes to Growth and higher', () => {
    expect(migration).toContain('pos_discount_threshold_plan_guard');
    expect(migration).toContain("plan_tier_rank('growth')");
    expect(migration).toContain('Configurable manager discount thresholds require the Growth plan.');
  });
});
