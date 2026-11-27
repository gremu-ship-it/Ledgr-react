import type { OperatingModel } from '@/lib/capabilities/profile';

/** The three business fields the vertical boundary reads. */
interface HealthcareProfile {
  operating_models?: readonly (OperatingModel | string)[] | null;
  plan_tier?: string | null;
  subscription_plan?: string | null;
}

/** Operating model that turns the clinic vertical on. */
export const HEALTHCARE_OPERATING_MODEL = 'HEALTHCARE' as const;

/** The clinic vertical is sold only on Enterprise. */
export const HEALTHCARE_MIN_PLAN = 'enterprise' as const;

/**
 * True when the business selected the healthcare operating model.
 *
 * This is the hard vertical boundary: a retail or construction business must
 * never see a clinic route or navigation item. The check is case-insensitive
 * because operating models have historically been stored in either case.
 */
export function isHealthcareBusiness(
  business: Pick<HealthcareProfile, 'operating_models'> | null | undefined,
): boolean {
  return (business?.operating_models ?? []).some(
    (model) => String(model).toUpperCase() === HEALTHCARE_OPERATING_MODEL,
  );
}

/**
 * True when the stored plan is Enterprise. Accepts the legacy
 * `subscription_plan` column as well as the current `plan_tier` so a database
 * that still carries both cannot disagree with the navigation gate.
 */
export function isHealthcareEnterprisePlan(
  plan: string | null | undefined,
): boolean {
  return String(plan ?? '').trim().toLowerCase() === HEALTHCARE_MIN_PLAN;
}

/**
 * Full route-level entitlement. Navigation uses the plan tier separately so a
 * healthcare business below Enterprise still sees the (locked) upsell path;
 * directly opening a clinic URL, however, redirects away instead of rendering a
 * locked clinic surface.
 */
export function isHealthcareEnabled(
  business: HealthcareProfile | null | undefined,
  effectivePlanTier?: string | null,
): boolean {
  if (!isHealthcareBusiness(business)) return false;

  // The effective tier accounts for an expired paid plan, so when the caller
  // supplies it that value is authoritative for `plan_tier`. The legacy
  // `subscription_plan` column can still entitle the business because some
  // deployments store the sold plan only there.
  const tierIsEnterprise = effectivePlanTier != null
    ? isHealthcareEnterprisePlan(effectivePlanTier)
    : isHealthcareEnterprisePlan(business?.plan_tier);

  return tierIsEnterprise || isHealthcareEnterprisePlan(business?.subscription_plan);
}
