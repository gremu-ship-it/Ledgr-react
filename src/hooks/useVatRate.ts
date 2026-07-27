import { useQuery } from '@tanstack/react-query';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { defaultVatRate, resolveJurisdiction } from '@/lib/taxRules';

/**
 * The business's standard VAT rate, from tax_configurations.
 *
 * Replaces the `const VAT_RATE = 0.175` constants that were duplicated across
 * ExpensesPage, IncomePage, InvoicesPage and QuickExpenseMobile. Those made
 * every statutory rate change a multi-file hunt and made Zambia (16%)
 * impossible to support alongside Malawi.
 *
 * Falls back to the jurisdiction default while the config loads or if none
 * has been seeded, so the UI never shows a nonsense 0%.
 */
export function useVatRate(): {
  /** Percentage, e.g. 17.5 */
  ratePercent: number;
  /** Fraction, e.g. 0.175 — multiply a net amount by this to get VAT. */
  rate: number;
  /** Divisor for extracting VAT from a gross amount, e.g. 1.175 */
  grossDivisor: number;
  /** Preformatted for labels, e.g. 'VAT (17.5%)' */
  label: string;
  isLoading: boolean;
} {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const jurisdiction = resolveJurisdiction(currentBusiness?.business?.country);
  const fallback = defaultVatRate(jurisdiction);

  const { data, isLoading } = useQuery({
    queryKey: ['tax_configurations', businessId, 'vat_standard', 'rate'],
    queryFn: () => repos.tax.getVatRate(businessId!),
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 30,
  });

  const ratePercent = data ?? fallback;
  return {
    ratePercent,
    rate: ratePercent / 100,
    grossDivisor: 1 + ratePercent / 100,
    label: `VAT (${ratePercent}%)`,
    isLoading,
  };
}
