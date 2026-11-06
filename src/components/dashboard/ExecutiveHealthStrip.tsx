import { useQuery } from '@tanstack/react-query';
import { Banknote, FileText, ReceiptText, Users, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { FinancialStatementRepository } from '@/dal/repositories/FinancialStatementRepository';
import { repos } from '@/lib/repositories';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { useOutstandingInvoices } from '@/hooks/useDashboardData';

const financialStatements = new FinancialStatementRepository(supabase);

function localDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatCompactCurrency(value: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return `${currency} ${new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`;
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
  loading,
  failed,
  metricFallback,
}: {
  label: string;
  value: string;
  detail: string;
  href: string;
  icon: LucideIcon;
  loading: boolean;
  failed: boolean;
  metricFallback: string;
}) {
  const { t } = useTranslation();
  return (
    <Link
      to={href}
      aria-label={t('dashboard.executiveHealth.openMetric', { metric: label })}
      className="group flex min-w-0 items-center gap-2.5 rounded-xl border border-gray-200 bg-white px-3 py-2.5 shadow-sm transition hover:border-brand-300 hover:shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:px-4"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[10px] font-bold uppercase tracking-wide text-gray-500 sm:text-[11px]">{label}</span>
        <span className="mt-0.5 block truncate text-sm font-extrabold leading-tight text-gray-900 sm:text-base" title={failed ? metricFallback : value}>
          {loading ? t('dashboard.executiveHealth.loading') : failed ? metricFallback : value}
        </span>
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
  const locale = i18n.language || undefined;

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

  const payableTotal = (payablesQuery.data ?? []).reduce(
    (sum, expense) => sum + expenseBalanceBase(expense, currency),
    0,
  );
  const payableCount = (payablesQuery.data ?? []).filter((expense) => expenseBalanceBase(expense, currency) > 0.005).length;
  const nextPayroll = payrollQuery.data ?? null;
  const payrollValue = nextPayroll
    ? formatCompactCurrency(Number(nextPayroll.total_net), currency, locale ?? 'en')
    : formatCompactCurrency(0, currency, locale ?? 'en');

  const noBusiness = !businessId;
  const emptyLabel = noBusiness ? t('dashboard.executiveHealth.noBusiness') : '—';

  return (
    <section aria-label={t('dashboard.executiveHealth.title')} className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3" data-testid="executive-health-strip">
      <MetricLink
        label={t('dashboard.executiveHealth.cashBalance')}
        value={formatCompactCurrency(Number(cashQuery.data ?? 0), currency, locale ?? 'en')}
        detail={t('dashboard.executiveHealth.cashAsOf', { date: dateLabel(asOfDate, locale ?? 'en') })}
        href="/reports/cash-flow"
        icon={Banknote}
        loading={!noBusiness && cashQuery.isLoading}
        failed={Boolean(!noBusiness && cashQuery.isError)}
        metricFallback={noBusiness ? emptyLabel : t('dashboard.executiveHealth.unavailable')}
      />
      <MetricLink
        label={t('dashboard.executiveHealth.accountsReceivable')}
        value={formatCompactCurrency(Number(receivablesQuery.data?.total ?? 0), currency, locale ?? 'en')}
        detail={t('dashboard.executiveHealth.openInvoices', { count: receivablesQuery.data?.count ?? 0 })}
        href="/invoices"
        icon={FileText}
        loading={!noBusiness && receivablesQuery.isLoading}
        failed={Boolean(!noBusiness && receivablesQuery.isError)}
        metricFallback={noBusiness ? emptyLabel : t('dashboard.executiveHealth.unavailable')}
      />
      <MetricLink
        label={t('dashboard.executiveHealth.accountsPayable')}
        value={formatCompactCurrency(payableTotal, currency, locale ?? 'en')}
        detail={t('dashboard.executiveHealth.unpaidExpenses', { count: payableCount })}
        href="/expenses"
        icon={ReceiptText}
        loading={!noBusiness && payablesQuery.isLoading}
        failed={Boolean(!noBusiness && payablesQuery.isError)}
        metricFallback={noBusiness ? emptyLabel : t('dashboard.executiveHealth.unavailable')}
      />
      <MetricLink
        label={t('dashboard.executiveHealth.nextPayroll')}
        value={payrollValue}
        detail={nextPayroll
          ? t('dashboard.executiveHealth.payDate', { date: dateLabel(nextPayroll.pay_date, locale ?? 'en') })
          : t('dashboard.executiveHealth.noUpcomingPayroll')}
        href="/payroll"
        icon={Users}
        loading={!noBusiness && payrollQuery.isLoading}
        failed={Boolean(!noBusiness && payrollQuery.isError)}
        metricFallback={noBusiness ? emptyLabel : t('dashboard.executiveHealth.unavailable')}
      />
    </section>
  );
}
