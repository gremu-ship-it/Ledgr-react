import { useState, type FormEvent } from 'react';
import { validateProject } from '@/lib/construction/projectValidation';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { repos } from '@/lib/repositories';
import type {
  Project,
  ProjectInput,
} from '@/dal/repositories/ProjectRepository';
import { ErrorBanner, Field, FIELD_CLASS } from '../constructionUi';

export const PROJECT_BUTTON =
  'rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50';
export function ProjectForm({
  businessId,
  project,
  onSaved,
  onCancel,
}: {
  businessId: string;
  project?: Project;
  onSaved: (project: Project) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const k = 'construction.projects';
  const [form, setForm] = useState({
    name: project?.name ?? '',
    client_name: project?.client_name ?? '',
    contract_sum: String(project?.contract_sum ?? ''),
    retention_pct: String(project?.retention_pct ?? 10),
    budget: String(project?.budget ?? ''),
    start_date: project?.start_date ?? '',
    end_date: project?.end_date ?? '',
  });
  const [validation, setValidation] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (input: ProjectInput) =>
      project
        ? repos.projects.update(project.id, input)
        : repos.projects.create(businessId, input),
    onSuccess: onSaved,
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const input: ProjectInput = {
      ...form,
      contract_sum: form.contract_sum.trim() ? Number(form.contract_sum) : NaN,
      retention_pct: form.retention_pct.trim()
        ? Number(form.retention_pct)
        : NaN,
      budget: Number(form.budget || 0),
      start_date: form.start_date || null,
      end_date: form.end_date || null,
    };
    const error = validateProject(input);
    setValidation(error);
    if (!error) mutation.mutate(input);
  };
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-form-title"
    >
      <form
        onSubmit={submit}
        className="my-auto w-full max-w-xl space-y-4 rounded-2xl bg-white p-6 shadow-xl"
      >
        <h2 id="project-form-title" className="text-lg font-semibold">
          {t(`${k}.${project ? 'edit' : 'new'}`)}
        </h2>
        {validation && (
          <ErrorBanner message={t(`${k}.validation.${validation}`)} />
        )}
        {mutation.isError && <ErrorBanner message={mutation.error.message} />}
        <div className="grid gap-4 sm:grid-cols-2">
          {(Object.keys(form) as Array<keyof typeof form>).map((key) => {
            const amount = ['contract_sum', 'retention_pct', 'budget'].includes(
              key,
            );
            return (
              <Field
                key={key}
                label={t(`${k}.fields.${key}`)}
                required={['name', 'client_name', 'contract_sum'].includes(key)}
              >
                <input
                  autoFocus={key === 'name'}
                  aria-label={t(`${k}.fields.${key}`)}
                  className={FIELD_CLASS}
                  type={
                    amount ? 'number' : key.endsWith('_date') ? 'date' : 'text'
                  }
                  required={[
                    'name',
                    'client_name',
                    'contract_sum',
                    'retention_pct',
                  ].includes(key)}
                  min={
                    amount
                      ? 0
                      : key === 'end_date'
                        ? form.start_date || undefined
                        : undefined
                  }
                  max={key === 'retention_pct' ? 100 : undefined}
                  step={amount ? '0.01' : undefined}
                  value={form[key]}
                  disabled={mutation.isPending}
                  onChange={(event) =>
                    setForm((previous) => ({
                      ...previous,
                      [key]: event.target.value,
                    }))
                  }
                />
              </Field>
            );
          })}
        </div>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={mutation.isPending}
          >
            {t(`${k}.cancel`)}
          </button>
          <button className={PROJECT_BUTTON} disabled={mutation.isPending}>
            {t(`${k}.save`)}
          </button>
        </div>
      </form>
    </div>
  );
}
