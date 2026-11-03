import { useCallback, useEffect, useRef, useState } from 'react';
import { Factory, Plus, Save, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PlanGate } from '@/components/billing/PlanGate';
import { CapabilityGate } from '@/components/billing/CapabilityGate';
import { useCapability } from '@/hooks/useCapability';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { manufacturingErrorMessage } from './manufacturingErrorMessage';
import type { CreateWorkCentreInput, WorkCentre } from '@/dal/repositories/ManufacturingRepository';

const emptyForm: CreateWorkCentreInput = {
  code: '', name: '', description: '', centre_type: 'machine',
  capacity_hours_per_day: 8, cost_rate_per_hour: 0, is_active: true, notes: '',
};

export function WorkCentresPage() {
  return <PlanGate minPlan="enterprise" featureNameKey="navigation.sections.manufacturing"><WorkCentresContent /></PlanGate>;
}

function WorkCentresContent() {
  const { t } = useTranslation();
  const translateRef = useRef(t);
  useEffect(() => { translateRef.current = t; }, [t]);
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id);
  const canUseManufacturing = useCapability('manufacturing');
  const [rows, setRows] = useState<WorkCentre[]>([]);
  const [form, setForm] = useState<CreateWorkCentreInput>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!businessId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    try { setRows(await repos.manufacturing.listWorkCentres(businessId)); setError(null); }
    catch (cause) { setError(manufacturingErrorMessage(cause, (key) => translateRef.current(key))); }
    finally { setLoading(false); }
  }, [businessId]);
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) return refresh(); });
    return () => { active = false; };
  }, [refresh]);

  const startEdit = (row: WorkCentre) => {
    setEditingId(row.id);
    setForm({ code: row.code, name: row.name, description: row.description, centre_type: row.centre_type,
      capacity_hours_per_day: row.capacity_hours_per_day, cost_rate_per_hour: row.cost_rate_per_hour,
      is_active: row.is_active, notes: row.notes });
  };
  const reset = () => { setEditingId(null); setForm(emptyForm); setError(null); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!businessId) return;
    setBusy(true); setError(null);
    try {
      if (editingId) await repos.manufacturing.updateWorkCentre(businessId, editingId, form);
      else await repos.manufacturing.createWorkCentre(businessId, form);
      reset(); await refresh();
    } catch (cause) { setError(manufacturingErrorMessage(cause, (key) => translateRef.current(key))); }
    finally { setBusy(false); }
  };

  if (!canUseManufacturing) return <CapabilityGate capability="manufacturing"><div /></CapabilityGate>;
  return (
    <div className="mx-auto max-w-6xl px-4 py-6" data-testid="work-centres-page">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{t('navigation.sections.manufacturing')}</p><h1 className="mt-1 text-2xl font-bold text-gray-900">{t('manufacturing.workCentres.title')}</h1><p className="mt-1 text-sm text-gray-600">{t('manufacturing.workCentres.description')}</p></div>
        <button type="button" onClick={reset} className="inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"><Plus className="h-4 w-4" />{t('manufacturing.workCentres.add')}</button>
      </header>
      <div className="grid gap-5 lg:grid-cols-[minmax(300px,380px)_1fr]">
        <form onSubmit={save} className="h-fit space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h2 className="font-semibold text-gray-900">{t(editingId ? 'manufacturing.workCentres.edit' : 'manufacturing.workCentres.new')}</h2>
          <Field label={t('manufacturing.workCentres.code')}><input required maxLength={32} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className={inputClass} /></Field>
          <Field label={t('manufacturing.workCentres.name')}><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} /></Field>
          <Field label={t('manufacturing.workCentres.type')}><select value={form.centre_type} onChange={(e) => setForm({ ...form, centre_type: e.target.value })} className={inputClass}>{(['machine', 'labor', 'cell', 'outsourced'] as const).map((type) => <option key={type} value={type}>{t(`manufacturing.workCentres.types.${type}`)}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('manufacturing.workCentres.capacity')}><input type="number" min="0" step="0.25" value={form.capacity_hours_per_day} onChange={(e) => setForm({ ...form, capacity_hours_per_day: Number(e.target.value) })} className={inputClass} /></Field>
            <Field label={t('manufacturing.workCentres.hourlyCost')}><input type="number" min="0" step="0.01" value={form.cost_rate_per_hour} onChange={(e) => setForm({ ...form, cost_rate_per_hour: Number(e.target.value) })} className={inputClass} /></Field>
          </div>
          <Field label={t('manufacturing.workCentres.description')}><textarea rows={2} value={form.description ?? ''} onChange={(e) => setForm({ ...form, description: e.target.value || null })} className={inputClass} /></Field>
          <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={!!form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} />{t('manufacturing.workCentres.active')}</label>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" onClick={reset} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700"><X className="h-4 w-4" />{t('common.cancel')}</button><button disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />{t('common.save')}</button></div>
        </form>
        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          {loading ? <p className="p-6 text-sm text-gray-500">{t('common.loading')}</p> : rows.length === 0 ? <div className="p-8 text-center"><Factory className="mx-auto mb-3 h-8 w-8 text-gray-400" /><p className="text-sm text-gray-600">{t('manufacturing.workCentres.empty')}</p></div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-gray-50 text-xs uppercase text-gray-500"><tr><th className="px-4 py-3">{t('manufacturing.workCentres.code')}</th><th className="px-4 py-3">{t('manufacturing.workCentres.name')}</th><th className="px-4 py-3">{t('manufacturing.workCentres.type')}</th><th className="px-4 py-3">{t('manufacturing.workCentres.capacity')}</th><th className="px-4 py-3">{t('common.status')}</th><th className="px-4 py-3">{t('common.actions')}</th></tr></thead><tbody className="divide-y divide-gray-100">{rows.map((row) => <tr key={row.id}><td className="px-4 py-3 font-mono text-xs">{row.code}</td><td className="px-4 py-3 font-medium text-gray-900">{row.name}</td><td className="px-4 py-3">{t(`manufacturing.workCentres.types.${row.centre_type}`)}</td><td className="px-4 py-3">{row.capacity_hours_per_day} {t('manufacturing.workCentres.hoursPerDay')}</td><td className="px-4 py-3">{t(row.is_active ? 'manufacturing.workCentres.active' : 'manufacturing.workCentres.inactive')}</td><td className="px-4 py-3"><button type="button" onClick={() => startEdit(row)} className="text-sm font-medium text-brand-700 hover:underline">{t('common.edit')}</button></td></tr>)}</tbody></table></div>}
        </section>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1 block text-xs font-medium text-gray-600">{label}</span>{children}</label>; }
const inputClass = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900';
export default WorkCentresPage;
