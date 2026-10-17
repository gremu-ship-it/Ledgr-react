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
} from '../constructionUi';
import { ConstructionPurchaseOrdersSection } from '../ConstructionPurchaseOrdersSection';
import { ConstructionMaterialIssuesSection } from '../ConstructionMaterialIssuesSection';
import { ConstructionReturnsSection } from '../ConstructionReturnsSection';
import { ProjectForm, PROJECT_BUTTON } from './ProjectForm';
import { ProjectStatusBadge } from './ProjectsSection';
import { ProjectBoqEditor } from './ProjectBoqEditor';
import { ProjectValuationsPanel } from './ProjectValuationsPanel';

const k = 'construction.projects';
const TABS = ['overview', 'sites', 'procurement', 'boq', 'valuations'] as const;
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
  const [tab, setTab] = useState<(typeof TABS)[number]>('overview');
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
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
        description={project.client_name}
        actions={
          <>
            <ProjectStatusBadge status={project.status} />
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
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                {[
                  ['fields.contract_sum', project.contract_sum],
                  ['fields.budget', project.budget],
                  ['cost', project.cost.net_cost],
                  ['fields.retention_pct', project.retention_pct],
                  ['siteCount', project.site_count],
                  ['poValue', project.cost.total_po_value],
                  ['issuedValue', project.cost.total_issued_value],
                  ['returnedValue', project.cost.total_returned_value],
                ].map(([label, value]) => (
                  <div className="rounded-xl border p-4" key={label}>
                    <p className="text-sm text-gray-500">
                      {t(`${k}.${label}`)}
                    </p>
                    <p className="mt-2 text-xl font-semibold">
                      {Number(value).toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-4 text-xs text-gray-500">{t(`${k}.costNote`)}</p>
            </>
          )}
          {tab === 'sites' && (
            <ProjectSites
              businessId={project.business_id}
              projectId={project.id}
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
  canManage,
  onNotice,
}: {
  businessId: string;
  projectId: string;
  canManage: boolean;
  onNotice: (notice: string) => void;
}) {
  const { t } = useTranslation();
  const cache = useQueryClient();
  const query = useQuery({
    queryKey: ['construction', 'project-sites', businessId, projectId],
    queryFn: async () => {
      const [locations, orders, issues, sites] = await Promise.all([
        repos.projects.locations(businessId),
        repos.construction.findPurchaseOrders(businessId, projectId),
        repos.construction.findMaterialIssues(businessId, projectId),
        repos.construction.findSites(businessId),
      ]);
      return { locations, orders, issues, sites };
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
  if (query.isLoading) return <LoadingBlock label={t(`${k}.loading`)} />;
  if (query.isError) return <ErrorBanner message={query.error.message} />;
  if (!query.data) return null;
  const { locations, orders, issues, sites } = query.data;
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
    </div>
  );
}
