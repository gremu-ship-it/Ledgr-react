import { useTranslation } from 'react-i18next';
import type { Project } from '@/dal/repositories/ProjectRepository';
import type { ConstructionProcurementSite } from '@/dal/repositories/ConstructionProcurementRepository';

interface ConstructionHseReferenceFieldsProps {
  namespace: 'hseIncidents' | 'toolboxTalks';
  projects: Project[];
  sites: ConstructionProcurementSite[];
  projectId: string;
  siteId: string;
  onProjectChange: (projectId: string) => void;
  onSiteChange: (siteId: string) => void;
}

const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';
const labelClass = 'block text-sm font-medium text-gray-700';

export function ConstructionHseReferenceFields({
  namespace,
  projects,
  sites,
  projectId,
  siteId,
  onProjectChange,
  onSiteChange,
}: ConstructionHseReferenceFieldsProps) {
  const { t } = useTranslation();
  const key = `construction.${namespace}`;

  return (
    <>
      <label className={labelClass}>
        {t(`${key}.fields.project`)} <span aria-hidden="true">*</span>
        <select required className={inputClass} value={projectId} onChange={(event) => onProjectChange(event.target.value)}>
          <option value="">{t(`${key}.placeholders.project`)}</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
      <label className={labelClass}>
        {t(`${key}.fields.site`)}
        <select className={inputClass} value={siteId} disabled={!projectId} onChange={(event) => onSiteChange(event.target.value)}>
          <option value="">{t(`${key}.placeholders.optional`)}</option>
          {sites.filter((site) => site.is_active).map((site) => (
            <option key={site.id} value={site.id}>{site.site_code} · {site.site_name}</option>
          ))}
        </select>
      </label>
    </>
  );
}
