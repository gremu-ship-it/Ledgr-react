import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Plus, DollarSign, Receipt, Users, FileText } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import {
  useMonthlyIncome,
  useMonthlyExpenses,
  useMonthlyExpenseVat,
  useOutstandingInvoices,
  useIncomeExpenseTrend,
  useRecentJournalEntries,
  useMonthlyProfitLossReport,
} from '@/hooks/useDashboardData';
import { IncomeExpenseChart } from '@/components/dashboard/IncomeExpenseChart';
import { RecentTransactions } from '@/components/dashboard/RecentTransactions';
import { CashFlowIndicator } from '@/components/dashboard/CashFlowIndicator';
import { TaxRemittancePanel } from '@/components/dashboard/TaxRemittancePanel';
import { TaxReminderModal } from '@/components/dashboard/TaxReminderModal';
import { formatMwk, formatMwkCompact } from '@/lib/formatters';
import { useIsMobile } from '@/hooks/useIsMobile';
import { MobileDashboard } from '@/components/mobile/MobileDashboard';
import { UsageMeter } from '@/components/billing/UsageMeter';
import { UpgradeModal } from '@/components/billing/UpgradeModal';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';
import { useState } from 'react';

interface KpiCardProps {
  label: string;
  value: string;
  valueTitle?: string;
  sub?: string;
  trendUp?: boolean;
  featured?: boolean;
  isLoading?: boolean;
  isError?: boolean;
}

function KpiCard({ label, value, valueTitle, sub, trendUp = true, featured = false, isLoading, isError }: KpiCardProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  if (isLoading) {
    return (
      <div className="animate-pulse rounded-2xl border border-gray-200 bg-white p-5">
        <div className="mb-4 h-3 w-24 rounded bg-gray-100" />
        <div className="mb-2 h-7 w-32 rounded bg-gray-100" />
        <div className="h-3 w-20 rounded bg-gray-100" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-red-100 bg-red-50 p-5">
        <p className="text-xs text-red-700">{t('dashboard.failedToLoad')}</p>
      </div>
    );
  }

  const full = valueTitle ?? value;
  const handleCopy = () => {
    navigator.clipboard?.writeText(full).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  if (featured) {
    return (
      <button
        onClick={handleCopy}
        title={full}
        className="group relative w-full overflow-hidden rounded-2xl p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
        style={{ background: 'linear-gradient(135deg, #065c42, #0a7c5a)' }}
      >
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-white/70">{label}</p>
        <p className="mb-2 truncate font-extrabold text-white" style={{ fontSize: 'clamp(1.25rem, 2.5vw, 1.6rem)' }}>
          {value}
        </p>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${trendUp ? 'bg-white/20 text-white' : 'bg-red-400/30 text-white'}`}>
            {trendUp ? '▲' : '▼'} {trendUp ? t('dashboard.profitable') : t('dashboard.loss')}
          </span>
          {sub && <span className="text-xs text-white/80">{sub}</span>}
        </div>
        {copied && <span className="absolute right-3 top-3 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold text-white">Copied!</span>}
      </button>
    );
  }

  return (
    <button
      onClick={handleCopy}
      title={full}
      className="group w-full rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md active:scale-[0.98]"
    >
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mb-1 font-extrabold leading-tight text-gray-900" style={{ fontSize: 'clamp(1.1rem, 2vw, 1.35rem)' }}>
        {value}
      </p>
      {sub && <p className="line-clamp-2 text-xs text-gray-600">{sub}</p>}
      {copied && <p className="mt-2 text-[10px] font-bold text-brand-600">Copied!</p>}
    </button>
  );
}

function QuickActions() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const actions = [
    { label: t('dashboard.newInvoice'), icon: Plus, onClick: () => navigate('/income?action=invoice'), variant: 'primary' as const },
    { label: t('dashboard.recordIncome'), icon: DollarSign, onClick: () => navigate('/income?action=record'), variant: 'secondary' as const },
    { label: t('dashboard.recordExpense'), icon: Receipt, onClick: () => navigate('/expenses?action=record'), variant: 'secondary' as const },
    { label: t('dashboard.runPayroll'), icon: Users, onClick: () => navigate('/payroll?action=run'), variant: 'secondary' as const },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {actions.map((action, idx) => {
        const Icon = action.icon;
        return (
          <button
            key={idx}
            onClick={action.onClick}
            className={`flex items-center gap-2 rounded-xl px-3 py-2.5 sm:px-4 sm:py-2.5 text-sm font-semibold shadow-sm transition-all active:scale-95 touch-manipulation ${
              action.variant === 'primary' 
                ? 'bg-brand-500 hover:bg-brand-600 text-white' 
                : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-200'
            }`}
          >
            <Icon className="h-4 w-4" />
            {action.label}
          </button>
        );
      })}
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business.id;
  const businessName = currentBusiness?.business.name;
  const isMobile = useIsMobile();

  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const income = useMonthlyIncome(businessId);
  const expenses = useMonthlyExpenses(businessId);
  const expenseVat = useMonthlyExpenseVat(businessId);
  const outstanding = useOutstandingInvoices(businessId);
  const trend = useIncomeExpenseTrend(businessId, 6);
  const recentEntries = useRecentJournalEntries(businessId, 10);
  const plReport = useMonthlyProfitLossReport(businessId);

  // Reconciled P&L values
  const netProfit = plReport.data?.netProfit;
  const totalIncomeValue = plReport.data ? (plReport.data.totalRevenue + plReport.data.totalOtherIncome) : undefined;
  const totalExpensesValue = plReport.data ? (
    plReport.data.totalCostOfSales +
    plReport.data.totalOperatingExpenses +
    plReport.data.totalDepreciationAmortisation +
    plReport.data.totalFinanceCosts +
    plReport.data.totalTaxExpense
  ) : undefined;

  const netIsLoading = plReport.isLoading;
  const netIsError = plReport.isError;

  const outputVat = income.data?.vatAmount ?? 0;
  const inputVat = expenseVat.data ?? 0;
  const netVat = outputVat - inputVat;
  const vatIsLoading = income.isLoading || expenseVat.isLoading;
  const vatIsError = income.isError || expenseVat.isError;

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
          <AlertCircle className="h-7 w-7 text-brand-500" />
        </div>
        <h1 className="text-lg font-semibold text-gray-900">{t('dashboard.noBusinessSelected')}</h1>
        <p className="max-w-sm text-sm text-gray-500">{t('dashboard.noBusinessBody')}</p>
      </div>
    );
  }

  if (isMobile) return <MobileDashboard />;

  return (
    <div className="space-y-6">
      <TaxReminderModal />
      <TaxRemittancePanel businessId={businessId} />
      <UsageMeter />

      {/* Onboarding progress checklist (spec #5) */}
      <OnboardingChecklist />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">{t('dashboard.financialOverview')}</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {businessName ? t('dashboard.realtimeInsightsFor', { business: businessName }) : t('dashboard.realtimeInsights')} · MWK
          </p>
        </div>
        <QuickActions />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label={t('dashboard.netProfit')}
          value={netProfit !== undefined ? formatMwkCompact(netProfit) : formatMwkCompact(0)}
          valueTitle={netProfit !== undefined ? formatMwk(netProfit) : formatMwk(0)}
          sub={t('dashboard.thisMonth')}
          trendUp={netProfit === undefined || netProfit >= 0}
          featured
          isLoading={netIsLoading}
          isError={netIsError}
        />
        <KpiCard
          label={t('dashboard.totalIncome')}
          value={totalIncomeValue !== undefined ? formatMwkCompact(totalIncomeValue) : formatMwkCompact(0)}
          valueTitle={totalIncomeValue !== undefined ? formatMwk(totalIncomeValue) : formatMwk(0)}
          sub={income.data ? t('dashboard.collected', { amount: formatMwk(income.data.amountPaid) }) : undefined}
          trendUp
          isLoading={plReport.isLoading || income.isLoading}
          isError={plReport.isError || income.isError}
        />
        <KpiCard
          label={t('dashboard.totalExpenses')}
          value={totalExpensesValue !== undefined ? formatMwkCompact(totalExpensesValue) : formatMwkCompact(0)}
          valueTitle={totalExpensesValue !== undefined ? formatMwk(totalExpensesValue) : formatMwk(0)}
          sub={t('dashboard.thisMonth')}
          trendUp={false}
          isLoading={plReport.isLoading}
          isError={plReport.isError}
        />
        <KpiCard
          label={t('dashboard.accountsReceivable')}
          value={outstanding.data ? formatMwkCompact(outstanding.data.total) : formatMwkCompact(0)}
          valueTitle={outstanding.data ? formatMwk(outstanding.data.total) : formatMwk(0)}
          sub={outstanding.data ? t('dashboard.unpaidInvoices', { count: outstanding.data.count }) : t('dashboard.invoices', { count: 0 })}
          trendUp={false}
          isLoading={outstanding.isLoading}
          isError={outstanding.isError}
        />
        <KpiCard
          label={t('dashboard.vatAccrued')}
          value={formatMwkCompact(Math.abs(netVat))}
          valueTitle={formatMwk(Math.abs(netVat))}
          sub={netVat >= 0 ? t('dashboard.payableToMra') : t('dashboard.refundableVat')}
          trendUp={netVat >= 0}
          isLoading={vatIsLoading}
          isError={vatIsError}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionErrorBoundary sectionName="Income/Expense Chart">
          <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-900">{t('dashboard.incomeVsExpenses')}</h2>
                <p className="text-xs text-gray-600">{t('dashboard.monthlyCashFlow')}</p>
              </div>
            </div>
            <IncomeExpenseChart data={trend.data} isLoading={trend.isLoading} isError={trend.isError} />
          </div>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Cash Flow Indicator">
          <div className="flex flex-col gap-4">
            <CashFlowIndicator income={income.data?.totalAmount} expenses={expenses.data} isLoading={income.isLoading || expenses.isLoading} isError={income.isError || expenses.isError} />
          </div>
        </SectionErrorBoundary>
      </div>

      <SectionErrorBoundary sectionName="Recent Transactions">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-gray-900">{t('dashboard.recentTransactions')}</h2>
              <p className="mt-0.5 text-xs text-gray-600">{t('dashboard.lastJournalEntries')}</p>
            </div>
            <FileText className="h-4 w-4 text-gray-300" />
          </div>
          <RecentTransactions entries={recentEntries.data} isLoading={recentEntries.isLoading} isError={recentEntries.isError} />
        </div>
      </SectionErrorBoundary>

      <UpgradeModal isOpen={showUpgradeModal} onClose={() => setShowUpgradeModal(false)} onUpgrade={() => { setShowUpgradeModal(false); navigate('/settings?tab=billing'); }} />
    </div>
  );
}
