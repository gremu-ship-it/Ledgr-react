import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, MapPin, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { constructionRepository, type ConstructionLocationOption } from '@/dal/repositories/ConstructionRepository';
import type { ConstructionProject, ConstructionProjectStatus, ConstructionSite } from '@/dal/types/construction';
import { CONSTRUCTION_PROJECT_STATUS_TRANSITIONS } from '@/dal/types/construction';
import type { ConstructionProjectInput } from '@/dal/types/construction';
import type { ConstructionSiteInput } from '@/dal/types/construction';
import { ConstructionProjectForm } from '@/components/construction/ConstructionProjectForm';
import { ConstructionSiteForm } from '@/components/construction/ConstructionSiteForm';
import { ProjectSubcontracts } from '@/components/construction/ProjectSubcontracts';
import { useAppStore } from '@/store/useAppStore';

const STATUS_STYLES: Record<ConstructionProjectStatus, string> = {
  draft: 'border-slate-200 bg-slate-100 text-slate-700',
  tender: 'border-violet-200 bg-violet-50 text-violet-700',
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  on_hold: 'border-amber-200 bg-amber-50 text-amber-800',
  practical_completion: 'border-sky-200 bg-sky-50 text-sky-700',
  defect_liability: 'border-orange-200 bg-orange-50 text-orange-700',
  completed: 'border-blue-200 bg-blue-50 text-blue-700',
  closed: 'border-slate-300 bg-slate-100 text-slate-600',
};

function currencyAmount(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value));
  } catch {
    return `${currency} ${Number(value).toLocaleString()}`;
  }
}

export function ConstructionProjectDetailPage() {
  const { t } = useTranslation();
  const { projectId = '' } = useParams();
  const business = useAppStore((state) => state.currentBusiness?.business ?? null);
  if (!business) {
    return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6"><div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">{t('construction.selectBusiness')}</div></main>;
  }
  const currency = business.base_currency?.trim().toUpperCase() || 'MWK';
  return <ConstructionProjectDetailWorkspace key={`${business.id}:${projectId}`} businessId={business.id} projectId={projectId} currency={currency} />;
}

function ConstructionProjectDetailWorkspace({
  businessId,
  projectId,
  currency,
}: {
  businessId: string;
  projectId: string;
  currency: string;
}) {
  const { t } = useTranslation();
  const [project, setProject] = useState<ConstructionProject | null>(null);
  const [sites, setSites] = useState<ConstructionSite[]>([]);
  const [locations, setLocations] = useState<ConstructionLocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editProject, setEditProject] = useState(false);
  const [projectSaving, setProjectSaving] = useState(false);
  const [projectError, setProjectError] = useState(false);
  const [siteForm, setSiteForm] = useState<{ open: boolean; site?: ConstructionSite }>({ open: false });
  const [siteSaving, setSiteSaving] = useState(false);
  const [siteError, setSiteError] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      const [loadedProject, loadedSites] = await Promise.all([
        constructionRepository.getProject(businessId, projectId),
        constructionRepository.listSites(businessId, projectId),
      ]);
      const loadedLocations = await constructionRepository.listLocations(businessId).catch(() => []);
      setProject(loadedProject);
      setSites(loadedSites);
      setLocations(loadedLocations);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [businessId, projectId]);

  useEffect(() => {
    if (!projectId) return;
    let active = true;
    const request = async () => {
      try {
        const [loadedProject, loadedSites] = await Promise.all([
          constructionRepository.getProject(businessId, projectId),
          constructionRepository.listSites(businessId, projectId),
        ]);
        const loadedLocations = await constructionRepository.listLocations(businessId).catch(() => []);
        if (active) {
          setProject(loadedProject);
          setSites(loadedSites);
          setLocations(loadedLocations);
        }
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    void request();
    return () => { active = false; };
  }, [businessId, projectId]);

  const nextStatuses = useMemo(
    () => project ? CONSTRUCTION_PROJECT_STATUS_TRANSITIONS[project.status] : [],
    [project],
  );
  const locationNames = useMemo(() => new Map(locations.map((location) => [location.id, location.name])), [locations]);

  const saveProject = async (input: ConstructionProjectInput) => {
    if (!project) return;
    setProjectSaving(true);
    setProjectError(false);
    try {
      const updated = await constructionRepository.updateProject(project.id, input);
      setProject(updated);
      setEditProject(false);
    } catch {
      setProjectError(true);
    } finally {
      setProjectSaving(false);
    }
  };

  const changeStatus = async (status: ConstructionProjectStatus) => {
    if (!project) return;
    setStatusSaving(true);
    setStatusError(false);
    try {
      const updated = await constructionRepository.transitionProjectStatus(project.id, status);
      setProject(updated);
    } catch {
      setStatusError(true);
    } finally {
      setStatusSaving(false);
    }
  };

  const saveSite = async (input: ConstructionSiteInput) => {
    if (!businessId || !project) return;
    setSiteSaving(true);
    setSiteError(false);
    try {
      const savedSite = siteForm.site
        ? await constructionRepository.updateSite(siteForm.site.id, input)
        : await constructionRepository.createSite(businessId, project.id, input);
      setSites((current) => [
        ...current.filter((site) => site.id !== savedSite.id),
        savedSite,
      ].sort((left, right) => left.name.localeCompare(right.name)));
      setSiteForm({ open: false });
    } catch {
      setSiteError(true);
    } finally {
      setSiteSaving(false);
    }
  };

  const deleteSite = async (site: ConstructionSite) => {
    if (!window.confirm(t('construction.sites.confirmDelete', { name: site.name }))) return;
    try {
      await constructionRepository.deleteSite(site.id);
      setSites((current) => current.filter((item) => item.id !== site.id));
    } catch {
      setSiteError(true);
    }
  };

  if (loading) return <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6"><div role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">{t('common.loading')}</div></main>;
  if (loadError) return <main className="mx-auto max-w-7xl space-y-4 px-4 py-8 sm:px-6"><Link to="/construction" className="inline-flex items-center gap-2 text-sm font-bold text-brand-700"><ArrowLeft className="h-4 w-4" />{t('construction.backToProjects')}</Link><div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">{t('construction.loadError')} <button type="button" onClick={() => { setLoading(true); setLoadError(false); void load(); }} className="ml-2 font-bold underline">{t('common.retry')}</button></div></main>;
  if (!project) return <main className="mx-auto max-w-7xl space-y-4 px-4 py-8 sm:px-6"><Link to="/construction" className="inline-flex items-center gap-2 text-sm font-bold text-brand-700"><ArrowLeft className="h-4 w-4" />{t('construction.backToProjects')}</Link><div className="rounded-2xl border border-slate-200 bg-white p-8 text-center"><h1 className="text-xl font-extrabold text-slate-900">{t('construction.projectNotFound')}</h1><p className="mt-2 text-sm text-slate-500">{t('construction.projectNotFoundDescription')}</p></div></main>;

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <Link to="/construction" className="inline-flex items-center gap-2 text-sm font-bold text-brand-700 hover:text-brand-900"><ArrowLeft className="h-4 w-4" />{t('construction.backToProjects')}</Link>

      <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-xl sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3"><span className={`rounded-full border px-3 py-1 text-xs font-bold ${STATUS_STYLES[project.status]}`}>{t(`construction.status.${project.status}`)}</span><span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{t('construction.projectRecord')}</span></div>
            <h1 className="mt-3 break-words text-3xl font-extrabold tracking-tight">{project.name}</h1>
            <p className="mt-2 text-sm text-slate-300">{project.client_name || t('construction.noClient')}</p>
          </div>
          <button type="button" onClick={() => { setEditProject(true); setProjectError(false); }} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-bold text-white hover:bg-white/15"><Pencil className="h-4 w-4" />{t('construction.editProject')}</button>
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('construction.fields.contractValueShort')}</p><p className="mt-1 text-lg font-extrabold">{currencyAmount(project.contract_sum, currency)}</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('construction.fields.budgetShort')}</p><p className="mt-1 text-lg font-extrabold">{currencyAmount(project.budget, currency)}</p></div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('construction.fields.retentionPercent')}</p><p className="mt-1 text-lg font-extrabold">{Number(project.retention_pct).toLocaleString()}%</p></div>
        </div>
      </header>

      {editProject && <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><div className="mb-5 flex items-start justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-brand-700">{t('construction.projectManagement')}</p><h2 className="mt-1 text-xl font-extrabold text-slate-900">{t('construction.editProject')}</h2></div><button type="button" onClick={() => setEditProject(false)} aria-label={t('common.close')} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></div><ConstructionProjectForm project={project} currency={currency} saving={projectSaving} error={projectError ? t('construction.saveError') : null} onCancel={() => setEditProject(false)} onSave={saveProject} /></section>}

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-extrabold text-slate-900">{t('construction.lifecycle.heading')}</h2><p className="mt-1 text-sm text-slate-500">{t('construction.lifecycle.description')}</p></div>{nextStatuses.length > 0 && <div className="flex flex-wrap gap-2">{nextStatuses.map((status) => <button key={status} type="button" disabled={statusSaving} onClick={() => void changeStatus(status)} className="rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-bold text-slate-700 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-800 disabled:opacity-50">{t('construction.lifecycle.moveTo', { status: t(`construction.status.${status}`) })}</button>)}</div>}</div>
        {statusError && <p role="alert" className="mt-3 text-sm font-medium text-rose-700">{t('construction.statusError')}</p>}
        {nextStatuses.length === 0 && <p className="mt-3 text-sm text-slate-500">{t('construction.lifecycle.terminal')}</p>}
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-lg font-extrabold text-slate-900">{t('construction.sites.heading')}</h2><p className="mt-1 text-sm text-slate-500">{t('construction.sites.description')}</p></div><button type="button" onClick={() => { setSiteForm({ open: true }); setSiteError(false); }} className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700"><Plus className="h-4 w-4" />{t('construction.sites.addSite')}</button></div>
        {siteError && !siteForm.open && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{t('construction.sites.saveError')}</p>}
        {siteForm.open && <div className="mb-5 rounded-2xl border border-brand-100 bg-brand-50/40 p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><h3 className="font-bold text-slate-900">{siteForm.site ? t('construction.sites.editSite') : t('construction.sites.addSite')}</h3><button type="button" onClick={() => setSiteForm({ open: false })} aria-label={t('common.close')} className="rounded-lg p-1.5 text-slate-500 hover:bg-white"><X className="h-4 w-4" /></button></div><ConstructionSiteForm key={siteForm.site?.id ?? 'new'} site={siteForm.site} locations={locations} saving={siteSaving} error={siteError ? t('construction.sites.saveError') : null} onCancel={() => setSiteForm({ open: false })} onSave={saveSite} /></div>}
        {sites.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 px-5 py-9 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><MapPin className="h-6 w-6" /></span><h3 className="mt-3 font-bold text-slate-900">{t('construction.sites.emptyTitle')}</h3><p className="mt-1 text-sm text-slate-500">{t('construction.sites.emptyDescription')}</p></div> : <div className="grid gap-3 md:grid-cols-2">{sites.map((site) => <article key={site.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h3 className="truncate font-bold text-slate-900">{site.name}</h3><p className="mt-1 text-sm text-slate-500">{site.location_id ? locationNames.get(site.location_id) ?? t('construction.sites.linkedLocation') : t('construction.sites.noLinkedLocation')}</p>{site.address && <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{site.address}</p>}</div><div className="flex shrink-0 gap-1"><button type="button" aria-label={t('construction.sites.editSiteNamed', { name: site.name })} onClick={() => { setSiteError(false); setSiteForm({ open: true, site }); }} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-brand-700"><Pencil className="h-4 w-4" /></button><button type="button" aria-label={t('construction.sites.deleteSiteNamed', { name: site.name })} onClick={() => void deleteSite(site)} className="rounded-lg p-2 text-slate-500 hover:bg-rose-50 hover:text-rose-700"><Trash2 className="h-4 w-4" /></button></div></div></article>)}</div>}
      </section>

      <ProjectSubcontracts businessId={businessId} projectId={project.id} currency={currency} />
    </main>
  );
}
