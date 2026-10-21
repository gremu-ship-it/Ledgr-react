import { useBusinessProfile } from './useBusinessProfile';

/**
 * Returns the best landing route based on the business's operating models.
 * Priority: CONSTRUCTION → MANUFACTURING → default dashboard
 */
export function useDefaultRoute(): string {
  const { profile } = useBusinessProfile();
  const models = profile?.operating_models ?? [];

  if (models.includes('CONSTRUCTION')) return '/construction';
  if (models.includes('MANUFACTURING')) return '/manufacturing';
  return '/dashboard';
}
