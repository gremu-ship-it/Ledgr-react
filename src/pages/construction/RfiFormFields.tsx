import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConstructionRfiPriority } from '@/dal/repositories/ConstructionRfiRepository';
import type { Project, BoqItem } from '@/dal/repositories/ProjectRepository';
import type { ConstructionProcurementSite } from '@/dal/repositories/ConstructionProcurementRepository';
import type { SubcontractSummary } from '@/dal/types/subcontracts';

export interface RfiFormValues {
  project_id: string;
  site_id: string;
  rfi_number: string;
  title: string;
  question: string;
  priority: ConstructionRfiPriority;
  due_date: string;
  evidence: string;
  proposed_solution: string;
  boq_item_id: string;
  subcontract_id: string;
  drawing_reference: string;
}

interface RfiFormFieldsProps {
  values: RfiFormValues;
  setValues: Dispatch<SetStateAction<RfiFormValues>>;
  projects: Project[];
  sites: ConstructionProcurementSite[];
  boqItems: BoqItem[];
  subcontracts: SubcontractSummary[];
  showRfiNumber?: boolean;
  projectDisabled?: boolean;
  siteDisabled?: boolean;
}

const k = 'construction.rfis';
const inputClass = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100';
const labelClass = 'block text-sm font-medium text-gray-700';

export function RfiFormFields({
  values,
  setValues,
  projects,
  sites,
  boqItems,
  subcontracts,
  showRfiNumber = true,
  projectDisabled = false,
  siteDisabled = false,
}: RfiFormFieldsProps) {
  const { t } = useTranslation();
  const set = <K extends keyof RfiFormValues>(field: K, value: RfiFormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
  };
  const availableSites = siteDisabled ? sites : sites.filter((site) => site.is_active);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <label className={labelClass}>
        {t(`${k}.fields.project`)} <span aria-hidden="true">*</span>
        <select
          className={inputClass}
          value={values.project_id}
          onChange={(event) => setValues((current) => ({
            ...current,
            project_id: event.target.value,
            site_id: '',
            boq_item_id: '',
            subcontract_id: '',
          }))}
          disabled={projectDisabled}
          required
        >
          <option value="">{t(`${k}.placeholders.project`)}</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </label>
      {showRfiNumber ? (
        <label className={labelClass}>
          {t(`${k}.fields.number`)} <span aria-hidden="true">*</span>
          <input className={inputClass} maxLength={80} value={values.rfi_number} onChange={(event) => set('rfi_number', event.target.value)} required />
        </label>
      ) : null}
      <label className={labelClass}>
        {t(`${k}.fields.subject`)} <span aria-hidden="true">*</span>
        <input className={inputClass} maxLength={200} value={values.title} onChange={(event) => set('title', event.target.value)} required />
      </label>
      <label className={labelClass}>
        {t(`${k}.fields.site`)}
        <select className={inputClass} value={values.site_id} onChange={(event) => set('site_id', event.target.value)} disabled={siteDisabled || !values.project_id}>
          <option value="">{t(`${k}.placeholders.optional`)}</option>
          {availableSites.map((site) => <option key={site.id} value={site.id}>{site.site_code} · {site.site_name}</option>)}
        </select>
      </label>
      <label className={labelClass}>
        {t(`${k}.fields.priority`)}
        <select className={inputClass} value={values.priority} onChange={(event) => set('priority', event.target.value as ConstructionRfiPriority)}>
          {(['low', 'normal', 'high', 'urgent'] as const).map((priority) => (
            <option key={priority} value={priority}>{t(`${k}.priorities.${priority}`)}</option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        {t(`${k}.fields.dueDate`)}
        <input className={inputClass} type="date" value={values.due_date} onChange={(event) => set('due_date', event.target.value)} />
      </label>
      <label className={labelClass}>
        {t(`${k}.fields.boqItem`)}
        <select className={inputClass} value={values.boq_item_id} onChange={(event) => set('boq_item_id', event.target.value)} disabled={!values.project_id}>
          <option value="">{t(`${k}.placeholders.optional`)}</option>
          {boqItems.map((item) => <option key={item.id} value={item.id}>{item.item_number} · {item.description}</option>)}
        </select>
      </label>
      <label className={labelClass}>
        {t(`${k}.fields.subcontract`)}
        <select className={inputClass} value={values.subcontract_id} onChange={(event) => set('subcontract_id', event.target.value)} disabled={!values.project_id}>
          <option value="">{t(`${k}.placeholders.optional`)}</option>
          {subcontracts.map((subcontract) => (
            <option key={subcontract.id} value={subcontract.id}>{subcontract.reference} · {subcontract.title}</option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        {t(`${k}.fields.drawingReference`)}
        <input className={inputClass} maxLength={200} value={values.drawing_reference} onChange={(event) => set('drawing_reference', event.target.value)} />
      </label>
      <label className={`${labelClass} md:col-span-2`}>
        {t(`${k}.fields.question`)} <span aria-hidden="true">*</span>
        <textarea className={inputClass} rows={5} maxLength={20000} value={values.question} onChange={(event) => set('question', event.target.value)} required />
      </label>
      <label className={`${labelClass} md:col-span-2`}>
        {t(`${k}.fields.proposedSolution`)}
        <textarea className={inputClass} rows={3} value={values.proposed_solution} onChange={(event) => set('proposed_solution', event.target.value)} />
      </label>
      <label className={`${labelClass} md:col-span-2`}>
        {t(`${k}.fields.evidenceReference`)}
        <input className={inputClass} value={values.evidence} onChange={(event) => set('evidence', event.target.value)} />
      </label>
    </div>
  );
}
