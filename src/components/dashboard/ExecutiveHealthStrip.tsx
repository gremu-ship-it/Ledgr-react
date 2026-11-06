import { useQuery } from '@tanstack/react-query';
import { Banknote, FileText, ReceiptText, Users, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { FinancialStatementRepository } from '@/dal/repositories/FinancialStatementRepository';
import { repos } from '@/lib/repositories';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { useOutstandingInvoices } from '@/hooks/useDashboardData';
import { Skeleton } from '@/components/ui/Skeleton';

const financialStatements = new FinancialStatementRepository(supabase);

function localDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatCurrency(value: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${Number(value).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

function dateLabel(date: string, locale: string): string {
  const value = new Date(`${date.slice(0, 10)}T00:00:00`);
  return Number.isNaN(value.getTime())
    ? date
    : value.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

function expenseBalanceBase(expense: {
  total_amount: number;
  amount_paid: number;
  functional_amount: number | null;
  functional_currency: string | null;
  exchange_rate: number;
}, baseCurrency: string): number {
  const paidBase = Number(expense.amount_paid) * Number(expense.exchange_rate || 1);
  const grossBase = expense.functional_amount != null && expense.functional_currency === baseCurrency
    ? Number(expense.functional_amount)
    : Number(expense.total_amount) * Number(expense.exchange_rate || 1);
  return Math.max(0, grossBase - paidBase);
}

function MetricLink({
  label,
  value,
  detail,
  href,
  icon: Icon,
}: {
  label: string;
  value: string;
  detail: string;
  href: string;
  icon: LucideIcon;
}) {
  const { t } = useTranslation();
  return (
    <Link
      to={href}
      aria-label={t('dashboard.executiveHealth.openMetric', { metric: label })}
      className="group flex min-h-20 min-w-0 items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-3 py-3 shadow-sm transition hover:border-brand-300 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:px-4"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[10px] font-bold uppercase tracking-wide text-gray-500 sm:text-[11px]">{label}</span>
        <span className="mt-0.5 block truncate text-sm font-extrabold leading-tight text-gray-900 sm:text-base" title={value}>{value}</span>
        <span className="block truncate text-[10px] leading-tight text-gray-500 sm:text-xs">{detail}</span>
      </span>
    </Link>
  );
}

export function ExecutiveHealthStrip() {
  const { t, i18n } = useTranslation();
  const business = useAppStore((state) => state.currentBusiness?.business);
  const businessId = business?.id;
  const currency = business?.base_currency ?? 'MWK';
  const asOfDate = localDate();
  const locale = i18n.language || 'en';

  const cashQuery = useQuery({
    queryKey: ['dashboard', 'executive-health', 'cash', businessId, asOfDate],
    queryFn: () => financialStatements.getBankCashPosition(businessId!, asOfDate),
    enabled: Boolean(businessId),
    staleTime: 5 * 60 * 1000,
  });
  const receivablesQuery = useOutstandingInvoices(businessId);
  const payablesQuery = useQuery({
    queryKey: ['expenses', 'outstanding', businessId],
    queryFn: () => repos.expense.findOutstanding(businessId!),
    enabled: Boolean(businessId),
    staleTime: 5 * 60 * 1000,
  });
  const payrollQuery = useQuery({
    queryKey: ['payroll', 'next-commitment', businessId, asOfDate],
    queryFn: () => repos.payroll.findNextApproved(businessId!, asOfDate),
    enabled: Boolean(businessId),
    staleTime: 5 * 60 * 1000,
  });

  const loading = Boolean(businessId && [
    cashQuery.isLoading || cashQuery.isPending,
    receivablesQuery.isLoading || receivablesQuery.isPending,
    payablesQuery.isLoading || payablesQuery.isPending,
    payrollQuery.isLoading || payrollQuery.isPending,
  ].some(Boolean));
  const payableRows = payablesQuery.data ?? [];
  const payableTotal = payableRows.reduce((sum, expense) => sum + expenseBalanceBase(expense, currency), 0);
  const payableCount = payableRows.filter((expense) => expenseBalanceBase(expense, currency) > 0.005).length;
  const nextPayroll = payrollQuery.data ?? null;

  return (
    <section
      aria-label={t('dashboard.executiveHealth.title')}
      className="rounded-xl border border-brand-200 bg-white p-4 shadow-sm sm:p-5"
      data-testid="executive-health-strip"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-extrabold tracking-tight text-gray-900 sm:text-xl">
          {t('dashboard.executiveHealth.title')}
        </h2>
        <span className="shrink-0 rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700">
          {t('dashboard.executiveHealth.liveSummary')}
        </span>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t('dashboard.executiveHealth.loading')}>
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-20 w-full" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricLink
            label={t('dashboard.executiveHealth.cashBalance')}
            value={formatCurrency(Number(cashQuery.data ?? 0), currency, locale)}
            detail={t('dashboard.executiveHealth.cashAsOf', { date: dateLabel(asOfDate, locale) })}
            href="/reports/cash-flow"
            icon={Banknote}
          />
          <MetricLink
            label={t('dashboard.executiveHealth.accountsReceivable')}
            value={formatCurrency(Number(receivablesQuery.data?.total ?? 0), currency, locale)}
            detail={t('dashboard.executiveHealth.openInvoices', { count: receivablesQuery.data?.count ?? 0 })}
            href="/invoices"
            icon={FileText}
          />
          <MetricLink
            label={t('dashboard.executiveHealth.accountsPayable')}
            value={formatCurrency(payableTotal, currency, locale)}
            detail={t('dashboard.executiveHealth.unpaidExpenses', { count: payableCount })}
            href="/expenses"
            icon={ReceiptText}
          />
          <MetricLink
            label={t('dashboard.executiveHealth.nextPayroll')}
            value={formatCurrency(Number(nextPayroll?.total_net ?? 0), currency, locale)}
            detail={nextPayroll
              ? t('dashboard.executiveHealth.payDate', { date: dateLabel(nextPayroll.pay_date, locale) })
              : t('dashboard.executiveHealth.noUpcomingPayroll')}
            href="/payroll"
            icon={Users}
          />
        </div>
      )}
    </section>
  );
}
