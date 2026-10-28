import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConstructionProject, ConstructionProjectInput } from '@/dal/types/construction';
import {
  validateConstructionProject,
  type ConstructionProjectFormErrors,
  type ConstructionProjectFormFields,
} from '@/lib/construction/constructionProjectValidation';

const INPUT_CLASS = 'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-brand-100';

function fieldsFromProject(project?: ConstructionProject | null): ConstructionProjectFormFields {
  return {
    name: project?.name ?? '',
    client_name: project?.client_name ?? '',
    contract_sum: String(project?.contract_sum ?? 0),
    retention_pct: String(project?.retention_pct ?? 0),
    budget: String(project?.budget ?? 0),
    start_date: project?.start_date ?? '',
    end_date: project?.end_date ?? '',
  };
}

interface ConstructionProjectFormProps {
  project?: ConstructionProject | null;
  currency: string;
  saving: boolean;
  error?: string | null;
  onCancel: () => void;
  onSave: (input: ConstructionProjectInput) => Promise<void>;
}

export function ConstructionProjectForm({
  project,
  currency,
  saving,
  error,
  onCancel,
  onSave,
}: ConstructionProjectFormProps) {
  const { t } = useTranslation();
  const [fields, setFields] = useState(() => fieldsFromProject(project));
  const [errors, setErrors] = useState<ConstructionProjectFormErrors>({});

  const setField = (key: keyof ConstructionProjectFormFields, value: string) => {
    setFields((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = validateConstructionProject(fields);
    setErrors(result.errors);
    if (!result.values) return;
    await onSave({ ...result.values, client_id: project?.client_id ?? null });
  };

  const errorMessage = (key: keyof ConstructionProjectFormFields) => {
    const errorKey = errors[key];
    return errorKey ? <p className="mt-1 text-xs font-medium text-rose-600">{t(errorKey)}</p> : null;
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
          {t('construction.fields.projectName')} <span className="text-rose-600">*</span>
          <input autoFocus required className={INPUT_CLASS} value={fields.name} onChange={(e) => setField('name', e.target.value)} />
          {errorMessage('name')}
        </label>
        <label className="text-sm font-semibold text-slate-700 sm:col-span-2">
          {t('construction.fields.clientName')} <span className="text-rose-600">*</span>
          <input required className={INPUT_CLASS} value={fields.client_name} onChange={(e) => setField('client_name', e.target.value)} disabled={Boolean(project?.client_id)} />
          {project?.client_id && <span className="mt-1 block text-xs font-normal text-slate-500">{t('construction.fields.linkedClientHelp')}</span>}
          {errorMessage('client_name')}
        </label>
        <label className="text-sm font-semibold text-slate-700">
          {t('construction.fields.contractValue', { currency })}
          <input type="number" min="0" step="0.01" className={INPUT_CLASS} value={fields.contract_sum} onChange={(e) => setField('contract_sum', e.target.value)} />
          {errorMessage('contract_sum')}
        </label>
        <label className="text-sm font-semibold text-slate-700">
          {t('construction.fields.retentionPercent')}
          <input type="number" min="0" max="100" step="0.01" className={INPUT_CLASS} value={fields.retention_pct} onChange={(e) => setField('retention_pct', e.target.value)} />
          {errorMessage('retention_pct')}
        </label>
        <label className="text-sm font-semibold text-slate-700">
          {t('construction.fields.budget', { currency })}
          <input type="number" min="0" step="0.01" className={INPUT_CLASS} value={fields.budget} onChange={(e) => setField('budget', e.target.value)} />
          {errorMessage('budget')}
        </label>
        <label className="text-sm font-semibold text-slate-700">
          {t('construction.fields.startDate')}
          <input type="date" className={INPUT_CLASS} value={fields.start_date} onChange={(e) => setField('start_date', e.target.value)} />
          {errorMessage('start_date')}
        </label>
        <label className="text-sm font-semibold text-slate-700">
          {t('construction.fields.endDate')}
          <input type="date" className={INPUT_CLASS} value={fields.end_date} onChange={(e) => setField('end_date', e.target.value)} />
          {errorMessage('end_date')}
        </label>
      </div>
      <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4">
        <button type="button" onClick={onCancel} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          {t('common.cancel')}
        </button>
        <button type="submit" disabled={saving} className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-brand-700 disabled:cursor-wait disabled:opacity-60">
          {saving ? t('construction.saving') : project ? t('construction.saveChanges') : t('construction.createProject')}
        </button>
      </div>
    </form>
  );
}
