import { useBusinessProfile } from './useBusinessProfile';
import { getDefaultLandingPath } from '@/utils/workspaceRouting';

/**
 * Returns the best landing route for the active business.
 *
 * Priority: clinical (HEALTHCARE enterprise) → CONSTRUCTION → MANUFACTURING →
 * default dashboard. The clinical helper deliberately yields to a
 * construction/manufacturing home, so a hybrid tenant that also runs a clinic
 * still lands on its operational vertical.
 */
export function useDefaultRoute(): string {
  const { profile } = useBusinessProfile();

  const clinicalLanding = getDefaultLandingPath(profile);
  if (clinicalLanding !== '/dashboard') return clinicalLanding;

  const models = profile?.operating_models ?? [];
  if (models.includes('CONSTRUCTION')) return '/construction';
  if (models.includes('MANUFACTURING')) return '/manufacturing';
  return '/dashboard';
}
