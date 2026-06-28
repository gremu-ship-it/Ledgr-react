import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, ChevronRight, Receipt } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import {
  useMonthlyIncome,
  useMonthlyExpenses,
  useOutstandingInvoices,
  useRecentJournalEntries,
} from '@/hooks/useDashboardData';
import { formatMwk } from '@/lib/formatters';
import { QuickExpenseMobile } from './QuickExpenseMobile';
import { QuickIncomeMobile } from './QuickIncomeMobile';

function StatCard({
  label,
  value,
  subtext,
  tone = 'neutral',
  isLoading,
}: {
  label: string;
  value: string;
  subtext?: string;
  tone?: 'positive' | 'negative' | 'neutral';
  isLoading?: boolean;
}) {
  const colors = {
    positive: { value: 'text-brand-700', bg: 'bg-brand-50', border: 'border-brand-100' },
    negative: { value: 'text-red-600', bg: 'bg-red-50', border: 'border-red-100' },
    neutral:  { value: 'text-gray-900', bg: 'bg-white',    border: 'border-gray-200' },
  }[tone];

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white p-4 animate-pulse">
        <div className="h-3 w-20 rounded bg-gray-100 mb-3" />
        <div className="h-6 w-28 rounded bg-gray-100 mb-2" />
        <div className="h-2.5 w-16 rounded bg-gray-100" />
      </div>
    );
  }

  return (
    <div className={`rounded-2xl border ${colors.border} ${colors.bg} p-4`}>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-1">{label}</p>
      <p className={`text-xl font-bold ${colors.value}`}>{value}</p>
      {subtext && <p className="mt-0.5 text-xs text-gray-400">{subtext}</p>}
    </div>
  );
}

function QuickActionButton({
  emoji,
  label,
  onClick,
}: {
  emoji: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-2 rounded-2xl border border-gray-200 bg-white p-4 transition-all active:scale-95 hover:border-brand-200 hover:bg-brand-50"
    >
      <span className="text-2xl">{emoji}</span>
      <span className="text-xs font-medium text-gray-700">{label}</span>
    </button>
  );
}

export function MobileDashboard() {
  const navigate = useNavigate();
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const currentUser = useAppStore((s) => s.currentUser);
  const businessId = currentBusiness?.business?.id;
  const businessName = currentBusiness?.business?.name;

  const [showExpense, setShowExpense] = useState(false);
  const [showIncome, setShowIncome] = useState(false);

  const income = useMonthlyIncome(businessId);
  const expenses = useMonthlyExpenses(businessId);
  const outstanding = useOutstandingInvoices(businessId);
  const recentEntries = useRecentJournalEntries(businessId, 5);

  const netProfit =
    income.data !== undefined && expenses.data !== undefined
      ? income.data.totalAmount - expenses.data
      : undefined;

  const greeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const firstName = currentUser?.profile?.full_name?.split(' ')[0]
    ?? currentUser?.email?.split('@')[0]
    ?? 'there';

  return (
    <div className="flex flex-col gap-5 pb-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400">{greeting()}</p>
          <h1 className="text-lg font-bold text-gray-900">{firstName} 👋</h1>
          {businessName && (
            <p className="text-xs text-gray-500 mt-0.5">{businessName}</p>
          )}
        </div>
        <button
          onClick={() => navigate('/settings')}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-500 text-sm font-bold text-white"
        >
          {firstName[0]?.toUpperCase()}
        </button>
      </div>

      {/* Net Profit Hero Card */}
      <div className={`rounded-2xl p-5 ${
        netProfit === undefined
          ? 'bg-gray-100'
          : netProfit >= 0
          ? 'bg-gradient-to-br from-brand-500 to-brand-600'
          : 'bg-gradient-to-br from-red-500 to-red-600'
      }`}>
        {income.isLoading || expenses.isLoading ? (
          <div className="animate-pulse space-y-3">
            <div className="h-3 w-24 rounded bg-white/20" />
            <div className="h-8 w-40 rounded bg-white/20" />
            <div className="h-3 w-20 rounded bg-white/20" />
          </div>
        ) : (
          <>
            <p className="text-xs font-medium uppercase tracking-wider text-white/70">
              Net Profit This Month
            </p>
            <p className="mt-1 text-3xl font-bold text-white">
              {netProfit !== undefined ? formatMwk(Math.abs(netProfit)) : formatMwk(0)}
            </p>
            <div className="mt-3 flex items-center gap-1">
              {netProfit !== undefined && netProfit >= 0
                ? <TrendingUp className="h-3.5 w-3.5 text-white/70" />
                : <TrendingDown className="h-3.5 w-3.5 text-white/70" />}
              <p className="text-xs text-white/70">
                {netProfit !== undefined && netProfit >= 0 ? 'Profitable' : 'Loss'} · {new Date().toLocaleDateString('en-MW', { month: 'long', year: 'numeric' })}
              </p>
            </div>
          </>
        )}
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Income"
          value={income.data ? formatMwk(income.data.totalAmount) : formatMwk(0)}
          subtext={income.data ? `${formatMwk(income.data.amountPaid)} collected` : undefined}
          tone="positive"
          isLoading={income.isLoading}
        />
        <StatCard
          label="Expenses"
          value={expenses.data !== undefined ? formatMwk(expenses.data) : formatMwk(0)}
          tone="negative"
          isLoading={expenses.isLoading}
        />
        <StatCard
          label="Outstanding"
          value={outstanding.data ? formatMwk(outstanding.data.total) : formatMwk(0)}
          subtext={outstanding.data ? `${outstanding.data.count} invoices` : undefined}
          tone="neutral"
          isLoading={outstanding.isLoading}
        />
        <StatCard
          label="This Month"
          value={new Date().toLocaleDateString('en-MW', { month: 'short', year: 'numeric' })}
          subtext="Tap for reports"
          tone="neutral"
          isLoading={false}
        />
      </div>

      {/* Quick Actions */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Quick Actions
        </p>
        <div className="grid grid-cols-4 gap-2">
          <QuickActionButton
            emoji="💵"
            label="Income"
            onClick={() => setShowIncome(true)}
          />
          <QuickActionButton
            emoji="🧾"
            label="Expense"
            onClick={() => setShowExpense(true)}
          />
          <QuickActionButton
            emoji="📄"
            label="Invoice"
            onClick={() => navigate('/income?action=invoice')}
          />
          <QuickActionButton
            emoji="👥"
            label="Payroll"
            onClick={() => navigate('/payroll?action=run')}
          />
        </div>
      </div>

      {/* Recent Transactions */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Recent Transactions
          </p>
          <button
            onClick={() => navigate('/reports')}
            className="text-xs font-medium text-brand-600"
          >
            See all
          </button>
        </div>

        {recentEntries.isLoading ? (
          <div className="space-y-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        ) : !recentEntries.data || recentEntries.data.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-8 text-center">
            <Receipt className="mb-2 h-8 w-8 text-gray-300" />
            <p className="text-sm font-medium text-gray-500">No transactions yet</p>
            <p className="mt-0.5 text-xs text-gray-400">Tap + to record your first one</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
            {recentEntries.data.map((entry, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm ${
                    entry.source_type === 'invoice'
                      ? 'bg-brand-50 text-brand-600'
                      : entry.source_type === 'expense'
                      ? 'bg-red-50 text-red-500'
                      : 'bg-gray-50 text-gray-500'
                  }`}>
                    {entry.source_type === 'invoice' ? '💵' :
                     entry.source_type === 'expense' ? '🧾' : '📋'}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 truncate max-w-[140px]">
                      {entry.description ?? entry.source_type ?? 'Transaction'}
                    </p>
                    <p className="text-xs text-gray-400">{entry.entry_date}</p>
                  </div>
                </div>
                <p className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  entry.source_type === 'expense' ? 'bg-red-50 text-red-600' : 'bg-brand-50 text-brand-700'
                }`}>
                  {entry.source_type ?? `journal`}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Shortcuts */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
          Shortcuts
        </p>
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
          {[
            { label: 'View Invoices', emoji: '📄', path: '/invoices' },
            { label: 'Tax & Compliance', emoji: '🧾', path: '/tax' },
            { label: 'Reports', emoji: '📊', path: '/reports' },
            { label: 'Contacts', emoji: '👥', path: '/contacts' },
          ].map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-gray-50 active:bg-gray-100"
            >
              <div className="flex items-center gap-3">
                <span className="text-base">{item.emoji}</span>
                <span className="text-sm font-medium text-gray-700">{item.label}</span>
              </div>
              <ChevronRight className="h-4 w-4 text-gray-400" />
            </button>
          ))}
        </div>
      </div>

      {/* Quick entry sheets */}
      {businessId && (
        <>
          <QuickExpenseMobile
            businessId={businessId}
            open={showExpense}
            onClose={() => setShowExpense(false)}
          />
          <QuickIncomeMobile
            businessId={businessId}
            open={showIncome}
            onClose={() => setShowIncome(false)}
          />
        </>
      )}
    </div>
  );
}