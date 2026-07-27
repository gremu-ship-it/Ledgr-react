import { useQuery } from '@tanstack/react-query';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { daysUntilDue, formatDueDate, formatPeriodLabel, lastDayOfMonth, todayIso } from '@/lib/taxDates';
import {
  getJurisdictionRules,
  resolveJurisdiction,
  dueDateFor,
  type TaxKind,
} from '@/lib/taxRules';

// ── Due dates ─────────────────────────────────────────────────────────────────

export interface TaxDueDate {
  taxType: string;
  dueDate: Date;
  dueDateStr: string;
  daysUntilDue: number;
  isOverdue: boolean;
  isDueSoon: boolean; // within 7 days
  period: string;
}

/** Previous calendar month bounds — the period most returns are filed for. */
function previousMonthBounds(): { start: string; end: string; label: string } {
  const [y, m] = todayIso().split('-').map(Number);
  const prevStart = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  return {
    start: prevStart,
    end: lastDayOfMonth(prevStart),
    label: prevStart.slice(0, 7),
  };
}

/**
 * Statutory due dates for the current filing cycle, derived from the
 * jurisdiction rules rather than hardcoded.
 *
 * The previous implementation hardcoded "PAYE and WHT on the 14th, VAT on
 * the 25th" and contradicted TaxReturnRepository, which used a different
 * PAYE rule again. Both now resolve through taxRules.ts.
 */
export function getTaxDueDates(country?: string | null): TaxDueDate[] {
  const jurisdiction = resolveJurisdiction(country);
  const rules = getJurisdictionRules(jurisdiction);
  const { end, label } = previousMonthBounds();
  const periodLabel = formatPeriodLabel(label);

  const kinds: TaxKind[] = ['vat', 'paye', 'pension'];
  return kinds
    .map((kind) => {
      const rule = rules.taxes.find((t) => t.taxKind === kind);
      if (!rule) return null;
      const due = dueDateFor(jurisdiction, kind, end);
      const days = daysUntilDue(due);
      const [dy, dm, dd] = due.split('-').map(Number);
      return {
        taxType: rule.label,
        dueDate: new Date(Date.UTC(dy, dm - 1, dd)),
        dueDateStr: formatDueDate(due),
        daysUntilDue: days,
        isOverdue: days < 0,
        isDueSoon: days >= 0 && days <= 7,
        period: periodLabel,
      } as TaxDueDate;
    })
    .filter((d): d is TaxDueDate => d !== null)
    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

/** Backwards-compatible alias. Malawi remains the default jurisdiction. */
export function getMraDueDates(): TaxDueDate[] {
  return getTaxDueDates('MW');
}

/** Due dates for the currently selected business's jurisdiction. */
export function useTaxDueDates(): TaxDueDate[] {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  return getTaxDueDates(currentBusiness?.business?.country);
}

// ── VAT summary ───────────────────────────────────────────────────────────────

export interface VatSummary {
  outputVat: number;
  inputVat: number;
  vatPayable: number;
  period: string;
}

/**
 * VAT position for the previous month.
 *
 * Now delegates to TaxReturnRepository.computeVatBreakdown() so the dashboard
 * figure matches the generated return exactly. The old implementation summed
 * invoices.vat_amount and expenses.vat_amount directly, which included quotes
 * and proformas and so disagreed with the VAT return for the same period.
 */
export function useVatSummary(businessId?: string) {
  const { start, end, label } = previousMonthBounds();
  const period = formatPeriodLabel(label);

  return useQuery({
    queryKey: ['vat', 'summary', businessId, start, end],
    queryFn: async () => {
      const b = await repos.taxReturn.computeVatBreakdown(businessId!, start, end);
      return {
        outputVat: b.outputTax,
        inputVat: b.inputTax,
        vatPayable: b.outputTax - b.inputTax,
        period,
      } as VatSummary;
    },
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
  });
}

// ── PAYE summary ──────────────────────────────────────────────────────────────

export interface PayeSummary {
  totalPaye: number;
  period: string;
}

export function usePayeSummary(businessId?: string) {
  const { start, end, label } = previousMonthBounds();
  const period = formatPeriodLabel(label);

  return useQuery({
    queryKey: ['paye', 'summary', businessId, start, end],
    queryFn: async () => {
      const runs = await repos.payroll.findByBusiness(businessId!);
      const lastMonthRuns = runs.filter((r) => r.pay_date >= start && r.pay_date <= end);
      const totalPaye = lastMonthRuns.reduce((sum, r) => sum + Number(r.total_paye), 0);
      return { totalPaye, period } as PayeSummary;
    },
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 10,
  });
}
