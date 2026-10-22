import { useAppStore } from '@/store/useAppStore';
import { LocationsTab } from '@/components/settings/LocationsTab';

/**
 * Organisation → Locations (labelled "Sites" in the construction/manufacturing
 * vocabulary). The locations master-data manager moved out of the Settings
 * tabs into its own route; LocationsTab is self-contained — own header, Growth
 * plan gate matching Branches/Contacts/Departments, CRUD through
 * LocationRepository under the existing RLS tier — so the page shell only
 * supplies the active business.
 */
export function LocationsPage() {
  const businessId = useAppStore((s) => s.currentBusiness?.business?.id);
  if (!businessId) return null;
  return <LocationsTab businessId={businessId} />;
}
