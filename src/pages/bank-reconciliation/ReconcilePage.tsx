import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Download, LockKeyhole, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BankReconciliationRepository, type BankReconciliationMatch, type BankStatementLine, type ReconciliationGlLine } from '@/dal/repositories/BankReconciliationRepository';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';
import { usePermissions } from '@/hooks/usePermissions';
import { autoMatch, type BankStatementMatchLine } from '@/lib/reconciliation/matcher';
import { computeReconciliationReport } from '@/lib/reconciliation/reconciliationReport';

function formatDate(date: string, locale: string): string {
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short', year: 'numeric' })
    .format(new Date(year, month - 1, day));
}

function formatMoney(amount: number, locale: string): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'MWK', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

const EMPTY_BANK_LINES: BankStatementLine[] = [];
const EMPTY_GL_LINES: ReconciliationGlLine[] = [];
const EMPTY_MATCHES: BankReconciliationMatch[] = [];

function signedGlAmount(line: ReconciliationGlLine): number {
  return line.is_debit ? line.amount : -line.amount;
}

function escapeCsv(value: string | number): string {
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function ReconcilePage() {
  const { t, i18n } = useTranslation();
  const { statementId = '' } = useParams();
  const queryClient = useQueryClient();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? '');
  const { canWrite, canDelete } = usePermissions();
  const [selectedBankLineId, setSelectedBankLineId] = useState<string | null>(null);
  const [selectedGlLineIds, setSelectedGlLineIds] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [errorKey, setErrorKey] = useState('');
  const [autoResult, setAutoResult] = useState<ReturnType<typeof autoMatch> | null>(null);

  const statementQuery = useQuery({
    queryKey: ['bank-reconciliation', 'statement', businessId, statementId],
    queryFn: () => BankReconciliationRepository.getStatement(supabase, businessId, statementId),
    enabled: Boolean(businessId && statementId),
  });
  const statement = statementQuery.data;
  const bankLinesQuery = useQuery({
    queryKey: ['bank-reconciliation', 'statement-lines', statementId],
    queryFn: () => BankReconciliationRepository.getStatementLines(supabase, statementId),
    enabled: Boolean(statementId && statement),
  });
  const matchesQuery = useQuery({
    queryKey: ['bank-reconciliation', 'matches', statementId],
    queryFn: () => BankReconciliationRepository.getMatchesForStatement(supabase, statementId),
    enabled: Boolean(statementId && statement),
  });
  const glLinesQuery = useQuery({
    queryKey: ['bank-reconciliation', 'gl-lines', businessId, statement?.bank_account_id, statement?.period_start, statement?.statement_date],
    queryFn: () => BankReconciliationRepository.getReconciliationGlLines(supabase, {
      businessId,
      bankAccountId: statement?.bank_account_id ?? '',
      dateFrom: statement?.period_start ?? '',
      dateTo: statement?.statement_date ?? '',
    }),
    enabled: Boolean(businessId && statement),
  });
  const bookBalanceQuery = useQuery({
    queryKey: ['bank-reconciliation', 'book-balance', businessId, statement?.bank_account_id, statement?.statement_date],
    queryFn: () => BankReconciliationRepository.getBookBalance(supabase, businessId, statement?.bank_account_id ?? '', statement?.statement_date ?? ''),
    enabled: Boolean(businessId && statement),
  });

  const bankLines = bankLinesQuery.data ?? EMPTY_BANK_LINES;
  const glLines = glLinesQuery.data ?? EMPTY_GL_LINES;
  const matches = matchesQuery.data ?? EMPTY_MATCHES;
  const matchedTotals = useMemo(() => {
    const bank = new Map<string, number>();
    const gl = new Map<string, number>();
    for (const match of matches) {
      bank.set(match.statement_line_id, (bank.get(match.statement_line_id) ?? 0) + match.matched_amount);
      gl.set(match.journal_line_id, (gl.get(match.journal_line_id) ?? 0) + match.matched_amount);
    }
    return { bank, gl };
  }, [matches]);
  const bankMatchLines: BankStatementMatchLine[] = useMemo(() => bankLines.map((line) => ({
    id: line.id,
    transaction_date: line.transaction_date,
    description: line.description,
    reference: line.reference,
    amount: line.amount,
    matchedAmount: line.is_reconciled ? Math.abs(line.amount) : matchedTotals.bank.get(line.id) ?? 0,
  })), [bankLines, matchedTotals.bank]);
  const glMatchLines = useMemo(() => glLines.map((line) => ({
    ...line,
    matchedAmount: Math.max(matchedTotals.gl.get(line.id) ?? 0, line.matchedAmount),
  })), [glLines, matchedTotals.gl]);
  const report = useMemo(() => statement ? computeReconciliationReport(
    bankMatchLines,
    glMatchLines,
    matches,
    statement.closing_balance,
    bookBalanceQuery.data ?? 0,
    { bankName: statement.bank_name, accountNumber: statement.account_number, statementDate: statement.statement_date },
  ) : null, [bankMatchLines, bookBalanceQuery.data, glMatchLines, matches, statement]);
  const locked = statement?.status === 'reconciled';
  const queryFailed = statementQuery.isError || bankLinesQuery.isError || matchesQuery.isError || glLinesQuery.isError || bookBalanceQuery.isError;
  const loading = statementQuery.isPending || bankLinesQuery.isPending || matchesQuery.isPending || glLinesQuery.isPending || bookBalanceQuery.isPending;
  const bankLineById = useMemo(() => new Map(bankLines.map((line) => [line.id, line])), [bankLines]);
  const glLineById = useMemo(() => new Map(glLines.map((line) => [line.id, line])), [glLines]);

  const refreshData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['bank-reconciliation', 'statement', businessId, statementId] }),
      queryClient.invalidateQueries({ queryKey: ['bank-reconciliation', 'statement-lines', statementId] }),
      queryClient.invalidateQueries({ queryKey: ['bank-reconciliation', 'matches', statementId] }),
      queryClient.invalidateQueries({ queryKey: ['bank-reconciliation', 'gl-lines', businessId] }),
      queryClient.invalidateQueries({ queryKey: ['bank-reconciliation', 'book-balance', businessId] }),
      queryClient.invalidateQueries({ queryKey: ['bank-reconciliation', 'statements', businessId] }),
      queryClient.invalidateQueries({ queryKey: ['bank-reconciliation', 'statement-history', businessId] }),
    ]);
    setSelectedBankLineId(null);
    setSelectedGlLineIds([]);
  };

  const runAutoMatch = async () => {
    if (!statement || !canWrite || locked || working) return;
    setErrorKey('');
    const result = autoMatch(bankMatchLines, glMatchLines);
    setAutoResult(result);
    if (result.matches.length === 0) {
      setErrorKey('bankReconciliation.reconcile.noMatches');
      return;
    }
    const high = result.matches.filter((match) => match.confidence >= 90).length;
    const medium = result.matches.filter((match) => match.confidence === 80).length;
    const low = result.matches.filter((match) => match.confidence === 60).length;
    const confirmation = [
      t('bankReconciliation.reconcile.autoMatchConfirm', { count: result.matches.length }),
      t('bankReconciliation.reconcile.autoMatchHigh', { count: high }),
      t('bankReconciliation.reconcile.autoMatchMedium', { count: medium }),
      t('bankReconciliation.reconcile.autoMatchLow', { count: low }),
    ].join('\n');
    if (!window.confirm(confirmation)) return;
    setWorking(true);
    try {
      await BankReconciliationRepository.bulkCreateMatches(supabase, businessId, statement.id, result.matches.map((match) => ({
        bankLineId: match.bankLineId,
        glLineId: match.glLineId,
        matchedAmount: match.amount,
        isAutoMatch: true,
      })));
      await refreshData();
    } catch {
      setErrorKey('bankReconciliation.reconcile.matchFailed');
    } finally {
      setWorking(false);
    }
  };

  const matchSelected = async () => {
    if (!statement || !canWrite || locked || !selectedBankLineId || selectedGlLineIds.length === 0 || working) return;
    setErrorKey('');
    const bankLine = bankMatchLines.find((line) => line.id === selectedBankLineId);
    const selectedGlLines = glMatchLines.filter((line) => selectedGlLineIds.includes(line.id));
    if (!bankLine || selectedGlLines.length === 0) return;
    const bankRemaining = Math.max(0, Math.abs(bankLine.amount) - (bankLine.matchedAmount ?? 0));
    const selectedTotal = selectedGlLines.reduce((total, line) => total + Math.max(0, line.amount - (line.matchedAmount ?? 0)), 0);
    const bankIsDebit = bankLine.amount > 0;
    if (selectedGlLines.some((line) => line.is_debit !== bankIsDebit)) {
      setErrorKey('bankReconciliation.reconcile.directionMismatch');
      return;
    }
    const difference = Math.abs(selectedTotal - bankRemaining);
    if (difference > 0.005 && !window.confirm(t('bankReconciliation.reconcile.amountMismatch', { difference: formatMoney(difference, i18n.language) }))) return;

    let remainingBank = bankRemaining;
    const inputs = selectedGlLines.flatMap((line) => {
      const available = Math.max(0, line.amount - (line.matchedAmount ?? 0));
      const amount = Math.min(remainingBank, available);
      remainingBank -= amount;
      return amount > 0 ? [{ bankLineId: selectedBankLineId, glLineId: line.id, matchedAmount: amount, isAutoMatch: false }] : [];
    });
    if (inputs.length === 0) return;
    setWorking(true);
    try {
      await BankReconciliationRepository.bulkCreateMatches(supabase, businessId, statement.id, inputs);
      await refreshData();
    } catch {
      setErrorKey('bankReconciliation.reconcile.matchFailed');
    } finally {
      setWorking(false);
    }
  };

  const deleteMatch = async (match: BankReconciliationMatch) => {
    if (!canWrite || locked || working) return;
    setErrorKey('');
    setWorking(true);
    try {
      await BankReconciliationRepository.deleteMatch(supabase, businessId, match.id);
      await refreshData();
    } catch {
      setErrorKey('bankReconciliation.reconcile.unmatchFailed');
    } finally {
      setWorking(false);
    }
  };

  const reconcile = async () => {
    if (!statement || !report || !canWrite || locked || working) return;
    const message = report.isReconciled
      ? t('bankReconciliation.reconcile.reconcileConfirm')
      : t('bankReconciliation.reconcile.nonZeroConfirm', { amount: formatMoney(Math.abs(report.difference), i18n.language) });
    if (!window.confirm(message)) return;
    setErrorKey('');
    setWorking(true);
    try {
      await BankReconciliationRepository.reconcileStatement(supabase, businessId, statement.id);
      await refreshData();
    } catch {
      setErrorKey('bankReconciliation.reconcile.statusChangeFailed');
    } finally {
      setWorking(false);
    }
  };

  const unreconcile = async () => {
    if (!statement || !canDelete || !locked || working) return;
    if (!window.confirm(t('bankReconciliation.reconcile.unreconcileConfirm'))) return;
    setErrorKey('');
    setWorking(true);
    try {
      await BankReconciliationRepository.unreconcileStatement(supabase, businessId, statement.id);
      await refreshData();
    } catch {
      setErrorKey('bankReconciliation.reconcile.statusChangeFailed');
    } finally {
      setWorking(false);
    }
  };

  const exportReport = () => {
    if (!report) return;
    const rows: Array<Array<string | number>> = [
      [t('bankReconciliation.reconcile.report.title'), ''],
      [t('bankReconciliation.reconcile.report.bankAccount'), `${report.bankName} · ${report.accountNumber}`],
      [t('bankReconciliation.reconcile.report.asOf'), report.statementDate],
      [t('bankReconciliation.reconcile.report.bankClosing'), report.bankClosingBalance.toFixed(2)],
      [t('bankReconciliation.reconcile.report.depositsInTransit'), report.depositsInTransit.reduce((sum, item) => sum + item.amount, 0).toFixed(2)],
      [t('bankReconciliation.reconcile.report.outstandingCheques'), report.outstandingCheques.reduce((sum, item) => sum + item.amount, 0).toFixed(2)],
      [t('bankReconciliation.reconcile.report.adjustedBank'), report.adjustedBankBalance.toFixed(2)],
      [t('bankReconciliation.reconcile.report.bookBalance'), report.bookBalance.toFixed(2)],
      [t('bankReconciliation.reconcile.report.unpresentedDeposits'), report.unpresentedDeposits.reduce((sum, item) => sum + item.amount, 0).toFixed(2)],
      [t('bankReconciliation.reconcile.report.bankCharges'), report.bankCharges.reduce((sum, item) => sum + item.amount, 0).toFixed(2)],
      [t('bankReconciliation.reconcile.report.otherBankItems'), report.otherUnmatchedBankLines.reduce((sum, item) => sum + item.amount, 0).toFixed(2)],
      [t('bankReconciliation.reconcile.report.adjustedBook'), report.adjustedBookBalance.toFixed(2)],
      [t('bankReconciliation.reconcile.report.difference'), report.difference.toFixed(2)],
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `bank-reconciliation-${statement?.statement_date ?? 'report'}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  if (statementQuery.isPending) return <div role="status" className="p-6 text-sm text-gray-500">{t('bankReconciliation.reconcile.loading')}</div>;
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
    <main className="mx-auto w-full max-w-7xl space-y-5">
      <header className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <Link to={`/bank-reconciliation/statements/${statement.id}`} className="inline-flex items-center gap-2 text-sm font-semibold text-brand-700 hover:underline">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />{t('bankReconciliation.detail.backToStatement')}
        </Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">{t('bankReconciliation.reconcile.title')}</h1>
            <p className="mt-1 text-sm text-gray-600">{statement.bank_name} · {statement.account_number} · {formatDate(statement.period_start, i18n.language)} → {formatDate(statement.statement_date, i18n.language)}</p>
            <p className="mt-1 text-sm text-gray-600">{t('bankReconciliation.statements.closingBalance')}: {formatMoney(statement.closing_balance, i18n.language)} · {t('bankReconciliation.reconcile.report.bookBalance')}: {formatMoney(bookBalanceQuery.data ?? 0, i18n.language)}</p>
          </div>
          <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${locked ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>
            {locked ? <LockKeyhole className="h-3.5 w-3.5" aria-hidden="true" /> : null}
            {t(locked ? 'bankReconciliation.statements.statusReconciled' : 'bankReconciliation.statements.statusDraft')}
          </span>
        </div>
        {locked && <p role="status" className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t('bankReconciliation.reconcile.locked')}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void runAutoMatch()} disabled={!canWrite || locked || working || loading} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            <Sparkles className="h-4 w-4" aria-hidden="true" />{t('bankReconciliation.reconcile.autoMatch')}
          </button>
          {locked ? (
            canDelete && <button type="button" onClick={() => void unreconcile()} disabled={working} className="rounded-lg border border-amber-300 px-3 py-2 text-sm font-semibold text-amber-800 disabled:opacity-50">{t('bankReconciliation.reconcile.unreconcile')}</button>
          ) : (
            canWrite && <button type="button" onClick={() => void reconcile()} disabled={working || loading || !report} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{t('bankReconciliation.reconcile.reconcile')}</button>
          )}
          <button type="button" onClick={exportReport} disabled={!report} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold text-gray-700 disabled:opacity-50">
            <Download className="h-4 w-4" aria-hidden="true" />{t('bankReconciliation.reconcile.export')}
          </button>
        </div>
      </header>

      {queryFailed && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{t('bankReconciliation.shared.loadFailed')}</p>}
      {errorKey && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{t(errorKey)}</p>}
      {autoResult?.suggestedGroups.length ? (
        <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          <h2 className="text-sm font-semibold text-indigo-900">{t('bankReconciliation.reconcile.suggestedGroups')}</h2>
          <ul className="mt-2 space-y-1 text-sm text-indigo-900">
            {autoResult.suggestedGroups.map((group) => <li key={`${group.bankLineId}-${group.glLineIds.join('-')}`}>
              {t('bankReconciliation.reconcile.suggestedGroup', {
                bankDescription: bankLineById.get(group.bankLineId)?.description ?? '',
                count: group.glLineIds.length,
                amount: formatMoney(Math.abs(group.glTotal), i18n.language),
              })}
            </li>)}
          </ul>
        </section>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm" aria-label={t('bankReconciliation.reconcile.bankLines')}>
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">{t('bankReconciliation.reconcile.bankLines')}</h2>
            <span className="text-xs text-gray-500">{t('bankReconciliation.reconcile.lineCounts', { matched: bankLines.filter((line) => line.is_reconciled || (matchedTotals.bank.get(line.id) ?? 0) >= Math.abs(line.amount)).length, total: bankLines.length })}</span>
          </div>
          {loading ? <div role="status" className="p-6 text-sm text-gray-500">{t('bankReconciliation.reconcile.loading')}</div> : bankLines.length === 0 ? <p className="p-6 text-sm text-gray-600">{t('bankReconciliation.detail.noLines')}</p> : (
            <ul className="divide-y divide-gray-100">
              {bankLines.map((line) => {
                const matchedAmount = line.is_reconciled ? Math.abs(line.amount) : matchedTotals.bank.get(line.id) ?? 0;
                const remaining = Math.max(0, Math.abs(line.amount) - matchedAmount);
                const selected = selectedBankLineId === line.id;
                const lineMatches = matches.filter((match) => match.statement_line_id === line.id);
                return <li key={line.id} className={`p-3 ${selected ? 'bg-blue-50' : matchedAmount > 0 && remaining < 0.005 ? 'bg-emerald-50/70' : ''}`}>
                  <button type="button" disabled={locked || !canWrite || remaining < 0.005} aria-pressed={selected} onClick={() => { setSelectedBankLineId(selected ? null : line.id); setSelectedGlLineIds([]); setErrorKey(''); }} className="grid w-full grid-cols-[1fr_auto] gap-3 text-left disabled:cursor-default">
                    <span>
                      <span className="block text-sm font-medium text-gray-900">{formatDate(line.transaction_date, i18n.language)} · {line.description}</span>
                      {line.reference && <span className="mt-0.5 block text-xs text-gray-500">{t('bankReconciliation.detail.reference')}: {line.reference}</span>}
                      {matchedAmount > 0 && <span className="mt-1 block text-xs text-emerald-800">{t('bankReconciliation.reconcile.matchedAmount', { amount: formatMoney(matchedAmount, i18n.language) })}</span>}
                      {remaining >= 0.005 && matchedAmount > 0 && <span className="block text-xs text-amber-800">{t('bankReconciliation.reconcile.remainingAmount', { amount: formatMoney(remaining, i18n.language) })}</span>}
                    </span>
                    <span className={`whitespace-nowrap text-sm font-semibold tabular-nums ${line.amount >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{line.amount > 0 ? '+' : ''}{formatMoney(line.amount, i18n.language)}</span>
                  </button>
                  {lineMatches.map((match) => <div key={match.id} className="mt-2 flex items-center justify-between gap-2 rounded-md bg-white/80 px-2 py-1.5 text-xs text-gray-700">
                    <span>{t('bankReconciliation.reconcile.matchedTo', { description: glLineById.get(match.journal_line_id)?.description ?? '' })} · {formatMoney(match.matched_amount, i18n.language)}{match.is_auto_match ? ` · ${t('bankReconciliation.reconcile.autoMatched')}` : ''}</span>
                    {!locked && canWrite && <button type="button" onClick={() => void deleteMatch(match)} disabled={working} aria-label={t('bankReconciliation.reconcile.unmatch')} className="inline-flex items-center gap-1 rounded px-2 py-1 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"><X className="h-3.5 w-3.5" aria-hidden="true" />{t('bankReconciliation.reconcile.unmatch')}</button>}
                  </div>)}
                </li>;
              })}
            </ul>
          )}
        </section>

        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm" aria-label={t('bankReconciliation.reconcile.glLines')}>
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-gray-900">{t('bankReconciliation.reconcile.glLines')}</h2>
            <span className="text-xs text-gray-500">{t('bankReconciliation.reconcile.lineCounts', { matched: glLines.filter((line) => (matchedTotals.gl.get(line.id) ?? 0) >= line.amount).length, total: glLines.length })}</span>
          </div>
          {loading ? <div role="status" className="p-6 text-sm text-gray-500">{t('bankReconciliation.reconcile.loading')}</div> : glLines.length === 0 ? <p className="p-6 text-sm text-gray-600">{t('bankReconciliation.reconcile.noGlLines')}</p> : (
            <ul className="divide-y divide-gray-100">
              {glLines.map((line) => {
                const matchedAmount = matchedTotals.gl.get(line.id) ?? line.matchedAmount;
                const remaining = Math.max(0, line.amount - matchedAmount);
                const selected = selectedGlLineIds.includes(line.id);
                const lineMatches = matches.filter((match) => match.journal_line_id === line.id);
                return <li key={line.id} className={`p-3 ${selected ? 'bg-blue-50' : matchedAmount > 0 && remaining < 0.005 ? 'bg-emerald-50/70' : ''}`}>
                  <button type="button" disabled={locked || !canWrite || remaining < 0.005} aria-pressed={selected} onClick={(event) => {
                    if (selectedBankLineId) {
                      const selectedBank = bankMatchLines.find((item) => item.id === selectedBankLineId);
                      if (selectedBank && (selectedBank.amount > 0) !== line.is_debit) {
                        setErrorKey('bankReconciliation.reconcile.directionMismatch');
                        return;
                      }
                    }
                    setErrorKey('');
                    setSelectedGlLineIds((current) => event.shiftKey
                      ? selected ? current.filter((id) => id !== line.id) : [...current, line.id]
                      : selected ? current.filter((id) => id !== line.id) : [...current, line.id]);
                  }} className="grid w-full grid-cols-[1fr_auto] gap-3 text-left disabled:cursor-default">
                    <span>
                      <span className="block text-sm font-medium text-gray-900">{formatDate(line.entry_date, i18n.language)} · {line.description}</span>
                      <span className="mt-0.5 block text-xs text-gray-500">{t('bankReconciliation.reconcile.entryNumber')}: {line.entry_number}</span>
                      {matchedAmount > 0 && <span className="mt-1 block text-xs text-emerald-800">{t('bankReconciliation.reconcile.matchedAmount', { amount: formatMoney(matchedAmount, i18n.language) })}</span>}
                      {remaining > 0.005 && matchedAmount > 0 && <span className="block text-xs text-amber-800">{t('bankReconciliation.reconcile.remainingAmount', { amount: formatMoney(remaining, i18n.language) })}</span>}
                    </span>
                    <span className={`whitespace-nowrap text-sm font-semibold tabular-nums ${line.is_debit ? 'text-emerald-700' : 'text-red-700'}`}>{signedGlAmount(line) > 0 ? '+' : ''}{formatMoney(signedGlAmount(line), i18n.language)}</span>
                  </button>
                  {lineMatches.map((match) => <div key={match.id} className="mt-2 flex items-center justify-between gap-2 rounded-md bg-white/80 px-2 py-1.5 text-xs text-gray-700">
                    <span>{t('bankReconciliation.reconcile.matchedFrom', { description: bankLineById.get(match.statement_line_id)?.description ?? '' })} · {formatMoney(match.matched_amount, i18n.language)}{match.is_auto_match ? ` · ${t('bankReconciliation.reconcile.autoMatched')}` : ''}</span>
                    {!locked && canWrite && <button type="button" onClick={() => void deleteMatch(match)} disabled={working} aria-label={t('bankReconciliation.reconcile.unmatch')} className="inline-flex items-center gap-1 rounded px-2 py-1 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"><X className="h-3.5 w-3.5" aria-hidden="true" />{t('bankReconciliation.reconcile.unmatch')}</button>}
                  </div>)}
                </li>;
              })}
            </ul>
          )}
        </section>
      </div>

      {selectedBankLineId && selectedGlLineIds.length > 0 && !locked && canWrite && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 shadow-lg">
          <p className="text-sm text-blue-900">{t('bankReconciliation.reconcile.selectToMatch', { count: selectedGlLineIds.length })}</p>
          <button type="button" onClick={() => void matchSelected()} disabled={working} className="inline-flex items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Check className="h-4 w-4" aria-hidden="true" />{t('bankReconciliation.reconcile.manualMatch')}</button>
        </div>
      )}

      {report && (
        <details open className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <summary className="cursor-pointer border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">{t('bankReconciliation.reconcile.report.title')}</summary>
          <div className="space-y-5 p-4 sm:p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-medium text-gray-500">{t('bankReconciliation.reconcile.report.bankClosing')}</p><p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{formatMoney(report.bankClosingBalance, i18n.language)}</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-medium text-gray-500">{t('bankReconciliation.reconcile.report.bookBalance')}</p><p className="mt-1 text-lg font-semibold tabular-nums text-gray-900">{formatMoney(report.bookBalance, i18n.language)}</p></div>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900">{t('bankReconciliation.reconcile.report.adjustedBank')}</h3>
                <ReportRow label={t('bankReconciliation.reconcile.report.bankClosing')} amount={report.bankClosingBalance} locale={i18n.language} />
                <ReportItemRows label={t('bankReconciliation.reconcile.report.depositsInTransit')} items={report.depositsInTransit} sign="+" locale={i18n.language} />
                <ReportItemRows label={t('bankReconciliation.reconcile.report.outstandingCheques')} items={report.outstandingCheques} sign="−" locale={i18n.language} />
                <ReportRow label={t('bankReconciliation.reconcile.report.adjustedBank')} amount={report.adjustedBankBalance} strong locale={i18n.language} />
              </div>
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-900">{t('bankReconciliation.reconcile.report.adjustedBook')}</h3>
                <ReportRow label={t('bankReconciliation.reconcile.report.bookBalance')} amount={report.bookBalance} locale={i18n.language} />
                <ReportItemRows label={t('bankReconciliation.reconcile.report.unpresentedDeposits')} items={report.unpresentedDeposits} sign="+" locale={i18n.language} />
                <ReportItemRows label={t('bankReconciliation.reconcile.report.bankCharges')} items={report.bankCharges} sign="−" locale={i18n.language} />
                <ReportItemRows label={t('bankReconciliation.reconcile.report.otherBankItems')} items={report.otherUnmatchedBankLines} sign="−" locale={i18n.language} />
                <ReportRow label={t('bankReconciliation.reconcile.report.adjustedBook')} amount={report.adjustedBookBalance} strong locale={i18n.language} />
              </div>
            </div>
            <div className={`flex flex-wrap items-center justify-between gap-2 rounded-xl p-4 ${report.isReconciled ? 'bg-emerald-50 text-emerald-900' : 'bg-rose-50 text-rose-900'}`}>
              <span className="font-semibold">{t('bankReconciliation.reconcile.report.difference')}</span>
              <span className="text-lg font-bold tabular-nums">{formatMoney(report.difference, i18n.language)}</span>
              <span className="inline-flex items-center gap-1 text-sm font-semibold">
                {report.isReconciled ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
                {report.isReconciled ? t('bankReconciliation.reconcile.report.balanced') : t('bankReconciliation.reconcile.report.notBalanced', { amount: formatMoney(Math.abs(report.difference), i18n.language) })}
              </span>
            </div>
          </div>
        </details>
      )}
    </main>
  );
}

function ReportRow({ label, amount, strong = false, locale }: { label: string; amount: number; strong?: boolean; locale: string }) {
  return <div className={`flex justify-between gap-4 text-sm ${strong ? 'border-t border-gray-200 pt-2 font-semibold text-gray-900' : 'text-gray-700'}`}><span>{label}</span><span className="tabular-nums">{formatMoney(amount, locale)}</span></div>;
}

function ReportItemRows({ label, items, sign, locale }: { label: string; items: Array<{ amount: number }>; sign: '+' | '−'; locale: string }) {
  const total = items.reduce((sum, item) => sum + item.amount, 0);
  return <div className="flex justify-between gap-4 text-sm text-gray-700"><span>{label}<span className="ms-1 text-xs text-gray-500">({items.length})</span></span><span className="tabular-nums">{sign}{formatMoney(total, locale)}</span></div>;
}
