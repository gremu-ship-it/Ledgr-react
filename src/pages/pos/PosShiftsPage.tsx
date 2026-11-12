import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Clock3 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import type { PosShift } from '@/types/pos';

function money(value: number | null | undefined): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'MWK', maximumFractionDigits: 2 }).format(Number(value ?? 0));
}

function dateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : '—';
}

export function PosShiftsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const business = useAppStore((state) => state.currentBusiness?.business);
  const businessId = business?.id ?? '';
  const [registerFilter, setRegisterFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');

  const registersQuery = useQuery({
    queryKey: ['pos-registers', businessId],
    enabled: Boolean(businessId),
    queryFn: () => repos.pos.getRegisters(businessId),
  });
  const shiftsQuery = useQuery({
    queryKey: ['pos-shift-history', businessId],
    enabled: Boolean(businessId),
    queryFn: () => repos.pos.listShifts(businessId, null, 200),
  });

  const registers = registersQuery.data ?? [];
  const filteredShifts = useMemo(() => (shiftsQuery.data ?? []).filter((shift) =>
    (registerFilter === 'all' || shift.terminal_id === registerFilter)
    && (statusFilter === 'all' || shift.status === statusFilter),
  ), [shiftsQuery.data, registerFilter, statusFilter]);
  const loading = registersQuery.isPending || shiftsQuery.isPending;
  const failed = registersQuery.isError || shiftsQuery.isError;

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="secondary" size="icon" aria-label={t('pos.backToPointOfSale')} onClick={() => navigate('/pos')}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('pos.shiftHistory')}</h1>
            <p className="mt-1 text-sm text-gray-600">{t('pos.shiftHistoryDescription')}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="pos-shift-register-filter">{t('pos.filterByRegister')}</label>
          <select id="pos-shift-register-filter" value={registerFilter} onChange={(event) => setRegisterFilter(event.target.value)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="all">{t('pos.allRegisters')}</option>
            {registers.map((register) => <option key={register.id} value={register.id}>{register.name} · {register.code}</option>)}
          </select>
          <label className="sr-only" htmlFor="pos-shift-status-filter">{t('pos.filterByStatus')}</label>
          <select id="pos-shift-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            <option value="all">{t('pos.allShiftStatuses')}</option>
            <option value="open">{t('pos.open')}</option>
            <option value="closed">{t('pos.closed')}</option>
          </select>
        </div>
      </header>

      {failed && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('pos.loadShiftHistoryFailed')}</p>}
      {loading ? <TableSkeleton rows={7} /> : filteredShifts.length === 0 ? (
        <section className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <Clock3 className="h-8 w-8 text-brand-600" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-semibold text-gray-900">{t('pos.noShiftHistory')}</h2>
          <p className="mt-1 max-w-md text-sm text-gray-600">{t('pos.noShiftHistoryDescription')}</p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-3">{t('pos.register')}</th>
                  <th scope="col" className="px-4 py-3">{t('pos.cashier')}</th>
                  <th scope="col" className="px-4 py-3">{t('pos.shiftOpenedAt')}</th>
                  <th scope="col" className="px-4 py-3">{t('pos.shiftClosedAt')}</th>
                  <th scope="col" className="px-4 py-3">{t('pos.openingFloat')}</th>
                  <th scope="col" className="px-4 py-3">{t('pos.expectedCash')}</th>
                  <th scope="col" className="px-4 py-3">{t('pos.actualCash')}</th>
                  <th scope="col" className="px-4 py-3">{t('pos.variance')}</th>
                  <th scope="col" className="px-4 py-3">{t('pos.registerStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredShifts.map((shift: PosShift) => {
                  const register = registers.find((item) => item.id === shift.terminal_id);
                  const variance = Number(shift.cash_variance ?? shift.variance ?? 0);
                  return (
                    <tr key={shift.id}>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">{register?.name ?? t('pos.unknownRegister')}<span className="ml-1 font-mono text-xs text-gray-500">{register?.code ?? ''}</span></td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">{shift.cashier_name || t('pos.unknownCashier')}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">{dateTime(shift.opened_at || shift.start_time)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">{dateTime(shift.closed_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">{money(shift.opening_float ?? shift.opening_cash)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">{money(shift.expected_cash)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-700">{money(shift.actual_cash)}</td>
                      <td className={`whitespace-nowrap px-4 py-3 font-semibold ${variance === 0 ? 'text-gray-700' : variance > 0 ? 'text-emerald-700' : 'text-red-700'}`}>{money(variance)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${shift.status === 'open' ? 'bg-amber-50 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>
                          {shift.status === 'open' ? t('pos.open') : t('pos.closed')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <footer className="border-t border-gray-100 px-4 py-3 text-xs text-gray-500">{t('pos.shiftHistoryLimit')}</footer>
        </section>
      )}
    </main>
  );
}
