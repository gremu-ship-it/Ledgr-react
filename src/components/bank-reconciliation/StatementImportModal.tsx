import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  calculateStatementBalance,
  detectStatementColumns,
  parseStatementCsv,
  StatementCsvParseError,
  validateStatementRows,
  type ParsedStatementCsv,
  type StatementColumnMapping,
} from '@/lib/bankReconciliation/statementCsv';
import { BankReconciliationRepository, type BankAccount, type BankStatement } from '@/dal/repositories/BankReconciliationRepository';
import { supabase } from '@/lib/supabase';

interface StatementImportModalProps {
  businessId: string;
  accounts: BankAccount[];
  statements: BankStatement[];
  onClose: () => void;
  onImported: (lineCount: number) => void;
}

const MAPPING_FIELDS = [
  ['date', 'bankReconciliation.import.dateColumn'],
  ['description', 'bankReconciliation.import.descriptionColumn'],
  ['reference', 'bankReconciliation.import.referenceColumn'],
  ['amount', 'bankReconciliation.import.amountColumn'],
  ['debit', 'bankReconciliation.import.debitColumn'],
  ['credit', 'bankReconciliation.import.creditColumn'],
  ['balance', 'bankReconciliation.import.balanceColumn'],
] as const;

function todayIso(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function firstDayOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function nextDay(date: string): string {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export function StatementImportModal({ businessId, accounts, statements, onClose, onImported }: StatementImportModalProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [bankAccountId, setBankAccountId] = useState(accounts[0]?.id ?? '');
  const [statementDate, setStatementDate] = useState(todayIso());
  const [periodStartOverride, setPeriodStartOverride] = useState<{ key: string; value: string } | null>(null);
  const [openingBalanceOverride, setOpeningBalanceOverride] = useState<{ key: string; value: string } | null>(null);
  const [closingBalance, setClosingBalance] = useState('');
  const [parsedCsv, setParsedCsv] = useState<ParsedStatementCsv | null>(null);
  const [mapping, setMapping] = useState<StatementColumnMapping>({ date: null, description: null, reference: null, amount: null, debit: null, credit: null, balance: null });
  const [parseErrorKey, setParseErrorKey] = useState('');
  const [validationErrorKey, setValidationErrorKey] = useState('');
  const [importing, setImporting] = useState(false);
  const [importFailed, setImportFailed] = useState(false);

  const previousStatement = useMemo(() => statements
    .filter((statement) => statement.bank_account_id === bankAccountId && statement.statement_date < statementDate)
    .sort((a, b) => b.statement_date.localeCompare(a.statement_date))[0], [bankAccountId, statementDate, statements]);

  const statementDefaultsKey = `${bankAccountId}:${statementDate}:${previousStatement?.id ?? ''}`;
  const periodStart = periodStartOverride?.key === statementDefaultsKey
    ? periodStartOverride.value
    : previousStatement ? nextDay(previousStatement.statement_date) : firstDayOfMonth(statementDate);
  const openingBalance = openingBalanceOverride?.key === statementDefaultsKey
    ? openingBalanceOverride.value
    : previousStatement ? String(previousStatement.closing_balance) : '0';

  const mappingComplete = mapping.date !== null
    && mapping.description !== null
    && (mapping.amount !== null || (mapping.debit !== null && mapping.credit !== null));
  const validation = useMemo(() => parsedCsv && mappingComplete
    ? validateStatementRows(parsedCsv.rows, mapping, periodStart, statementDate)
    : { lines: [], errors: [] }, [mapping, mappingComplete, parsedCsv, periodStart, statementDate]);
  const numericOpening = openingBalance.trim() === '' ? null : Number(openingBalance);
  const numericClosing = closingBalance.trim() === '' ? null : Number(closingBalance);
  const balancesValid = numericOpening !== null && Number.isFinite(numericOpening)
    && numericClosing !== null && Number.isFinite(numericClosing);
  const computedClosing = balancesValid ? calculateStatementBalance(numericOpening ?? 0, validation.lines) : 0;
  const balanceDifference = balancesValid ? numericClosing - computedClosing : 0;
  const balanceMismatch = balancesValid && validation.lines.length > 0 && Math.abs(balanceDifference) > 0.01;

  const onFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setParsedCsv(null);
    setParseErrorKey('');
    setValidationErrorKey('');
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
      setParseErrorKey('bankReconciliation.import.csvOnly');
      return;
    }
    try {
      const result = parseStatementCsv(await file.text());
      setParsedCsv(result);
      setMapping(detectStatementColumns(result.headers));
    } catch (error) {
      if (error instanceof StatementCsvParseError) {
        setParseErrorKey(`bankReconciliation.import.${error.reason}`);
      } else {
        setParseErrorKey('bankReconciliation.import.csvParseFailed');
      }
    }
  };

  const updateMapping = (field: keyof StatementColumnMapping, value: string) => {
    setMapping((current) => ({ ...current, [field]: value === '' ? null : Number(value) }));
  };

  const goToReview = () => {
    setValidationErrorKey('');
    if (!parsedCsv) {
      setValidationErrorKey('bankReconciliation.import.selectCsvFirst');
      return;
    }
    if (!mappingComplete) {
      setValidationErrorKey('bankReconciliation.import.mappingRequired');
      return;
    }
    if (validation.errors.length > 0) return;
    if (validation.lines.length === 0) {
      setValidationErrorKey('bankReconciliation.import.noTransactions');
      return;
    }
    setStep(3);
  };

  const importStatement = async () => {
    if (!balancesValid || !mappingComplete || validation.errors.length > 0 || validation.lines.length === 0) return;
    setImporting(true);
    setImportFailed(false);
    try {
      await BankReconciliationRepository.importStatement(supabase, {
        businessId,
        bankAccountId,
        statementDate,
        periodStart,
        openingBalance: numericOpening ?? 0,
        closingBalance: numericClosing ?? 0,
        lines: validation.lines,
      });
      onImported(validation.lines.length);
    } catch {
      setImportFailed(true);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !importing) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="statement-import-title" className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="statement-import-title" className="text-xl font-semibold text-gray-900">{t('bankReconciliation.import.title')}</h2>
            <p className="mt-1 text-sm text-gray-500">{t(`bankReconciliation.import.step${step}`)}</p>
          </div>
          <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-600">{t('bankReconciliation.accounts.currency')}: MWK</span>
        </div>

        {accounts.length === 0 ? (
          <div className="mt-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-800">{t('bankReconciliation.import.noActiveAccounts')}</div>
        ) : (
          <>
            {step === 1 && (
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-gray-700">
                  {t('bankReconciliation.import.selectAccount')}
                  <select value={bankAccountId} onChange={(event) => setBankAccountId(event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
                    {accounts.map((account) => <option key={account.id} value={account.id}>{account.bank_name} · {account.account_number} · {account.account_code}</option>)}
                  </select>
                </label>
                <label className="text-sm font-medium text-gray-700">
                  {t('bankReconciliation.import.statementDate')}
                  <input type="date" value={statementDate} onChange={(event) => setStatementDate(event.target.value)} required className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2" />
                </label>
                <label className="text-sm font-medium text-gray-700">
                  {t('bankReconciliation.import.periodStart')}
                  <input type="date" value={periodStart} max={statementDate} onChange={(event) => setPeriodStartOverride({ key: statementDefaultsKey, value: event.target.value })} required className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2" />
                </label>
                <label className="text-sm font-medium text-gray-700">
                  {t('bankReconciliation.statements.openingBalance')}
                  <input type="number" step="0.01" value={openingBalance} onChange={(event) => setOpeningBalanceOverride({ key: statementDefaultsKey, value: event.target.value })} required className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2" />
                </label>
                <label className="text-sm font-medium text-gray-700 sm:col-span-2">
                  {t('bankReconciliation.statements.closingBalance')}
                  <input type="number" step="0.01" value={closingBalance} onChange={(event) => setClosingBalance(event.target.value)} required className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 sm:max-w-sm" />
                </label>
                {(!statementDate || !periodStart || periodStart > statementDate || !balancesValid) && (
                  <p role="alert" className="text-sm text-red-700 sm:col-span-2">{t('bankReconciliation.import.periodAndBalancesRequired')}</p>
                )}
              </div>
            )}

            {step === 2 && (
              <div className="mt-6 space-y-5">
                <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">{t('bankReconciliation.import.csvFormat')}</div>
                <label className="block text-sm font-medium text-gray-700">
                  {t('bankReconciliation.import.uploadCSV')}
                  <input type="file" accept=".csv,text/csv" onChange={(event) => void onFileSelected(event)} className="mt-1 block w-full rounded-lg border border-gray-300 p-2 text-sm file:me-3 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5" />
                </label>
                {parseErrorKey && <p role="alert" className="text-sm text-red-700">{t(parseErrorKey)}</p>}
                {parsedCsv && (
                  <>
                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-gray-900">{t('bankReconciliation.import.columnMapping')}</h3>
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {MAPPING_FIELDS.map(([field, labelKey]) => (
                          <label key={field} className="text-xs font-medium text-gray-600">
                            {t(labelKey)}
                            <select value={mapping[field] === null ? '' : String(mapping[field])} onChange={(event) => updateMapping(field, event.target.value)} className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm">
                              <option value="">{t('bankReconciliation.shared.notSet')}</option>
                              {parsedCsv.headers.map((header, index) => <option key={`${index}-${header}`} value={index}>{header}</option>)}
                            </select>
                          </label>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-gray-500">{t('bankReconciliation.import.autoDetected')}</p>
                      {!mappingComplete && <p role="alert" className="mt-2 text-sm text-red-700">{t('bankReconciliation.import.mappingRequired')}</p>}
                    </div>

                    <div>
                      <h3 className="mb-2 text-sm font-semibold text-gray-900">{t('bankReconciliation.import.preview')} · {t('bankReconciliation.import.previewRows', { count: Math.min(10, parsedCsv.rows.length) })}</h3>
                      <div className="max-h-64 overflow-auto rounded-lg border border-gray-200">
                        <table className="w-full min-w-[620px] text-xs">
                          <thead className="sticky top-0 bg-gray-50 text-left text-gray-600">
                            <tr>{parsedCsv.headers.map((header, index) => <th key={`${index}-${header}`} className="px-3 py-2">{header}</th>)}</tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {parsedCsv.rows.slice(0, 10).map((row, index) => (
                              <tr key={index}>{parsedCsv.headers.map((_, columnIndex) => <td key={`${index}-${columnIndex}`} className="max-w-64 truncate px-3 py-2">{row[columnIndex]}</td>)}</tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {mappingComplete && validation.errors.length > 0 && (
                      <div role="alert" className="max-h-36 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                        {validation.errors.map((error, index) => (
                          <p key={`${error.row}-${index}`}>{t('bankReconciliation.import.validateError', {
                            row: error.row,
                            message: t(`bankReconciliation.import.${error.reason}`),
                          })}</p>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {validationErrorKey && <p role="alert" className="text-sm text-red-700">{t(validationErrorKey)}</p>}
              </div>
            )}

            {step === 3 && (
              <div className="mt-6 space-y-4">
                <p className="text-sm text-gray-700">{t('bankReconciliation.import.reviewSummary', { count: validation.lines.length })}</p>
                {balanceMismatch && (
                  <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    {t('bankReconciliation.import.balanceMismatch', {
                      computed: computedClosing.toFixed(2),
                      expected: numericClosing?.toFixed(2) ?? '',
                      difference: balanceDifference.toFixed(2),
                    })}
                  </p>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <p className="text-sm text-gray-700">{t('bankReconciliation.statements.openingBalance')}: {numericOpening?.toFixed(2)} MWK</p>
                  <p className="text-sm text-gray-700">{t('bankReconciliation.statements.closingBalance')}: {numericClosing?.toFixed(2)} MWK</p>
                </div>
                {importFailed && <p role="alert" className="text-sm text-red-700">{t('bankReconciliation.import.importFailed')}</p>}
              </div>
            )}
          </>
        )}

        <div className="mt-7 flex flex-wrap justify-between gap-2 border-t border-gray-100 pt-4">
          <div>
            {step > 1 && <button type="button" onClick={() => setStep((current) => current === 3 ? 2 : 1)} disabled={importing} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700">{t('common.back')}</button>}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={importing} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700">{t('common.cancel')}</button>
            {step === 1 && accounts.length > 0 && <button type="button" onClick={() => setStep(2)} disabled={!bankAccountId || !statementDate || !periodStart || periodStart > statementDate || !balancesValid} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t('common.next')}</button>}
            {step === 2 && accounts.length > 0 && <button type="button" onClick={goToReview} disabled={!parsedCsv || !mappingComplete || validation.errors.length > 0 || validation.lines.length === 0} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t('common.next')}</button>}
            {step === 3 && accounts.length > 0 && <button type="button" onClick={() => void importStatement()} disabled={importing || !balancesValid || validation.errors.length > 0 || validation.lines.length === 0} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{importing ? t('bankReconciliation.import.importing') : t('bankReconciliation.import.importButton')}</button>}
          </div>
        </div>
      </section>
    </div>
  );
}
