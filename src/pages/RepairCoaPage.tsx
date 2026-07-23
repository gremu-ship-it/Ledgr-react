/**
 * RepairCoaPage.tsx
 *
 * Admin utility page — seeds the Chart of Accounts for any business that
 * is missing accounts. Accessible at /settings/repair-coa or wherever
 * you mount it.
 *
 * Usage:
 *   import { RepairCoaPage } from '@/pages/RepairCoaPage';
 *   <Route path="/repair-coa" element={<RepairCoaPage />} />
 */

import { useState } from 'react';
import { CheckCircle, AlertCircle, RefreshCw, Database } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { supabase } from '@/lib/supabase';
import { seedChartOfAccounts } from '@/services/seedChartOfAccounts';

interface SeedResult {
  businessId:   string;
  businessName: string;
  inserted:     number;
  skipped:      number;
  error?:       string;
}

export function RepairCoaPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId      = currentBusiness?.business?.id;
  const businessName    = currentBusiness?.business?.name ?? 'Unknown';

  const [running,  setRunning]  = useState(false);
  const [results,  setResults]  = useState<SeedResult[]>([]);
  const [allDone,  setAllDone]  = useState(false);
  const [runAll,   setRunAll]   = useState(false);

  async function seedCurrent() {
    if (!businessId) return;
    setRunning(true);
    setResults([]);
    setAllDone(false);
    try {
      const { inserted, skipped } = await seedChartOfAccounts(supabase, businessId);
      setResults([{ businessId, businessName, inserted, skipped }]);
    } catch (err) {
      setResults([{ businessId, businessName, inserted: 0, skipped: 0, error: (err as Error).message }]);
    } finally {
      setRunning(false);
      setAllDone(true);
    }
  }

  async function seedAll() {
    setRunning(true);
    setResults([]);
    setAllDone(false);

    const { data: businessesRaw, error } = await supabase
      .from('businesses')
      .select('id, name')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name');

    const businesses = businessesRaw as { id: string; name: string }[] | null;

    if (error || !businesses) {
      setResults([{ businessId: '', businessName: '', inserted: 0, skipped: 0, error: error?.message ?? 'Could not fetch businesses' }]);
      setRunning(false);
      setAllDone(true);
      return;
    }

    const out: SeedResult[] = [];
    for (const biz of businesses) {
      try {
        const { inserted, skipped } = await seedChartOfAccounts(supabase, biz.id);
        out.push({ businessId: biz.id, businessName: biz.name, inserted, skipped });
      } catch (err) {
        out.push({ businessId: biz.id, businessName: biz.name, inserted: 0, skipped: 0, error: (err as Error).message });
      }
      // Update UI as each business completes
      setResults([...out]);
    }

    setRunning(false);
    setAllDone(true);
  }

  const totalInserted = results.reduce((s, r) => s + r.inserted, 0);
  const totalErrors   = results.filter((r) => r.error).length;

  return (
    <div className="mx-auto max-w-2xl py-10 px-6">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Database className="h-6 w-6 text-brand-600 dark:text-brand-400" />
          <h1 className="text-2xl font-semibold text-ink">Repair Chart of Accounts</h1>
        </div>
        <p className="text-sm text-muted">
          Seeds a complete Malawian Chart of Accounts for any business that is missing
          accounts. Safe to run multiple times — existing accounts are never overwritten.
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-card p-6 shadow-sm space-y-4">
        <div className="rounded-lg bg-warning/12 border border-warning/20 px-4 py-3 text-sm text-warning">
          <strong>Note:</strong> This seeds ~100 standard accounts including all codes required
          by the journal service (1110, 1131, 1135, 2111, 2121, 2122, 2131, 4112, 6110).
          Existing accounts with the same code are skipped.
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={seedCurrent}
            disabled={running || !businessId}
            className="flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
          >
            {running && !runAll ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            Seed Current Business
          </button>

          <button
            onClick={() => { setRunAll(true); seedAll(); }}
            disabled={running}
            className="flex items-center justify-center gap-2 rounded-lg border border-line bg-card px-5 py-2.5 text-sm font-semibold text-sub hover:bg-bg disabled:opacity-50 transition-colors"
          >
            {running && runAll ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Seed All Businesses
          </button>
        </div>

        {results.length > 0 && (
          <div className="mt-4 space-y-2">
            {results.map((r) => (
              <div
                key={r.businessId}
                className={`flex items-start gap-3 rounded-lg px-4 py-3 text-sm ${
                  r.error
                    ? 'bg-danger/10 border border-danger/20'
                    : r.inserted > 0
                    ? 'bg-brand-500/10 border border-brand-500/20'
                    : 'bg-bg border border-line'
                }`}
              >
                {r.error ? (
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-danger" />
                ) : (
                  <CheckCircle className="h-4 w-4 mt-0.5 shrink-0 text-brand-600 dark:text-brand-400" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-ink truncate">{r.businessName}</p>
                  {r.error ? (
                    <p className="text-danger mt-0.5">{r.error}</p>
                  ) : (
                    <p className="text-muted mt-0.5">
                      {r.inserted > 0
                        ? `${r.inserted} accounts added`
                        : 'Already complete — nothing to add'}
                      {r.skipped > 0 && ` · ${r.skipped} skipped`}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {allDone && results.length > 0 && (
          <div className={`rounded-lg px-4 py-3 text-sm font-medium ${
            totalErrors > 0 ? 'bg-danger/10 text-danger' : 'bg-brand-500/10 text-brand-700 dark:text-brand-300'
          }`}>
            {totalErrors > 0
              ? `Completed with ${totalErrors} error${totalErrors > 1 ? 's' : ''}. Check details above.`
              : totalInserted > 0
              ? `Done — ${totalInserted} account${totalInserted > 1 ? 's' : ''} added across ${results.length} business${results.length > 1 ? 'es' : ''}.`
              : `All ${results.length} business${results.length > 1 ? 'es' : ''} already have a complete Chart of Accounts.`}
          </div>
        )}
      </div>
    </div>
  );
}
