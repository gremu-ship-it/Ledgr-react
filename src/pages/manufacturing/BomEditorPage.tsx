import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Lock, Play, Plus, Save, Trash2 } from 'lucide-react';
import { PlanGate } from '@/components/billing/PlanGate';
import { CapabilityGate } from '@/components/billing/CapabilityGate';
import { useCapability } from '@/hooks/useCapability';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { supabase } from '@/lib/supabase';
import type { BomComponentDraft } from '@/dal/repositories/BomRepository';
import type { Row } from '@/dal/types/database';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sb = supabase as unknown as { from: (table: string) => any; rpc: (name: string, args: unknown) => any };

type ProductRow = Pick<Row<'products'>, 'id' | 'name' | 'product_type' | 'unit_of_measure' | 'purchase_price'> & {
  cost_price?: number | null;
};
type BomRow = Pick<Row<'manufacturing_boms'>, 'id' | 'business_id' | 'product_id' | 'version' | 'status' | 'bom_locked_at' | 'notes'>;
type LineForm = {
  kind: 'product' | 'subassembly';
  component_product_id: string;
  component_bom_id: string;
  quantity: string;
  unit_of_measure: string;
  scrap_pct: string;
  notes: string;
};

const emptyLine = (kind: LineForm['kind'] = 'product'): LineForm => ({
  kind, component_product_id: '', component_bom_id: '', quantity: '1', unit_of_measure: '', scrap_pct: '0', notes: '',
});

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return String(error);
}

export function BomEditorPage() {
  return (
    <PlanGate minPlan="enterprise" featureNameKey="navigation.sections.manufacturing">
      <BomEditorPageContent />
    </PlanGate>
  );
}

function BomEditorPageContent() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id);
  const hasManufacturing = useCapability('manufacturing');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outputProductId, setOutputProductId] = useState('');
  const [notes, setNotes] = useState('');
  const [version, setVersion] = useState(1);
  const [status, setStatus] = useState('draft');
  const [lockedAt, setLockedAt] = useState<string | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [boms, setBoms] = useState<BomRow[]>([]);
  const [subassemblyCosts, setSubassemblyCosts] = useState<Record<string, number>>({});
  const [lines, setLines] = useState<LineForm[]>([]);

  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const bomsById = useMemo(() => new Map(boms.map((bom) => [bom.id, bom])), [boms]);
  const isLocked = Boolean(lockedAt);
  const canEdit = !isLocked && (!isEdit || status === 'draft');

  const totalCost = useMemo(() => lines.reduce((total, line) => {
    const quantity = Number(line.quantity);
    const scrap = Number(line.scrap_pct || 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(scrap)) return total;
    const unitCost = line.kind === 'subassembly'
      ? subassemblyCosts[line.component_bom_id] ?? 0
      : Number(productsById.get(line.component_product_id)?.cost_price ?? productsById.get(line.component_product_id)?.purchase_price ?? 0);
    return total + quantity * (1 + scrap / 100) * unitCost;
  }, 0), [lines, productsById, subassemblyCosts]);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [productsResult, bomsResult] = await Promise.all([
          sb.from('products')
            .select('id,name,product_type,unit_of_measure,purchase_price,cost_price')
            .eq('business_id', businessId)
            .neq('product_type', 'service')
            .order('name'),
          sb.from('manufacturing_boms')
            .select('id,business_id,product_id,version,status,bom_locked_at,notes')
            .eq('business_id', businessId)
            .order('version', { ascending: false }),
        ]);
        if (productsResult.error) throw productsResult.error;
        if (bomsResult.error) throw bomsResult.error;
        if (cancelled) return;
        const loadedProducts = (productsResult.data ?? []) as ProductRow[];
        const loadedBoms = (bomsResult.data ?? []) as BomRow[];
        setProducts(loadedProducts);
        setBoms(loadedBoms);
        const costPairs = await Promise.all(loadedBoms.map(async (bom) => {
          const result = await sb.rpc('manufacturing_bom_cost', { p_bom_id: bom.id });
          return [bom.id, result.error ? 0 : Number(result.data ?? 0)] as const;
        }));
        if (cancelled) return;
        setSubassemblyCosts(Object.fromEntries(costPairs));

        if (id) {
          const tree = await repos.bom.getVersionTree(businessId!, id);
          if (cancelled) return;
          setOutputProductId(tree.product_id);
          setNotes(tree.notes ?? '');
          setVersion(tree.version);
          setStatus(tree.status);
          setLockedAt(tree.bom_locked_at);
          setLines(tree.components.map((line) => ({
            kind: line.component_bom_id ? 'subassembly' : 'product',
            component_product_id: line.component_product_id ?? '',
            component_bom_id: line.component_bom_id ?? '',
            quantity: String(line.quantity),
            unit_of_measure: line.unit_of_measure ?? '',
            scrap_pct: String(line.scrap_pct ?? 0),
            notes: line.notes ?? '',
          })));
        } else {
          setLines([]);
        }
      } catch {
        if (!cancelled) setError(t('manufacturing.bom.errors.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [businessId, id, t]);

  function updateLine(index: number, patch: Partial<LineForm>) {
    if (!canEdit) return;
    setLines((current) => current.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      const next = { ...line, ...patch };
      if (patch.kind === 'product') next.component_bom_id = '';
      if (patch.kind === 'subassembly') next.component_product_id = '';
      if (patch.component_product_id) {
        next.kind = 'product';
        next.component_bom_id = '';
        const product = productsById.get(patch.component_product_id);
        if (!line.unit_of_measure && product?.unit_of_measure) next.unit_of_measure = product.unit_of_measure;
      }
      if (patch.component_bom_id) {
        next.kind = 'subassembly';
        next.component_product_id = '';
      }
      return next;
    }));
  }

  function validate(): string | null {
    if (!outputProductId) return t('manufacturing.bom.errors.requiredProduct');
    const seen = new Set<string>();
    for (const line of lines) {
      const productId = line.kind === 'product' ? line.component_product_id || null : null;
      const componentBomId = line.kind === 'subassembly' ? line.component_bom_id || null : null;
      if ((!productId && !componentBomId) || (productId && componentBomId)) {
        return t('manufacturing.bom.errors.requiredComponent');
      }
      const componentProductId = productId ?? bomsById.get(componentBomId!)?.product_id;
      if (componentProductId === outputProductId) return t('manufacturing.bom.circularRef');
      const identity = productId ? `product:${productId}` : `bom:${componentBomId}`;
      if (seen.has(identity)) return t('manufacturing.bom.errors.duplicateComponent');
      seen.add(identity);
      const quantity = Number(line.quantity);
      const scrap = Number(line.scrap_pct || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) return t('manufacturing.bom.errors.positiveQuantity');
      if (!Number.isFinite(scrap) || scrap < 0 || scrap >= 100) return t('manufacturing.bom.errors.invalidScrap');
    }
    return null;
  }

  async function handleSave() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!businessId) {
      setError(t('manufacturing.bom.errors.noBusiness'));
      return;
    }
    if (isEdit && !canEdit) {
      setError(isLocked ? t('manufacturing.bom.lockedMessage') : t('manufacturing.bom.readOnlyVersion'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const components: BomComponentDraft[] = lines.map((line) => ({
        component_product_id: line.kind === 'product' ? line.component_product_id || null : null,
        component_bom_id: line.kind === 'subassembly' ? line.component_bom_id || null : null,
        quantity: Number(line.quantity),
        unit_of_measure: line.unit_of_measure || null,
        scrap_pct: Number(line.scrap_pct || 0),
        notes: line.notes || null,
      }));
      const savedId = await repos.bom.saveVersion({
        businessId,
        bomId: isEdit ? id! : null,
        productId: outputProductId,
        notes: notes || null,
        components,
      });
      navigate(`/manufacturing/bom/${savedId}`);
    } catch (saveError: unknown) {
      const message = getErrorMessage(saveError);
      setError(/cycle|circular/i.test(message) ? t('manufacturing.bom.errors.cycleDetected') : t('manufacturing.bom.errors.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleActivate() {
    if (!id) return;
    if (!businessId) {
      setError(t('manufacturing.bom.errors.noBusiness'));
      return;
    }
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setActivating(true);
    setError(null);
    try {
      const savedId = await repos.bom.saveVersion({
        businessId,
        bomId: id,
        productId: outputProductId,
        notes: notes || null,
        components: lines.map((line) => ({
          component_product_id: line.kind === 'product' ? line.component_product_id || null : null,
          component_bom_id: line.kind === 'subassembly' ? line.component_bom_id || null : null,
          quantity: Number(line.quantity),
          unit_of_measure: line.unit_of_measure || null,
          scrap_pct: Number(line.scrap_pct || 0),
          notes: line.notes || null,
        })),
      });
      await repos.bom.activateVersion(savedId);
      navigate(`/manufacturing/bom/${savedId}`);
    } catch (activateError: unknown) {
      const message = getErrorMessage(activateError);
      setError(/cycle|circular/i.test(message) ? t('manufacturing.bom.errors.cycleDetected') : t('manufacturing.bom.errors.activateFailed'));
    } finally {
      setActivating(false);
    }
  }

  if (!hasManufacturing) {
    return <CapabilityGate capability="manufacturing"><div /></CapabilityGate>;
  }

  if (loading && businessId) {
    return <div className="mx-auto max-w-[1200px] px-4 py-6"><div className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">{t('common.loading')}</div></div>;
  }

  const selectedBomIds = new Set(lines.map((line) => line.component_bom_id).filter(Boolean));
  const subassemblyOptions = boms.filter((bom) =>
    (bom.product_id !== outputProductId || selectedBomIds.has(bom.id))
      && (bom.status === 'active' || selectedBomIds.has(bom.id)),
  );

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6">
      <header className="mb-5">
        <div className="flex items-center gap-2">
          <Link to="/manufacturing/bom" className="text-sm text-gray-500 hover:text-gray-700">{t('manufacturing.bom.title')}</Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-xl font-semibold text-gray-900">{isEdit ? t('manufacturing.bom.edit') : t('manufacturing.bom.create')}</h1>
        </div>
        {isLocked && (
          <div role="alert" className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="locked-banner">
            <Lock className="h-4 w-4" />{t('manufacturing.bom.lockedMessage')}
          </div>
        )}
        {isEdit && status !== 'draft' && !isLocked && (
          <p className="mt-3 text-sm text-gray-600">{t('manufacturing.bom.readOnlyVersion')}</p>
        )}
      </header>

      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</div>}

      <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="bom-output-product">{t('manufacturing.bom.outputProduct')} *</label>
            <select id="bom-output-product" value={outputProductId} onChange={(event) => setOutputProductId(event.target.value)} disabled={!canEdit || isEdit} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100" data-testid="output-product-select">
              <option value="">{t('common.none')}</option>
              {products.map((product) => <option key={product.id} value={product.id}>{product.name} — {product.product_type}</option>)}
            </select>
            {isEdit && <p className="mt-1 text-xs text-gray-500">{t('manufacturing.bom.version')}: v{version} ({t(`manufacturing.bom.status.${status}`)})</p>}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="bom-notes">{t('common.details')}</label>
            <textarea id="bom-notes" value={notes} onChange={(event) => setNotes(event.target.value)} disabled={!canEdit} rows={3} placeholder={t('manufacturing.bom.notesPlaceholder')} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100" />
          </div>
        </div>

        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-900">{t('manufacturing.bom.component')}</h2>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setLines((current) => [...current, emptyLine()])} disabled={!canEdit} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50" data-testid="add-component-button"><Plus className="h-4 w-4" />{t('manufacturing.bom.addComponent')}</button>
              <button type="button" onClick={() => setLines((current) => [...current, emptyLine('subassembly')])} disabled={!canEdit || !subassemblyOptions.length} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50" data-testid="add-subassembly-button"><Plus className="h-4 w-4" />{t('manufacturing.bom.addSubassembly')}</button>
            </div>
          </div>

          {!lines.length ? (
            <p className="rounded-lg border border-dashed border-gray-300 px-4 py-6 text-center text-sm text-gray-500">{t('manufacturing.bom.noComponents')}</p>
          ) : (
            <div className="space-y-3">
              {lines.map((line, index) => {
                const isSubassembly = line.kind === 'subassembly';
                const selectedBom = bomsById.get(line.component_bom_id);
                const selectedProduct = productsById.get(line.component_product_id);
                const componentProduct = selectedBom ? productsById.get(selectedBom.product_id) : selectedProduct;
                return (
                  <div key={`${index}-${isSubassembly ? 'bom' : 'product'}`} className="grid grid-cols-12 gap-3 rounded-xl border border-gray-200 p-3" data-testid={`bom-line-${index}`}>
                    <div className="col-span-12 md:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor={`line-${index}-kind`}>{t('manufacturing.bom.componentType')}</label>
                      <select id={`line-${index}-kind`} value={line.kind} onChange={(event) => updateLine(index, { kind: event.target.value as LineForm['kind'], component_product_id: '', component_bom_id: '' })} disabled={!canEdit} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100" data-testid={`line-${index}-kind`}>
                        <option value="product">{t('manufacturing.bom.rawMaterial')}</option>
                        <option value="subassembly">{t('manufacturing.bom.subAssembly')}</option>
                      </select>
                    </div>
                    <div className="col-span-12 md:col-span-4">
                      <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor={`line-${index}-component`}>{t('manufacturing.bom.component')} *</label>
                      {isSubassembly ? (
                        <select id={`line-${index}-component`} value={line.component_bom_id} onChange={(event) => updateLine(index, { component_bom_id: event.target.value })} disabled={!canEdit} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100" data-testid={`line-${index}-component`}>
                          <option value="">{t('manufacturing.bom.selectSubassembly')}</option>
                          {subassemblyOptions.map((bom) => <option key={bom.id} value={bom.id}>{productsById.get(bom.product_id)?.name ?? bom.product_id} — v{bom.version}</option>)}
                        </select>
                      ) : (
                        <select id={`line-${index}-component`} value={line.component_product_id} onChange={(event) => updateLine(index, { component_product_id: event.target.value })} disabled={!canEdit} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100" data-testid={`line-${index}-component`}>
                          <option value="">{t('common.none')}</option>
                          {products.filter((product) => product.id !== outputProductId).map((product) => <option key={product.id} value={product.id}>{product.name} — {product.product_type}</option>)}
                        </select>
                      )}
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor={`line-${index}-quantity`}>{t('manufacturing.bom.quantity')} *</label>
                      <input id={`line-${index}-quantity`} type="number" min="0" step="any" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} disabled={!canEdit} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100" data-testid={`line-${index}-quantity`} />
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor={`line-${index}-uom`}>{t('manufacturing.bom.unitOfMeasure')}</label>
                      <input id={`line-${index}-uom`} type="text" value={line.unit_of_measure} onChange={(event) => updateLine(index, { unit_of_measure: event.target.value })} disabled={!canEdit} placeholder={componentProduct?.unit_of_measure ?? ''} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100" data-testid={`line-${index}-uom`} />
                    </div>
                    <div className="col-span-4 md:col-span-1">
                      <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor={`line-${index}-scrap`}>{t('manufacturing.bom.scrapPercent')}</label>
                      <input id={`line-${index}-scrap`} type="number" min="0" max="99" step="any" value={line.scrap_pct} onChange={(event) => updateLine(index, { scrap_pct: event.target.value })} disabled={!canEdit} className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:bg-gray-100" data-testid={`line-${index}-scrap`} />
                    </div>
                    <div className="col-span-12 flex items-center justify-between gap-2">
                      <input type="text" aria-label={t('manufacturing.bom.notes')} value={line.notes} onChange={(event) => updateLine(index, { notes: event.target.value })} disabled={!canEdit} placeholder={t('manufacturing.bom.notesPlaceholder')} className="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm disabled:bg-gray-100" />
                      <button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))} disabled={!canEdit} className="inline-flex items-center justify-center rounded-lg border border-red-200 p-2 text-red-600 hover:bg-red-50 disabled:opacity-50" aria-label={t('manufacturing.bom.removeComponent')}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="mt-6 rounded-xl bg-gray-50 px-4 py-3">
          <div className="flex items-center justify-between"><span className="text-sm font-medium text-gray-700">{t('manufacturing.bom.totalCost')}</span><span className="text-sm font-semibold text-gray-900" data-testid="total-cost">{totalCost.toFixed(2)} MWK</span></div>
          <p className="mt-1 text-xs text-gray-500">{t('manufacturing.bom.costPerUnitNote')}</p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {canEdit ? <>
            <button type="button" onClick={() => void handleSave()} disabled={saving || activating} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50" data-testid="save-bom-button"><Save className="h-4 w-4" />{saving ? t('common.loading') : t('manufacturing.bom.saveVersion')}</button>
            {isEdit && status === 'draft' && <button type="button" onClick={() => void handleActivate()} disabled={saving || activating || !lines.length} className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50" data-testid="activate-bom-button"><Play className="h-4 w-4" />{activating ? t('common.loading') : t('manufacturing.bom.activate')}</button>}
          </> : <p className="text-sm text-amber-700">{t(isLocked ? 'manufacturing.bom.lockedMessage' : 'manufacturing.bom.readOnlyVersion')}</p>}
          <Link to={isEdit ? `/manufacturing/bom/${id}` : '/manufacturing/bom'} className="inline-flex items-center gap-2 rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50">{t('common.back')}</Link>
        </div>
      </div>
    </div>
  );
}

export default BomEditorPage;
