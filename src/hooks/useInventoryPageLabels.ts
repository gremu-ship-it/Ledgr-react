import { useTranslation } from 'react-i18next';
import { useOrganisationCapabilityVisibility } from '@/hooks/useCapability';

/**
 * Supply Chain page vocabulary.
 *
 * The sidebar already speaks site language to a construction business —
 * Materials / Site Stores / Material Transfers instead of Products /
 * Warehouse / Transfers (see `CONSTRUCTION_LABEL_OVERRIDES` in
 * `src/components/layout/navConfig.ts`). The page headers were hardcoded
 * English, so a construction user who clicked "Materials" landed on a page
 * titled "Products & Inventory". This hook is the one place that resolves
 * the header title/subtitle keys so the pages and the sidebar can never
 * drift apart again.
 */
export type InventoryPageSlug = 'products' | 'warehouse' | 'transfers';

const PAGE_LABEL_KEYS: Record<
  InventoryPageSlug,
  { defaultKey: string; constructionKey: string }
> = {
  products: { defaultKey: 'products', constructionKey: 'materials' },
  warehouse: { defaultKey: 'warehouse', constructionKey: 'siteStores' },
  transfers: { defaultKey: 'transfers', constructionKey: 'materialTransfers' },
};

/**
 * Resolve the i18n header keys for one Supply Chain page. A
 * non-construction business gets the default keys back untouched, so the
 * default vocabulary cannot drift — the same contract as
 * `resolveNavLabelKey`.
 */
export function inventoryPageLabelKeys(
  page: InventoryPageSlug,
  isConstruction: boolean,
): { titleKey: string; subtitleKey: string } {
  const entry = PAGE_LABEL_KEYS[page];
  const base = `pages.inventory.${isConstruction ? entry.constructionKey : entry.defaultKey}`;
  return { titleKey: `${base}.title`, subtitleKey: `${base}.subtitle` };
}

export interface InventoryPageLabels {
  title: string;
  subtitle: string;
}

/**
 * Translated header labels for a Supply Chain page.
 *
 * Construction is detected through the organisation-only predicate
 * (`useOrganisationCapabilityVisibility`) — the exact predicate
 * `visibleSectionsFor` uses for the sidebar override — rather than the
 * full `useCapability('construction')`. The full hook also requires the
 * Enterprise plan and role access to `/construction`, so a construction
 * business on a lower plan, or a stock clerk who may open the inventory
 * pages but not the construction workspace, would get "Materials" in the
 * sidebar and "Products & Inventory" on the page. Vocabulary follows the
 * business profile; plan/role gates stay where they already are.
 *
 * Construction is always profile-gated (`ALWAYS_PROFILE_GATED` in
 * `src/lib/capabilities/resolve.ts`), so this resolves from the profile
 * whether or not the organisation-layer kill switch is on — again,
 * exactly like the sidebar labels it must match.
 *
 * `interpolation` is forwarded to both strings (the products subtitle
 * names the business: "…for {{businessName}}").
 */
export function useInventoryPageLabels(
  page: InventoryPageSlug,
  interpolation?: Record<string, string>,
): InventoryPageLabels {
  const { t } = useTranslation();
  const isOrgCapabilityEnabled = useOrganisationCapabilityVisibility();

  const { titleKey, subtitleKey } = inventoryPageLabelKeys(
    page,
    isOrgCapabilityEnabled('construction'),
  );

  return {
    title: t(titleKey, interpolation),
    subtitle: t(subtitleKey, interpolation),
  };
}
