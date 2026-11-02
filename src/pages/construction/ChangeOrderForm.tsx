import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/store/useAppStore';
import type { CreateConstructionChangeOrderInput } from '@/dal/repositories/ConstructionChangeOrderRepository';
import { Button } from '@/components/ui/Button';
import { loadAllProjects, loadChangeOrderProjectReferences } from './changeOrderPageData';

export type ChangeOrderFormValues = CreateConstructionChangeOrderInput;

const EMPTY_CHANGE_ORDER_VALUES: ChangeOrderFormValues = {
  project_id: '',
  site_id: '',
  co_number: '',
  title: '',
  description: '',
  reason: '',
  cost_impact: 0,
  time_impact_days: 0,
  boq_section_id: '',
  subcontract_id: '',
  evidence_reference: '',
};

interface ChangeOrderFormProps {
  initialValues?: ChangeOrderFormValues;
  submitLabel: string;
  isSubmitting: boolean;
  errorMessage?: string;
  onSubmit: (values: ChangeOrderFormValues) => void;
  onCancel?: () => void;
}

export function ChangeOrderForm({
  initialValues = EMPTY_CHANGE_ORDER_VALUES,
  submitLabel,
  isSubmitting,
  errorMessage,
  onSubmit,
  onCancel,
}: ChangeOrderFormProps) {
  const { t } = useTranslation();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? null);
  const [values, setValues] = useState<ChangeOrderFormValues>(() => ({ ...initialValues }));

  const projectsQuery = useQuery({
    queryKey: ['construction', 'change-order-projects', businessId],
    queryFn: () => loadAllProjects(businessId as string),
    enabled: Boolean(businessId),
  });
  const referencesQuery = useQuery({
    queryKey: ['construction', 'change-order-references', businessId, values.project_id],
    queryFn: () => loadChangeOrderProjectReferences(businessId as string, values.project_id),
    enabled: Boolean(businessId && values.project_id),
  });
  const references = referencesQuery.data;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit({
      ...values,
      project_id: values.project_id,
      site_id: values.site_id || null,
      co_number: values.co_number.trim(),
      title: values.title.trim(),
      description: values.description.trim(),
      reason: values.reason.trim(),
      cost_impact: Number(values.cost_impact),
      time_impact_days: Number(values.time_impact_days),
      boq_section_id: values.boq_section_id || null,
      subcontract_id: values.subcontract_id || null,
      evidence_reference: values.evidence_reference?.trim() || null,
    });
  };

  const update = <K extends keyof ChangeOrderFormValues>(key: K, value: ChangeOrderFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm sm:p-6">
      {errorMessage ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{errorMessage}</p> : null}
      {projectsQuery.isError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t('changeOrders.errors.projects')}</p> : null}
      {referencesQuery.isError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t('changeOrders.errors.references')}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-gray-700">
          {t('changeOrders.fields.project')} <span aria-hidden="true">*</span>
          <select
            required
            className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            value={values.project_id}
            onChange={(event) => setValues((current) => ({
              ...current,
              project_id: event.target.value,
              site_id: '',
              boq_section_id: '',
              subcontract_id: '',
            }))}
          >
            <option value="">{t('changeOrders.placeholders.project')}</option>
            {(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-gray-700">
          {t('changeOrders.fields.site')}
          <select className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" value={values.site_id ?? ''} onChange={(event) => update('site_id', event.target.value)}>
            <option value="">{t('changeOrders.placeholders.optional')}</option>
            {(references?.sites ?? []).map((site) => <option key={site.id} value={site.id}>{site.site_code} · {site.site_name}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-gray-700">
          {t('changeOrders.fields.number')} <span aria-hidden="true">*</span>
          <input required maxLength={80} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={values.co_number} onChange={(event) => update('co_number', event.target.value)} />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          {t('changeOrders.fields.title')} <span aria-hidden="true">*</span>
          <input required maxLength={200} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={values.title} onChange={(event) => update('title', event.target.value)} />
        </label>
        <label className="block text-sm font-medium text-gray-700 sm:col-span-2">
          {t('changeOrders.fields.description')} <span aria-hidden="true">*</span>
          <textarea required maxLength={20000} rows={5} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={values.description} onChange={(event) => update('description', event.target.value)} />
        </label>
        <label className="block text-sm font-medium text-gray-700 sm:col-span-2">
          {t('changeOrders.fields.reason')} <span aria-hidden="true">*</span>
          <textarea required maxLength={10000} rows={4} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={values.reason} onChange={(event) => update('reason', event.target.value)} />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          {t('changeOrders.fields.costImpact')} <span aria-hidden="true">*</span>
          <input required type="number" step="0.01" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={values.cost_impact ?? 0} onChange={(event) => update('cost_impact', Number(event.target.value))} />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          {t('changeOrders.fields.timeImpact')} <span aria-hidden="true">*</span>
          <input required type="number" step="1" className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={values.time_impact_days ?? 0} onChange={(event) => update('time_impact_days', Number(event.target.value))} />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          {t('changeOrders.fields.boqSection')}
          <select className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" value={values.boq_section_id ?? ''} onChange={(event) => update('boq_section_id', event.target.value)}>
            <option value="">{t('changeOrders.placeholders.optional')}</option>
            {(references?.boqSections ?? []).map((section) => <option key={section.id} value={section.id}>{section.code} · {section.title}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-gray-700">
          {t('changeOrders.fields.subcontract')}
          <select className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm" value={values.subcontract_id ?? ''} onChange={(event) => update('subcontract_id', event.target.value)}>
            <option value="">{t('changeOrders.placeholders.optional')}</option>
            {(references?.subcontracts ?? []).map((subcontract) => <option key={subcontract.id} value={subcontract.id}>{subcontract.reference} · {subcontract.title}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium text-gray-700 sm:col-span-2">
          {t('changeOrders.fields.evidenceReference')}
          <input maxLength={1000} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" value={values.evidence_reference ?? ''} onChange={(event) => update('evidence_reference', event.target.value)} />
        </label>
      </div>

      <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
        {onCancel ? <Button type="button" variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button> : null}
        <Button type="submit" isLoading={isSubmitting} disabled={!businessId || isSubmitting || projectsQuery.isLoading}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
