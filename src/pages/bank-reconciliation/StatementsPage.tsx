import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BankReconciliationRepository } from '@/dal/repositories/BankReconciliationRepository';
import { StatementImportModal } from '@/components/bank-reconciliation/StatementImportModal';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { usePermissions } from '@/hooks/usePermissions';

function formatDate(date: string, locale: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(year, month - 1, day));
}

function formatMoney(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'MWK', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

export function StatementsPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? '');
  const { canWrite } = usePermissions();
  const [filterAccountId, setFilterAccountId] = useState('all');
  const [showImport, setShowImport] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);

  const accountsQuery = useQuery({
    queryKey: ['bank-reconciliation', 'accounts', businessId],
    queryFn: () => BankReconciliationRepository.getBankAccounts(supabase, businessId),
    enabled: Boolean(businessId),
  });
  const statementsQuery = useQuery({
    queryKey: ['bank-reconciliation', 'statements', businessId, filterAccountId],
    queryFn: () => BankReconciliationRepository.getStatements(supabase, businessId, filterAccountId === 'all' ? undefined : filterAccountId),
    enabled: Boolean(businessId),
  });
  const statementHistoryQuery = useQuery({
    queryKey: ['bank-reconciliation', 'statement-history', businessId],
    queryFn: () => BankReconciliationRepository.getStatements(supabase, businessId),
    enabled: Boolean(businessId && showImport),
  });
  const accounts = accountsQuery.data ?? [];
  const activeAccounts = accounts.filter((account) => account.is_active);
  const statements = statementsQuery.data ?? [];

  const onImported = (lineCount: number) => {
    setImportedCount(lineCount);
    setShowImport(false);
    void queryClient.invalidateQueries({ queryKey: ['bank-reconciliation', 'statements', businessId] });
  };

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">{t('bankReconciliation.statements.title')}</h1>
          <p className="mt-1 text-sm text-gray-600">{t('bankReconciliation.statements.description')}</p>
        </div>
        {canWrite && (
          <button type="button" onClick={() => setShowImport(true)} disabled={activeAccounts.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            <Upload className="h-4 w-4" aria-hidden="true" />{t('bankReconciliation.statements.import')}
          </button>
        )}
      </header>

      {importedCount !== null && (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {t('bankReconciliation.import.importSuccess', { count: importedCount })}
        </p>
      )}
      {(accountsQuery.isError || statementsQuery.isError) && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{t('bankReconciliation.shared.loadFailed')}</p>
      )}

      <section className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <label className="block text-sm font-medium text-gray-700">
          {t('bankReconciliation.statements.filterAccount')}
          <select value={filterAccountId} onChange={(event) => setFilterAccountId(event.target.value)} className="mt-1 block min-w-64 rounded-lg border border-gray-300 bg-white px-3 py-2">
            <option value="all">{t('bankReconciliation.statements.allAccounts')}</option>
            {accounts.map((account) => <option key={account.id} value={account.id}>{account.bank_name} · {account.account_number}</option>)}
          </select>
        </label>
        {accounts.length === 0 && (
          <p className="text-sm text-gray-600">
            {t('bankReconciliation.statements.configureAccountFirst')}{' '}
            <Link to="/bank-reconciliation/accounts" className="font-semibold text-brand-700 underline">{t('bankReconciliation.accounts.title')}</Link>
          </p>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm" aria-label={t('bankReconciliation.statements.title')}>
        {statementsQuery.isPending ? (
          <div role="status" className="p-8 text-center text-sm text-gray-500">{t('common.loading')}</div>
        ) : statements.length === 0 ? (
          <div className="flex min-h-64 items-center justify-center p-8 text-center text-sm text-gray-600">{t('bankReconciliation.statements.noStatements')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">{t('bankReconciliation.statements.bankAccount')}</th>
                  <th className="px-4 py-3">{t('bankReconciliation.statements.period')}</th>
                  <th className="px-4 py-3 text-right">{t('bankReconciliation.statements.openingBalance')}</th>
                  <th className="px-4 py-3 text-right">{t('bankReconciliation.statements.closingBalance')}</th>
                  <th className="px-4 py-3 text-right">{t('bankReconciliation.statements.lineCount')}</th>
                  <th className="px-4 py-3">{t('bankReconciliation.statements.status')}</th>
                  <th className="px-4 py-3">{t('bankReconciliation.statements.importedAt')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {statements.map((statement) => (
                  <tr key={statement.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <Link to={`/bank-reconciliation/statements/${statement.id}`} className="text-brand-700 hover:underline">
                        {statement.bank_name} · {statement.account_number}
                      </Link>
                      <span className="mt-0.5 block text-xs font-normal text-gray-500">{statement.account_code} — {statement.account_name}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">{formatDate(statement.period_start, i18n.language)} → {formatDate(statement.statement_date, i18n.language)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-gray-700">{formatMoney(statement.opening_balance, i18n.language)}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-gray-700">{formatMoney(statement.closing_balance, i18n.language)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">{statement.line_count}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statement.status === 'draft' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>
                        {t(statement.status === 'draft' ? 'bankReconciliation.statements.statusDraft' : 'bankReconciliation.statements.statusReconciled')}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600">{formatDate(statement.created_at.slice(0, 10), i18n.language)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showImport && (
        <StatementImportModal
          businessId={businessId}
          accounts={activeAccounts}
          statements={statementHistoryQuery.data ?? []}
          onClose={() => setShowImport(false)}
          onImported={onImported}
        />
      )}
    </main>
  );
}
