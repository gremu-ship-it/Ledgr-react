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
 * Construction and manufacturing are detected through the organisation-only
 * predicate (`useOrganisationCapabilityVisibility`) — the same predicate the
 * sidebar override uses — rather than the full plan/role capability gate.
 * Vocabulary follows the business profile; plan/role gates stay where they
 * already are. Both operating models use the sidebar's Materials / Site Stores
 * / Material Transfers terminology on these page headers.
 *
 * These operating models are profile-gated (`ALWAYS_PROFILE_GATED` in
 * `src/lib/capabilities/resolve.ts`), so the labels follow the profile whether
 * or not the organisation-layer kill switch is on — exactly like the sidebar.
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

  const usesMaterialsVocabulary =
    isOrgCapabilityEnabled('construction') || isOrgCapabilityEnabled('manufacturing');
  const { titleKey, subtitleKey } = inventoryPageLabelKeys(page, usesMaterialsVocabulary);

  return {
    title: t(titleKey, interpolation),
    subtitle: t(subtitleKey, interpolation),
  };
}
