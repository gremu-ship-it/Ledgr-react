import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Plus, Lock, Eye, Pencil, Play, Copy, Package } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { supabase } from '@/lib/supabase';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as unknown as { from: (t: string) => any; rpc: (n: string, p: unknown) => any; auth: any };
import { useCapability } from '@/hooks/useCapability';
import { CapabilityGate } from '@/components/billing/CapabilityGate';

type BomRow = {
  id: string;
  business_id: string;
  product_id: string;
  version: number;
  status: 'draft' | 'active' | 'archived';
  bom_locked_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type ProductRow = {
  id: string;
  name: string;
  product_type: string;
};

export function BomListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const businessId = useAppStore((s) => s.currentBusiness?.business?.id);
  const hasManufacturing = useCapability('manufacturing');

  const [boms, setBoms] = useState<BomRow[]>([]);
  const [productsById, setProductsById] = useState<Record<string, ProductRow>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [costs, setCosts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchBoms = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: qError } = await sb
        .from('manufacturing_boms')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false });

      if (qError) throw qError;

      const rows = (data as BomRow[]) ?? [];
      setBoms(rows);

      if (rows.length === 0) {
        setLoading(false);
        return;
      }

      // Fetch products for output names
      const productIds = [...new Set(rows.map((r) => r.product_id))];
      const { data: prodData } = await sb
        .from('products')
        .select('id,name,product_type')
        .in('id', productIds);

      const map: Record<string, ProductRow> = {};
      for (const p of (prodData as ProductRow[]) ?? []) {
        map[p.id] = p;
      }
      setProductsById(map);

      // Component counts and costs in parallel
      const countsMap: Record<string, number> = {};
      const costsMap: Record<string, number> = {};
      await Promise.all(
        rows.map(async (bom) => {
          const { count } = await sb
            .from('manufacturing_bom_lines')
            .select('id', { count: 'exact', head: true })
            .eq('bom_id', bom.id);
          countsMap[bom.id] = count ?? 0;

          const { data: costData } = await sb.rpc('manufacturing_bom_cost', {
            p_bom_id: bom.id,
          });
          costsMap[bom.id] = Number(costData ?? 0);
        }),
      );
      setCounts(countsMap);
      setCosts(costsMap);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchBoms();
  }, [fetchBoms]);

  const handleActivate = async (bomId: string) => {
    setActionLoading(bomId);
    try {
      const { error } = await sb.rpc('manufacturing_bom_activate', { p_bom_id: bomId });
      if (error) throw error;
      await fetchBoms();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  };

  const handleNewVersion = async (bomId: string) => {
    setActionLoading(bomId);
    try {
      const { data, error } = await sb.rpc('manufacturing_bom_new_version', {
        p_bom_id: bomId,
      });
      if (error) throw error;
      const newId = data as string;
      navigate(`/manufacturing/bom/${newId}/edit`);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(null);
    }
  };

  if (!hasManufacturing) {
    return (
      <CapabilityGate capability="manufacturing">
        <div />
      </CapabilityGate>
    );
  }

  const statusBadgeClass = (status: string) => {
    if (status === 'active') return 'bg-green-100 text-green-800';
    if (status === 'draft') return 'bg-gray-100 text-gray-700';
    return 'bg-zinc-100 text-zinc-500';
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">{t('manufacturing.bom.title')}</h1>
          <p className="text-sm text-gray-500">
            {t('manufacturing.title')} · {businessId ? '' : ''}
          </p>
        </div>
        <Link
          to="/manufacturing/bom/new"
          className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          data-testid="create-bom-button"
        >
          <Plus className="h-4 w-4" />
          {t('manufacturing.bom.create')}
        </Link>
      </header>

      {loading ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          {t('common.loading')}
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">{error}</div>
      ) : boms.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <Package className="mx-auto mb-3 h-8 w-8 text-gray-400" aria-hidden />
          <p className="mb-4 text-sm text-gray-600">{t('manufacturing.bom.emptyState')}</p>
          <Link
            to="/manufacturing/bom/new"
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" />
            {t('manufacturing.bom.create')}
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">{t('manufacturing.bom.outputProduct')}</th>
                  <th className="px-4 py-3">{t('manufacturing.bom.version')}</th>
                  <th className="px-4 py-3">{t('common.status')}</th>
                  <th className="px-4 py-3">{t('manufacturing.bom.totalCost')}</th>
                  <th className="px-4 py-3">Components</th>
                  <th className="px-4 py-3">{t('common.date')}</th>
                  <th className="px-4 py-3">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {boms.map((bom) => {
                  const product = productsById[bom.product_id];
                  return (
                    <tr key={bom.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900">
                            {product?.name ?? bom.product_id.slice(0, 8)}
                          </span>
                          {bom.bom_locked_at && (
                            <Lock className="h-3.5 w-3.5 text-amber-600" aria-label={t('manufacturing.bom.locked')} />
                          )}
                        </div>
                        {product?.product_type && (
                          <span className="text-xs text-gray-500">{product.product_type}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">v{bom.version}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(bom.status)}`}
                        >
                          {t(`manufacturing.bom.status.${bom.status}`)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {costs[bom.id] != null ? costs[bom.id].toFixed(2) : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{counts[bom.id] ?? 0}</td>
                      <td className="px-4 py-3 text-gray-500">
                        {new Date(bom.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link
                            to={`/manufacturing/bom/${bom.id}`}
                            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                            aria-label={`${t('common.view')} ${bom.id}`}
                          >
                            <Eye className="h-3.5 w-3.5" />
                            {t('common.view')}
                          </Link>
                          {bom.status === 'draft' && !bom.bom_locked_at && (
                            <>
                              <Link
                                to={`/manufacturing/bom/${bom.id}/edit`}
                                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                                {t('common.edit')}
                              </Link>
                              <button
                                type="button"
                                disabled={!!actionLoading}
                                onClick={() => handleActivate(bom.id)}
                                className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                              >
                                <Play className="h-3.5 w-3.5" />
                                {t('manufacturing.bom.activate')}
                              </button>
                            </>
                          )}
                          {(bom.status === 'active' || bom.status === 'archived') && (
                            <button
                              type="button"
                              disabled={!!actionLoading}
                              onClick={() => handleNewVersion(bom.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              {t('manufacturing.bom.newVersion')}
                            </button>
                          )}
                          {bom.bom_locked_at && (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                              <Lock className="h-3 w-3" />
                              {t('manufacturing.bom.locked')}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default BomListPage;
