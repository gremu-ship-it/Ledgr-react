import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BankReconciliationRepository } from '@/dal/repositories/BankReconciliationRepository';
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

export function StatementDetailPage() {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? '');
  const { canDelete } = usePermissions();
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  const statementQuery = useQuery({
    queryKey: ['bank-reconciliation', 'statement', businessId, id],
    queryFn: () => BankReconciliationRepository.getStatement(supabase, businessId, id),
    enabled: Boolean(businessId && id),
  });
  const linesQuery = useQuery({
    queryKey: ['bank-reconciliation', 'statement-lines', id],
    queryFn: () => BankReconciliationRepository.getStatementLines(supabase, id),
    enabled: Boolean(id && statementQuery.data),
  });
  const statement = statementQuery.data;
  const lines = linesQuery.data ?? [];

  const deleteStatement = async () => {
    if (!statement || statement.status !== 'draft' || !canDelete) return;
    if (!window.confirm(t('bankReconciliation.statements.deleteConfirm'))) return;
    setDeleting(true);
    setDeleteFailed(false);
    try {
      await BankReconciliationRepository.deleteStatement(supabase, businessId, statement.id);
      await queryClient.invalidateQueries({ queryKey: ['bank-reconciliation', 'statements', businessId] });
      await queryClient.invalidateQueries({ queryKey: ['bank-reconciliation', 'statement-history', businessId] });
      navigate('/bank-reconciliation/statements', { replace: true });
    } catch {
      setDeleteFailed(true);
    } finally {
      setDeleting(false);
    }
  };

  if (statementQuery.isPending) {
    return <div role="status" className="mx-auto max-w-7xl p-6 text-sm text-gray-500">{t('common.loading')}</div>;
  }
  if (statementQuery.isError || !statement) {
    return (
      <main className="mx-auto max-w-7xl space-y-4">
        <Link to="/bank-reconciliation/statements" className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t('bankReconciliation.detail.backToStatements')}
        </Link>
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{t('bankReconciliation.detail.notFound')}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/bank-reconciliation/statements" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t('bankReconciliation.detail.backToStatements')}
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">{t('bankReconciliation.detail.title')}</h1>
          <p className="mt-1 text-sm text-gray-600">{statement.bank_name} · {statement.account_number} · {statement.account_code} {statement.account_name}</p>
        </div>
        {canDelete && statement.status === 'draft' && (
          <button type="button" onClick={() => void deleteStatement()} disabled={deleting} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 disabled:opacity-50">
            <Trash2 className="h-4 w-4" aria-hidden="true" />{deleting ? t('bankReconciliation.statements.deleting') : t('bankReconciliation.statements.delete')}
          </button>
        )}
      </header>

      {deleteFailed && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{t('bankReconciliation.shared.deleteFailed')}</p>}
      {(linesQuery.isError) && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{t('bankReconciliation.shared.loadFailed')}</p>}

      <section className="grid gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><p className="text-xs font-semibold uppercase text-gray-500">{t('bankReconciliation.statements.period')}</p><p className="mt-1 text-sm font-medium text-gray-900">{formatDate(statement.period_start, i18n.language)} → {formatDate(statement.statement_date, i18n.language)}</p></div>
        <div><p className="text-xs font-semibold uppercase text-gray-500">{t('bankReconciliation.statements.openingBalance')}</p><p className="mt-1 text-sm font-medium tabular-nums text-gray-900">{formatMoney(statement.opening_balance, i18n.language)}</p></div>
        <div><p className="text-xs font-semibold uppercase text-gray-500">{t('bankReconciliation.statements.closingBalance')}</p><p className="mt-1 text-sm font-medium tabular-nums text-gray-900">{formatMoney(statement.closing_balance, i18n.language)}</p></div>
        <div>
          <p className="text-xs font-semibold uppercase text-gray-500">{t('bankReconciliation.statements.status')}</p>
          <span className={`mt-1 inline-flex rounded-full px-2 py-1 text-xs font-semibold ${statement.status === 'draft' ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'}`}>
            {t(statement.status === 'draft' ? 'bankReconciliation.statements.statusDraft' : 'bankReconciliation.statements.statusReconciled')}
          </span>
        </div>
        <div><p className="text-xs font-semibold uppercase text-gray-500">{t('bankReconciliation.statements.lineCount')}</p><p className="mt-1 text-sm font-medium text-gray-900">{statement.line_count}</p></div>
        <div><p className="text-xs font-semibold uppercase text-gray-500">{t('bankReconciliation.statements.totalDeposits')}</p><p className="mt-1 text-sm font-medium tabular-nums text-emerald-700">{formatMoney(statement.total_deposits, i18n.language)}</p></div>
        <div><p className="text-xs font-semibold uppercase text-gray-500">{t('bankReconciliation.statements.totalWithdrawals')}</p><p className="mt-1 text-sm font-medium tabular-nums text-red-700">{formatMoney(statement.total_withdrawals, i18n.language)}</p></div>
        <div><p className="text-xs font-semibold uppercase text-gray-500">{t('bankReconciliation.statements.importedAt')}</p><p className="mt-1 text-sm font-medium text-gray-900">{formatDate(statement.created_at.slice(0, 10), i18n.language)}</p></div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm" aria-label={t('bankReconciliation.detail.linesTitle')}>
        <div className="border-b border-gray-100 px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-gray-900">{t('bankReconciliation.detail.linesTitle')}</h2>
        </div>
        {linesQuery.isPending ? (
          <div role="status" className="p-8 text-center text-sm text-gray-500">{t('common.loading')}</div>
        ) : lines.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-600">{t('bankReconciliation.detail.noLines')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">{t('bankReconciliation.detail.transactionDate')}</th>
                  <th className="px-4 py-3">{t('bankReconciliation.detail.description')}</th>
                  <th className="px-4 py-3">{t('bankReconciliation.detail.reference')}</th>
                  <th className="px-4 py-3 text-right">{t('bankReconciliation.detail.amount')}</th>
                  <th className="px-4 py-3 text-right">{t('bankReconciliation.detail.runningBalance')}</th>
                  <th className="px-4 py-3">{t('bankReconciliation.detail.matchStatus')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((line) => (
                  <tr key={line.id}>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">{formatDate(line.transaction_date, i18n.language)}</td>
                    <td className="px-4 py-3 text-gray-900">{line.description}</td>
                    <td className="px-4 py-3 text-gray-600">{line.reference || t('bankReconciliation.shared.notSet')}</td>
                    <td className={`whitespace-nowrap px-4 py-3 text-right font-medium tabular-nums ${line.amount > 0 ? 'text-emerald-700' : line.amount < 0 ? 'text-red-700' : 'text-gray-700'}`}>
                      {formatMoney(line.amount, i18n.language)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-gray-700">{line.running_balance === null ? t('bankReconciliation.shared.notSet') : formatMoney(line.running_balance, i18n.language)}</td>
                    <td className="px-4 py-3 text-gray-500">{t('bankReconciliation.detail.pendingMatch')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
