import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { repos } from '@/lib/repositories';
import { FinancialStatementRepository } from '@/dal/repositories/FinancialStatementRepository';
import { useLocaleFormat } from '@/i18n';
import { ReportHeader } from './ReportHeader';

function formatAccounting(amount: number, formatCurrency: (value: number) => string): string {
  const formatted = formatCurrency(Math.abs(amount));
  return amount < 0 ? `(${formatted})` : formatted;
}

const financialStatementRepo = new FinancialStatementRepository(repos.account.db);

interface Props {
  businessId: string;
  periodStart: string;
  periodEnd: string;
  businessName?: string;
}

function Line({
  label,
  amount,
  bold,
  indent,
  formatCurrency,
}: {
  label: string;
  amount: number;
  bold?: boolean;
  indent?: boolean;
  formatCurrency: (value: number) => string;
}) {
  return (
    <div className={`flex items-center justify-between py-1 ${indent ? 'ps-4' : ''}`}>
      <span className={`text-sm ${bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{label}</span>
      <span className={`text-sm ${bold ? 'font-semibold text-gray-900' : 'text-gray-600'} ${amount < 0 ? 'text-red-600' : ''}`}>
        {formatAccounting(amount, formatCurrency)}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="my-2 border-t border-gray-200" />;
}

export function CashFlowStatement({ businessId, periodStart, periodEnd }: Props) {
  const { t } = useTranslation();
  const format = useLocaleFormat();
  const { data: cf, isLoading, error } = useQuery({
    queryKey: ['cash_flow', businessId, periodStart, periodEnd],
    queryFn: () => financialStatementRepo.getCashFlow(businessId, periodStart, periodEnd),
    enabled: Boolean(businessId && periodStart && periodEnd),
  });

  const formatMwk = (value: number) => format.currency(value, 'MWK');
  const periodLabel = t('reports.period', { start: format.date(periodStart), end: format.date(periodEnd) });
  const lineProps = { formatCurrency: formatMwk };

  if (isLoading) return <div className="space-y-3">{[...Array(10)].map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-gray-100" />)}</div>;

  if (error || !cf) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-center">
        <AlertTriangle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-gray-500">{t('reports.couldNotLoadCashFlows')}</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <ReportHeader
        title={t('reports.statementOfCashFlows')}
        subtitle={`${periodLabel} · ${t('reports.indirectMethod')} · ${t('reports.currencyNote', { currency: 'MWK' })}`}
      />

      {!cf.reconciles && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{t('reports.cashFlowReconciliationWarning')}</span>
        </div>
      )}

      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">{t('reports.operatingActivities')}</p>
      <Line label={t('reports.netProfit')} amount={cf.netProfit} indent {...lineProps} />
      <Line label={t('reports.addDepreciationAmortisation')} amount={cf.depreciationAmortisationAddBack} indent {...lineProps} />
      <Line label={t('reports.otherOperatingMovements')} amount={cf.otherOperatingMovements} indent {...lineProps} />
      <Divider />
      <Line label={t('reports.netCashFromOperating')} amount={cf.netCashFromOperating} bold {...lineProps} />

      <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wider text-gray-400">{t('reports.investingActivities')}</p>
      <Line label={t('reports.purchaseOfAssets')} amount={cf.assetPurchases} indent {...lineProps} />
      <Line label={t('reports.assetDisposalProceeds')} amount={cf.assetDisposalProceeds} indent {...lineProps} />
      <Divider />
      <Line label={t('reports.netCashFromInvesting')} amount={cf.netCashFromInvesting} bold {...lineProps} />

      <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-wider text-gray-400">{t('reports.financingActivities')}</p>
      <Line label={t('reports.loanDrawdowns')} amount={cf.loanDrawdowns} indent {...lineProps} />
      <Line label={t('reports.loanRepayments')} amount={cf.loanRepayments} indent {...lineProps} />
      <Line label={t('reports.shareCapitalContributions')} amount={cf.shareCapitalContributions} indent {...lineProps} />
      <Line label={t('reports.drawingsAndDividendsPaid')} amount={cf.drawingsAndDividendsPaid} indent {...lineProps} />
      <Divider />
      <Line label={t('reports.netCashFromFinancing')} amount={cf.netCashFromFinancing} bold {...lineProps} />

      <Divider />
      <Line label={t('reports.netMovementInCash')} amount={cf.netMovementInCash} bold {...lineProps} />
      <Line label={t('reports.openingCashBalance')} amount={cf.openingCashBalance} {...lineProps} />
      <Line label={t('reports.closingCashBalance')} amount={cf.closingCashBalance} bold {...lineProps} />
    </div>
  );
}
