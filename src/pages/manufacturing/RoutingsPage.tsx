import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ClipboardList, Plus, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PlanGate } from '@/components/billing/PlanGate';
import { CapabilityGate } from '@/components/billing/CapabilityGate';
import { useCapability } from '@/hooks/useCapability';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { manufacturingErrorMessage } from './manufacturingErrorMessage';
import { supabase } from '@/lib/supabase';
import type { RoutingStepInput, RoutingSummary, WorkCentre } from '@/dal/repositories/ManufacturingRepository';

type ProductOption = { id: string; name: string; sku: string | null };
type BomOption = { id: string; product_id: string; version: number };
const blankStep = (sequence: number, centreId: string): RoutingStepInput => ({ sequence, work_centre_id: centreId, operation_name: '', setup_time_minutes: 0, run_time_per_unit_minutes: 0, queue_time_minutes: 0, is_quality_checkpoint: false, notes: null });

export function RoutingsPage() { return <PlanGate minPlan="enterprise" featureNameKey="navigation.sections.manufacturing"><RoutingsContent /></PlanGate>; }

function RoutingsContent() {
  const { t } = useTranslation();
  const translateRef = useRef(t);
  useEffect(() => { translateRef.current = t; }, [t]);
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id);
  const canUseManufacturing = useCapability('manufacturing');
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [boms, setBoms] = useState<BomOption[]>([]);
  const [centres, setCentres] = useState<WorkCentre[]>([]);
  const [routes, setRoutes] = useState<RoutingSummary[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [productId, setProductId] = useState('');
  const [bomId, setBomId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [version, setVersion] = useState(1);
  const [notes, setNotes] = useState('');
  const [steps, setSteps] = useState<RoutingStepInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [routeRows, centreRows, productResult, bomResult] = await Promise.all([
        repos.manufacturing.listRoutings(businessId),
        repos.manufacturing.listWorkCentres(businessId),
        supabase.from('products').select('id,name,sku').eq('business_id', businessId).order('name'),
        supabase.from('manufacturing_boms').select('id,product_id,version').eq('business_id', businessId).eq('status', 'active').order('version', { ascending: false }),
      ]);
      if (productResult.error) throw productResult.error;
      if (bomResult.error) throw bomResult.error;
      setRoutes(routeRows); setCentres(centreRows); setProducts((productResult.data ?? []) as ProductOption[]); setBoms((bomResult.data ?? []) as BomOption[]); setError(null);
    } catch (cause) { setError(manufacturingErrorMessage(cause, (key) => translateRef.current(key))); }
    finally { setLoading(false); }
  }, [businessId]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return refresh(); });
    return () => { active = false; };
  }, [refresh]);

  const reset = () => { setEditingId(null); setProductId(''); setBomId(''); setCode(''); setName(''); setVersion(1); setNotes(''); setSteps([]); setError(null); };
  const edit = async (route: RoutingSummary) => {
    if (!businessId) return;
    setBusy(true); setError(null);
    try {
      const detail = await repos.manufacturing.getRoutingWithSteps(businessId, route.id);
      setEditingId(route.id); setProductId(route.product_id); setBomId(route.bom_version_id ?? ''); setCode(route.code); setName(route.name); setVersion(route.version_number); setNotes(route.notes ?? '');
      setSteps(detail.steps.map((step) => ({ sequence: step.sequence, work_centre_id: step.work_centre_id, operation_name: step.operation_name, setup_time_minutes: step.setup_time_minutes, run_time_per_unit_minutes: step.run_time_per_unit_minutes, queue_time_minutes: step.queue_time_minutes, is_quality_checkpoint: step.is_quality_checkpoint, notes: step.notes })));
    } catch (cause) { setError(manufacturingErrorMessage(cause, (key) => translateRef.current(key))); }
    finally { setBusy(false); }
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!businessId) return;
    setBusy(true); setError(null);
    try {
      await repos.manufacturing.saveRouting(businessId, { id: editingId, product_id: productId, bom_version_id: bomId || null, code, name, version_number: version, notes: notes || null, steps: steps.map((step, index) => ({ ...step, sequence: index + 1 })) });
      reset(); await refresh();
    } catch (cause) { setError(manufacturingErrorMessage(cause, (key) => translateRef.current(key))); }
    finally { setBusy(false); }
  };
  const activate = async (id: string) => { if (!businessId) return; setBusy(true); setError(null); try { await repos.manufacturing.activateRouting(businessId, id); await refresh(); } catch (cause) { setError(manufacturingErrorMessage(cause, (key) => translateRef.current(key))); } finally { setBusy(false); } };
  const archive = async (id: string) => { if (!businessId || !window.confirm(t('manufacturing.routing.confirmArchive'))) return; setBusy(true); setError(null); try { await repos.manufacturing.archiveRouting(businessId, id); await refresh(); } catch (cause) { setError(manufacturingErrorMessage(cause, (key) => translateRef.current(key))); } finally { setBusy(false); } };
  const addStep = () => setSteps((current) => [...current, blankStep(current.length + 1, centres.find((centre) => centre.is_active)?.id ?? '')]);
  const move = (index: number, delta: number) => setSteps((current) => { const next = [...current]; const target = index + delta; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next; });
  const patchStep = (index: number, patch: Partial<RoutingStepInput>) => setSteps((current) => current.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step));

  if (!canUseManufacturing) return <CapabilityGate capability="manufacturing"><div /></CapabilityGate>;
  return <div className="mx-auto max-w-7xl px-4 py-6" data-testid="routings-page">
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{t('navigation.sections.manufacturing')}</p><h1 className="mt-1 text-2xl font-bold text-gray-900">{t('manufacturing.routing.title')}</h1><p className="mt-1 text-sm text-gray-600">{t('manufacturing.routing.description')}</p></div><button type="button" onClick={reset} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white"><Plus className="h-4 w-4" />{t('manufacturing.routing.new')}</button></header>
    <div className="grid gap-5 xl:grid-cols-[minmax(360px,520px)_1fr]">
      <form onSubmit={save} className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between"><h2 className="font-semibold text-gray-900">{t(editingId ? 'manufacturing.routing.edit' : 'manufacturing.routing.new')}</h2><span className="text-xs text-gray-500">{t('manufacturing.routing.stepCount', { count: steps.length })}</span></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('manufacturing.routing.product')}><select required value={productId} onChange={(e) => setProductId(e.target.value)} className={inputClass}><option value="">{t('manufacturing.routing.chooseProduct')}</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` (${product.sku})` : ''}</option>)}</select></Field>
          <Field label={t('manufacturing.routing.bom')}><select value={bomId} onChange={(e) => setBomId(e.target.value)} className={inputClass}><option value="">{t('manufacturing.routing.anyActiveBom')}</option>{boms.filter((bom) => bom.product_id === productId).map((bom) => <option key={bom.id} value={bom.id}>{t('manufacturing.routing.bomVersion', { version: bom.version })}</option>)}</select></Field>
          <Field label={t('manufacturing.routing.code')}><input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} className={inputClass} /></Field>
          <Field label={t('manufacturing.routing.name')}><input required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} /></Field>
          <Field label={t('manufacturing.routing.version')}><input type="number" min="1" value={version} onChange={(e) => setVersion(Number(e.target.value))} className={inputClass} /></Field>
          <Field label={t('common.details')}><input value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} /></Field>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-gray-900">{t('manufacturing.routing.steps')}</h3><button type="button" onClick={addStep} disabled={!centres.some((centre) => centre.is_active)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 disabled:opacity-50"><Plus className="h-3.5 w-3.5" />{t('manufacturing.routing.addStep')}</button></div>
          {steps.length === 0 ? <p className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500">{t('manufacturing.routing.noSteps')}</p> : steps.map((step, index) => <div key={`${index}-${step.sequence}`} className="rounded-xl border border-gray-200 p-3">
            <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold uppercase text-gray-500">{t('manufacturing.routing.stepNumber', { number: index + 1 })}</span><div className="flex gap-1"><button type="button" aria-label={t('manufacturing.routing.moveUp')} onClick={() => move(index, -1)} disabled={index === 0} className="rounded border p-1 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button><button type="button" aria-label={t('manufacturing.routing.moveDown')} onClick={() => move(index, 1)} disabled={index === steps.length - 1} className="rounded border p-1 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button><button type="button" aria-label={t('manufacturing.routing.removeStep')} onClick={() => setSteps((current) => current.filter((_, i) => i !== index))} className="rounded border border-red-200 p-1 text-red-700"><Trash2 className="h-3.5 w-3.5" /></button></div></div>
            <div className="grid gap-2 sm:grid-cols-2"><Field label={t('manufacturing.routing.operation')}><input required value={step.operation_name} onChange={(e) => patchStep(index, { operation_name: e.target.value })} className={inputClass} /></Field><Field label={t('manufacturing.routing.workCentre')}><select required value={step.work_centre_id} onChange={(e) => patchStep(index, { work_centre_id: e.target.value })} className={inputClass}><option value="">{t('manufacturing.routing.chooseWorkCentre')}</option>{centres.filter((centre) => centre.is_active).map((centre) => <option key={centre.id} value={centre.id}>{centre.code} — {centre.name}</option>)}</select></Field>
              <NumberField label={t('manufacturing.routing.setupMinutes')} value={step.setup_time_minutes} onChange={(value) => patchStep(index, { setup_time_minutes: value })} /><NumberField label={t('manufacturing.routing.runMinutesPerUnit')} value={step.run_time_per_unit_minutes} onChange={(value) => patchStep(index, { run_time_per_unit_minutes: value })} /><NumberField label={t('manufacturing.routing.queueMinutes')} value={step.queue_time_minutes} onChange={(value) => patchStep(index, { queue_time_minutes: value })} /><label className="flex items-center gap-2 self-end pb-2 text-xs text-gray-700"><input type="checkbox" checked={step.is_quality_checkpoint} onChange={(e) => patchStep(index, { is_quality_checkpoint: e.target.checked })} />{t('manufacturing.routing.qualityCheckpoint')}</label>
            </div></div>)}
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex justify-end"><button disabled={busy || steps.length === 0} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />{t('common.save')}</button></div>
      </form>
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {loading ? <p className="p-6 text-sm text-gray-500">{t('common.loading')}</p> : routes.length === 0 ? <div className="p-8 text-center"><ClipboardList className="mx-auto mb-3 h-8 w-8 text-gray-400" /><p className="text-sm text-gray-600">{t('manufacturing.routing.empty')}</p></div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-gray-50 text-xs uppercase text-gray-500"><tr><th className="px-4 py-3">{t('manufacturing.routing.code')}</th><th className="px-4 py-3">{t('manufacturing.routing.product')}</th><th className="px-4 py-3">{t('manufacturing.routing.version')}</th><th className="px-4 py-3">{t('manufacturing.routing.steps')}</th><th className="px-4 py-3">{t('common.status')}</th><th className="px-4 py-3">{t('common.actions')}</th></tr></thead><tbody className="divide-y divide-gray-100">{routes.map((route) => <tr key={route.id}><td className="px-4 py-3"><div className="font-mono text-xs">{route.code}</div><div className="font-medium text-gray-900">{route.name}</div></td><td className="px-4 py-3">{route.product?.name ?? route.product_id.slice(0, 8)}</td><td className="px-4 py-3">{t('manufacturing.routing.versionTag', { version: route.version_number })}</td><td className="px-4 py-3">{route.total_setup_minutes} / {route.total_run_minutes_per_unit} {t('manufacturing.routing.minutes')}</td><td className="px-4 py-3">{t(`manufacturing.routing.status.${route.status}`)}</td><td className="px-4 py-3"><div className="flex flex-wrap gap-2">{route.status === 'draft' && <><button type="button" disabled={busy} onClick={() => void edit(route)} className="text-xs font-medium text-brand-700 hover:underline">{t('common.edit')}</button><button type="button" disabled={busy} onClick={() => void activate(route.id)} className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:underline"><ShieldCheck className="h-3.5 w-3.5" />{t('manufacturing.routing.activate')}</button></>}{route.status !== 'archived' && <button type="button" disabled={busy} onClick={() => void archive(route.id)} className="text-xs font-medium text-red-700 hover:underline">{t('manufacturing.routing.archive')}</button>}</div></td></tr>)}</tbody></table></div>}
      </section>
    </div>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>{children}</label>; }
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) { return <Field label={label}><input type="number" min="0" step="0.01" value={value} onChange={(e) => onChange(Number(e.target.value))} className={inputClass} /></Field>; }
const inputClass = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900';
export default RoutingsPage;
