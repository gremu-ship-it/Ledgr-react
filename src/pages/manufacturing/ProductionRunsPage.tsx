import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Factory, Play, XCircle } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PlanGate } from '@/components/billing/PlanGate';
import { CapabilityGate } from '@/components/billing/CapabilityGate';
import { useCapability } from '@/hooks/useCapability';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { manufacturingErrorMessage } from './manufacturingErrorMessage';
import { supabase } from '@/lib/supabase';
import type { WorkOrderDetail } from '@/dal/repositories/ManufacturingRepository';

type LocationOption = { id: string; name: string; location_type: string; is_default: boolean };

export function ProductionRunsPage() { return <PlanGate minPlan="enterprise" featureNameKey="navigation.sections.manufacturing"><ProductionRunsContent /></PlanGate>; }

function ProductionRunsContent() {
  const { t } = useTranslation();
  const translateRef = useRef(t);
  useEffect(() => { translateRef.current = t; }, [t]);
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id);
  const canUseManufacturing = useCapability('manufacturing');
  const [orders, setOrders] = useState<WorkOrderDetail[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startOrder, setStartOrder] = useState<WorkOrderDetail | null>(null);
  const [completeRun, setCompleteRun] = useState<{ order: WorkOrderDetail; runId: string } | null>(null);

  const refresh = useCallback(async () => {
    if (!businessId) { setOrders([]); setLoading(false); return; }
    setLoading(true);
    try {
      const [released, inProgress, locationResult] = await Promise.all([
        repos.manufacturing.listWorkOrders(businessId, { status: 'released' }),
        repos.manufacturing.listWorkOrders(businessId, { status: 'in_progress' }),
        supabase.from('inventory_locations').select('id,name,location_type,is_default').eq('business_id', businessId).eq('is_active', true).order('name'),
      ]);
      if (locationResult.error) throw locationResult.error;
      const allOrders = [...released, ...inProgress];
      const details = await Promise.all(allOrders.map((order) => repos.manufacturing.getWorkOrder(businessId, order.id)));
      setOrders(details); setLocations((locationResult.data ?? []) as LocationOption[]); setError(null);
    } catch (cause) { setError(manufacturingErrorMessage(cause, (key) => translateRef.current(key))); }
    finally { setLoading(false); }
  }, [businessId]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return refresh(); });
    return () => { active = false; };
  }, [refresh]);

  const beginRun = async (order: WorkOrderDetail, locationId: string) => {
    if (!businessId) return;
    setBusyKey(`start:${order.id}`); setError(null);
    try { await repos.manufacturing.startRun(businessId, order.id, locationId); setStartOrder(null); await refresh(); }
    catch (cause) { setError(manufacturingErrorMessage(cause, (key) => translateRef.current(key))); }
    finally { setBusyKey(null); }
  };
  const finishRun = async (produced: number, scrapped: number, reason: string, locationId: string) => {
    if (!businessId || !completeRun) return;
    const { runId } = completeRun;
    setBusyKey(`complete:${runId}`); setError(null);
    try { await repos.manufacturing.completeRun(businessId, runId, { quantity_produced: produced, quantity_scrapped: scrapped, scrap_reason: reason || null, output_location_id: locationId || null }); setCompleteRun(null); await refresh(); }
    catch (cause) { setError(manufacturingErrorMessage(cause, (key) => translateRef.current(key))); }
    finally { setBusyKey(null); }
  };
  const abort = async (runId: string) => {
    if (!businessId || !window.confirm(t('manufacturing.runs.confirmAbort'))) return;
    setBusyKey(`abort:${runId}`); setError(null);
    try { await repos.manufacturing.abortRun(businessId, runId); await refresh(); }
    catch (cause) { setError(manufacturingErrorMessage(cause, (key) => translateRef.current(key))); }
    finally { setBusyKey(null); }
  };
  const preferredLocation = (order: WorkOrderDetail) => order.to_location_id ?? locations.find((location) => location.location_type === 'finished_goods_store' && location.is_default)?.id ?? locations.find((location) => location.location_type === 'finished_goods_store')?.id ?? locations.find((location) => location.is_default)?.id ?? locations[0]?.id ?? '';

  if (!canUseManufacturing) return <CapabilityGate capability="manufacturing"><div /></CapabilityGate>;
  return <div className="mx-auto max-w-6xl px-4 py-6" data-testid="production-runs-page">
    <header className="mb-5"><p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{t('navigation.sections.manufacturing')}</p><h1 className="mt-1 text-2xl font-bold text-gray-900">{t('manufacturing.runs.title')}</h1><p className="mt-1 text-sm text-gray-600">{t('manufacturing.runs.description')}</p></header>
    {error && <p role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {loading ? <div className="rounded-2xl border bg-white p-8 text-center text-sm text-gray-500">{t('common.loading')}</div> : orders.length === 0 ? <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center"><Factory className="mx-auto mb-3 h-8 w-8 text-gray-400" /><p className="text-sm text-gray-600">{t('manufacturing.runs.empty')}</p><Link className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline" to="/manufacturing/production">{t('manufacturing.wo.title')}</Link></div> : <div className="space-y-4">{orders.map((order) => <section key={order.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 p-4"><div><Link to={`/manufacturing/production/${order.id}`} className="font-semibold text-brand-700 hover:underline">{order.work_order_number}</Link><p className="mt-1 text-sm text-gray-700">{order.product?.name ?? order.product_id.slice(0, 8)} · {t('manufacturing.wo.completedQuantity')}: {order.completed_quantity} / {order.planned_quantity}</p></div>{(order.status === 'released' || order.status === 'in_progress') && <button type="button" onClick={() => setStartOrder(order)} disabled={!locations.length || !!busyKey} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Play className="h-4 w-4" />{t('manufacturing.runs.startRun')}</button>}</div>
      {order.runs.length === 0 ? <p className="p-4 text-sm text-gray-500">{t('manufacturing.runs.noRuns')}</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-gray-50 text-xs uppercase text-gray-500"><tr><th className="px-4 py-3">{t('manufacturing.wo.runNumber')}</th><th className="px-4 py-3">{t('common.status')}</th><th className="px-4 py-3">{t('manufacturing.wo.outputQty')}</th><th className="px-4 py-3">{t('manufacturing.wo.scrapQty')}</th><th className="px-4 py-3">{t('common.actions')}</th></tr></thead><tbody className="divide-y divide-gray-100">{order.runs.map((run) => <tr key={run.id}><td className="px-4 py-3 font-medium">#{run.run_number}</td><td className="px-4 py-3">{t(`manufacturing.runs.status.${run.status}`)}</td><td className="px-4 py-3">{run.output_quantity}</td><td className="px-4 py-3">{run.scrap_quantity}</td><td className="px-4 py-3"><div className="flex gap-3">{run.status === 'in_progress' && <><button type="button" onClick={() => setCompleteRun({ order, runId: run.id })} className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 hover:underline"><CheckCircle2 className="h-4 w-4" />{t('manufacturing.runs.completeRun')}</button><button type="button" onClick={() => void abort(run.id)} disabled={!!busyKey} className="inline-flex items-center gap-1 text-xs font-semibold text-red-700 hover:underline"><XCircle className="h-4 w-4" />{t('manufacturing.runs.abortRun')}</button></>}</div></td></tr>)}</tbody></table></div>}
    </section>)}</div>}
    {startOrder && <StartRunDialog order={startOrder} locations={locations} preferred={preferredLocation(startOrder)} busy={busyKey === `start:${startOrder.id}`} onClose={() => setStartOrder(null)} onSubmit={(locationId) => void beginRun(startOrder, locationId)} />}
    {completeRun && <CompleteRunDialog order={completeRun.order} locations={locations} preferred={preferredLocation(completeRun.order)} busy={busyKey === `complete:${completeRun.runId}`} onClose={() => setCompleteRun(null)} onSubmit={(produced, scrapped, reason, locationId) => void finishRun(produced, scrapped, reason, locationId)} />}
  </div>;
}

function StartRunDialog({ order, locations, preferred, busy, onClose, onSubmit }: { order: WorkOrderDetail; locations: LocationOption[]; preferred: string; busy: boolean; onClose: () => void; onSubmit: (locationId: string) => void }) {
  const { t } = useTranslation(); const [locationId, setLocationId] = useState(preferred);
  return <Dialog title={t('manufacturing.runs.startRun')} onClose={onClose}><p className="mb-3 text-sm text-gray-600">{order.work_order_number}</p><label className="block text-sm font-medium text-gray-700">{t('manufacturing.wo.destinationLocation')}<select required value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputClass}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-sm">{t('common.cancel')}</button><button type="button" disabled={!locationId || busy} onClick={() => onSubmit(locationId)} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{t('manufacturing.runs.startRun')}</button></div></Dialog>;
}
function CompleteRunDialog({ order, locations, preferred, busy, onClose, onSubmit }: { order: WorkOrderDetail; locations: LocationOption[]; preferred: string; busy: boolean; onClose: () => void; onSubmit: (produced: number, scrapped: number, reason: string, locationId: string) => void }) {
  const { t } = useTranslation(); const [produced, setProduced] = useState(''); const [scrapped, setScrapped] = useState('0'); const [reason, setReason] = useState(''); const [locationId, setLocationId] = useState(preferred);
  const producedNumber = Number(produced); const scrapNumber = Number(scrapped);
  const valid = Number.isFinite(producedNumber) && producedNumber > 0 && Number.isFinite(scrapNumber) && scrapNumber >= 0 && (!scrapNumber || reason.trim().length > 0) && !!locationId;
  return <Dialog title={t('manufacturing.runs.completeRun')} onClose={onClose}><p className="mb-3 text-sm text-gray-600">{order.work_order_number}</p><div className="space-y-3"><label className="block text-sm font-medium text-gray-700">{t('manufacturing.wo.outputQty')}<input type="number" min="0.000001" step="any" value={produced} onChange={(e) => setProduced(e.target.value)} className={inputClass} /></label><label className="block text-sm font-medium text-gray-700">{t('manufacturing.wo.scrapQty')}<input type="number" min="0" step="any" value={scrapped} onChange={(e) => setScrapped(e.target.value)} className={inputClass} /></label>{scrapNumber > 0 && <label className="block text-sm font-medium text-gray-700">{t('manufacturing.runs.scrapReason')}<textarea required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} /></label>}<label className="block text-sm font-medium text-gray-700">{t('manufacturing.wo.destinationLocation')}<select required value={locationId} onChange={(e) => setLocationId(e.target.value)} className={inputClass}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><p className="text-xs text-gray-500">{t('manufacturing.runs.materialUseHint')}</p><div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 text-sm">{t('common.cancel')}</button><button type="button" disabled={!valid || busy} onClick={() => onSubmit(producedNumber, scrapNumber, reason, locationId)} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{t('manufacturing.runs.completeRun')}</button></div></div></Dialog>;
}
function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { const { t } = useTranslation(); return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl"><div className="mb-4 flex items-center justify-between"><h2 className="font-semibold text-gray-900">{title}</h2><button type="button" onClick={onClose} aria-label={t('common.close')} className="text-gray-500">×</button></div>{children}</div></div>; }
const inputClass = 'mt-1 block w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900';
export default ProductionRunsPage;
