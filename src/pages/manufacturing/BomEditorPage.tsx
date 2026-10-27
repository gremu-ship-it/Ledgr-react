import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams, Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Lock, Save, Play } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { supabase } from '@/lib/supabase';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as unknown as { from: (t: string) => any; rpc: (n: string, p: unknown) => any; auth: any };
import { useCapability } from '@/hooks/useCapability';
import { CapabilityGate } from '@/components/billing/CapabilityGate';

type ProductRow = {
  id: string;
  name: string;
  product_type: string;
  unit_of_measure: string | null;
  purchase_price: number;
  cost_price?: number | null;
};

type BomRow = {
  id: string;
  business_id: string;
  product_id: string;
  version: number;
  status: string;
  bom_locked_at: string | null;
  notes: string | null;
};

type LineForm = {
  id?: string; // existing line id
  component_product_id: string;
  quantity: string;
  unit_of_measure: string;
  scrap_pct: string;
  notes: string;
};

export function BomEditorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const businessId = useAppStore((s) => s.currentBusiness?.business?.id);
  const hasManufacturing = useCapability('manufacturing');

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Header form
  const [outputProductId, setOutputProductId] = useState('');
  const [notes, setNotes] = useState('');
  const [version, setVersion] = useState<number>(1);
  const [status, setStatus] = useState<string>('draft');
  const [lockedAt, setLockedAt] = useState<string | null>(null);

  // Products for dropdowns
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [lines, setLines] = useState<LineForm[]>([]);

  // Derived for live cost rollup
  const productsById = useMemo(() => {
    const m: Record<string, ProductRow> = {};
    for (const p of products) m[p.id] = p;
    return m;
  }, [products]);

  const totalCost = useMemo(() => {
    let sum = 0;
    for (const line of lines) {
      const prod = productsById[line.component_product_id];
      if (!prod) continue;
      const qty = parseFloat(line.quantity);
      const scrap = parseFloat(line.scrap_pct || '0');
      const unitCost = Number(prod.cost_price ?? prod.purchase_price ?? 0);
      if (isNaN(qty) || qty <= 0) continue;
      if (isNaN(scrap)) continue;
      sum += qty * (1 + scrap / 100) * unitCost;
    }
    return sum;
  }, [lines, productsById]);

  const isLocked = Boolean(lockedAt);

  // Load products (filter product_type != service)
  useEffect(() => {
    if (!businessId) return;
    const fetchProducts = async () => {
      const { data } = await sb
        .from('products')
        .select('id,name,product_type,unit_of_measure,purchase_price,cost_price')
        .eq('business_id', businessId)
        .neq('product_type', 'service')
        .order('name');

      setProducts((data as ProductRow[]) ?? []);
    };
    void fetchProducts();
  }, [businessId]);

  // Load existing BOM if editing
  useEffect(() => {
    if (!id || !businessId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const { data: bom, error: bomErr } = await sb
          .from('manufacturing_boms')
          .select('*')
          .eq('id', id)
          .single();
        if (bomErr) throw bomErr;
        if (cancelled) return;
        const b = bom as BomRow;
        setOutputProductId(b.product_id);
        setNotes(b.notes ?? '');
        setVersion(b.version);
        setStatus(b.status);
        setLockedAt(b.bom_locked_at);

        const { data: bomLines, error: linesErr } = await sb
          .from('manufacturing_bom_lines')
          .select('*')
          .eq('bom_id', id);

        if (linesErr) throw linesErr;
        if (cancelled) return;
        setLines(
          (bomLines as unknown as Array<{
            id: string;
            component_product_id: string;
            quantity: number;
            unit_of_measure: string | null;
            scrap_pct: number;
            notes: string | null;
          }>)?.map((l) => ({
            id: l.id,
            component_product_id: l.component_product_id,
            quantity: String(l.quantity),
            unit_of_measure: l.unit_of_measure ?? '',
            scrap_pct: String(l.scrap_pct ?? 0),
            notes: l.notes ?? '',
          })) ?? [],
        );
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, businessId]);

  const addLine = () => {
    if (isLocked) return;
    setLines((prev) => [
      ...prev,
      {
        component_product_id: '',
        quantity: '1',
        unit_of_measure: '',
        scrap_pct: '0',
        notes: '',
      },
    ]);
  };

  const removeLine = (index: number) => {
    if (isLocked) return;
    setLines((prev) => prev.filter((_, i) => i !== index));
  };

  const updateLine = (index: number, patch: Partial<LineForm>) => {
    if (isLocked) return;
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== index) return l;
        const next = { ...l, ...patch };
        // Auto-fill unit_of_measure from product if empty
        if (patch.component_product_id) {
          const prod = productsById[patch.component_product_id];
          if (prod?.unit_of_measure && !l.unit_of_measure) {
            next.unit_of_measure = prod.unit_of_measure;
          }
        }
        return next;
      }),
    );
  };

  const validate = (): string | null => {
    if (!outputProductId) return 'Output product is required';
    for (const line of lines) {
      if (!line.component_product_id) return 'Component product is required for all lines';
      if (line.component_product_id === outputProductId) {
        return t('manufacturing.bom.circularRef');
      }
      const qty = parseFloat(line.quantity);
      if (isNaN(qty) || qty <= 0) return 'Quantity must be > 0';
      const scrap = parseFloat(line.scrap_pct || '0');
      if (isNaN(scrap) || scrap < 0 || scrap >= 100) return 'Scrap % must be between 0 and 99';
    }
    // check duplicate components
    const ids = lines.map((l) => l.component_product_id).filter(Boolean);
    if (new Set(ids).size !== ids.length) return 'Duplicate component in same BOM';
    return null;
  };

  const handleSave = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!businessId) {
      setError('No business selected');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Get current user id from supabase auth
      const {
        data: { user },
      } = await sb.auth.getUser();
      const createdBy = user?.id;
      if (!createdBy && !isEdit) {
        throw new Error('Not authenticated');
      }

      let bomId = id;

      if (!isEdit) {
        // create new BOM header
        const { data, error } = await sb
          .from('manufacturing_boms')
          .insert({
            business_id: businessId,
            product_id: outputProductId,
            version: 1,
            status: 'draft',
            notes: notes || null,
            created_by: createdBy,
          } as never)
          .select('id')
          .single();
        if (error) throw error;
        bomId = (data as { id: string }).id;
      } else {
        // update header (draft only)
        if (isLocked) throw new Error(t('manufacturing.bom.lockedMessage'));
        if (status !== 'draft') {
          // Editing locked/active should create new version via RPC, but this path is for draft edit
          throw new Error('Only draft BOMs can be edited. Create a new version.');
        }
        const { error } = await sb
          .from('manufacturing_boms')
          .update({ notes: notes || null } as never)
          .eq('id', id);
        if (error) throw error;
      }

      if (!bomId) throw new Error('Failed to create BOM');

      // Upsert lines: simplest is delete all existing and insert current lines (for draft)
      if (isEdit) {
        const { error: delErr } = await sb.from('manufacturing_bom_lines').delete().eq('bom_id', bomId);
        if (delErr) throw delErr;
      }

      if (lines.length > 0) {
        const payload = lines.map((l) => ({
          bom_id: bomId,
          component_product_id: l.component_product_id,
          quantity: parseFloat(l.quantity),
          unit_of_measure: l.unit_of_measure || null,
          scrap_pct: parseFloat(l.scrap_pct || '0'),
          notes: l.notes || null,
        }));

        const { error: lineErr } = await sb.from('manufacturing_bom_lines').insert(payload as never);
        if (lineErr) throw lineErr;
      }

      navigate(`/manufacturing/bom/${bomId}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleActivate = async () => {
    if (!id) return;
    if (lines.length === 0) {
      setError(t('manufacturing.bom.noComponents'));
      return;
    }
    setActivating(true);
    setError(null);
    try {
      // First save changes if any, then activate
      const { error } = await sb.rpc('manufacturing_bom_activate', { p_bom_id: id });
      if (error) throw error;
      navigate(`/manufacturing/bom/${id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setActivating(false);
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

  // Output product dropdown filtered to product_type != service
  const outputOptions = products;
  // Component options exclude output product itself (circular ref)
  const componentOptions = products.filter((p) => p.id !== outputProductId);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <header className="mb-5">
        <div className="flex items-center gap-2">
          <Link to="/manufacturing/bom" className="text-sm text-gray-500 hover:text-gray-700">
            {t('manufacturing.bom.title')}
          </Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-xl font-semibold text-gray-900">
            {isEdit ? t('manufacturing.bom.edit') : t('manufacturing.bom.create')}
          </h1>
        </div>
        {isLocked && (
          <div
            role="alert"
            className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            data-testid="locked-banner"
          >
            <Lock className="h-4 w-4" />
            {t('manufacturing.bom.lockedMessage')}
          </div>
        )}
      </header>

      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        {/* Header fields */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t('manufacturing.bom.outputProduct')} *
            </label>
            <select
              value={outputProductId}
              onChange={(e) => setOutputProductId(e.target.value)}
              disabled={isLocked || (isEdit && status !== 'draft')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100"
              data-testid="output-product-select"
            >
              <option value="">{t('common.none')}</option>
              {outputOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.product_type}
                </option>
              ))}
            </select>
            {isEdit && (
              <p className="mt-1 text-xs text-gray-500">
                {t('manufacturing.bom.version')}: v{version} ({t(`manufacturing.bom.status.${status}`)})
              </p>
            )}
            {!isEdit && (
              <p className="mt-1 text-xs text-gray-500">
                {t('manufacturing.bom.version')}: v1 ({t('manufacturing.bom.status.draft')})
              </p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t('common.details')}</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isLocked}
              rows={3}
              placeholder="Notes"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100"
            />
          </div>
        </div>

        {/* Component lines */}
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">{t('manufacturing.bom.component')}s</h2>
            <button
              type="button"
              onClick={addLine}
              disabled={isLocked}
              className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              data-testid="add-component-button"
            >
              <Plus className="h-4 w-4" />
              {t('manufacturing.bom.addComponent')}
            </button>
          </div>

          {lines.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">
              {t('manufacturing.bom.noComponents')}
            </p>
          ) : (
            <div className="space-y-3">
              {lines.map((line, idx) => {
                const selectedProduct = productsById[line.component_product_id];
                const isCircular = line.component_product_id === outputProductId;
                return (
                  <div
                    key={idx}
                    className="grid grid-cols-12 gap-3 rounded-xl border border-gray-200 p-3"
                    data-testid={`bom-line-${idx}`}
                  >
                    <div className="col-span-12 md:col-span-4">
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        {t('manufacturing.bom.component')} *
                      </label>
                      <select
                        value={line.component_product_id}
                        onChange={(e) => updateLine(idx, { component_product_id: e.target.value })}
                        disabled={isLocked}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none disabled:bg-gray-100"
                        data-testid={`line-${idx}-component`}
                      >
                        <option value="">{t('common.none')}</option>
                        {componentOptions.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} — {p.product_type}
                          </option>
                        ))}
                        {/* If circular product was somehow selected, show it disabled */}
                        {isCircular && selectedProduct && (
                          <option value={selectedProduct.id} disabled>
                            {selectedProduct.name} — circular
                          </option>
                        )}
                      </select>
                      {isCircular && (
                        <p className="mt-1 text-xs text-red-600" role="alert">
                          {t('manufacturing.bom.circularRef')}
                        </p>
                      )}
                    </div>

                    <div className="col-span-4 md:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        {t('manufacturing.bom.quantity')} *
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={line.quantity}
                        onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                        disabled={isLocked}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none disabled:bg-gray-100"
                        data-testid={`line-${idx}-quantity`}
                      />
                    </div>

                    <div className="col-span-4 md:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        {t('manufacturing.bom.unitOfMeasure')}
                      </label>
                      <input
                        type="text"
                        value={line.unit_of_measure}
                        onChange={(e) => updateLine(idx, { unit_of_measure: e.target.value })}
                        disabled={isLocked}
                        placeholder={selectedProduct?.unit_of_measure ?? ''}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none disabled:bg-gray-100"
                        data-testid={`line-${idx}-uom`}
                      />
                    </div>

                    <div className="col-span-4 md:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        {t('manufacturing.bom.scrapPercent')}
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="99"
                        step="any"
                        value={line.scrap_pct}
                        onChange={(e) => updateLine(idx, { scrap_pct: e.target.value })}
                        disabled={isLocked}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none disabled:bg-gray-100"
                        data-testid={`line-${idx}-scrap`}
                      />
                    </div>

                    <div className="col-span-8 md:col-span-1 flex items-end">
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        disabled={isLocked}
                        className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-red-200 px-2 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                        aria-label={`Remove line ${idx}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="col-span-12">
                      <input
                        type="text"
                        value={line.notes}
                        onChange={(e) => updateLine(idx, { notes: e.target.value })}
                        disabled={isLocked}
                        placeholder="Notes (optional)"
                        className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm focus:border-brand-500 focus:outline-none disabled:bg-gray-100"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Live cost rollup */}
        <div className="mt-6 rounded-xl bg-gray-50 px-4 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">{t('manufacturing.bom.totalCost')}</span>
            <span className="text-sm font-semibold text-gray-900" data-testid="total-cost">
              {totalCost.toFixed(2)} MWK
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">Material cost only = Σ qty × (1 + scrap/100) × unit cost</p>
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {!isLocked ? (
            <>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || activating}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                data-testid="save-bom-button"
              >
                <Save className="h-4 w-4" />
                {saving ? t('common.loading') : t('common.save')}
              </button>
              {isEdit && status === 'draft' && (
                <button
                  type="button"
                  onClick={handleActivate}
                  disabled={saving || activating || lines.length === 0}
                  className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                  data-testid="activate-bom-button"
                >
                  <Play className="h-4 w-4" />
                  {t('manufacturing.bom.activate')}
                </button>
              )}
            </>
          ) : (
            <p className="text-sm text-amber-700">{t('manufacturing.bom.lockedMessage')}</p>
          )}
          <Link
            to={isEdit ? `/manufacturing/bom/${id}` : '/manufacturing/bom'}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            {t('common.back')}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default BomEditorPage;
