import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Building2, CalendarDays, CircleDollarSign, Plus, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Business } from '@/types';
import { constructionRepository } from '@/dal/repositories/ConstructionRepository';
import type { ConstructionProject, ConstructionProjectStatus } from '@/dal/types/construction';
import { CONSTRUCTION_PROJECT_STATUSES } from '@/dal/types/construction';
import { ConstructionProjectForm } from '@/components/construction/ConstructionProjectForm';
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

function dateLabel(value: string | null, locale: string, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

export function ConstructionProjectsPage() {
  const business = useAppStore((state) => state.currentBusiness?.business ?? null);
  return <ConstructionProjectsWorkspace key={business?.id ?? 'no-business'} business={business} />;
}

function ConstructionProjectsWorkspace({ business }: { business: Business | null }) {
  const { t, i18n } = useTranslation();
  const businessId = business?.id ?? '';
  const currency = business?.base_currency?.trim().toUpperCase() || 'MWK';
  const [projects, setProjects] = useState<ConstructionProject[]>([]);
  const [loading, setLoading] = useState(Boolean(businessId));
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ConstructionProjectStatus>('all');

  const loadProjects = useCallback(async () => {
    if (!businessId) return;
    try {
      const rows = await constructionRepository.listProjects(businessId);
      setProjects(rows);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;
    let active = true;
    const request = async () => {
      try {
        const rows = await constructionRepository.listProjects(businessId);
        if (active) {
          setProjects(rows);
          setLoadError(false);
        }
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    };
    void request();
    return () => { active = false; };
  }, [businessId]);

  const filteredProjects = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return projects.filter((project) => {
      const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
      const matchesQuery = !query || `${project.name} ${project.client_name}`.toLocaleLowerCase().includes(query);
      return matchesStatus && matchesQuery;
    });
  }, [projects, search, statusFilter]);

  const counts = useMemo(() => ({
    all: projects.length,
    active: projects.filter((project) => project.status === 'active').length,
    onHold: projects.filter((project) => project.status === 'on_hold').length,
    completed: projects.filter((project) => project.status === 'completed' || project.status === 'closed').length,
  }), [projects]);

  const saveProject = async (input: Parameters<typeof constructionRepository.createProject>[1]) => {
    if (!businessId) return;
    setSaving(true);
    setFormError(false);
    try {
      const created = await constructionRepository.createProject(businessId, input);
      setProjects((current) => [created, ...current.filter((project) => project.id !== created.id)]);
      setShowForm(false);
    } catch {
      setFormError(true);
    } finally {
      setSaving(false);
    }
  };

  const projectStatusLabel = (status: ConstructionProjectStatus) => t(`construction.status.${status}`);

  return (
    <main className="mx-auto w-full max-w-7xl space-y-7 px-4 py-6 sm:px-6 lg:px-8">
      <header className="relative overflow-hidden rounded-3xl bg-slate-950 px-6 py-7 text-white shadow-xl sm:px-8 sm:py-9">
        <div className="absolute -right-12 -top-20 h-64 w-64 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-sky-100">
              <Building2 className="h-3.5 w-3.5" /> {t('construction.eyebrow')}
            </p>
            <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('construction.title')}</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300 sm:text-base">{t('construction.subtitle', { business: business?.name ?? '' })}</p>
          </div>
          <button
            type="button"
            onClick={() => { setShowForm(true); setFormError(false); }}
            disabled={!businessId}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-bold text-slate-950 shadow-lg transition hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> {t('construction.newProject')}
          </button>
        </div>
      </header>

      {!business && <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{t('construction.selectBusiness')}</div>}
      {loadError && <div role="alert" className="flex items-center justify-between rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800"><span>{t('construction.loadError')}</span><button type="button" onClick={() => { setLoading(true); setLoadError(false); void loadProjects(); }} className="font-bold underline">{t('common.retry')}</button></div>}

      {showForm && (
        <section aria-labelledby="new-project-heading" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div><p className="text-xs font-bold uppercase tracking-[0.15em] text-brand-700">{t('construction.projectManagement')}</p><h2 id="new-project-heading" className="mt-1 text-xl font-extrabold text-slate-900">{t('construction.createProject')}</h2></div>
            <button type="button" onClick={() => setShowForm(false)} aria-label={t('common.close')} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
          </div>
          <ConstructionProjectForm
            currency={currency}
            saving={saving}
            error={formError ? t('construction.saveError') : null}
            onCancel={() => setShowForm(false)}
            onSave={saveProject}
          />
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('construction.projectSummary')}>
        {[
          { label: t('construction.metrics.total'), value: counts.all, icon: Building2, tone: 'bg-slate-100 text-slate-700' },
          { label: t('construction.metrics.active'), value: counts.active, icon: ArrowRight, tone: 'bg-emerald-50 text-emerald-700' },
          { label: t('construction.metrics.onHold'), value: counts.onHold, icon: CalendarDays, tone: 'bg-amber-50 text-amber-700' },
          { label: t('construction.metrics.completed'), value: counts.completed, icon: CircleDollarSign, tone: 'bg-blue-50 text-blue-700' },
        ].map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between"><span className="text-sm font-medium text-slate-500">{label}</span><span className={`flex h-9 w-9 items-center justify-center rounded-xl ${tone}`}><Icon className="h-4 w-4" /></span></div>
            <p className="mt-3 text-2xl font-extrabold text-slate-950">{value}</p>
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 className="text-xl font-extrabold text-slate-900">{t('construction.projectsHeading')}</h2><p className="mt-1 text-sm text-slate-500">{t('construction.projectsCount', { count: projects.length })}</p></div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="relative block">
              <span className="sr-only">{t('construction.searchProjects')}</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('construction.searchProjects')} className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-3 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100 sm:w-56" />
            </label>
            <label>
              <span className="sr-only">{t('construction.filterByStatus')}</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-700 outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100 sm:w-48">
                <option value="all">{t('construction.allStatuses')}</option>
                {CONSTRUCTION_PROJECT_STATUSES.map((status) => <option key={status} value={status}>{projectStatusLabel(status)}</option>)}
              </select>
            </label>
          </div>
        </div>

        {loading ? (
          <div role="status" className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">{t('common.loading')}</div>
        ) : filteredProjects.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><Building2 className="h-7 w-7" /></span>
            <h3 className="mt-4 text-lg font-bold text-slate-900">{projects.length === 0 ? t('construction.emptyTitle') : t('construction.noMatches')}</h3>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{projects.length === 0 ? t('construction.emptyDescription') : t('construction.noMatchesDescription')}</p>
            {projects.length === 0 && <button type="button" onClick={() => setShowForm(true)} disabled={!businessId} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"><Plus className="h-4 w-4" />{t('construction.createFirstProject')}</button>}
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {filteredProjects.map((project) => (
              <Link key={project.id} to={`/construction/projects/${project.id}`} aria-label={t('construction.openProject', { name: project.name })} className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0"><h3 className="truncate text-lg font-extrabold text-slate-950 group-hover:text-brand-700">{project.name}</h3><p className="mt-1 truncate text-sm text-slate-500">{project.client_name || t('construction.noClient')}</p></div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-bold ${STATUS_STYLES[project.status]}`}>{projectStatusLabel(project.status)}</span>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('construction.fields.contractValueShort')}</p><p className="mt-1 text-sm font-bold text-slate-800">{currencyAmount(project.contract_sum, currency)}</p></div>
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t('construction.fields.budgetShort')}</p><p className="mt-1 text-sm font-bold text-slate-800">{currencyAmount(project.budget, currency)}</p></div>
                </div>
                <div className="mt-4 flex items-center justify-between text-xs text-slate-500"><span>{dateLabel(project.start_date, i18n.language, t('construction.notScheduled'))}</span><span className="inline-flex items-center gap-1 font-bold text-brand-700">{t('common.view')}<ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" /></span></div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
