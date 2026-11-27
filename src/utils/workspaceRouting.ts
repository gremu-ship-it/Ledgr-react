/**
 * Resolve the default home path for the active business.
 *
 * A pure clinical tenant lands on the Clinic Hub rather than the generic
 * dashboard. Hybrids retain the clinical landing while they have no
 * construction/manufacturing home of their own; those verticals keep
 * precedence in `useDefaultRoute`.
 */
export interface WorkspaceBusiness {
  subscription_plan?: string | null;
  /** Current persisted tier column; accepted for older/newer callers alike. */
  plan_tier?: string | null;
  operating_models?: readonly string[] | null;
}

export function getDefaultLandingPath(business?: WorkspaceBusiness | null): string {
  if (!business) return '/dashboard';

  const plan = String(business.plan_tier ?? business.subscription_plan ?? '')
    .toLowerCase()
    .trim();
  const models = (business.operating_models ?? []).map((model) =>
    String(model).toUpperCase(),
  );

  if (
    plan === 'enterprise' &&
    models.includes('HEALTHCARE') &&
    !models.includes('CONSTRUCTION') &&
    !models.includes('MANUFACTURING')
  ) {
    return '/healthcare';
  }

  return '/dashboard';
}
