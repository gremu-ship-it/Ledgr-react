import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/store/useAppStore';
import { usageService } from '@/lib/billing/UsageService';
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

export function UsageHistoryChart() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['usage-history', businessId],
    queryFn: () => usageService.getUsageHistory(businessId!),
    enabled: !!businessId,
  });

  if (isLoading) {
    return <div className="h-48 animate-pulse rounded bg-gray-100" />;
  }

  return (
    <div className="rounded-2xl border bg-white p-5">
      <div className="mb-4">
        <h4 className="font-semibold">Usage Trend (Last 3 Months)</h4>
        <p className="text-xs text-gray-500">Journal entries created per month</p>
      </div>

      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={history}>
            <XAxis dataKey="month" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="count" fill="#0a7c5a" radius={4} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}