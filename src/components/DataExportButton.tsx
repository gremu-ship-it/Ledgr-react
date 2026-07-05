import { useState } from 'react';
import { Download, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

/**
 * "Download my data" — GDPR Right to Portability.
 *
 * Calls the export-my-data Edge Function, which compiles the user's
 * personal data plus full data for every business they OWN into a ZIP
 * (JSON + CSV per table), uploads it to private storage, and returns a
 * short-lived signed URL. This component just triggers that and starts
 * the browser download once ready.
 *
 * Drop this into SettingsPage.tsx wherever account/privacy settings live.
 */
export function DataExportButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function handleExport() {
    setStatus('loading');
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke('export-my-data', {
        method: 'POST',
      });

      if (error) throw new Error(error.message);
      if (!data?.url) throw new Error('No download link returned.');

      // Trigger the browser download.
      const a = document.createElement('a');
      a.href = data.url;
      a.download = 'ledgr-data-export.zip';
      document.body.appendChild(a);
      a.click();
      a.remove();

      setStatus('success');
      setMessage(
        data.businesses_included > 0
          ? `Export ready — includes ${data.businesses_included} business${data.businesses_included > 1 ? 'es' : ''} you own. Link expires in 1 hour.`
          : 'Export ready — personal data only (no businesses owned by this account). Link expires in 1 hour.',
      );
    } catch (err) {
      setStatus('error');
      setMessage((err as Error).message || 'Export failed. Please try again.');
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="mb-1 flex items-center gap-2">
        <Download className="h-4 w-4 text-brand-500" />
        <h3 className="text-sm font-semibold text-gray-900">Download my data</h3>
      </div>
      <p className="mb-4 text-xs text-gray-500">
        Get a copy of your personal information and the full data for any business you own,
        as a ZIP file containing JSON and CSV files.
      </p>

      <button
        onClick={handleExport}
        disabled={status === 'loading'}
        className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors"
      >
        {status === 'loading' ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Preparing your export…
          </>
        ) : (
          <>
            <Download className="h-4 w-4" />
            Download my data
          </>
        )}
      </button>

      {message && (
        <div className={`mt-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
          status === 'error' ? 'bg-red-50 text-red-700' : 'bg-brand-50 text-brand-700'
        }`}>
          {status === 'error' ? (
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <CheckCircle className="h-3.5 w-3.5 shrink-0" />
          )}
          {message}
        </div>
      )}
    </div>
  );
}
