import { Link } from 'react-router';
import { FileText } from 'lucide-react';
import { IncomeExpenseChart } from '@/components/dashboard/IncomeExpenseChart';
import { CashFlowIndicator } from '@/components/dashboard/CashFlowIndicator';
import { formatMwk, formatMwkCompact, formatDateShort } from '@/lib/formatters';
import {
  DEMO_BUSINESS_NAME,
  DEMO_INVOICES,
  DEMO_KPIS,
  DEMO_TREND,
  type DemoInvoiceStatus,
} from '@/lib/demoData';

function statusStyles(status: DemoInvoiceStatus): string {
  if (status === 'paid') return 'bg-emerald-50 text-emerald-800';
  if (status === 'overdue') return 'bg-red-50 text-red-800';
  return 'bg-amber-50 text-amber-800';
}

function KpiCard({
  label,
  value,
  valueTitle,
  sub,
  featured,
}: {
  label: string;
  value: string;
  valueTitle?: string;
  sub?: string;
  featured?: boolean;
}) {
  if (featured) {
    return (
      <div
        className="overflow-hidden rounded-2xl p-5 text-left"
        style={{ background: 'linear-gradient(135deg, #065c42, #0a7c5a)' }}
        title={valueTitle}
      >
        <p className="mb-2 text-xs font-bold uppercase tracking-wider text-white/70">{label}</p>
        <p className="mb-2 truncate font-extrabold text-white" style={{ fontSize: 'clamp(1.25rem, 2.5vw, 1.6rem)' }}>
          {value}
        </p>
        {sub && <p className="text-xs text-white/80">{sub}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" title={valueTitle}>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mb-1 font-extrabold leading-tight text-gray-900" style={{ fontSize: 'clamp(1.1rem, 2vw, 1.35rem)' }}>
        {value}
      </p>
      {sub && <p className="text-xs text-gray-600">{sub}</p>}
    </div>
  );
}

export function DemoPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-40 border-b border-brand-700 bg-brand-950 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-200">Public sample</p>
            <p className="text-sm font-medium">
              Exploring <span className="font-bold">{DEMO_BUSINESS_NAME}</span> — read-only demo data, not a live company.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/login"
              className="rounded-lg border border-brand-400/50 px-4 py-2 text-sm font-semibold text-brand-100 hover:bg-brand-900"
            >
              Sign in
            </Link>
            <Link
              to="/register"
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400"
            >
              Start free
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-extrabold text-gray-900">Financial overview</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            Realtime insights for {DEMO_BUSINESS_NAME} · MWK · sample books
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <KpiCard
            label="Net profit"
            value={formatMwkCompact(DEMO_KPIS.netProfit)}
            valueTitle={formatMwk(DEMO_KPIS.netProfit)}
            sub="This month"
            featured
          />
          <KpiCard
            label="Total income"
            value={formatMwkCompact(DEMO_KPIS.totalIncome)}
            valueTitle={formatMwk(DEMO_KPIS.totalIncome)}
            sub={`Collected ${formatMwk(DEMO_KPIS.amountPaid)}`}
          />
          <KpiCard
            label="Total expenses"
            value={formatMwkCompact(DEMO_KPIS.totalExpenses)}
            valueTitle={formatMwk(DEMO_KPIS.totalExpenses)}
            sub="This month"
          />
          <KpiCard
            label="Accounts receivable"
            value={formatMwkCompact(DEMO_KPIS.accountsReceivable)}
            valueTitle={formatMwk(DEMO_KPIS.accountsReceivable)}
            sub={`${DEMO_KPIS.unpaidInvoiceCount} unpaid invoices`}
          />
          <KpiCard
            label="VAT accrued"
            value={formatMwkCompact(DEMO_KPIS.vatAccrued)}
            valueTitle={formatMwk(DEMO_KPIS.vatAccrued)}
            sub="Payable to MRA"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm lg:col-span-2">
            <div className="mb-4">
              <h2 className="text-base font-bold text-gray-900">Income vs expenses</h2>
              <p className="text-xs text-gray-600">Monthly cash flow (sample)</p>
            </div>
            <IncomeExpenseChart data={[...DEMO_TREND]} />
          </div>
          <CashFlowIndicator income={DEMO_KPIS.totalIncome} expenses={DEMO_KPIS.totalExpenses} />
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-gray-900">Recent invoices</h2>
              <p className="mt-0.5 text-xs text-gray-600">Sample customer documents</p>
            </div>
            <FileText className="h-4 w-4 text-gray-300" aria-hidden="true" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th scope="col" className="px-4 py-3 text-start text-xs font-bold uppercase tracking-wide text-gray-600">
                    Number
                  </th>
                  <th scope="col" className="px-4 py-3 text-start text-xs font-bold uppercase tracking-wide text-gray-600">
                    Client
                  </th>
                  <th scope="col" className="px-4 py-3 text-start text-xs font-bold uppercase tracking-wide text-gray-600">
                    Amount
                  </th>
                  <th scope="col" className="px-4 py-3 text-start text-xs font-bold uppercase tracking-wide text-gray-600">
                    Due
                  </th>
                  <th scope="col" className="px-4 py-3 text-start text-xs font-bold uppercase tracking-wide text-gray-600">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {DEMO_INVOICES.map((inv) => (
                  <tr key={inv.id} className="border-b border-gray-50 last:border-0">
                    <th scope="row" className="px-4 py-3 font-medium text-gray-900">
                      {inv.number}
                    </th>
                    <td className="px-4 py-3 text-gray-700">{inv.client}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900">{formatMwk(inv.amount)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDateShort(inv.due)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold capitalize ${statusStyles(inv.status)}`}>
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-center text-sm text-gray-500">
          This tour never writes to a live ledger.{' '}
          <Link to="/register" className="font-medium text-brand-600 hover:text-brand-700">
            Create a free account
          </Link>{' '}
          to keep your own books.
        </p>
      </main>
    </div>
  );
}
