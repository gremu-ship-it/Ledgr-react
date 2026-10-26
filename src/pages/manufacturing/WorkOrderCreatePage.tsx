import { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ClipboardList } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/dal/types/database';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as unknown as { from: (t: string) => any; rpc: (n: string, p: unknown) => any; auth: any };
import { useCapability } from '@/hooks/useCapability';
import { CapabilityGate } from '@/components/billing/CapabilityGate';

// Derived from the regenerated Database types (P3-4): these reads select a
// fixed column subset through the untyped `sb` adapter below.
type Tables = Database['public']['Tables'];

type ProductRow = Pick<Tables['products']['Row'], 'id' | 'name' | 'product_type' | 'unit_of_measure'>;

type LocationRow = Pick<Tables['inventory_locations']['Row'], 'id' | 'name' | 'location_type' | 'is_default'>;

/** The store the order draws materials from, and the store it delivers into. */
const DEFAULT_SOURCE_TYPE = 'raw_materials_store';
const DEFAULT_DESTINATION_TYPE = 'finished_goods_store';

function pickDefault(locations: LocationRow[], locationType: string): string {
  const typed = locations.filter((l) => l.location_type === locationType);
  if (typed.length === 0) {
    return locations.find((l) => l.is_default)?.id ?? '';
  }
  // Prefer the business default when it is also of the wanted type, so a single
  // store business still resolves deterministically.
  return (typed.find((l) => l.is_default) ?? typed[0]).id;
}

export function WorkOrderCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const businessId = useAppStore((s) => s.currentBusiness?.business?.id);
  const hasManufacturing = useCapability('manufacturing');

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [bomProductIds, setBomProductIds] = useState<Set<string>>(new Set());
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [productId, setProductId] = useState('');
  const [plannedQty, setPlannedQty] = useState('1');
  const [plannedStart, setPlannedStart] = useState('');
  const [plannedEnd, setPlannedEnd] = useState('');
  const [fromLocationId, setFromLocationId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    void (async () => {
      if (!businessId) return;
      setLoading(true);
      try {
        const [{ data: prodData }, { data: bomData }, { data: locData }] = await Promise.all([
          sb.from('products').select('id,name,product_type,unit_of_measure').eq('business_id', businessId).order('name'),
          sb.from('manufacturing_boms').select('product_id,status').eq('business_id', businessId).eq('status', 'active'),
          sb.from('inventory_locations').select('id,name,location_type,is_default').eq('business_id', businessId).order('name'),
        ]);
        const rows = (prodData as ProductRow[]) ?? [];
        setProducts(rows);
        setBomProductIds(new Set(((bomData as { product_id: string }[]) ?? []).map((b) => b.product_id)));
        const locs = (locData as LocationRow[]) ?? [];
        setLocations(locs);
        setFromLocationId(pickDefault(locs, DEFAULT_SOURCE_TYPE));
        setToLocationId(pickDefault(locs, DEFAULT_DESTINATION_TYPE));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [businessId]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!businessId || !productId) return;
      setSaving(true);
      setError(null);
      try {
        const { data, error: rpcError } = await sb.rpc('manufacturing_wo_create', {
          p_business_id: businessId,
          p_product_id: productId,
          p_planned_qty: Number(plannedQty),
          p_planned_start: plannedStart || null,
          p_planned_end: plannedEnd || null,
          p_from_location_id: fromLocationId || null,
          p_to_location_id: toLocationId || null,
          p_notes: notes || null,
        });
        if (rpcError) throw rpcError;
        navigate(`/manufacturing/production/${data as string}`);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
        setSaving(false);
      }
    },
    [businessId, productId, plannedQty, plannedStart, plannedEnd, fromLocationId, toLocationId, notes, navigate],
  );

  if (!hasManufacturing) {
    return (
      <CapabilityGate capability="manufacturing">
        <div />
      </CapabilityGate>
    );
  }

  const qty = Number(plannedQty);
  const qtyInvalid = !Number.isFinite(qty) || qty <= 0;
  const canSubmit = !!productId && !qtyInvalid && !saving;

  return (
    <div className="mx-auto max-w-[760px] px-4 py-6">
      <header className="mb-5">
        <Link
          to="/manufacturing/production"
          className="mb-2 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('manufacturing.wo.title')}
        </Link>
        <h1 className="text-xl font-semibold text-gray-900">{t('manufacturing.wo.create')}</h1>
      </header>

      {loading ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          {t('common.loading')}
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
        >
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              {t('manufacturing.wo.outputProduct')}
            </span>
            <select
              value={productId}
              onChange={(e) => setProductId(e.target.value)}
              required
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900"
              data-testid="output-product-select"
            >
              <option value="">{t('manufacturing.wo.outputProduct')}</option>
              {products.map((p) => {
                const hasBom = bomProductIds.has(p.id);
                return (
                  <option
                    key={p.id}
                    value={p.id}
                    disabled={!hasBom}
                    title={hasBom ? undefined : t('manufacturing.wo.noActiveBom')}
                    className={hasBom ? undefined : 'text-gray-400'}
                  >
                    {p.name}
                    {hasBom ? '' : ` — ${t('manufacturing.wo.noActiveBom')}`}
                  </option>
                );
              })}
            </select>
            {products.length > 0 && bomProductIds.size === 0 ? (
              <p className="mt-1 text-xs text-amber-700">{t('manufacturing.wo.noActiveBom')}</p>
            ) : null}
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">
              {t('manufacturing.wo.plannedQuantity')}
            </span>
            <input
              type="number"
              min="0.000001"
              step="any"
              value={plannedQty}
              onChange={(e) => setPlannedQty(e.target.value)}
              required
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900"
              data-testid="planned-quantity-input"
            />
            {qtyInvalid ? (
              <p className="mt-1 text-xs text-red-600">{t('manufacturing.wo.plannedQuantity')}</p>
            ) : null}
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                {t('manufacturing.wo.plannedStart')}
              </span>
              <input
                type="date"
                value={plannedStart}
                onChange={(e) => setPlannedStart(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900"
                data-testid="planned-start-input"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                {t('manufacturing.wo.plannedEnd')}
              </span>
              <input
                type="date"
                value={plannedEnd}
                onChange={(e) => setPlannedEnd(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900"
                data-testid="planned-end-input"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                {t('manufacturing.wo.sourceLocation')}
              </span>
              <select
                value={fromLocationId}
                onChange={(e) => setFromLocationId(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900"
                data-testid="source-location-select"
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-gray-700">
                {t('manufacturing.wo.destinationLocation')}
              </span>
              <select
                value={toLocationId}
                onChange={(e) => setToLocationId(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900"
                data-testid="destination-location-select"
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700">{t('common.details')}</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900"
              data-testid="notes-input"
            />
          </label>

          {error ? (
            <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          ) : null}

          <div className="flex items-center justify-end gap-3">
            <Link
              to="/manufacturing/production"
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {t('common.cancel')}
            </Link>
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              data-testid="save-work-order-button"
            >
              <ClipboardList className="h-4 w-4" />
              {t('common.save')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default WorkOrderCreatePage;
