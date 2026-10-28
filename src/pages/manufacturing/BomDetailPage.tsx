import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PlanGate } from '@/components/billing/PlanGate';
import { Lock, Pencil, Play, Copy, ArrowLeft } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { supabase } from '@/lib/supabase';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as unknown as { from: (t: string) => any; rpc: (n: string, p: unknown) => any; auth: any };
import { useCapability } from '@/hooks/useCapability';
import { CapabilityGate } from '@/components/billing/CapabilityGate';
import { repos } from '@/lib/repositories';

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

type LineRow = {
  id: string;
  bom_id: string;
  component_product_id: string | null;
  component_bom_id: string | null;
  quantity: number;
  unit_of_measure: string | null;
  scrap_pct: number;
  notes: string | null;
  subassembly: Pick<BomRow, 'id' | 'product_id' | 'version'> | null;
};

type ProductRow = {
  id: string;
  name: string;
  product_type: string;
  purchase_price: number;
  cost_price: number | null;
  unit_of_measure: string | null;
};

export function BomDetailPage() {
  return (
    <PlanGate minPlan="enterprise" featureNameKey="navigation.sections.manufacturing">
      <BomDetailPageContent />
    </PlanGate>
  );
}

function BomDetailPageContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const businessId = useAppStore((s) => s.currentBusiness?.business?.id);
  const hasManufacturing = useCapability('manufacturing');

  const [bom, setBom] = useState<BomRow | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [productsById, setProductsById] = useState<Record<string, ProductRow>>({});
  const [subassemblyCosts, setSubassemblyCosts] = useState<Record<string, number>>({});
  const [versionHistory, setVersionHistory] = useState<BomRow[]>([]);
  const [totalCost, setTotalCost] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!id || !businessId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: bomData, error: bomErr } = await sb
        .from('manufacturing_boms')
        .select('*')
        .eq('id', id)
        .single();
      if (bomErr) throw bomErr;
      const b = bomData as BomRow;
      setBom(b);

      const tree = await repos.bom.getVersionTree(b.business_id, id);
      const l: LineRow[] = tree.components.map((line) => ({
        ...line,
        subassembly: line.subassembly ? {
          id: line.subassembly.id,
          product_id: line.subassembly.product_id,
          version: line.subassembly.version,
        } : null,
      }));
      setLines(l);

      // Load names and unit costs for raw products and referenced sub-assemblies.
      const productIds = [
        b.product_id,
        ...l.flatMap((line) => line.component_product_id ? [line.component_product_id] : []),
        ...l.flatMap((line) => line.subassembly ? [line.subassembly.product_id] : []),
      ];
      const uniqueIds = [...new Set(productIds)];
      if (uniqueIds.length > 0) {
        const { data: prodData, error: productError } = await sb
          .from('products')
          .select('id,name,product_type,purchase_price,cost_price,unit_of_measure')
          .in('id', uniqueIds);
        if (productError) throw productError;
        const map: Record<string, ProductRow> = {};
        for (const p of (prodData as ProductRow[]) ?? []) map[p.id] = p;
        setProductsById(map);
      }
      const subassemblyCostPairs = await Promise.all(l.flatMap((line) => line.component_bom_id
        ? [sb.rpc('manufacturing_bom_cost', { p_bom_id: line.component_bom_id }).then((result: { data: unknown }) => [line.component_bom_id!, Number(result.data ?? 0)] as const)]
        : []));
      setSubassemblyCosts(Object.fromEntries(subassemblyCostPairs));

      // Version history for this product
      const { data: historyData } = await sb
        .from('manufacturing_boms')
        .select('*')
        .eq('business_id', b.business_id)
        .eq('product_id', b.product_id)
        .order('version', { ascending: true });
      setVersionHistory((historyData as BomRow[]) ?? []);

      // Total cost via RPC
      const { data: costData } = await sb.rpc('manufacturing_bom_cost', { p_bom_id: id });
      setTotalCost(Number(costData ?? 0));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [id, businessId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAll();
  }, [fetchAll]);

  const handleActivate = async () => {
    if (!id) return;
    setActionLoading(true);
    try {
      const { error } = await sb.rpc('manufacturing_bom_activate', { p_bom_id: id });
      if (error) throw error;
      await fetchAll();
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(false);
    }
  };

  const handleNewVersion = async () => {
    if (!id) return;
    setActionLoading(true);
    try {
      const { data, error } = await sb.rpc('manufacturing_bom_new_version', { p_bom_id: id });
      if (error) throw error;
      const newId = data as string;
      navigate(`/manufacturing/bom/${newId}/edit`);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setActionLoading(false);
    }
  };

  if (!hasManufacturing) {
    return (
      <CapabilityGate capability="manufacturing">
        <div />
      </CapabilityGate>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          {t('common.loading')}
        </div>
      </div>
    );
  }

  if (error || !bom) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {error ?? 'BOM not found'}
        </div>
        <Link to="/manufacturing/bom" className="mt-4 inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" />
          {t('common.back')}
        </Link>
      </div>
    );
  }

  const outputProduct = productsById[bom.product_id];
  const statusBadgeClass = (s: string) => {
    if (s === 'active') return 'bg-green-100 text-green-800';
    if (s === 'draft') return 'bg-gray-100 text-gray-700';
    return 'bg-zinc-100 text-zinc-500';
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <header className="mb-5">
        <Link to="/manufacturing/bom" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="h-4 w-4" />
          {t('manufacturing.bom.title')}
        </Link>

        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">
              {outputProduct?.name ?? bom.product_id.slice(0, 8)} — {t('manufacturing.bom.version')} {bom.version}
              {bom.bom_locked_at && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                  <Lock className="h-3 w-3" />
                  {t('manufacturing.bom.locked')}
                </span>
              )}
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeClass(bom.status)}`}>
                {t(`manufacturing.bom.status.${bom.status}`)}
              </span>
              {outputProduct && <span className="text-sm text-gray-500">{outputProduct.product_type}</span>}
            </div>
            {bom.notes && <p className="mt-2 text-sm text-gray-600">{bom.notes}</p>}
            {bom.bom_locked_at && (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">
                <Lock className="mr-2 inline h-4 w-4" />
                {t('manufacturing.bom.lockedMessage')}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {bom.status === 'draft' && !bom.bom_locked_at && (
              <>
                <Link
                  to={`/manufacturing/bom/${bom.id}/edit`}
                  className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  data-testid="edit-bom-button"
                >
                  <Pencil className="h-4 w-4" />
                  {t('common.edit')}
                </Link>
                <button
                  type="button"
                  onClick={handleActivate}
                  disabled={actionLoading}
                  className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                  data-testid="activate-bom-button"
                >
                  <Play className="h-4 w-4" />
                  {t('manufacturing.bom.activate')}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleNewVersion}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              data-testid="new-version-button"
            >
              <Copy className="h-4 w-4" />
              {t('manufacturing.bom.newVersion')}
            </button>
          </div>
        </div>
      </header>

      {/* Component table */}
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">{t('manufacturing.bom.component')}</th>
                <th className="px-4 py-3">{t('manufacturing.bom.quantity')}</th>
                <th className="px-4 py-3">{t('manufacturing.bom.unitOfMeasure')}</th>
                <th className="px-4 py-3">{t('manufacturing.bom.scrapPercent')}</th>
                <th className="px-4 py-3">{t('manufacturing.bom.effectiveQuantity')}</th>
                <th className="px-4 py-3">{t('manufacturing.bom.unitCost')}</th>
                <th className="px-4 py-3">{t('manufacturing.bom.lineCost')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                    {t('manufacturing.bom.noComponents')}
                  </td>
                </tr>
              ) : (
                lines.map((line) => {
                  const product = line.component_product_id ? productsById[line.component_product_id] : undefined;
                  const componentProduct = line.subassembly ? productsById[line.subassembly.product_id] : product;
                  const qty = Number(line.quantity);
                  const scrap = Number(line.scrap_pct);
                  const unitCost = line.component_bom_id
                    ? subassemblyCosts[line.component_bom_id] ?? 0
                    : Number(product?.cost_price ?? product?.purchase_price ?? 0);
                  const effectiveQty = qty * (1 + scrap / 100);
                  const lineCost = effectiveQty * unitCost;
                  return (
                    <tr key={line.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">
                          {line.component_bom_id && line.subassembly ? (
                            <Link to={`/manufacturing/bom/${line.component_bom_id}`} className="text-brand-700 hover:text-brand-900">
                              {componentProduct?.name ?? t('manufacturing.bom.subAssembly')} — v{line.subassembly.version}
                            </Link>
                          ) : (
                            componentProduct?.name ?? t('manufacturing.bom.rawMaterial')
                          )}
                        </div>
                        {line.component_bom_id
                          ? <div className="text-xs text-gray-500">{t('manufacturing.bom.subAssembly')}</div>
                          : product?.product_type && <div className="text-xs text-gray-500">{product.product_type}</div>}
                      </td>
                      <td className="px-4 py-3">{qty}</td>
                      <td className="px-4 py-3">{line.unit_of_measure ?? '—'}</td>
                      <td className="px-4 py-3">{scrap}%</td>
                      <td className="px-4 py-3">{effectiveQty.toFixed(2)}</td>
                      <td className="px-4 py-3">{unitCost.toFixed(2)}</td>
                      <td className="px-4 py-3 font-medium">{lineCost.toFixed(2)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {lines.length > 0 && (
              <tfoot className="bg-gray-50">
                <tr>
                  <td colSpan={6} className="px-4 py-3 text-right text-sm font-semibold text-gray-700">
                    {t('manufacturing.bom.totalCost')}
                  </td>
                  <td className="px-4 py-3 text-sm font-bold text-gray-900" data-testid="total-cost">
                    {totalCost.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* Version history */}
      <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-gray-900">{t('manufacturing.bom.versionHistory')}</h2>
        {versionHistory.length === 0 ? (
          <p className="text-sm text-gray-500">No history</p>
        ) : (
          <ul className="space-y-2">
            {versionHistory.map((v) => (
              <li
                key={v.id}
                className={`flex items-center justify-between rounded-xl border px-3 py-2 ${v.id === bom.id ? 'bg-brand-50 border-brand-200' : 'bg-white border-gray-200'}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">
                    {t('manufacturing.bom.version')} {v.version}
                  </span>
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(v.status)}`}>
                    {t(`manufacturing.bom.status.${v.status}`)}
                  </span>
                  {v.bom_locked_at && <Lock className="h-3 w-3 text-amber-600" aria-label={t('manufacturing.bom.locked')} />}
                  {v.id === bom.id && <span className="text-xs text-brand-700">• current</span>}
                </div>
                <Link to={`/manufacturing/bom/${v.id}`} className="text-xs text-brand-600 hover:text-brand-800">
                  {t('common.view')}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default BomDetailPage;
