import { Link, useNavigate } from 'react-router';
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
  getDashboardPeriod,
} from '@/hooks/useDashboardData';
import { IncomeExpenseChart } from '@/components/dashboard/IncomeExpenseChart';
import { RecentTransactions } from '@/components/dashboard/RecentTransactions';
import { CashFlowIndicator } from '@/components/dashboard/CashFlowIndicator';
import { TaxRemittancePanel } from '@/components/dashboard/TaxRemittancePanel';
import { TaxReminderModal } from '@/components/dashboard/TaxReminderModal';
import { formatCurrency, formatCurrencyCompact, formatDateRange } from '@/lib/formatters';
import { useIsMobile } from '@/hooks/useIsMobile';
import { MobileDashboard } from '@/components/mobile/MobileDashboard';
import { UsageMeter } from '@/components/billing/UsageMeter';
import { UpgradeModal } from '@/components/billing/UpgradeModal';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { OnboardingChecklist } from '@/components/OnboardingChecklist';
import { useState } from 'react';
import { useCapability } from '@/hooks/useCapability';
import { ConstructionDashboard } from '@/components/construction/dashboard/ConstructionDashboard';
import { ExecutiveHealthStrip } from '@/components/dashboard/ExecutiveHealthStrip';
import { ActionableExceptions } from '@/components/dashboard/ActionableExceptions';
import { ManufacturingDashboardPage } from '@/pages/manufacturing/ManufacturingDashboardPage';
import { DashboardVerticalModules } from '@/components/dashboard/DashboardVerticalModules';
import { DashboardFreshnessToolbar } from '@/components/dashboard/DashboardFreshnessToolbar';

interface KpiCardProps {
  label: string;
  value: string;
  to: string;
  valueTitle?: string;
  sub?: string;
  trendUp?: boolean;
  featured?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  metadata: string;
}

function KpiCard({ label, value, to, valueTitle, sub, metadata, trendUp = true, featured = false, isLoading, isError }: KpiCardProps) {
  const { t } = useTranslation();

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
  const className = featured
    ? 'group relative block w-full overflow-hidden rounded-2xl p-5 text-left transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.98]'
    : 'group block w-full rounded-2xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:scale-[0.98]';

  return (
    <Link
      to={to}
      title={full}
      className={className}
      style={featured ? { background: 'linear-gradient(135deg, #065c42, #0a7c5a)' } : undefined}
    >
      <p className={`mb-2 text-xs font-bold uppercase tracking-wider ${featured ? 'text-white/70' : 'text-gray-400'}`}>{label}</p>
      <p className={`mb-1 truncate font-extrabold leading-tight ${featured ? 'text-white' : 'text-gray-900'}`} style={{ fontSize: featured ? 'clamp(1.25rem, 2.5vw, 1.6rem)' : 'clamp(1.1rem, 2vw, 1.35rem)' }}>
        {value}
      </p>
      <p className={`mb-2 text-[10px] font-medium ${featured ? 'text-white/75' : 'text-gray-500'}`}>{metadata}</p>
      {featured ? (
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${trendUp ? 'bg-white/20 text-white' : 'bg-red-400/30 text-white'}`}>
            {trendUp ? '▲' : '▼'} {trendUp ? t('dashboard.profitable') : t('dashboard.loss')}
          </span>
          {sub && <span className="text-xs text-white/80">{sub}</span>}
        </div>
      ) : sub ? <p className="line-clamp-2 text-xs text-gray-600">{sub}</p> : null}
    </Link>
  );
}

function QuickActions() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const actions = [
    { label: t('dashboard.newInvoice'), icon: Plus, onClick: () => navigate('/income?action=invoice'), variant: 'primary' as const },
    { label: t('dashboard.recordIncome'), icon: DollarSign, onClick: () => navigate('/income?action=record'), variant: 'secondary' as const },
    { label: t('dashboard.recordExpense'), icon: Receipt, onClick: () => navigate('/expenses?action=record'), variant: 'secondary' as const },
    { label: t('payroll.title'), icon: Users, onClick: () => navigate('/payroll/employees'), variant: 'secondary' as const },
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
  const isConstruction = useCapability('construction');
  const hasManufacturingCapability = useCapability('manufacturing');
  const inventoryEnabled = useCapability('inventory');
  const operatingModels = useAppStore((state) => state.currentBusiness?.business?.operating_models);
  const hasManufacturingOperatingModel = Array.isArray(operatingModels)
    && operatingModels.some((model) => typeof model === 'string' && model.trim().toUpperCase() === 'MANUFACTURING');
  const isManufacturing = hasManufacturingCapability || hasManufacturingOperatingModel;
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id);
  const isMobile = useIsMobile();

  // MobileDashboard owns the compact summaries for standard businesses. Keep
  // the full manufacturing workspace responsive rather than replacing it.
  if (!isConstruction && !isManufacturing && isMobile) return <MobileDashboard />;

  const exceptions = (
    <SectionErrorBoundary sectionName="Actionable Exceptions" fallbackHeight="220px">
      <ActionableExceptions
        construction={isConstruction}
        manufacturing={isManufacturing}
        inventoryEnabled={inventoryEnabled}
      />
    </SectionErrorBoundary>
  );
  const hasSpecializedDashboard = isConstruction || isManufacturing;

  return (
    <div className="space-y-6" data-testid="executive-hub-dashboard">
      <SectionErrorBoundary sectionName="Executive Health Summary" fallbackHeight="150px">
        <ExecutiveHealthStrip />
      </SectionErrorBoundary>
      {hasSpecializedDashboard && businessId && <DashboardFreshnessToolbar businessId={businessId} />}
      {isConstruction && <ConstructionDashboard />}
      {isManufacturing ? (
        <>
          {exceptions}
          <SectionErrorBoundary sectionName="Manufacturing Executive Dashboard" fallbackHeight="560px">
            <ManufacturingDashboardPage />
          </SectionErrorBoundary>
        </>
      ) : (
        <>
          {!isConstruction && <GenericDashboard />}
          {exceptions}
        </>
      )}
      {/* The generic desktop dashboard includes these modules itself. Specialized
          dashboards retain the same additive, role-gated summaries as well. */}
      {hasSpecializedDashboard && <DashboardVerticalModules />}
    </div>
  );
}

export function GenericDashboard() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business.id;
  const businessName = currentBusiness?.business.name;
  const currencyCode = currentBusiness?.business.base_currency || 'MWK';
  const isMobile = useIsMobile();
  const dashboardPeriod = getDashboardPeriod(undefined, i18n.language);
  const formattedPeriodLabel = dashboardPeriod.formattedPeriodLabel;
  const periodMetadata = t('dashboard.metadata.period', { period: formatDateRange(dashboardPeriod.from, dashboardPeriod.to, i18n.language) });
  const trendStart = new Date(`${dashboardPeriod.from}T00:00:00`);
  trendStart.setMonth(trendStart.getMonth() - 5);
  const trendPeriod = getDashboardPeriod(trendStart, i18n.language);
  const trendMetadata = t('dashboard.metadata.period', { period: formatDateRange(trendPeriod.from, dashboardPeriod.to, i18n.language) });
  const asOfMetadata = t('dashboard.metadata.asOf', { date: new Date().toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }) });

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

      <section aria-label={t('dashboard.financialOverview')} className="space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-extrabold text-gray-900">{t('dashboard.financialOverview')}</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {businessName ? t('dashboard.realtimeInsightsFor', { business: businessName }) : t('dashboard.realtimeInsights')} · {t('dashboard.baseCurrency', { currency: currencyCode })}
            </p>
          </div>
          <DashboardFreshnessToolbar businessId={businessId} />
        </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <KpiCard
          label={t('dashboard.netProfit')}
          to="/reports/profit-loss"
          value={netProfit !== undefined ? formatCurrencyCompact(netProfit, currencyCode, i18n.language) : formatCurrencyCompact(0, currencyCode, i18n.language)}
          valueTitle={netProfit !== undefined ? formatCurrency(netProfit, currencyCode, i18n.language) : formatCurrency(0, currencyCode, i18n.language)}
          sub={t('dashboard.forPeriod', { period: formattedPeriodLabel })}
          metadata={periodMetadata}
          trendUp={netProfit === undefined || netProfit >= 0}
          featured
          isLoading={netIsLoading}
          isError={netIsError}
        />
        <KpiCard
          label={t('dashboard.totalIncome')}
          to="/income"
          value={totalIncomeValue !== undefined ? formatCurrencyCompact(totalIncomeValue, currencyCode, i18n.language) : formatCurrencyCompact(0, currencyCode, i18n.language)}
          valueTitle={totalIncomeValue !== undefined ? formatCurrency(totalIncomeValue, currencyCode, i18n.language) : formatCurrency(0, currencyCode, i18n.language)}
          sub={income.data
            ? t('dashboard.collectedForPeriod', { amount: formatCurrency(income.data.amountPaid, currencyCode, i18n.language), period: formattedPeriodLabel })
            : t('dashboard.forPeriod', { period: formattedPeriodLabel })}
          metadata={periodMetadata}
          trendUp
          isLoading={plReport.isLoading || income.isLoading}
          isError={plReport.isError || income.isError}
        />
        <KpiCard
          label={t('dashboard.totalExpenses')}
          to="/expenses"
          value={totalExpensesValue !== undefined ? formatCurrencyCompact(totalExpensesValue, currencyCode, i18n.language) : formatCurrencyCompact(0, currencyCode, i18n.language)}
          valueTitle={totalExpensesValue !== undefined ? formatCurrency(totalExpensesValue, currencyCode, i18n.language) : formatCurrency(0, currencyCode, i18n.language)}
          sub={t('dashboard.forPeriod', { period: formattedPeriodLabel })}
          metadata={periodMetadata}
          trendUp={false}
          isLoading={plReport.isLoading}
          isError={plReport.isError}
        />
        <KpiCard
          label={t('dashboard.accountsReceivable')}
          to="/invoices"
          value={outstanding.data ? formatCurrencyCompact(outstanding.data.total, currencyCode, i18n.language) : formatCurrencyCompact(0, currencyCode, i18n.language)}
          valueTitle={outstanding.data ? formatCurrency(outstanding.data.total, currencyCode, i18n.language) : formatCurrency(0, currencyCode, i18n.language)}
          sub={outstanding.data ? t('dashboard.unpaidInvoices', { count: outstanding.data.count }) : t('dashboard.invoices', { count: 0 })}
          metadata={asOfMetadata}
          trendUp={false}
          isLoading={outstanding.isLoading}
          isError={outstanding.isError}
        />
        <KpiCard
          label={t('dashboard.vatAccrued')}
          to="/reports/vat-return"
          value={formatCurrencyCompact(Math.abs(netVat), currencyCode, i18n.language)}
          valueTitle={formatCurrency(Math.abs(netVat), currencyCode, i18n.language)}
          sub={t(netVat >= 0 ? 'dashboard.payableToMraForPeriod' : 'dashboard.refundableVatForPeriod', { period: formattedPeriodLabel })}
          metadata={periodMetadata}
          trendUp={netVat >= 0}
          isLoading={vatIsLoading}
          isError={vatIsError}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionErrorBoundary sectionName={t('dashboard.incomeVsExpenses')}>
          <div className="lg:col-span-2 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-gray-900">{t('dashboard.incomeVsExpenses')}</h2>
                <p className="text-xs text-gray-600">{t('dashboard.monthlyCashFlow')} · {trendMetadata}</p>
              </div>
            </div>
            <IncomeExpenseChart data={trend.data} isLoading={trend.isLoading} isError={trend.isError} currencyCode={currencyCode} />
          </div>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName={t('dashboard.cashFlow')}>
          <div className="flex flex-col gap-4">
            <CashFlowIndicator income={income.data?.totalAmount} expenses={expenses.data} isLoading={income.isLoading || expenses.isLoading} isError={income.isError || expenses.isError} currencyCode={currencyCode} locale={i18n.language} metadata={periodMetadata} />
          </div>
        </SectionErrorBoundary>
      </div>

      <SectionErrorBoundary sectionName={t('dashboard.recentTransactions')}>
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

        <TaxRemittancePanel businessId={businessId} />
      </section>

      <DashboardVerticalModules />

      <section className="space-y-4" aria-label={t('dashboard.bottomSection')}>
        <div className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">{t('dashboard.quickActions')}</h2>
            <p className="text-xs text-gray-500">{t('dashboard.quickActionsDescription')}</p>
          </div>
          <QuickActions />
        </div>
        <UsageMeter />
        <OnboardingChecklist />
      </section>

      <UpgradeModal isOpen={showUpgradeModal} onClose={() => setShowUpgradeModal(false)} onUpgrade={() => { setShowUpgradeModal(false); navigate('/settings?tab=billing'); }} />
    </div>
  );
}
