import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20261215000000_ai_summaries_and_forecasts.sql', 'utf8');

describe('AI financial summaries migration contract', () => {
  it('persists health snapshots with bounded scores, period ordering, and business ownership', () => {
    expect(migration).toContain('REFERENCES public.businesses(id) ON DELETE CASCADE');
    expect(migration).toContain('CHECK (health_score BETWEEN 0 AND 100)');
    expect(migration).toContain('CHECK (period_start <= period_end)');
    expect(migration).toContain("key_risks jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(migration).toContain("recommendations jsonb NOT NULL DEFAULT '[]'::jsonb");
    expect(migration).not.toMatch(/organisation_id|organisations/i);
  });

  it('scopes snapshot reads and writes to active Enterprise members without JWT tenant claims', () => {
    expect(migration).toContain('public.is_business_member(p_business_id)');
    expect(migration).toContain("public.effective_plan_tier(b.plan_tier, b.plan_expires_at) = 'enterprise'");
    expect(migration).toContain('public.can_access_ai_financial_summaries(business_id)');
    expect(migration).toContain('FOR SELECT TO authenticated');
    expect(migration).toContain('FOR INSERT TO authenticated');
    expect(migration).not.toMatch(/auth\.jwt\(\).*business_id/i);
  });
});
