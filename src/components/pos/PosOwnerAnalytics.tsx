import { useState, useMemo } from 'react';
import {
  TrendingUp,
  DollarSign,
  ShoppingBag,
  Users,
  RotateCcw,
} from 'lucide-react';
import type { PosSale, PosShift } from '@/types/pos';
import { formatMwkDetailed } from '@/lib/formatters';

interface PosOwnerAnalyticsProps {
  sales: PosSale[];
  shifts?: PosShift[];
  currentBranchId?: string;
  branches?: Array<{ id: string; name: string }>;
}

export function PosOwnerAnalytics({
  sales = [],
  currentBranchId,
  branches = [],
}: PosOwnerAnalyticsProps) {
  const [dateRange, setDateRange] = useState<'today' | '7d' | '30d' | 'all'>('today');
  const [selectedBranch, setSelectedBranch] = useState<string>(currentBranchId || 'all');

  // Filter sales based on date range & branch
  const filteredSales = useMemo(() => {
    const now = new Date();
    return sales.filter((s) => {
      const branchMatch = !s.branch_id && !s.branchId
        ? true
        : s.branch_id === selectedBranch || s.branchId === selectedBranch;

      if (selectedBranch !== 'all' && !branchMatch) {
        return false;
      }
      if (s.status === 'voided') return false;

      const dateStr = s.created_at || s.createdAt || '';
      const saleDate = new Date(dateStr);
      if (dateRange === 'today') {
        return saleDate.toDateString() === now.toDateString();
      }
      if (dateRange === '7d') {
        const d7 = new Date();
        d7.setDate(now.getDate() - 7);
        return saleDate >= d7;
      }
      if (dateRange === '30d') {
        const d30 = new Date();
        d30.setDate(now.getDate() - 30);
        return saleDate >= d30;
      }
      return true;
    });
  }, [sales, dateRange, selectedBranch]);

  // Aggregate metrics
  const totalRevenue = useMemo(() => {
    return filteredSales.reduce((acc, s) => acc + (s.net_amount ?? s.netAmount ?? s.total_amount ?? 0), 0);
  }, [filteredSales]);

  const totalDiscount = useMemo(() => {
    return filteredSales.reduce((acc, s) => acc + (s.discount_amount ?? s.discountAmount ?? 0), 0);
  }, [filteredSales]);

  const totalReturns = useMemo(() => {
    return filteredSales.filter((s) => s.status === 'returned').length;
  }, [filteredSales]);

  const completedSalesCount = filteredSales.length;
  const averageOrderValue = completedSalesCount > 0 ? totalRevenue / completedSalesCount : 0;

  // Breakdown by Cashier / Staff
  const salesByCashier = useMemo(() => {
    const map = new Map<string, { count: number; revenue: number; name: string }>();
    filteredSales.forEach((s) => {
      const cId = s.cashier_id || s.cashierId || 'Unknown';
      const cName = s.cashierName || s.cashier_name || 'Cashier ' + cId.slice(0, 4);
      const curr = map.get(cId) || { count: 0, revenue: 0, name: cName };
      curr.count += 1;
      curr.revenue += (s.net_amount ?? s.netAmount ?? 0);
      map.set(cId, curr);
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [filteredSales]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Bar Filter */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-gray-200 pb-4">
        <div>
          <h2 className="text-xl font-black text-gray-900 tracking-tight flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-brand-600" />
            Executive POS Sales Analytics
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Real-time multi-branch point of sale performance, cash flow, and cashier productivity.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Branch selector */}
          {branches.length > 0 && (
            <select
              value={selectedBranch}
              onChange={(e) => setSelectedBranch(e.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-gray-700 shadow-2xs focus:border-brand-500 focus:outline-none"
            >
              <option value="all">All Branches</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}

          {/* Date range filter */}
          <div className="flex rounded-xl bg-gray-100 p-1">
            {(['today', '7d', '30d', 'all'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setDateRange(r)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  dateRange === r ? 'bg-white text-gray-900 shadow-2xs' : 'text-gray-500 hover:text-gray-900'
                }`}
              >
                {r === 'today' ? 'Today' : r === '7d' ? '7 Days' : r === '30d' ? '30 Days' : 'All Time'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs font-bold uppercase tracking-wider">Gross Sales Revenue</span>
            <div className="rounded-xl bg-brand-50 p-2 text-brand-600">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-gray-900">{formatMwkDetailed(totalRevenue)}</p>
          <div className="text-[11px] text-gray-500 flex items-center gap-1 font-semibold">
            <span>From {completedSalesCount} completed sales</span>
          </div>
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs font-bold uppercase tracking-wider">Average Ticket Value</span>
            <div className="rounded-xl bg-blue-50 p-2 text-blue-600">
              <ShoppingBag className="h-4 w-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-gray-900">{formatMwkDetailed(averageOrderValue)}</p>
          <div className="text-[11px] text-gray-500 flex items-center gap-1 font-semibold">
            <span>Per customer basket</span>
          </div>
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs font-bold uppercase tracking-wider">Discounts Given</span>
            <div className="rounded-xl bg-amber-50 p-2 text-amber-600">
              <RotateCcw className="h-4 w-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-amber-900">{formatMwkDetailed(totalDiscount)}</p>
          <div className="text-[11px] text-gray-500 font-semibold">
            <span>Total promotions applied</span>
          </div>
        </div>

        <div className="rounded-3xl border border-gray-200 bg-white p-5 shadow-2xs space-y-2">
          <div className="flex items-center justify-between text-gray-500">
            <span className="text-xs font-bold uppercase tracking-wider">Refunds & Returns</span>
            <div className="rounded-xl bg-red-50 p-2 text-red-600">
              <RotateCcw className="h-4 w-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-gray-900">{totalReturns} Orders</p>
          <div className="text-[11px] text-gray-500 font-semibold">
            <span>Processed customer returns</span>
          </div>
        </div>
      </div>

      {/* Staff / Cashier Performance Table */}
      <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-2xs space-y-4">
        <h3 className="text-sm font-black text-gray-900 uppercase tracking-wider flex items-center gap-2">
          <Users className="h-4 w-4 text-brand-600" />
          Cashier & Register Sales Leaderboard
        </h3>
        {salesByCashier.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">No sales recorded for the selected period.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-gray-100 text-gray-400 uppercase font-bold text-[10px]">
                <tr>
                  <th className="py-2.5 px-3">Cashier Name</th>
                  <th className="py-2.5 px-3">Sales Count</th>
                  <th className="py-2.5 px-3">Total Volume</th>
                  <th className="py-2.5 px-3">Avg Ticket</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 font-semibold text-gray-800">
                {salesByCashier.map((c, i) => (
                  <tr key={i} className="hover:bg-gray-50/70">
                    <td className="py-3 px-3 font-bold text-gray-900">{c.name}</td>
                    <td className="py-3 px-3">{c.count} orders</td>
                    <td className="py-3 px-3 font-black text-brand-700">{formatMwkDetailed(c.revenue)}</td>
                    <td className="py-3 px-3 text-gray-600">
                      {formatMwkDetailed(c.count > 0 ? c.revenue / c.count : 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
