import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, FileSpreadsheet, Upload, X } from 'lucide-react';
import {
  parseRawCsv,
  validateAndMapCsvRows,
  type CsvInvalidRow,
  type CsvParseResult,
  type EntityImportType,
} from '@/lib/csv/nativeCsvParser';

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: EntityImportType;
  title: string;
  onImport: (validRows: Record<string, unknown>[]) => Promise<void>;
  templateDownloadUrl?: string;
}

const ERROR_KEYS: Record<string, string> = {
  'Missing product name': 'csvImport.errors.missingProductName',
  'Missing SKU': 'csvImport.errors.missingSku',
  'Missing asset name': 'csvImport.errors.missingAssetName',
  'Invalid purchase cost': 'csvImport.errors.invalidPurchaseCost',
  'Missing contact / company name': 'csvImport.errors.missingContactName',
  'Missing account code': 'csvImport.errors.missingAccountCode',
  'Missing account name': 'csvImport.errors.missingAccountName',
  'Type must be asset, liability, equity, revenue, or expense': 'csvImport.errors.invalidAccountType',
};

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
    reader.readAsText(file);
  });
}

/**
 * Generic native CSV import dialog: file selection/drop, pure-TS parsing with
 * per-row validation, a two-tab preview, and a single batched import callback.
 */
export function CsvImportModal({
  isOpen,
  onClose,
  entityType,
  title,
  onImport,
  templateDownloadUrl,
}: CsvImportModalProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<CsvParseResult<Record<string, unknown>> | null>(null);
  const [activeTab, setActiveTab] = useState<'valid' | 'errors'>('valid');
  const [isReading, setIsReading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the previous upload whenever the dialog reopens
    setFileName(null);
    setResult(null);
    setActiveTab('valid');
    setSuccessMessage(null);
    setErrorMessage(null);
    setIsReading(false);
    setIsImporting(false);
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, [isOpen]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
      setErrorMessage(t('csvImport.invalidFile'));
      return;
    }

    setIsReading(true);
    setErrorMessage(null);
    try {
      const rows = parseRawCsv(await readFileText(file));
      const headers = rows[0] ?? [];
      setResult(validateAndMapCsvRows(headers, rows.slice(1), entityType));
      setFileName(file.name);
      setActiveTab('valid');
    } catch {
      setErrorMessage(t('csvImport.readFailed'));
    } finally {
      setIsReading(false);
    }
  };

  const handleImport = async () => {
    if (!result || result.validRows.length === 0 || isImporting) return;
    setIsImporting(true);
    setErrorMessage(null);
    try {
      await onImport(result.validRows);
      setSuccessMessage(t('csvImport.importSuccess', { count: result.validRows.length }));
      closeTimerRef.current = setTimeout(() => onClose(), 700);
    } catch {
      setErrorMessage(t('csvImport.importError'));
    } finally {
      setIsImporting(false);
    }
  };

  const translateError = (error: string) => {
    const key = ERROR_KEYS[error];
    return key ? t(key) : error;
  };

  if (!isOpen) return null;

  const validCount = result?.validRows.length ?? 0;
  const invalidCount = result?.invalidRows.length ?? 0;
  const showingErrors = activeTab === 'errors';
  const previewRows: Array<Record<string, unknown> | CsvInvalidRow> = showingErrors
    ? result?.invalidRows ?? []
    : result?.validRows ?? [];
  const columns = Array.from(
    new Set(
      previewRows
        .slice(0, 20)
        .flatMap((row) => Object.keys(showingErrors ? (row as CsvInvalidRow).data : row)),
    ),
  ).slice(0, 10);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-brand-600" />
            <h2 className="text-base font-black text-gray-900">{title}</h2>
          </div>
          <button
            type="button"
            aria-label={t('csvImport.close')}
            onClick={onClose}
            className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void handleFile(event.dataTransfer.files?.[0]);
            }}
            className="rounded-2xl border-2 border-dashed border-gray-300 bg-gray-50/60 px-4 py-6 text-center"
          >
            <Upload className="mx-auto mb-2 h-6 w-6 text-brand-500" />
            <label
              htmlFor="csv-import-file"
              className="cursor-pointer text-sm font-bold text-brand-700 hover:underline"
            >
              {t('csvImport.dropzone')}
            </label>
            <input
              id="csv-import-file"
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(event) => {
                void handleFile(event.target.files?.[0]);
                event.target.value = '';
              }}
            />
            {fileName && (
              <p className="mt-2 text-xs font-semibold text-gray-600">
                {t('csvImport.fileSelected', { fileName })}
              </p>
            )}
            {isReading && <p className="mt-1 text-xs text-gray-500">{t('csvImport.reading')}</p>}
            {templateDownloadUrl && (
              <a
                href={templateDownloadUrl}
                download
                className="mt-2 inline-block text-xs font-semibold text-brand-600 hover:underline"
              >
                {t('csvImport.downloadTemplate')}
              </a>
            )}
          </div>

          {errorMessage && (
            <p role="alert" className="flex items-center gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />{errorMessage}
            </p>
          )}
          {successMessage && (
            <p role="status" className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
              <CheckCircle2 className="h-4 w-4 shrink-0" />{successMessage}
            </p>
          )}

          {result && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                  {t('csvImport.summaryValid', { count: validCount })}
                </span>
                <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-700">
                  {t('csvImport.summaryInvalid', { count: invalidCount })}
                </span>
              </div>

              <div className="flex gap-2 border-b border-gray-200">
                <button
                  type="button"
                  onClick={() => setActiveTab('valid')}
                  className={`border-b-2 px-3 py-2 text-xs font-bold ${
                    !showingErrors ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500'
                  }`}
                >
                  {t('csvImport.tabValid', { count: validCount })}
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('errors')}
                  className={`border-b-2 px-3 py-2 text-xs font-bold ${
                    showingErrors ? 'border-red-500 text-red-700' : 'border-transparent text-gray-500'
                  }`}
                >
                  {t('csvImport.tabErrors', { count: invalidCount })}
                </button>
              </div>

              <div className="max-h-72 overflow-auto rounded-xl border border-gray-200">
                <table className="w-full min-w-max text-left text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-[11px] uppercase text-gray-500">
                    <tr>
                      <th className="px-3 py-2">{t('csvImport.rowNumber', { number: '#' })}</th>
                      {columns.map((column) => (
                        <th key={column} className="px-3 py-2">{column.replace(/_/g, ' ')}</th>
                      ))}
                      {showingErrors && <th className="px-3 py-2">{t('csvImport.errorLabel')}</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {previewRows.slice(0, 100).map((row, index) => {
                      const data = showingErrors ? (row as CsvInvalidRow).data : row as Record<string, unknown>;
                      const errors = showingErrors ? (row as CsvInvalidRow).errors : [];
                      return (
                        <tr key={index}>
                          <td className="px-3 py-2 font-mono text-gray-500">
                            {showingErrors ? (row as CsvInvalidRow).rowNumber : index + 2}
                          </td>
                          {columns.map((column) => (
                            <td key={column} className="px-3 py-2 text-gray-800">
                              {String(data[column] ?? '') || '—'}
                            </td>
                          ))}
                          {showingErrors && (
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap gap-1">
                                {errors.map((error) => (
                                  <span key={error} className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
                                    {translateError(error)}
                                  </span>
                                ))}
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {previewRows.length === 0 && (
                      <tr>
                        <td colSpan={columns.length + 2} className="px-3 py-6 text-center text-gray-400">
                          {t('csvImport.emptyPreview')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            disabled={validCount === 0 || isImporting}
            onClick={() => void handleImport()}
            className="flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-black text-white hover:bg-brand-700 disabled:opacity-40"
          >
            {isImporting && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {t('csvImport.importAction', { count: validCount })}
          </button>
        </div>
      </div>
    </div>
  );
}

export default CsvImportModal;
