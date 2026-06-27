import { useQuery } from '@tanstack/react-query';
import { repos } from '@/lib/repositories';

// ── MRA Due Date Calculator ───────────────────────────────────────────────────

export interface TaxDueDate {
  taxType: string;
  dueDate: Date;
  dueDateStr: string;
  daysUntilDue: number;
  isOverdue: boolean;
  isDueSoon: boolean; // within 7 days
  period: string;     // e.g. "June 2026"
}

function getDaysUntil(date: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-MW', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Calculate MRA tax due dates for the current month.
 * Based on official MRA Malawi schedule:
 * - PAYE:  14th of each month (for previous month)
 * - WHT:   14th of each month (for previous month)
 * - VAT:   25th of each month (for previous month)
 * - TEVET: 1st April annually
 */
export function getMraDueDates(): TaxDueDate[] {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed

  // Previous month label (what we're paying for)
  const prevMonth = new Date(year, month - 1, 1);
  const prevMonthLabel = prevMonth.toLocaleDateString('en-MW', {
    month: 'long',
    year: 'numeric',
  });

  const dueDates: TaxDueDate[] = [];

  // PAYE — 14th of current month (for previous month's payroll)
  const payeDue = new Date(year, month, 14);
  const payeDays = getDaysUntil(payeDue);
  dueDates.push({
    taxType: 'PAYE',
    dueDate: payeDue,
    dueDateStr: formatDate(payeDue),
    daysUntilDue: payeDays,
    isOverdue: payeDays < 0,
    isDueSoon: payeDays >= 0 && payeDays <= 7,
    period: prevMonthLabel,
  });

  // WHT — 14th of current month
  const whtDue = new Date(year, month, 14);
  const whtDays = getDaysUntil(whtDue);
  dueDates.push({
    taxType: 'Withholding Tax (WHT)',
    dueDate: whtDue,
    dueDateStr: formatDate(whtDue),
    daysUntilDue: whtDays,
    isOverdue: whtDays < 0,
    isDueSoon: whtDays >= 0 && whtDays <= 7,
    period: prevMonthLabel,
  });

  // VAT — 25th of current month
  const vatDue = new Date(year, month, 25);
  const vatDays = getDaysUntil(vatDue);
  dueDates.push({
    taxType: 'VAT Return',
    dueDate: vatDue,
    dueDateStr: formatDate(vatDue),
    daysUntilDue: vatDays,
    isOverdue: vatDays < 0,
    isDueSoon: vatDays >= 0 && vatDays <= 7,
    period: prevMonthLabel,
  });

  // TEVET Levy — 1st April annually
  const tevetYear = month >= 3 ? year + 1 : year; // if past April, next year
  const tevetDue = new Date(tevetYear, 3, 1); // April 1st
  const tevetDays = getDaysUntil(tevetDue);
  dueDates.push({
    taxType: 'TEVET Levy',
    dueDate: tevetDue,
    dueDateStr: formatDate(tevetDue),
    daysUntilDue: tevetDays,
    isOverdue: tevetDays < 0,
    isDueSoon: tevetDays >= 0 && tevetDays <= 30, // 30 days for annual
    period: `${tevetYear}/${String(tevetYear + 1).slice(2)}`,
  });

  return dueDates.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

// ── VAT Summary Hook ──────────────────────────────────────────────────────────

export interface VatSummary {
  outputVat: number;   // VAT collected on sales (owed to MRA)
  inputVat: number;    // VAT paid on expenses (claimable from MRA)
  vatPayable: number;  // outputVat - inputVat (positive = pay MRA, negative = MRA owes you)
  period: string;
}

export function useVatSummary(businessId?: string) {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    .toISOString().slice(0, 10);
  const to = new Date(now.getFullYear(), now.getMonth(), 0)
    .toISOString().slice(0, 10);

  const period = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    .toLocaleDateString('en-MW', { month: 'long', year: 'numeric' });

  return useQuery({
    queryKey: ['vat', 'summary', businessId, from, to],
    queryFn: async () => {
      const [incomeTotals, expenseRows] = await Promise.all([
        repos.income.getTotals(businessId!, from, to),
        repos.expense.findByDateRange(businessId!, from, to),
      ]);

      const outputVat = incomeTotals.vatAmount;
      const inputVat = expenseRows
        .filter((r) => r.status !== 'void')
        .reduce((sum, r) => sum + Number(r.vat_amount), 0);
      const vatPayable = outputVat - inputVat;

      return { outputVat, inputVat, vatPayable, period } as VatSummary;
    },
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 5,
  });
}

// ── PAYE Summary Hook ─────────────────────────────────────────────────────────

export interface PayeSummary {
  totalPaye: number;
  period: string;
}

export function usePayeSummary(businessId?: string) {
  const now = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const period = prevMonth.toLocaleDateString('en-MW', {
    month: 'long', year: 'numeric',
  });

  return useQuery({
    queryKey: ['paye', 'summary', businessId],
    queryFn: async () => {
      const runs = await repos.payroll.findByBusiness(businessId!);
      // Sum PAYE from last month's payroll runs
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
      const to = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);

      const lastMonthRuns = runs.filter((r) => {
        const payDate = r.pay_date;
        return payDate >= from && payDate <= to;
      });

      const totalPaye = lastMonthRuns.reduce(
        (sum, r) => sum + Number(r.total_paye), 0,
      );

      return { totalPaye, period } as PayeSummary;
    },
    enabled: Boolean(businessId),
    staleTime: 1000 * 60 * 10,
  });
}