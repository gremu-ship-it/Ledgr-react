import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { formatDate, text } from './employeeUtils';
import { formatPayRunMoney } from './payRunUtils';

export function PayRunJournalEntryModal({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const currency = useAppStore((state) => state.currentBusiness?.business?.base_currency ?? 'MWK');
  const entryQuery = useQuery({
    queryKey: ['payroll-journal-entry', entryId],
    enabled: Boolean(entryId),
    queryFn: () => repos.journal.findByIdWithLines(entryId),
  });
  const entry = entryQuery.data?.entry;
  const lines = Array.isArray(entryQuery.data?.lines) ? entryQuery.data.lines : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-950/50 p-4" role="presentation">
      <section role="dialog" aria-modal="true" aria-labelledby="payroll-journal-title" className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-7">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 id="payroll-journal-title" className="text-xl font-semibold text-gray-900">{t('payroll.journalEntryDetails')}</h2>
            {entry && <p className="mt-1 text-sm text-gray-500">{text(entry.entry_number)}</p>}
          </div>
          <Button variant="secondary" size="icon" aria-label={t('payroll.closeJournalEntry')} onClick={onClose}><X className="h-4 w-4" aria-hidden="true" /></Button>
        </header>

        {entryQuery.isPending ? <div className="mt-5"><TableSkeleton rows={3} /></div> : entryQuery.isError || !entry ? (
          <p role="alert" className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('payroll.journalEntryLoadFailed')}</p>
        ) : (
          <>
            <dl className="mt-5 grid gap-4 rounded-xl bg-gray-50 p-4 text-sm sm:grid-cols-3">
              <div><dt className="text-gray-500">{t('payroll.journalEntryNumber')}</dt><dd className="mt-1 font-medium text-gray-900">{text(entry.entry_number, '—')}</dd></div>
              <div><dt className="text-gray-500">{t('payroll.journalEntryDate')}</dt><dd className="mt-1 font-medium text-gray-900">{formatDate(entry.entry_date, i18n.language)}</dd></div>
              <div><dt className="text-gray-500">{t('payroll.journalEntryStatus')}</dt><dd className="mt-1 font-medium text-gray-900">{t(`payroll.${text(entry.status)}`, { defaultValue: text(entry.status, '—') })}</dd></div>
              <div className="sm:col-span-3"><dt className="text-gray-500">{t('payroll.journalEntryDescription')}</dt><dd className="mt-1 text-gray-900">{text(entry.description, '—')}</dd></div>
            </dl>
            <div className="mt-5 overflow-x-auto rounded-xl border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th scope="col" className="px-4 py-3">{t('payroll.journalEntryLines')}</th>
                    <th scope="col" className="px-4 py-3 text-right">{t('payroll.debit')}</th>
                    <th scope="col" className="px-4 py-3 text-right">{t('payroll.credit')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lines.map((line, index) => {
                    const debit = line.is_debit === true;
                    return (
                      <tr key={text(line.id, `journal-line-${index}`)}>
                        <td className="px-4 py-3 text-gray-800">{text(line.description, text(line.account_id, '—'))}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{debit ? formatPayRunMoney(line.amount_base, currency, i18n.language) : '—'}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{!debit ? formatPayRunMoney(line.amount_base, currency, i18n.language) : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-5 flex justify-end"><Button variant="secondary" onClick={onClose}>{t('payroll.close')}</Button></div>
          </>
        )}
      </section>
    </div>
  );
}
