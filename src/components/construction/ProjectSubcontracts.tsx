import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { FileText, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { subcontractRepository } from '@/dal/repositories/SubcontractRepository';
import type { SubcontractSummary, SubcontractStatus } from '@/dal/types/construction';
import { SUBCONTRACT_STATUS_TRANSITIONS } from '@/dal/types/construction';
import type { SubcontractorProfileWithContact } from '@/dal/types/construction';

const FIELD_CLASS = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100';
interface AgreementDraft {
  subcontractor_profile_id: string;
  reference: string;
  title: string;
  contract_value: string;
  retention_percentage: string;
  start_date: string;
  end_date: string;
  scope_of_work: string;
  payment_terms: string;
}
const EMPTY_DRAFT: AgreementDraft = {
  subcontractor_profile_id: '', reference: '', title: '', contract_value: '0',
  retention_percentage: '0', start_date: '', end_date: '', scope_of_work: '', payment_terms: '',
};

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(amount));
  } catch {
    return `${currency} ${Number(amount).toLocaleString()}`;
  }
}

export function ProjectSubcontracts({ businessId, projectId, currency }: {
  businessId: string;
  projectId: string;
  currency: string;
}) {
  const { t } = useTranslation();
  const [agreements, setAgreements] = useState<SubcontractSummary[]>([]);
  const [profiles, setProfiles] = useState<SubcontractorProfileWithContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<AgreementDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [transitionError, setTransitionError] = useState(false);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [loadedAgreements, loadedProfiles] = await Promise.all([
        subcontractRepository.listSubcontracts(businessId, projectId),
        subcontractRepository.listSubcontractorProfiles(businessId),
      ]);
      setAgreements(loadedAgreements);
      setProfiles(loadedProfiles);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [businessId, projectId]);

  useEffect(() => {
    let active = true;
    const request = async () => {
      try {
        const [loadedAgreements, loadedProfiles] = await Promise.all([
          subcontractRepository.listSubcontracts(businessId, projectId),
          subcontractRepository.listSubcontractorProfiles(businessId),
        ]);
        if (!active) return;
        setAgreements(loadedAgreements);
        setProfiles(loadedProfiles);
        setLoadError(false);
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    void request();
    return () => { active = false; };
  }, [businessId, projectId]);

  const activeProfiles = useMemo(() => profiles.filter((profile) => profile.is_active), [profiles]);
  const openForm = () => {
    setDraft({ ...EMPTY_DRAFT, subcontractor_profile_id: activeProfiles[0]?.id ?? '' });
    setError(false);
    setFormOpen(true);
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number(draft.contract_value);
    const retention = Number(draft.retention_percentage);
    if (!draft.subcontractor_profile_id || !draft.reference.trim() || !draft.title.trim()
      || !Number.isFinite(value) || value < 0 || !Number.isFinite(retention) || retention < 0 || retention > 100
      || (draft.start_date && draft.end_date && draft.end_date < draft.start_date)) {
      setError(true);
      return;
    }
    setSaving(true);
    setError(false);
    try {
      await subcontractRepository.createSubcontract(businessId, {
        project_id: projectId,
        subcontractor_profile_id: draft.subcontractor_profile_id,
        reference: draft.reference.trim(),
        title: draft.title.trim(),
        contract_value: value,
        currency,
        retention_percentage: retention,
        status: 'draft',
        start_date: draft.start_date || null,
        end_date: draft.end_date || null,
        scope_of_work: draft.scope_of_work.trim() || null,
        payment_terms: draft.payment_terms.trim() || null,
      });
      setFormOpen(false);
      await load();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (agreement: SubcontractSummary, status: SubcontractStatus) => {
    setTransitioningId(agreement.id);
    setTransitionError(false);
    try {
      await subcontractRepository.updateSubcontractStatus(businessId, agreement.id, status);
      await load();
    } catch {
      setTransitionError(true);
    } finally {
      setTransitioningId(null);
    }
  };

  return <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-extrabold text-slate-900">{t('construction.subcontractor.agreementsHeading')}</h2><p className="mt-1 text-sm text-slate-500">{t('construction.subcontractor.agreementsDescription')}</p></div><button type="button" onClick={openForm} disabled={activeProfiles.length === 0} className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"><Plus className="h-4 w-4" />{t('construction.subcontractor.addAgreement')}</button></div>
    {loadError && <div role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{t('construction.subcontractor.agreementLoadError')} <button type="button" onClick={() => { setLoading(true); void load(); }} className="ml-1 font-bold underline">{t('common.retry')}</button></div>}
    {transitionError && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{t('construction.subcontractor.statusError')}</p>}
    {formOpen && <form onSubmit={save} className="mb-5 rounded-2xl border border-brand-100 bg-brand-50/40 p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between"><div><h3 className="font-bold text-slate-900">{t('construction.subcontractor.newAgreement')}</h3><p className="mt-1 text-xs text-slate-500">{t('construction.subcontractor.newAgreementHelp')}</p></div><button type="button" aria-label={t('common.close')} onClick={() => setFormOpen(false)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white"><X className="h-4 w-4" /></button></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm font-semibold text-slate-700 sm:col-span-2 lg:col-span-1">{t('construction.subcontractor.subcontractor')} *<select required value={draft.subcontractor_profile_id} onChange={(event) => setDraft((current) => ({ ...current, subcontractor_profile_id: event.target.value }))} className={FIELD_CLASS}><option value="">{t('construction.subcontractor.chooseSubcontractor')}</option>{activeProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.contact.name} · {profile.trade}</option>)}</select></label>
        <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.reference')} *<input required maxLength={80} value={draft.reference} onChange={(event) => setDraft((current) => ({ ...current, reference: event.target.value }))} className={FIELD_CLASS} /></label>
        <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.agreementTitle')} *<input required maxLength={160} value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} className={FIELD_CLASS} /></label>
        <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.contractValue', { currency })} *<input required type="number" min="0" step="0.01" value={draft.contract_value} onChange={(event) => setDraft((current) => ({ ...current, contract_value: event.target.value }))} className={FIELD_CLASS} /></label>
        <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.retention')}<input type="number" min="0" max="100" step="0.01" value={draft.retention_percentage} onChange={(event) => setDraft((current) => ({ ...current, retention_percentage: event.target.value }))} className={FIELD_CLASS} /></label>
        <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.startDate')}<input type="date" value={draft.start_date} onChange={(event) => setDraft((current) => ({ ...current, start_date: event.target.value }))} className={FIELD_CLASS} /></label>
        <label className="text-sm font-semibold text-slate-700">{t('construction.subcontractor.endDate')}<input type="date" value={draft.end_date} onChange={(event) => setDraft((current) => ({ ...current, end_date: event.target.value }))} className={FIELD_CLASS} /></label>
        <label className="text-sm font-semibold text-slate-700 sm:col-span-2">{t('construction.subcontractor.scopeOfWork')}<textarea rows={2} value={draft.scope_of_work} onChange={(event) => setDraft((current) => ({ ...current, scope_of_work: event.target.value }))} className={FIELD_CLASS} /></label>
        <label className="text-sm font-semibold text-slate-700 sm:col-span-2 lg:col-span-3">{t('construction.subcontractor.paymentTerms')}<textarea rows={2} value={draft.payment_terms} onChange={(event) => setDraft((current) => ({ ...current, payment_terms: event.target.value }))} className={FIELD_CLASS} /></label>
      </div>
      {error && <p role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{t('construction.subcontractor.agreementSaveError')}</p>}
      <div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setFormOpen(false)} className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">{t('common.cancel')}</button><button type="submit" disabled={saving} className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? t('construction.subcontractor.savingAgreement') : t('construction.subcontractor.saveAgreement')}</button></div>
    </form>}

    {loading ? <div role="status" className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">{t('common.loading')}</div> : agreements.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-8 text-center"><FileText className="mx-auto h-7 w-7 text-slate-400" /><p className="mt-2 font-bold text-slate-900">{t('construction.subcontractor.noAgreements')}</p><p className="mt-1 text-sm text-slate-500">{activeProfiles.length ? t('construction.subcontractor.noAgreementsHelp') : t('construction.subcontractor.noActiveProfiles')}</p></div> : <div className="space-y-3">{agreements.map((agreement) => { const nextStatuses = SUBCONTRACT_STATUS_TRANSITIONS[agreement.status]; return <article key={agreement.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-bold text-slate-900">{agreement.reference}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{t(`construction.subcontractor.status.${agreement.status}`)}</span></div><h3 className="mt-1 font-semibold text-slate-800">{agreement.title}</h3><p className="mt-1 text-sm text-slate-500">{agreement.subcontractor_profile.contact.name} · {agreement.subcontractor_profile.trade}</p><p className="mt-1 text-sm font-bold text-slate-700">{formatMoney(agreement.contract_value, agreement.currency)}</p>{agreement.scope_of_work && <p className="mt-2 max-w-3xl text-sm text-slate-600">{agreement.scope_of_work}</p>}</div><div className="flex flex-wrap gap-2">{nextStatuses.map((status) => <button key={status} type="button" disabled={transitioningId === agreement.id} onClick={() => void changeStatus(agreement, status)} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50">{t('construction.subcontractor.moveTo', { status: t(`construction.subcontractor.status.${status}`) })}</button>)}</div></div></article>; })}</div>}
  </section>;
}
