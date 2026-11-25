import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  AlertCircle, Calculator, CheckCircle2, FileDown, Plus, Trash2, X,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { supabase } from '@/lib/supabase';
import { formatMwkDetailed } from '@/lib/formatters';
import { printElementRef } from '@/services/reportPrintService';
import {
  calculateTotalUnitCost,
  simulatePricing,
  syncPriceToCatalog,
  type BomMaterialLine,
  type LaborOperationLine,
  type OverheadCostLine,
} from '@/services/manufacturingCostingService';

interface SelectableProduct {
  id: string;
  name: string;
  salePrice: number;
  costPrice: number;
  bomId: string;
}

interface BomLineRow {
  id: string;
  component_product_id: string | null;
  component_bom_id: string | null;
  quantity: number;
  unit_of_measure: string | null;
  scrap_pct: number;
}

interface ComponentProduct {
  id: string;
  name: string;
  cost_price: number | null;
  purchase_price: number;
}

type PricingStrategy = 'margin' | 'markup';

const money = (value: number) => formatMwkDetailed(Number(value) || 0);

/** Interactive cost rollup + pricing simulator for finished goods. */
export function ProductCostingPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const requestedBomId = searchParams.get('bom');
  const businessId = useAppStore((s) => s.currentBusiness?.business?.id);
  const businessName = useAppStore((s) => s.currentBusiness?.business?.name);
  const printRef = useRef<HTMLDivElement>(null);
  const nextLocalId = useRef(0);

  const [products, setProducts] = useState<SelectableProduct[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [materials, setMaterials] = useState<BomMaterialLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [materialsLoading, setMaterialsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogOverrides, setCatalogOverrides] = useState<Record<string, number>>({});
  const [strategy, setStrategy] = useState<PricingStrategy>('margin');
  const [targetRate, setTargetRate] = useState(35);
  const [confirming, setConfirming] = useState(false);
  const [applying, setApplying] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  const [labor, setLabor] = useState<LaborOperationLine[]>(() => [
    { id: 'labor-cutting', operation_name: t('manufacturing.costing.defaultOperations.cutting'), labor_hours: 0, hourly_rate: 0, line_cost: 0 },
    { id: 'labor-assembly', operation_name: t('manufacturing.costing.defaultOperations.assembly'), labor_hours: 0, hourly_rate: 0, line_cost: 0 },
    { id: 'labor-testing', operation_name: t('manufacturing.costing.defaultOperations.testing'), labor_hours: 0, hourly_rate: 0, line_cost: 0 },
  ]);
  const [overheads, setOverheads] = useState<OverheadCostLine[]>(() => [
    { id: 'oh-power', overhead_name: t('manufacturing.costing.defaultOverheads.power'), cost_type: 'fixed', rate_or_amount: 0, line_cost: 0 },
    { id: 'oh-depreciation', overhead_name: t('manufacturing.costing.defaultOverheads.depreciation'), cost_type: 'fixed', rate_or_amount: 0, line_cost: 0 },
    { id: 'oh-rent', overhead_name: t('manufacturing.costing.defaultOverheads.rent'), cost_type: 'fixed', rate_or_amount: 0, line_cost: 0 },
  ]);

  const selected = products.find((product) => product.id === selectedProductId) ?? products[0];
  const catalogPrice = selected ? (catalogOverrides[selected.id] ?? selected.salePrice) : 0;
  const selectedBomId = selected?.bomId ?? '';

  const loadProducts = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: boms, error: bomError } = await supabase
        .from('manufacturing_boms')
        .select('id, product_id')
        .eq('business_id', businessId)
        .eq('status', 'active')
        .order('version', { ascending: false });
      if (bomError) throw bomError;

      const productIds = [...new Set((boms ?? []).map((bom) => bom.product_id))];
      const { data: productRows, error: productError } = productIds.length > 0
        ? await supabase
            .from('products')
            .select('id, name, sale_price, cost_price, purchase_price')
            .in('id', productIds)
        : { data: [], error: null };
      if (productError) throw productError;
      const productsById = new Map((productRows ?? []).map((row) => [row.id, row]));

      const options: SelectableProduct[] = [];
      for (const bom of boms ?? []) {
        if (options.some((option) => option.id === bom.product_id)) continue;
        const product = productsById.get(bom.product_id);
        if (!product) continue;
        options.push({
          id: product.id,
          name: product.name,
          salePrice: Number(product.sale_price ?? 0),
          costPrice: Number(product.cost_price ?? product.purchase_price ?? 0),
          bomId: bom.id,
        });
      }

      setProducts(options);
      setSelectedProductId((current) => {
        if (requestedBomId) {
          const requested = options.find((option) => option.bomId === requestedBomId);
          if (requested) return requested.id;
        }
        return options.some((option) => option.id === current) ? current : (options[0]?.id ?? '');
      });
      setError(null);
    } catch {
      setError(t('manufacturing.costing.loadFailed'));
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [businessId, requestedBomId, t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch finished goods when the till context changes
    void loadProducts();
  }, [loadProducts]);

  useEffect(() => {
    if (!selectedBomId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear stale BOM lines
      setMaterials([]);
      return;
    }
    let ignore = false;
    async function loadMaterials() {
      setMaterialsLoading(true);
      try {
        const { data: rows, error: lineError } = await supabase
          .from('manufacturing_bom_lines')
          .select('id, component_product_id, component_bom_id, quantity, unit_of_measure, scrap_pct')
          .eq('bom_id', selectedBomId);
        if (lineError) throw lineError;
        const lines = (rows ?? []) as BomLineRow[];
        const componentIds = [...new Set(lines.flatMap((line) => line.component_product_id ? [line.component_product_id] : []))];
        const { data: componentRows } = componentIds.length > 0
          ? await supabase
              .from('products')
              .select('id, name, cost_price, purchase_price')
              .in('id', componentIds)
          : { data: [] };
        const byId = new Map((componentRows ?? []).map((row) => [row.id, row as ComponentProduct]));

        const mapped = lines.map<BomMaterialLine>((line) => {
          const component = line.component_product_id ? byId.get(line.component_product_id) : undefined;
          return {
            id: line.id,
            component_id: line.component_product_id ?? line.component_bom_id ?? line.id,
            component_name: component?.name ?? line.component_bom_id?.slice(0, 8) ?? t('manufacturing.costing.materialsTable.component'),
            quantity_per_unit: Number(line.quantity ?? 0),
            unit_of_measure: line.unit_of_measure ?? 'pcs',
            unit_cost: Number(component?.cost_price ?? component?.purchase_price ?? 0),
            scrap_factor_pct: Number(line.scrap_pct ?? 0),
            line_cost: 0,
          };
        });
        if (!ignore) setMaterials(mapped);
      } catch {
        if (!ignore) setError(t('manufacturing.costing.loadFailed'));
      } finally {
        if (!ignore) setMaterialsLoading(false);
      }
    }
    void loadMaterials();
    return () => { ignore = true; };
  }, [selectedBomId, t]);

  const cost = useMemo(
    () => calculateTotalUnitCost(materials, labor, overheads),
    [materials, labor, overheads],
  );
  const pricing = useMemo(
    () => simulatePricing(cost.totalUnitCost, strategy, targetRate, catalogPrice),
    [cost.totalUnitCost, strategy, targetRate, catalogPrice],
  );
  const marginClass = pricing.currentCatalogMarginPct < 15
    ? 'bg-red-100 text-red-700'
    : pricing.currentCatalogMarginPct < 30
      ? 'bg-amber-100 text-amber-800'
      : 'bg-emerald-100 text-emerald-700';
  const marginLabel = pricing.currentCatalogMarginPct < 15
    ? t('manufacturing.costing.lowMarginWarning')
    : t('manufacturing.costing.healthyMargin');

  const handleStrategyChange = (next: PricingStrategy) => {
    setStrategy(next);
    setTargetRate(next === 'margin' ? 35 : 50);
  };

  const handleApply = async () => {
    if (!selected) return;
    setApplying(true);
    setApplyError(null);
    try {
      await syncPriceToCatalog(selected.id, pricing.recommendedPrice, cost.totalUnitCost);
      setCatalogOverrides((previous) => ({ ...previous, [selected.id]: pricing.recommendedPrice }));
      setSuccess(t('manufacturing.costing.applySuccess'));
      setConfirming(false);
    } catch {
      setApplyError(t('manufacturing.costing.applyFailed'));
    } finally {
      setApplying(false);
    }
  };

  const handleExport = () => {
    printElementRef(printRef.current, {
      title: t('manufacturing.costing.title'),
      subtitle: selected?.name,
      companyName: businessName,
      orientation: 'portrait',
    });
  };

  const newLocalId = (prefix: string) => `${prefix}-${++nextLocalId.current}`;

  return (
    <div className="mx-auto max-w-[1200px] space-y-5 px-4 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">
            <Calculator className="h-5 w-5 text-brand-600" />
            {t('manufacturing.costing.title')}
          </h1>
          <p className="mt-1 text-sm text-gray-500">{t('manufacturing.costing.subtitle')}</p>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={!selected}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          <FileDown className="h-4 w-4" />{t('manufacturing.costing.exportPdf')}
        </button>
      </header>

      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </p>
      )}
      {success && (
        <p role="status" className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" />{success}
          <button type="button" aria-label={t('common.close')} onClick={() => setSuccess(null)} className="ml-auto">
            <X className="h-4 w-4" />
          </button>
        </p>
      )}
      {applyError && (
        <p role="alert" className="flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />{applyError}
        </p>
      )}

      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <label htmlFor="costing-product" className="mb-1 block text-xs font-semibold uppercase text-gray-500">
          {t('manufacturing.costing.selectProduct')}
        </label>
        <select
          id="costing-product"
          value={selected?.id ?? ''}
          onChange={(event) => setSelectedProductId(event.target.value)}
          className="w-full max-w-xl rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        >
          {products.length === 0 && <option value="">{t('manufacturing.costing.noProducts')}</option>}
          {products.map((product) => (
            <option key={product.id} value={product.id}>{product.name}</option>
          ))}
        </select>
      </div>

      {loading || materialsLoading ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          {t('common.loading')}
        </div>
      ) : !selected ? null : (
        <div ref={printRef} className="space-y-5">
          {/* Cost pillars */}
          <section className="grid gap-3 sm:grid-cols-3">
            {[
              { label: t('manufacturing.costing.directMaterials'), value: cost.materialCostUnit, pct: cost.materialsPct, color: 'bg-emerald-500' },
              { label: t('manufacturing.costing.directLabor'), value: cost.laborCostUnit, pct: cost.laborPct, color: 'bg-blue-500' },
              { label: t('manufacturing.costing.overhead'), value: cost.overheadCostUnit, pct: cost.overheadPct, color: 'bg-purple-500' },
            ].map((pillar) => (
              <div key={pillar.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold text-gray-500">{pillar.label}</p>
                <p className="mt-1 text-xl font-bold text-gray-900">{money(pillar.value)}</p>
                <p className="text-xs text-gray-500">{pillar.pct}% {t('manufacturing.costing.perUnit')}</p>
              </div>
            ))}
          </section>

          <section className="rounded-xl border border-brand-200 bg-brand-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">
                  {t('manufacturing.costing.totalUnitCost')}
                </p>
                <p className="text-2xl font-black text-brand-800">{money(cost.totalUnitCost)}</p>
              </div>
              <div className="min-w-[220px] flex-1">
                <p className="mb-1 text-[11px] font-semibold text-gray-600">{t('manufacturing.costing.distribution')}</p>
                <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-200">
                  <div className="bg-emerald-500" style={{ width: `${cost.materialsPct}%` }} />
                  <div className="bg-blue-500" style={{ width: `${cost.laborPct}%` }} />
                  <div className="bg-purple-500" style={{ width: `${cost.overheadPct}%` }} />
                </div>
              </div>
            </div>
          </section>

          {/* Pricing simulator */}
          <section className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="text-sm font-semibold text-gray-900">{t('manufacturing.costing.pricingSimulator')}</h2>
              <div className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-500">{t('manufacturing.costing.currentCatalogPrice')}</p>
                <p className="text-lg font-bold text-gray-900">{money(catalogPrice)}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${marginClass}`}>
                    {t('manufacturing.costing.currentMargin', { pct: pricing.currentCatalogMarginPct })}
                  </span>
                  <span className="text-[11px] font-semibold text-gray-500">{marginLabel}</span>
                </div>
              </div>

              <div className="space-y-2">
                {([
                  { value: 'margin' as const, label: t('manufacturing.costing.strategyMargin') },
                  { value: 'markup' as const, label: t('manufacturing.costing.strategyMarkup') },
                ]).map((option) => (
                  <label key={option.value} className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                    <input
                      type="radio"
                      name="costing-strategy"
                      checked={strategy === option.value}
                      onChange={() => handleStrategyChange(option.value)}
                      className="accent-brand-600 no-print"
                    />
                    {option.label}
                  </label>
                ))}
              </div>

              <div>
                <label htmlFor="costing-target" className="mb-1 block text-xs font-semibold text-gray-600">
                  {t('manufacturing.costing.targetRate')}
                </label>
                <div className="flex items-center gap-3">
                  <input
                    id="costing-target"
                    type="range"
                    min="0"
                    max="99.9"
                    step="0.1"
                    value={targetRate}
                    onChange={(event) => setTargetRate(Number(event.target.value))}
                    className="flex-1 accent-brand-600 no-print"
                  />
                  <input
                    type="number"
                    min="0"
                    max="99.9"
                    step="0.1"
                    value={targetRate}
                    onChange={(event) => setTargetRate(Math.min(99.9, Math.max(0, Number(event.target.value) || 0)))}
                    className="w-20 rounded-lg border border-gray-200 px-2 py-1 text-sm no-print"
                    aria-label={t('manufacturing.costing.targetRate')}
                  />
                  <span className="hidden print:inline text-sm">{targetRate}%</span>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-brand-200 bg-brand-50 p-4">
              <div>
                <p className="text-xs text-brand-700">{t('manufacturing.costing.recommendedPrice')}</p>
                <p className="text-3xl font-black text-brand-800" data-testid="recommended-price">
                  {money(pricing.recommendedPrice)}
                </p>
              </div>
              <p className="text-sm font-semibold text-gray-800">
                {t('manufacturing.costing.grossProfitUnit')}: {money(pricing.unitGrossProfit)}
              </p>
              <p className="text-sm text-gray-700">
                {t('manufacturing.costing.actualMargin', { pct: pricing.actualMarginPct })}
              </p>
              <p className="text-xs text-gray-600">
                {t('manufacturing.costing.priceDifference', { amount: money(pricing.priceDifference) })}
              </p>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                disabled={!selected || pricing.recommendedPrice <= 0}
                className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-40 no-print"
              >
                {t('manufacturing.costing.applyToCatalog', { price: money(pricing.recommendedPrice) })}
              </button>
            </div>
          </section>

          {/* Itemised BOM materials */}
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <h2 className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-gray-900">
              {t('manufacturing.costing.directMaterials')}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">{t('manufacturing.costing.materialsTable.component')}</th>
                    <th className="px-4 py-2 text-right">{t('manufacturing.costing.materialsTable.quantityPerUnit')}</th>
                    <th className="px-4 py-2 text-left">{t('manufacturing.costing.materialsTable.unitOfMeasure')}</th>
                    <th className="px-4 py-2 text-right">{t('manufacturing.costing.materialsTable.unitCost')}</th>
                    <th className="px-4 py-2 text-right">{t('manufacturing.costing.scrapFactor')}</th>
                    <th className="px-4 py-2 text-right">{t('manufacturing.costing.materialsTable.lineCost')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {materials.map((line) => (
                    <tr key={line.id}>
                      <td className="px-4 py-2 font-medium text-gray-900">{line.component_name}</td>
                      <td className="px-4 py-2 text-right">{line.quantity_per_unit}</td>
                      <td className="px-4 py-2">{line.unit_of_measure}</td>
                      <td className="px-4 py-2 text-right">{money(line.unit_cost)}</td>
                      <td className="px-4 py-2 text-right">{line.scrap_factor_pct}%</td>
                      <td className="px-4 py-2 text-right font-semibold">
                        {money(line.quantity_per_unit * line.unit_cost * (1 + line.scrap_factor_pct / 100))}
                      </td>
                    </tr>
                  ))}
                  {materials.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-400">{t('manufacturing.costing.noProducts')}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Editable labor operations */}
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">{t('manufacturing.costing.directLabor')}</h2>
              <button
                type="button"
                onClick={() => setLabor((rows) => [...rows, {
                  id: newLocalId('labor'), operation_name: t('manufacturing.costing.laborTable.operation'),
                  labor_hours: 0, hourly_rate: 0, line_cost: 0,
                }])}
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 no-print"
              >
                <Plus className="h-3.5 w-3.5" />{t('manufacturing.costing.laborTable.add')}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">{t('manufacturing.costing.laborTable.operation')}</th>
                    <th className="px-4 py-2 text-right">{t('manufacturing.costing.laborTable.hoursPerUnit')}</th>
                    <th className="px-4 py-2 text-right">{t('manufacturing.costing.laborTable.hourlyRate')}</th>
                    <th className="px-4 py-2 text-right">{t('manufacturing.costing.laborTable.lineCost')}</th>
                    <th className="px-2 py-2 no-print" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {labor.map((row, index) => {
                    const lineCost = row.labor_hours * row.hourly_rate;
                    return (
                      <tr key={row.id}>
                        <td className="px-4 py-2">
                          <input
                            value={row.operation_name}
                            onChange={(event) => setLabor((rows) => rows.map((entry, i) => i === index ? { ...entry, operation_name: event.target.value } : entry))}
                            className="w-full rounded border border-gray-200 px-2 py-1 no-print"
                            aria-label={t('manufacturing.costing.laborTable.operation')}
                          />
                          <span className="hidden print:inline">{row.operation_name}</span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <input
                            type="number" min="0" step="0.01" value={row.labor_hours}
                            onChange={(event) => setLabor((rows) => rows.map((entry, i) => i === index
                              ? { ...entry, labor_hours: Number(event.target.value) || 0, line_cost: (Number(event.target.value) || 0) * entry.hourly_rate }
                              : entry))}
                            className="w-24 rounded border border-gray-200 px-2 py-1 text-right no-print"
                            aria-label={t('manufacturing.costing.laborTable.hoursPerUnit')}
                          />
                          <span className="hidden print:inline">{row.labor_hours}</span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <input
                            type="number" min="0" step="0.01" value={row.hourly_rate}
                            onChange={(event) => setLabor((rows) => rows.map((entry, i) => i === index
                              ? { ...entry, hourly_rate: Number(event.target.value) || 0, line_cost: entry.labor_hours * (Number(event.target.value) || 0) }
                              : entry))}
                            className="w-28 rounded border border-gray-200 px-2 py-1 text-right no-print"
                            aria-label={t('manufacturing.costing.laborTable.hourlyRate')}
                          />
                          <span className="hidden print:inline">{money(row.hourly_rate)}</span>
                        </td>
                        <td className="px-4 py-2 text-right font-semibold">{money(lineCost)}</td>
                        <td className="px-2 py-2 no-print">
                          <button
                            type="button"
                            aria-label={t('manufacturing.costing.laborTable.remove')}
                            onClick={() => setLabor((rows) => rows.filter((_, i) => i !== index))}
                            className="text-gray-400 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* Editable overhead inputs */}
          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">{t('manufacturing.costing.overhead')}</h2>
              <button
                type="button"
                onClick={() => setOverheads((rows) => [...rows, {
                  id: newLocalId('overhead'), overhead_name: t('manufacturing.costing.overheadTable.name'),
                  cost_type: 'fixed', rate_or_amount: 0, line_cost: 0,
                }])}
                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 no-print"
              >
                <Plus className="h-3.5 w-3.5" />{t('manufacturing.costing.overheadTable.add')}
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-2 text-left">{t('manufacturing.costing.overheadTable.name')}</th>
                    <th className="px-4 py-2 text-left">{t('manufacturing.costing.overheadTable.costType')}</th>
                    <th className="px-4 py-2 text-right">{t('manufacturing.costing.overheadTable.rateOrAmount')}</th>
                    <th className="px-4 py-2 text-right">{t('manufacturing.costing.overheadTable.lineCost')}</th>
                    <th className="px-2 py-2 no-print" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {overheads.map((row, index) => {
                    const lineCost = row.cost_type === 'percentage'
                      ? (cost.materialCostUnit + cost.laborCostUnit) * row.rate_or_amount / 100
                      : row.rate_or_amount;
                    return (
                      <tr key={row.id}>
                        <td className="px-4 py-2">
                          <input
                            value={row.overhead_name}
                            onChange={(event) => setOverheads((rows) => rows.map((entry, i) => i === index ? { ...entry, overhead_name: event.target.value } : entry))}
                            className="w-full rounded border border-gray-200 px-2 py-1 no-print"
                            aria-label={t('manufacturing.costing.overheadTable.name')}
                          />
                          <span className="hidden print:inline">{row.overhead_name}</span>
                        </td>
                        <td className="px-4 py-2">
                          <select
                            value={row.cost_type}
                            onChange={(event) => setOverheads((rows) => rows.map((entry, i) => i === index
                              ? { ...entry, cost_type: event.target.value as OverheadCostLine['cost_type'] }
                              : entry))}
                            className="rounded border border-gray-200 px-2 py-1 no-print"
                            aria-label={t('manufacturing.costing.overheadTable.costType')}
                          >
                            <option value="fixed">{t('manufacturing.costing.overheadTable.fixed')}</option>
                            <option value="machine_hours">{t('manufacturing.costing.overheadTable.machine_hours')}</option>
                            <option value="percentage">{t('manufacturing.costing.overheadTable.percentage')}</option>
                          </select>
                          <span className="hidden print:inline">
                            {t(`manufacturing.costing.overheadTable.${row.cost_type}`)}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <input
                            type="number" min="0" step="0.01" value={row.rate_or_amount}
                            onChange={(event) => setOverheads((rows) => rows.map((entry, i) => i === index
                              ? { ...entry, rate_or_amount: Number(event.target.value) || 0, line_cost: Number(event.target.value) || 0 }
                              : entry))}
                            className="w-28 rounded border border-gray-200 px-2 py-1 text-right no-print"
                            aria-label={t('manufacturing.costing.overheadTable.rateOrAmount')}
                          />
                          <span className="hidden print:inline">{row.rate_or_amount}</span>
                        </td>
                        <td className="px-4 py-2 text-right font-semibold">{money(lineCost)}</td>
                        <td className="px-2 py-2 no-print">
                          <button
                            type="button"
                            aria-label={t('manufacturing.costing.overheadTable.remove')}
                            onClick={() => setOverheads((rows) => rows.filter((_, i) => i !== index))}
                            className="text-gray-400 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {confirming && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-gray-900">{t('manufacturing.costing.confirmTitle')}</h2>
            <p className="mt-2 text-sm text-gray-600">
              {t('manufacturing.costing.confirmBody', {
                product: selected.name,
                price: money(pricing.recommendedPrice),
                cost: money(cost.totalUnitCost),
              })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700"
              >
                {t('manufacturing.costing.cancel')}
              </button>
              <button
                type="button"
                disabled={applying}
                onClick={() => void handleApply()}
                className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {t('manufacturing.costing.confirmApply')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ProductCostingPage;
