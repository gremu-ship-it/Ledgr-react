import { useState } from 'react';
import { Download, Loader2, AlertCircle, CheckCircle, FileJson, FileSpreadsheet } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { exportJsonBackup, exportCsvBackup } from '@/services/dataBackupService';
import { handleError } from '@/lib/errorHandler';

/**
 * Per-business data backup. Runs entirely in the browser: queries the
 * business's data via the existing RLS-scoped repositories, serialises to
 * JSON/CSV, and downloads to the user's device. Nothing is uploaded to a
 * third party. See dataBackupService.ts for the security model.
 */
export function BusinessDataBackup() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const businessName = currentBusiness?.business?.name ?? 'business';

  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [stage, setStage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function runExport(format: 'json' | 'csv') {
    if (!businessId) return;
    setStatus('loading');
    setStage('Preparing…');
    setMessage(null);
    try {
      const fn = format === 'json' ? exportJsonBackup : exportCsvBackup;
      await fn(businessId, businessName, (p) => {
        setStage(`${p.stage} (${p.stageIndex}/${p.totalStages})`);
      });
      setStatus('success');
      setMessage('Backup downloaded. Keep this file in a secure location — it contains all your financial records for this business.');
    } catch (err) {
      setStatus('error');
      setMessage((err as Error).message || 'Export failed.');
      handleError(err, { module: 'BusinessDataBackup', operation: 'export' });
    } finally {
      setStage(null);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-1 flex items-center gap-2">
        <Download className="h-4 w-4 text-brand-500" />
        <h3 className="text-sm font-semibold text-gray-900">Backup business data</h3>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        Download a complete copy of <strong>{businessName}</strong>'s transactions, contacts, products,
        accounts, and journal entries. The export runs locally in your browser — nothing leaves your device.
        JSON imports are suitable for re-import / disaster recovery; CSV opens in Excel or Google Sheets.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => void runExport('json')}
          disabled={status === 'loading' || !businessId}
          className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors"
        >
          {status === 'loading' ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> {stage ?? 'Exporting…'}</>
          ) : (
            <><FileJson className="h-4 w-4" /> Download JSON backup</>
          )}
        </button>
        <button
          onClick={() => void runExport('csv')}
          disabled={status === 'loading' || !businessId}
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 transition-colors"
        >
          {status === 'loading' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <><FileSpreadsheet className="h-4 w-4" /> Download CSV (Excel)</>
          )}
        </button>
      </div>

      {message && (
        <div className={`mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
          status === 'error' ? 'bg-red-50 text-red-700' : 'bg-brand-50 text-brand-700'
        }`}>
          {status === 'error' ? (
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          ) : (
            <CheckCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          )}
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}
