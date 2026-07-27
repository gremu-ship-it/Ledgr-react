import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { useMemo } from 'react';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import type { Row } from '@/dal/types/database';
import { daysUntilDue, formatDueDate, formatPeriodLabel } from '@/lib/taxDates';
import {
  getJurisdictionRules,
  getTaxRule,
  resolveJurisdiction,
  type Jurisdiction,
  type TaxKind,
} from '@/lib/taxRules';

export type UrgencyLevel = 'overdue' | 'critical' | 'soon' | 'upcoming' | 'settled';

export interface TaxObligation {
  taxReturn: Row<'tax_returns'>;
  /** Display name, e.g. 'VAT' or 'PAYE'. */
  label: string;
  shortLabel: string;
  formName?: string;
  authority: string;
  /** Statutory reference, e.g. 'VAT Act'. */
  reference?: string;
  periodDisplay: string;
  dueDateDisplay: string;
  daysRemaining: number;
  outstanding: number;
  /** True when input tax exceeded output tax — a refund rather than a bill. */
  isCredit: boolean;
  urgency: UrgencyLevel;
  isPaid: boolean;
  isFiled: boolean;
}

/** Map a tax_code to the taxKind used by the jurisdiction rules. */
function taxKindFor(taxCode: string): TaxKind {
  if (taxCode === 'vat_standard' || taxCode.startsWith('vat')) return 'vat';
  if (taxCode === 'paye') return 'paye';
  if (taxCode === 'tpr_pension') return 'pension';
  return 'wht';
}

/**
 * Urgency drives the colour treatment. The spec calls for red inside 7 days;
 * 'critical' covers 0–7 and 'overdue' covers anything past due.
 */
function urgencyFor(daysRemaining: number, status: string): UrgencyLevel {
  if (status === 'paid' || status === 'void') return 'settled';
  if (daysRemaining < 0) return 'overdue';
  if (daysRemaining <= 7) return 'critical';
  if (daysRemaining <= 14) return 'soon';
  return 'upcoming';
}

export function useBusinessJurisdiction(): Jurisdiction {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  return resolveJurisdiction(currentBusiness?.business?.country);
}

function toObligation(tr: Row<'tax_returns'>, jurisdiction: Jurisdiction): TaxObligation {
  const kind = taxKindFor(tr.tax_code);
  const rule = getTaxRule(jurisdiction, kind);
  const rules = getJurisdictionRules(jurisdiction);
  const days = daysUntilDue(tr.due_date);
  const amountDue = Number(tr.amount_due);
  const isCredit = amountDue < 0;

  return {
    taxReturn: tr,
    label: rule?.label ?? tr.tax_code,
    shortLabel: rule?.shortLabel ?? tr.tax_code.toUpperCase(),
    formName: rule?.formName,
    authority: rule?.authority ?? rules.authority,
    reference: rule?.reference,
    periodDisplay: formatPeriodLabel(tr.period_label),
    dueDateDisplay: formatDueDate(tr.due_date),
    daysRemaining: days,
    outstanding: Math.max(amountDue - Number(tr.amount_paid), 0),
    isCredit,
    urgency: urgencyFor(days, tr.status),
    isPaid: tr.status === 'paid',
    isFiled: Boolean(tr.filed_at),
  };
}

/**
 * Open tax obligations — the "amount owed / due date / days remaining /
 * payment status" dashboard feed.
 *
 * Marks anything past due as overdue first, so the status shown is accurate
 * even when the nightly cron job isn't enabled.
 */
export function useTaxObligations(businessId?: string) {
  const jurisdiction = useBusinessJurisdiction();

  const query = useQuery({
    queryKey: ['tax_returns', 'open', businessId],
    queryFn: async () => {
      await repos.taxReturn.markOverdueReturns(businessId!).catch(() => 0);
      return repos.taxReturn.findOpenByBusiness(businessId!);
    },
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 2,
  });

  const obligations = useMemo(
    () => (query.data ?? []).map((tr) => toObligation(tr, jurisdiction)),
    [query.data, jurisdiction],
  );

  const summary = useMemo(() => {
    const totalOwed = obligations
      .filter((o) => !o.isCredit)
      .reduce((sum, o) => sum + o.outstanding, 0);
    const totalCredit = obligations
      .filter((o) => o.isCredit)
      .reduce((sum, o) => sum + Math.abs(Number(o.taxReturn.amount_due)), 0);
    return {
      totalOwed,
      totalCredit,
      overdueCount: obligations.filter((o) => o.urgency === 'overdue').length,
      criticalCount: obligations.filter((o) => o.urgency === 'critical').length,
      nextDue: obligations.find((o) => o.daysRemaining >= 0) ?? null,
    };
  }, [obligations]);

  return { ...query, obligations, summary, jurisdiction };
}

/** Filing history — paid and voided returns. */
export function useTaxFilingHistory(businessId?: string) {
  const jurisdiction = useBusinessJurisdiction();

  const query = useQuery({
    queryKey: ['tax_returns', 'history', businessId],
    queryFn: () => repos.taxReturn.findHistoryByBusiness(businessId!),
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
  });

  const history = useMemo(
    () => (query.data ?? []).map((tr) => toObligation(tr, jurisdiction)),
    [query.data, jurisdiction],
  );

  return { ...query, history };
}

/** Payments recorded against a single return. */
export function useTaxPayments(taxReturnId?: string) {
  return useQuery({
    queryKey: ['tax_payments', taxReturnId],
    queryFn: () => repos.taxPayment.findByTaxReturn(taxReturnId!),
    enabled: Boolean(taxReturnId),
  });
}

/** Bank accounts available to settle a tax liability from. */
export function useBankAccounts(businessId?: string) {
  return useQuery({
    queryKey: ['accounts', 'bank', businessId],
    queryFn: async () => {
      const { data, error } = await repos.account.db
        .from('accounts')
        .select('id, code, name')
        .eq('business_id', businessId!)
        .eq('is_bank_account', true)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('code');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
    enabled: Boolean(businessId),
  });
}

/** Generate a VAT return for a given 'YYYY-MM' period. */
export function useGenerateVatReturn(businessId?: string) {
  const queryClient = useQueryClient();
  const jurisdiction = useBusinessJurisdiction();

  return useMutation({
    mutationFn: async (periodLabel: string) => {
      const start = `${periodLabel}-01`;
      const [y, m] = periodLabel.split('-').map(Number);
      const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      return repos.taxReturn.generateVatReturn(businessId!, start, end, jurisdiction);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax_returns'] });
    },
  });
}
