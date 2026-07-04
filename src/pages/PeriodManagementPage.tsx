import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, Unlock, Calendar, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { formatMwk } from '@/lib/formatters';
import type { Row } from '@/dal/types/database';

interface PeriodWithSummary {
  period: Row<'accounting_periods'>;
  entryCount: number;
  totalDebits: number;
  totalCredits: number;
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-MW', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function PeriodManagementPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const currentUser = useAppStore((s) => s.currentUser);
  const businessId = currentBusiness?.business?.id;
  const role = currentBusiness?.role;
  const canManage = role === 'owner' || role === 'admin';

  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['accounting_periods', businessId],
    queryFn: async (): Promise<PeriodWithSummary[]> => {
      const periods = await repos.period.findByBusiness(businessId!);
      return Promise.all(
        periods.map(async (period) => {
          const summary = await repos.period.getSummary(period.id);
          return { period, ...summary };
        }),
      );
    },
    enabled: Boolean(businessId),
  });

  const lockMutation = useMutation({
    mutationFn: (periodId: string) =>
      repos.period.lock(periodId, currentUser!.id, currentUser?.email),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['accounting_periods', businessId] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to lock period.');
    },
  });

  const unlockMutation = useMutation({
    mutationFn: (periodId: string) =>
      repos.period.unlock(periodId, currentUser!.id, currentUser?.email),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['accounting_periods', businessId] });
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to unlock period.');
    },
  });

  function handleLock(period: Row<'accounting_periods'>) {
    if (!window.confirm(
      `Lock "${period.name}"? No new journal entries can be posted to this period once locked. Draft entries in range must be posted or removed first.`,
    )) return;
    lockMutation.mutate(period.id);
  }

  function handleUnlock(period: Row<'accounting_periods'>) {
    if (!window.confirm(
      `Unlock "${period.name}"? This will allow journal entries to be posted to this period again.`,
    )) return;
    unlockMutation.mutate(period.id);
  }

  if (!businessId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-gray-500">No business selected.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Period Management</h1>
        <p className="mt-1 text-sm text-gray-500">
          Lock financial periods to prevent further posting once they're closed.
        </p>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {!canManage && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-amber-500 shrink-0" />
          <p className="text-sm text-amber-700">
            Only business owners and admins can lock or unlock periods. You can view period status below.
          </p>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-gray-100" />
          ))}
        </div>
      ) : isError ? (
        <p className="text-sm text-red-500">Failed to load periods.</p>
      ) : !data || data.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-200 py-12 text-center">
          <Calendar className="h-8 w-8 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">No accounting periods yet</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">Period</th>
                  <th className="hidden sm:table-cell px-4 py-3 text-left">Date Range</th>
                  <th className="px-4 py-3 text-right">Entries</th>
                  <th className="hidden sm:table-cell px-4 py-3 text-right">Debits</th>
                  <th className="hidden sm:table-cell px-4 py-3 text-right">Credits</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  {canManage && <th className="px-4 py-3 text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.map(({ period, entryCount, totalDebits, totalCredits }) => {
                  const balanced = Math.abs(totalDebits - totalCredits) < 0.01;
                  const isPending = lockMutation.isPending || unlockMutation.isPending;
                  return (
                    <tr key={period.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-900">{period.name}</td>
                      <td className="hidden sm:table-cell px-4 py-3 text-gray-500 whitespace-nowrap">
                        {formatDate(period.period_start)} – {formatDate(period.period_end)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">{entryCount}</td>
                      <td className="hidden sm:table-cell px-4 py-3 text-right text-gray-600">{formatMwk(totalDebits)}</td>
                      <td className="hidden sm:table-cell px-4 py-3 text-right text-gray-600">{formatMwk(totalCredits)}</td>
                      <td className="px-4 py-3">
                        {period.is_closed ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
                            <Lock className="h-3 w-3" /> Locked
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" /> Open
                          </span>
                        )}
                        {!balanced && (
                          <span className="ml-2 inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600">
                            Unbalanced
                          </span>
                        )}
                      </td>
                      {canManage && (
                        <td className="px-4 py-3 text-right">
                          {period.is_closed ? (
                            <button
                              onClick={() => handleUnlock(period)}
                              disabled={isPending}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                            >
                              <Unlock className="h-3.5 w-3.5" /> Unlock
                            </button>
                          ) : (
                            <button
                              onClick={() => handleLock(period)}
                              disabled={isPending}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                            >
                              <Lock className="h-3.5 w-3.5" /> Lock
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}