import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/store/useAppStore';

/**
 * Supply Chain page vocabulary.
 *
 * PROJECT_BASED businesses use Materials / Site Stores / Materials Transfer
 * instead of Products / Warehouse / Transfers. The header keys follow that
 * operating model (via `operating_models.includes('PROJECT_BASED')`) so the
 * pages and navigation stay aligned; other models retain their defaults.
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
  isProjectBased: boolean,
): { titleKey: string; subtitleKey: string } {
  const entry = PAGE_LABEL_KEYS[page];
  const base = `pages.inventory.${isProjectBased ? entry.constructionKey : entry.defaultKey}`;
  return { titleKey: `${base}.title`, subtitleKey: `${base}.subtitle` };
}

export interface InventoryPageLabels {
  title: string;
  subtitle: string;
}

/**
 * Translated header labels for a Supply Chain page. Only PROJECT_BASED
 * changes the inventory vocabulary; other models keep the existing headers.
 * The selection is taken directly from the active business profile and is
 * independent of plan, role, and capability gates.
 *
 * `interpolation` is forwarded to both strings (the products subtitle names
 * the business: "…for {{businessName}}").
 */
export function useInventoryPageLabels(
  page: InventoryPageSlug,
  interpolation?: Record<string, string>,
): InventoryPageLabels {
  const { t } = useTranslation();
  const operatingModels = useAppStore((state) => state.currentBusiness?.business?.operating_models ?? []);
  const usesProjectBasedVocabulary = operatingModels.includes('PROJECT_BASED');
  const { titleKey, subtitleKey } = inventoryPageLabelKeys(page, usesProjectBasedVocabulary);

  return {
    title: t(titleKey, interpolation),
    subtitle: t(subtitleKey, interpolation),
  };
}
