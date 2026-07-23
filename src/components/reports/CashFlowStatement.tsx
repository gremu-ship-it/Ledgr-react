import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { repos } from '@/lib/repositories';
import { FinancialStatementRepository } from '@/dal/repositories/FinancialStatementRepository';

function formatMwk(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-MW', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `(${formatted})` : formatted;
}

const financialStatementRepo = new FinancialStatementRepository(repos.account.db);

interface Props {
  businessId: string;
  periodStart: string;
  periodEnd: string;
  businessName?: string;
}

function Line({ label, amount, bold, indent }: { label: string; amount: number; bold?: boolean; indent?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1 ${indent ? 'pl-4' : ''}`}>
      <span className={`text-sm ${bold ? 'font-semibold text-ink' : 'text-sub'}`}>{label}</span>
      <span className={`text-sm ${bold ? 'font-semibold text-ink' : 'text-sub'} ${amount < 0 ? 'text-danger' : ''}`}>
        {formatMwk(amount)}
      </span>
    </div>
  );
}

function Divider() {
  return <div className="my-2 border-t border-line" />;
}

export function CashFlowStatement({ businessId, periodStart, periodEnd, businessName }: Props) {
  const { data: cf, isLoading, error } = useQuery({
    queryKey: ['cash_flow', businessId, periodStart, periodEnd],
    queryFn: () => financialStatementRepo.getCashFlow(businessId, periodStart, periodEnd),
    enabled: Boolean(businessId && periodStart && periodEnd),
  });

  if (isLoading) return <div className="space-y-3">{[...Array(10)].map((_, i) => <div key={i} className="h-8 animate-pulse rounded bg-surface" />)}</div>;

  if (error || !cf) {
    return (
      <div className="flex min-h-[30vh] flex-col items-center justify-center gap-2 text-center">
        <AlertTriangle className="h-8 w-8 text-danger" />
        <p className="text-sm text-muted">Could not load Statement of Cash Flows.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-card p-6 shadow-sm max-w-2xl">
      {businessName && <h1 className="text-lg font-bold text-ink">{businessName}</h1>}
      <h2 className="mb-1 text-base font-semibold text-ink">Statement of Cash Flows</h2>
      <p className="mb-6 text-xs text-muted">
        {periodStart} to {periodEnd} · Indirect method · Currency: MWK
      </p>

      {!cf.reconciles && (
        <div className="mb-4 flex items-start gap-2 rounded-lg bg-warning/12 p-3 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            Opening cash + net movement doesn't match closing cash. This can happen with untagged manual
            journal entries that couldn't be automatically classified — check recent manual entries touching
            bank accounts.
          </span>
        </div>
      )}

      <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Operating Activities</p>
      <Line label="Net Profit" amount={cf.netProfit} indent />
      <Line label="Add: Depreciation & Amortisation" amount={cf.depreciationAmortisationAddBack} indent />
      <Line label="Other operating movements" amount={cf.otherOperatingMovements} indent />
      <Divider />
      <Line label="Net Cash from Operating Activities" amount={cf.netCashFromOperating} bold />

      <p className="mt-4 mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Investing Activities</p>
      <Line label="Purchase of assets" amount={cf.assetPurchases} indent />
      <Line label="Proceeds from disposal of assets" amount={cf.assetDisposalProceeds} indent />
      <Divider />
      <Line label="Net Cash from Investing Activities" amount={cf.netCashFromInvesting} bold />

      <p className="mt-4 mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Financing Activities</p>
      <Line label="Loan drawdowns" amount={cf.loanDrawdowns} indent />
      <Line label="Loan repayments" amount={cf.loanRepayments} indent />
      <Line label="Share capital contributions" amount={cf.shareCapitalContributions} indent />
      <Line label="Drawings / dividends paid" amount={cf.drawingsAndDividendsPaid} indent />
      <Divider />
      <Line label="Net Cash from Financing Activities" amount={cf.netCashFromFinancing} bold />

      <Divider />
      <Line label="Net Movement in Cash" amount={cf.netMovementInCash} bold />
      <Line label="Opening Cash Balance" amount={cf.openingCashBalance} />
      <Line label="Closing Cash Balance" amount={cf.closingCashBalance} bold />
    </div>
  );
}
