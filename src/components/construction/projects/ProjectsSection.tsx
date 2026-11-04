import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { repos } from '@/lib/repositories';
import {
  PROJECT_STATUSES,
  type ProjectStatus,
} from '@/dal/repositories/ProjectRepository';
import {
  EmptyState,
  ErrorBanner,
  LoadingBlock,
  SectionCard,
  StatusPill,
} from '../constructionUi';
import { ProjectForm, PROJECT_BUTTON } from './ProjectForm';

const STATUS_COLORS: Record<ProjectStatus, string> = {
  tender: 'bg-gray-100 text-gray-700',
  active: 'bg-green-100 text-green-800',
  practical_completion: 'bg-blue-100 text-blue-800',
  defect_liability: 'bg-yellow-100 text-yellow-800',
  closed: 'bg-gray-800 text-white',
};
export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const { t } = useTranslation();
  return (
    <StatusPill
      label={t(`construction.projects.statuses.${status}`)}
      className={STATUS_COLORS[status]}
    />
  );
}
export function ProjectsSection({
  businessId,
  capabilities,
}: {
  businessId: string;
  capabilities: string[];
}) {
  const { t } = useTranslation();
  const k = 'construction.projects';
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [status, setStatus] = useState<ProjectStatus | ''>('');
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const canManage = capabilities.includes('procurement.master.manage');
  const query = useQuery({
    queryKey: ['construction', 'projects', businessId, status, page],
    queryFn: () =>
      repos.projects.list(businessId, { status: status || undefined, page }),
  });
  const createButton = (
    <button
      className={PROJECT_BUTTON}
      disabled={!canManage}
      title={!canManage ? t(`${k}.manageRequired`) : undefined}
      onClick={() => setCreating(true)}
    >
      {t(`${k}.new`)}
    </button>
  );
  return (
    <SectionCard title={t(`${k}.title`)} actions={createButton}>
      <label className="mb-4 block text-sm">
        {t(`${k}.filter`)}
        <select
          className="ml-3 rounded border p-2"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as ProjectStatus | '');
            setPage(0);
          }}
        >
          <option value="">{t(`${k}.allStatuses`)}</option>
          {PROJECT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`${k}.statuses.${s}`)}
            </option>
          ))}
        </select>
      </label>
      {query.isLoading && <LoadingBlock label={t(`${k}.loading`)} />}
      {query.isError && <ErrorBanner message={query.error.message} />}
      {query.data &&
        (query.data.rows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {[
                    'name',
                    'client_name',
                    'status',
                    'contract_sum',
                    'budget',
                    'start_date',
                    'end_date',
                  ].map((field) => (
                    <th className="p-2" key={field}>
                      {t(`${k}.columns.${field}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {query.data.rows.map((project) => (
                  <tr
                    className="cursor-pointer border-t hover:bg-gray-50"
                    key={project.id}
                    onClick={() =>
                      navigate(`/construction/projects/${project.id}`)
                    }
                  >
                    <td className="p-2">
                      <Link
                        className="text-brand-700 underline"
                        to={`/construction/projects/${project.id}`}
                      >
                        {project.name}
                      </Link>
                    </td>
                    <td className="p-2">{project.client_name}</td>
                    <td className="p-2">
                      <ProjectStatusBadge status={project.status} />
                    </td>
                    <td className="p-2">
                      {Number(project.contract_sum).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="p-2">
                      {Number(project.budget).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="p-2">{project.start_date ?? '—'}</td>
                    <td className="p-2">{project.end_date ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="space-y-3 text-center">
            <EmptyState title={t(`${k}.empty`)} />
            {createButton}
          </div>
        ))}
      {query.data && (
        <div className="mt-4 flex justify-end gap-4 text-sm">
          <button disabled={!page} onClick={() => setPage(page - 1)}>
            {t(`${k}.previous`)}
          </button>
          <span>{t(`${k}.page`, { page: page + 1 })}</span>
          <button
            disabled={(page + 1) * 25 >= query.data.count}
            onClick={() => setPage(page + 1)}
          >
            {t(`${k}.next`)}
          </button>
        </div>
      )}
      {creating && (
        <ProjectForm
          businessId={businessId}
          onCancel={() => setCreating(false)}
          onSaved={(project) => {
            void cache.invalidateQueries({
              queryKey: ['construction', 'projects'],
            });
            navigate(`/construction/projects/${project.id}`, {
              state: { projectCreated: true },
            });
          }}
        />
      )}
    </SectionCard>
  );
}
