import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { formatMwk } from '@/lib/formatters';

interface ChartDataPoint {
  month: string;
  income: number;
  expenses: number;
}

interface IncomeExpenseChartProps {
  data?: ChartDataPoint[];
  isLoading?: boolean;
  isError?: boolean;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-lg">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-sm">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-gray-600 capitalize">{entry.name}:</span>
          <span className="font-semibold text-gray-900">{formatMwk(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function IncomeExpenseChart({ data, isLoading, isError }: IncomeExpenseChartProps) {
  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium text-red-600">Failed to load chart data</p>
        <p className="text-xs text-gray-400">Check your connection and try again</p>
      </div>
    );
  }

  const isEmpty = !data || data.every((d) => d.income === 0 && d.expenses === 0);

  if (isEmpty) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium text-gray-500">No transactions yet</p>
        <p className="text-xs text-gray-400">Income and expenses will appear here once recorded</p>
      </div>
    );
  }

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#1D9E75" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#1D9E75" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="expensesGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#F43F5E" stopOpacity={0.12} />
              <stop offset="95%" stopColor="#F43F5E" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: '#9CA3AF' }}
            axisLine={false}
            tickLine={false}
            dy={8}
          />
          <YAxis
            tickFormatter={(v) => {
              if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
              if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
              return String(v);
            }}
            tick={{ fontSize: 11, fill: '#9CA3AF' }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
            formatter={(value) => (
              <span style={{ color: '#6B7280', textTransform: 'capitalize' }}>{value}</span>
            )}
          />
          <Area
            type="monotone"
            dataKey="income"
            stroke="#1D9E75"
            strokeWidth={2}
            fill="url(#incomeGradient)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
          <Area
            type="monotone"
            dataKey="expenses"
            stroke="#F43F5E"
            strokeWidth={2}
            fill="url(#expensesGradient)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
