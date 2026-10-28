import { useCallback, useState } from 'react';
import { ProjectToast } from './ProjectToast';
import { Link, useLocation } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { repos } from '@/lib/repositories';
import {
  PROJECT_STATUSES,
  type Project,
  type ProjectCostSummary,
} from '@/dal/repositories/ProjectRepository';
import {
  ErrorBanner,
  FIELD_CLASS,
  LoadingBlock,
  SectionCard,
  StatusPill,
} from '../constructionUi';
import { ConstructionPurchaseOrdersSection } from '../ConstructionPurchaseOrdersSection';
import { ConstructionMaterialIssuesSection } from '../ConstructionMaterialIssuesSection';
import { ConstructionReturnsSection } from '../ConstructionReturnsSection';
import { ProjectForm, PROJECT_BUTTON } from './ProjectForm';
import { ClientPicker } from './ClientPicker';
import { ProjectStatusBadge } from './ProjectsSection';
import { ProjectBoqEditor } from './ProjectBoqEditor';
import { ProjectValuationsPanel } from './ProjectValuationsPanel';
import { ProjectPnlOverview } from './ProjectPnlOverview';
import { ProjectSubcontracts } from '@/components/construction/ProjectSubcontracts';
import { useAppStore } from '@/store/useAppStore';

const k = 'construction.projects';
const TABS = ['overview', 'sites', 'procurement', 'subcontracts', 'boq', 'valuations'] as const;
export function ProjectDetail({
  businessId,
  projectId,
  capabilities,
}: {
  businessId: string;
  projectId: string;
  capabilities: string[];
}) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ['construction', 'project', businessId, projectId],
    queryFn: () => repos.projects.getById(businessId, projectId),
  });
  if (query.isLoading) return <LoadingBlock label={t(`${k}.loading`)} />;
  if (query.isError) return <ErrorBanner message={query.error.message} />;
  if (!query.data) return <ErrorBanner message={t(`${k}.notFound`)} />;
  return (
    <ProjectDetailContent
      key={`${businessId}:${projectId}`}
      project={query.data}
      capabilities={capabilities}
    />
  );
}
function ProjectDetailContent({
  project,
  capabilities,
}: {
  project: Project & { site_count: number; cost: ProjectCostSummary };
  capabilities: string[];
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const cache = useQueryClient();
  const currency = useAppStore((state) => state.currentBusiness?.business?.base_currency?.trim().toUpperCase() || 'MWK');
  const [tab, setTab] = useState<(typeof TABS)[number]>('overview');
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkClientId, setLinkClientId] = useState<string | null>(null);
  const [linkClientName, setLinkClientName] = useState('');
  const [reason, setReason] = useState('');
  const [notice, setNotice] = useState(
    location.state?.projectCreated ? t(`${k}.created`) : '',
  );
  const dismissNotice = useCallback(() => setNotice(''), []);
  const canManage = capabilities.includes('procurement.master.manage');
  const next = PROJECT_STATUSES[PROJECT_STATUSES.indexOf(project.status) + 1];
  const transition = useMutation({
    mutationFn: () => repos.projects.transitionStatus(project.id, next, reason),
    onSuccess: () => {
      setConfirming(false);
      setReason('');
      setNotice(t(`${k}.transitioned`));
      void cache.invalidateQueries({ queryKey: ['construction'] });
    },
  });
  // P2-3: linking a client is a normal update — the RPC validates the
  // contact against the project's business and caches its name.
  const linkClient = useMutation({
    mutationFn: () =>
      repos.projects.update(project.id, {
        name: project.name,
        client_name: linkClientName,
        client_id: linkClientId,
        contract_sum: project.contract_sum,
        retention_pct: project.retention_pct,
        budget: project.budget,
        start_date: project.start_date,
        end_date: project.end_date,
      }),
    onSuccess: () => {
      setLinking(false);
      setNotice(t(`${k}.updated`));
      void cache.invalidateQueries({ queryKey: ['construction'] });
    },
  });
  return (
    <div className="space-y-4">
      <Link
        className="text-sm text-brand-700 underline"
        to="/construction/projects"
      >
        {t(`${k}.back`)}
      </Link>
      {notice && <ProjectToast message={notice} onClose={dismissNotice} />}
      <SectionCard
        title={project.name}
        description={
          project.client_id ? (
            // P2-3: a linked client jumps to its Contacts context.
            <Link
              className="font-medium text-brand-700 underline hover:text-brand-800"
              to={`/contacts?search=${encodeURIComponent(project.client_name)}`}
              data-testid="project-client-link"
            >
              {project.client_name}
            </Link>
          ) : (
            <span data-testid="project-client-unlinked">
              {project.client_name}
              <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                {t('construction.clients.unlinked')}
              </span>
            </span>
          )
        }
        actions={
          <>
            <ProjectStatusBadge status={project.status} />
            {!project.client_id && (
              <button
                className={PROJECT_BUTTON}
                disabled={!canManage}
                data-testid="project-link-client"
                onClick={() => {
                  setLinkClientId(null);
                  setLinkClientName(project.client_name);
                  setLinking(true);
                }}
              >
                {t('construction.clients.linkClient')}
              </button>
            )}
            <button
              className={PROJECT_BUTTON}
              disabled={!canManage}
              onClick={() => setEditing(true)}
            >
              {t(`${k}.edit`)}
            </button>
            {next && (
              <button
                className={PROJECT_BUTTON}
                disabled={!canManage}
                onClick={() => setConfirming(true)}
              >
                {t(`${k}.transitions.${project.status}`)}
              </button>
            )}
          </>
        }
      >
        <div
          role="tablist"
          aria-label={t(`${k}.title`)}
          className="flex flex-wrap gap-3 border-b pb-3"
        >
          {TABS.map((name) => (
            <button
              role="tab"
              aria-selected={tab === name}
              className={
                tab === name ? 'font-semibold text-brand-700' : 'text-gray-600'
              }
              key={name}
              onClick={() => setTab(name)}
            >
              {t(`${k}.tabs.${name}`)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className="pt-4">
          {tab === 'overview' && (
            <ProjectPnlOverview project={project} onNotice={setNotice} />
          )}
          {tab === 'sites' && (
            <ProjectSites
              businessId={project.business_id}
              projectId={project.id}
              projectName={project.name}
              canManage={canManage}
              onNotice={setNotice}
            />
          )}
          {tab === 'procurement' && (
            <div className="space-y-5">
              <p className="text-sm text-gray-600">{t(`${k}.tagHint`)}</p>
              <ConstructionPurchaseOrdersSection
                businessId={project.business_id}
                capabilities={capabilities}
                projectId={project.id}
              />
              <ConstructionMaterialIssuesSection
                businessId={project.business_id}
                capabilities={capabilities}
                projectId={project.id}
              />
              <ConstructionReturnsSection
                businessId={project.business_id}
                capabilities={capabilities}
                projectId={project.id}
              />
            </div>
          )}
          {tab === 'subcontracts' && (
            <ProjectSubcontracts businessId={project.business_id} projectId={project.id} currency={currency} />
          )}
          {tab === 'boq' && <ProjectBoqEditor project={project} canManage={canManage} onNotice={setNotice} />}
          {tab === 'valuations' && (
            <ProjectValuationsPanel
              project={project}
              capabilities={capabilities}
              onNotice={setNotice}
            />
          )}
        </div>
      </SectionCard>
      {editing && (
        <ProjectForm
          businessId={project.business_id}
          project={project}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setNotice(t(`${k}.updated`));
            void cache.invalidateQueries({ queryKey: ['construction'] });
          }}
        />
      )}
      {linking && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="link-client-title"
        >
          <div
            className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6"
            data-testid="link-client-dialog"
          >
            <h2 id="link-client-title" className="font-semibold">
              {t('construction.clients.linkClient')}
            </h2>
            <ClientPicker
              businessId={project.business_id}
              value={linkClientId}
              clientName={linkClientName}
              disabled={linkClient.isPending}
              onChange={(id, name) => {
                setLinkClientId(id);
                setLinkClientName(name);
              }}
            />
            {linkClient.isError && (
              <ErrorBanner message={linkClient.error.message} />
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={linkClient.isPending}
                onClick={() => setLinking(false)}
              >
                {t(`${k}.cancel`)}
              </button>
              <button
                className={PROJECT_BUTTON}
                disabled={!linkClientId || linkClient.isPending}
                data-testid="link-client-save"
                onClick={() => linkClient.mutate()}
              >
                {t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="transition-title"
        >
          <form
            className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6"
            onSubmit={(event) => {
              event.preventDefault();
              transition.mutate();
            }}
          >
            <h2 id="transition-title" className="font-semibold">
              {t(`${k}.confirmTitle`)}
            </h2>
            <p>
              {t(`${k}.confirmText`, { status: t(`${k}.statuses.${next}`) })}
            </p>
            <label className="block">
              {t(`${k}.reason`)}
              <textarea
                autoFocus
                className={FIELD_CLASS}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            {transition.isError && (
              <ErrorBanner message={transition.error.message} />
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={transition.isPending}
                onClick={() => setConfirming(false)}
              >
                {t(`${k}.cancel`)}
              </button>
              <button
                className={PROJECT_BUTTON}
                disabled={transition.isPending}
              >
                {t(`${k}.confirm`)}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
function ProjectSites({
  businessId,
  projectId,
  projectName,
  canManage,
  onNotice,
}: {
  businessId: string;
  projectId: string;
  projectName: string;
  canManage: boolean;
  onNotice: (notice: string) => void;
}) {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const [linkSiteId, setLinkSiteId] = useState('');
  const query = useQuery({
    queryKey: ['construction', 'project-sites', businessId, projectId],
    queryFn: async () => {
      const [locations, orders, issues, sites, branches] = await Promise.all([
        repos.projects.locations(businessId),
        repos.construction.findPurchaseOrders(businessId, projectId),
        repos.construction.findMaterialIssues(businessId, projectId),
        repos.construction.findSites(businessId),
        repos.branch.findByBusiness(businessId),
      ]);
      return { locations, orders, issues, sites, branches };
    },
  });
  const mutation = useMutation({
    mutationFn: ({ id, unlink }: { id: string; unlink: boolean }) =>
      unlink
        ? repos.projects.unlinkSite(id)
        : repos.projects.linkSite(id, projectId),
    onSuccess: (_, variables) => {
      onNotice(t(`${k}.${variables.unlink ? 'unlinked' : 'linked'}`));
      void cache.invalidateQueries({ queryKey: ['construction'] });
    },
  });
  // Procurement-site linkage (P2-4): authoritative FK writes go through the
  // update_construction_procurement_site lifecycle RPC, never a table write.
  const siteMutation = useMutation({
    mutationFn: ({
      siteId,
      projectId: nextProjectId,
      projectRef,
    }: {
      siteId: string;
      projectId: string | null;
      projectRef?: string;
    }) =>
      repos.construction.updateSite(siteId, {
        projectId: nextProjectId,
        ...(projectRef !== undefined ? { projectRef } : {}),
      }),
    onSuccess: (_, variables) => {
      setLinkSiteId('');
      onNotice(
        variables.projectId
          ? t('construction.sites.siteLinked')
          : t('construction.sites.siteUnlinked'),
      );
      void cache.invalidateQueries({ queryKey: ['construction'] });
    },
  });
  if (query.isLoading) return <LoadingBlock label={t(`${k}.loading`)} />;
  if (query.isError) return <ErrorBanner message={query.error.message} />;
  if (!query.data) return null;
  const { locations, orders, issues, sites, branches } = query.data;
  const branchesById = new Map(branches.map((branch) => [branch.id, branch]));
  const locationsById = new Map(
    locations.map((location) => [location.id, location]),
  );
  const linkedProcurementSites = sites.filter(
    (site) => site.project_id === projectId,
  );
  const unlinkedProcurementSites = sites.filter(
    (site) => site.project_id === null,
  );
  const act = (id: string, unlink: boolean) => {
    const hasActivity =
      issues.some((issue) => issue.location_id === id) ||
      orders.some(
        (order) =>
          order.status !== 'cancelled' &&
          sites.some(
            (site) => site.id === order.site_id && site.location_id === id,
          ),
      );
    if (unlink && hasActivity && !window.confirm(t(`${k}.unlinkWarning`)))
      return;
    mutation.mutate({ id, unlink });
  };
  return (
    <div className="space-y-5">
      {mutation.isError && <ErrorBanner message={mutation.error.message} />}
      {siteMutation.isError && (
        <ErrorBanner message={siteMutation.error.message} />
      )}
      {[true, false].map((linked) => {
        const rows = locations.filter((site) =>
          linked ? site.project_id === projectId : site.project_id === null,
        );
        return (
          <section key={String(linked)}>
            <h3 className="mb-3 font-medium">
              {t(`${k}.${linked ? 'linkedSites' : 'availableSites'}`)}
            </h3>
            {!rows.length && (
              <p className="text-sm text-gray-500">{t(`${k}.noSites`)}</p>
            )}
            <ul>
              {rows.map((site) => (
                <li
                  className="flex items-center justify-between border-b py-3"
                  key={site.id}
                >
                  <span>{site.name}</span>
                  <button
                    className={PROJECT_BUTTON}
                    disabled={!canManage || mutation.isPending}
                    onClick={() => act(site.id, linked)}
                  >
                    {t(`${k}.${linked ? 'unlink' : 'link'}`)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {/* Procurement sites (P2-4): linked through the authoritative
          construction_procurement_sites.project_id FK, independent from the
          inventory-location lists above. */}
      <section>
        <h3 className="mb-3 font-medium">
          {t('construction.sites.procurementSites')}
        </h3>
        {!linkedProcurementSites.length && (
          <p className="text-sm text-gray-500">
            {t('construction.sites.noProcurementSites')}
          </p>
        )}
        <ul>
          {linkedProcurementSites.map((site) => (
            <li
              className="flex items-center justify-between border-b py-3"
              key={site.id}
            >
              <span className="text-sm">
                {site.site_name}{' '}
                <span className="font-mono text-xs text-gray-500">
                  ({site.site_code})
                </span>
                <span className="block text-xs text-gray-500">
                  {branchesById.get(site.branch_id)?.name ?? '—'} ·{' '}
                  {locationsById.get(site.location_id)?.name ?? '—'}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <StatusPill
                  label={
                    site.is_active
                      ? t('construction.sites.active')
                      : t('construction.sites.inactive')
                  }
                  className={
                    site.is_active
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-slate-100 text-slate-700'
                  }
                />
                {canManage ? (
                  <button
                    className={PROJECT_BUTTON}
                    disabled={siteMutation.isPending}
                    onClick={() =>
                      siteMutation.mutate({ siteId: site.id, projectId: null })
                    }
                  >
                    {t('construction.sites.unlinkProject')}
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
        {canManage && unlinkedProcurementSites.length ? (
          <div className="mt-3 flex items-center gap-2">
            <select
              aria-label={t('construction.sites.linkProcurementSite')}
              value={linkSiteId}
              onChange={(event) => setLinkSiteId(event.target.value)}
              className={FIELD_CLASS}
            >
              <option value="">
                {t('construction.sites.linkProcurementSite')}
              </option>
              {unlinkedProcurementSites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.site_name} ({site.site_code})
                </option>
              ))}
            </select>
            <button
              className={PROJECT_BUTTON}
              disabled={!linkSiteId || siteMutation.isPending}
              onClick={() =>
                siteMutation.mutate({
                  siteId: linkSiteId,
                  projectId,
                  projectRef: projectName,
                })
              }
            >
              {t(`${k}.link`)}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
