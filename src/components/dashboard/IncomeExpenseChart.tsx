import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Area,
  AreaChart,
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
      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-400">{label}</p>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-sm">
          <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="capitalize text-gray-500">{entry.name}:</span>
          <span className="font-bold text-gray-900">{formatMwk(entry.value)}</span>
        </div>
      ))}
    </div>
  );
}

function fmtShort(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000)     return `${(v / 1_000).toFixed(0)}K`;
  return String(v);
}

export function IncomeExpenseChart({ data, isLoading, isError }: IncomeExpenseChartProps) {
  if (isLoading) {
    return (
      <div className="flex h-72 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium text-red-500">Failed to load chart data</p>
      </div>
    );
  }

  const isEmpty = !data || data.every((d) => d.income === 0 && d.expenses === 0);

  if (isEmpty) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-2 text-center">
        <p className="text-sm font-medium text-gray-400">No transactions yet</p>
        <p className="text-xs text-gray-300">Income and expenses will appear here once recorded</p>
      </div>
    );
  }

  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#0a7c5a" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#0a7c5a" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="expensesGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#e3342f" stopOpacity={0.12} />
              <stop offset="95%" stopColor="#e3342f" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            dy={8}
          />
          <YAxis
            tickFormatter={fmtShort}
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 16 }}
            iconType="circle"
            formatter={(value) => (
              <span style={{ color: '#64748b', textTransform: 'capitalize' }}>{value}</span>
            )}
          />
          <Area
            type="monotone"
            dataKey="income"
            name="Income"
            stroke="#0a7c5a"
            strokeWidth={3}
            fill="url(#incomeGradient)"
            dot={{ r: 4, fill: '#0a7c5a', strokeWidth: 0 }}
            activeDot={{ r: 5, strokeWidth: 0 }}
          />
          <Area
            type="monotone"
            dataKey="expenses"
            name="Expenses"
            stroke="#e3342f"
            strokeWidth={3}
            strokeDasharray="6 4"
            fill="url(#expensesGradient)"
            dot={{ r: 4, fill: '#e3342f', strokeWidth: 0 }}
            activeDot={{ r: 5, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
