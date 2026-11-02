import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router';
import { CalendarDays, ChevronDown, ChevronRight, ListTree, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type {
  ConstructionScheduleTaskRow,
  ConstructionScheduleTaskStatus,
  ConstructionScheduleTaskTreeNode,
  ConstructionTaskDependencyRow,
  ConstructionTaskDependencyType,
  CreateConstructionScheduleTaskInput,
  UpdateConstructionScheduleTaskInput,
} from '@/dal/repositories/ConstructionScheduleRepository';
import type { BoqSectionWithItems, Project } from '@/dal/repositories/ProjectRepository';
import type { ConstructionProcurementSite } from '@/dal/repositories/ConstructionProcurementRepository';
import type { SubcontractSummary } from '@/dal/types/subcontracts';
import { subcontractRepository } from '@/dal/repositories/SubcontractRepository';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';

const K = 'scheduling';
const TASK_STATUSES: ConstructionScheduleTaskStatus[] = ['not_started', 'in_progress', 'completed', 'on_hold', 'cancelled'];
const DEPENDENCY_TYPES: ConstructionTaskDependencyType[] = ['FS', 'SS', 'FF', 'SF'];

interface FlatTask {
  task: ConstructionScheduleTaskRow;
  depth: number;
}

interface ScheduleReferences {
  sites: ConstructionProcurementSite[];
  subcontracts: SubcontractSummary[];
  boqSections: Array<{ id: string; code: string; title: string }>;
}

interface TaskFormValues {
  wbs_code: string;
  task_name: string;
  description: string;
  parent_task_id: string;
  status: ConstructionScheduleTaskStatus;
  planned_start: string;
  planned_finish: string;
  actual_start: string;
  actual_finish: string;
  progress_percent: number;
  site_id: string;
  boq_section_id: string;
  subcontract_id: string;
}

interface DependencyFormValues {
  predecessor_id: string;
  successor_id: string;
  dependency_type: ConstructionTaskDependencyType;
  lag_days: number;
}

function flattenTree(nodes: ConstructionScheduleTaskTreeNode[], depth = 0): FlatTask[] {
  return nodes.flatMap((node) => [
    { task: node, depth },
    ...flattenTree(node.children, depth + 1),
  ]);
}

function emptyTaskForm(parentTaskId = ''): TaskFormValues {
  return {
    wbs_code: '', task_name: '', description: '', parent_task_id: parentTaskId,
    status: 'not_started', planned_start: '', planned_finish: '', actual_start: '', actual_finish: '', progress_percent: 0,
    site_id: '', boq_section_id: '', subcontract_id: '',
  };
}

function flattenSections(sections: BoqSectionWithItems[]): ScheduleReferences['boqSections'] {
  return sections.flatMap((section) => [
    { id: section.id, code: section.code, title: section.title },
    ...flattenSections(section.children),
  ]);
}

async function loadScheduleReferences(businessId: string, projectId: string): Promise<ScheduleReferences> {
  const [sites, subcontracts, versions] = await Promise.all([
    repos.construction.findSitesForProject(businessId, projectId),
    subcontractRepository.listSubcontracts(businessId, projectId),
    repos.projects.listBoqVersions(businessId, projectId),
  ]);
  const version = versions.find((item) => item.status === 'active') ?? versions[0];
  const boq = version ? await repos.projects.getBoqVersion(businessId, version.id) : null;
  return { sites, subcontracts, boqSections: boq ? flattenSections(boq.sections) : [] };
}

function toTaskForm(task: ConstructionScheduleTaskRow): TaskFormValues {
  return {
    wbs_code: task.wbs_code,
    task_name: task.task_name,
    description: task.description ?? '',
    parent_task_id: task.parent_task_id ?? '',
    status: task.status,
    planned_start: task.planned_start ?? '',
    planned_finish: task.planned_finish ?? '',
    actual_start: task.actual_start ?? '',
    actual_finish: task.actual_finish ?? '',
    progress_percent: task.progress_percent,
    site_id: task.site_id ?? '',
    boq_section_id: task.boq_section_id ?? '',
    subcontract_id: task.subcontract_id ?? '',
  };
}

function taskStatusKey(status: ConstructionScheduleTaskStatus): string {
  return `${K}.status${status.split('_').map((word) => word[0].toUpperCase() + word.slice(1)).join('')}`;
}

function statusClasses(status: ConstructionScheduleTaskStatus): string {
  const classes: Record<ConstructionScheduleTaskStatus, string> = {
    not_started: 'bg-gray-100 text-gray-700',
    in_progress: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    on_hold: 'bg-amber-100 text-amber-800',
    cancelled: 'bg-red-100 text-red-800',
  };
  return classes[status];
}

function progressClasses(status: ConstructionScheduleTaskStatus, progress: number): string {
  if (progress === 100) return 'bg-green-500';
  if (status === 'in_progress' || progress > 0) return 'bg-blue-500';
  return 'bg-gray-400';
}

function asNullable(value: string): string | null {
  return value.trim() ? value : null;
}

function TaskModal({
  task,
  parentTaskId,
  tasks,
  references,
  loading,
  error,
  referencesError,
  onClose,
  onSave,
}: {
  task: ConstructionScheduleTaskRow | null;
  parentTaskId: string;
  tasks: FlatTask[];
  references: ScheduleReferences | undefined;
  loading: boolean;
  error: string | null;
  referencesError: string | null;
  onClose: () => void;
  onSave: (values: TaskFormValues) => void;
}) {
  const { t } = useTranslation();
  const blockedParentIds = useMemo(() => {
    const blocked = new Set<string>();
    if (!task) return blocked;
    blocked.add(task.id);
    let changed = true;
    while (changed) {
      changed = false;
      for (const { task: candidate } of tasks) {
        if (candidate.parent_task_id && blocked.has(candidate.parent_task_id) && !blocked.has(candidate.id)) {
          blocked.add(candidate.id);
          changed = true;
        }
      }
    }
    return blocked;
  }, [task, tasks]);
  const [values, setValues] = useState<TaskFormValues>(() => task ? toTaskForm(task) : emptyTaskForm(parentTaskId));
  const update = <KField extends keyof TaskFormValues>(key: KField, value: TaskFormValues[KField]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(values);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="schedule-task-title" className="my-8 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 id="schedule-task-title" className="text-xl font-semibold text-gray-900">{t(task ? `${K}.editTask` : `${K}.addTask`)}</h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="rounded-lg px-3 py-1 text-gray-500 hover:bg-gray-100">×</button>
        </div>
        <form onSubmit={submit} className="space-y-5">
          {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
          {referencesError ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{referencesError}</p> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-gray-700">{t(`${K}.wbsCode`)}<span aria-hidden="true"> *</span>
              <input required value={values.wbs_code} onChange={(event) => update('wbs_code', event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" />
            </label>
            <label className="block text-sm font-medium text-gray-700">{t(`${K}.taskName`)}<span aria-hidden="true"> *</span>
              <input required value={values.task_name} onChange={(event) => update('task_name', event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" />
            </label>
            <label className="block text-sm font-medium text-gray-700 sm:col-span-2">{t(`${K}.description`)}
              <textarea rows={3} value={values.description} onChange={(event) => update('description', event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" />
            </label>
            <label className="block text-sm font-medium text-gray-700">{t(`${K}.parentTask`)}
              <select value={values.parent_task_id} onChange={(event) => update('parent_task_id', event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900">
                <option value="">{t(`${K}.noParent`)}</option>
                {tasks.filter(({ task: option }) => !blockedParentIds.has(option.id)).map(({ task: option, depth }) => (
                  <option key={option.id} value={option.id}>{'　'.repeat(depth)}{option.wbs_code} — {option.task_name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium text-gray-700">{t(`${K}.status`)}
              <select value={values.status} onChange={(event) => update('status', event.target.value as ConstructionScheduleTaskStatus)} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900">
                {TASK_STATUSES.map((status) => <option key={status} value={status}>{t(taskStatusKey(status))}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-gray-700">{t(`${K}.plannedStart`)}
              <input type="date" value={values.planned_start} onChange={(event) => update('planned_start', event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" />
            </label>
            <label className="block text-sm font-medium text-gray-700">{t(`${K}.plannedFinish`)}
              <input type="date" value={values.planned_finish} onChange={(event) => update('planned_finish', event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" />
            </label>
            <label className="block text-sm font-medium text-gray-700">{t(`${K}.actualStart`)}
              <input type="date" value={values.actual_start} onChange={(event) => update('actual_start', event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" />
            </label>
            <label className="block text-sm font-medium text-gray-700">{t(`${K}.actualFinish`)}
              <input type="date" value={values.actual_finish} onChange={(event) => update('actual_finish', event.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-gray-900" />
            </label>
            <label className="block text-sm font-medium text-gray-700 sm:col-span-2">{t(`${K}.progress`)}: {values.progress_percent}%
              <input type="range" min="0" max="100" step="1" value={values.progress_percent} onChange={(event) => update('progress_percent', Number(event.target.value))} aria-label={t(`${K}.progress`)} className="mt-2 block w-full accent-blue-600" />
            </label>
            <label className="block text-sm font-medium text-gray-700">{t(`${K}.site`)}
              <select value={values.site_id} onChange={(event) => update('site_id', event.target.value)} disabled={loading} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900">
                <option value="">{t(`${K}.optional`)}</option>
                {(references?.sites ?? []).map((site) => <option key={site.id} value={site.id}>{site.site_code} — {site.site_name}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-gray-700">{t(`${K}.boqSection`)}
              <select value={values.boq_section_id} onChange={(event) => update('boq_section_id', event.target.value)} disabled={loading} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900">
                <option value="">{t(`${K}.optional`)}</option>
                {(references?.boqSections ?? []).map((section) => <option key={section.id} value={section.id}>{section.code} — {section.title}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-gray-700 sm:col-span-2">{t(`${K}.subcontract`)}
              <select value={values.subcontract_id} onChange={(event) => update('subcontract_id', event.target.value)} disabled={loading} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-gray-900">
                <option value="">{t(`${K}.optional`)}</option>
                {(references?.subcontracts ?? []).map((subcontract) => <option key={subcontract.id} value={subcontract.id}>{subcontract.reference} — {subcontract.title}</option>)}
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" isLoading={loading}>{t(`${K}.saveTask`)}</Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function DependencyPanel({
  task,
  tasks,
  dependencies,
  loading,
  busy,
  error,
  onAdd,
  onDelete,
  onClose,
}: {
  task: ConstructionScheduleTaskRow;
  tasks: FlatTask[];
  dependencies: ConstructionTaskDependencyRow[];
  loading: boolean;
  busy: boolean;
  error: string | null;
  onAdd: (values: DependencyFormValues) => void;
  onDelete: (dependencyId: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [values, setValues] = useState<DependencyFormValues>({
    predecessor_id: task.id, successor_id: '', dependency_type: 'FS', lag_days: 0,
  });
  const taskNames = useMemo(() => new Map(tasks.map(({ task: item }) => [item.id, `${item.wbs_code} — ${item.task_name}`])), [tasks]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onAdd(values);
  };

  return (
    <section aria-labelledby="schedule-dependencies-title" className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 id="schedule-dependencies-title" className="font-semibold text-gray-900">{t(`${K}.dependencies`)}</h2>
          <p className="text-sm text-gray-500">{task.wbs_code} — {task.task_name}</p>
        </div>
        <button type="button" aria-label={t(`${K}.closeDependencies`)} className="rounded-lg px-3 py-1 text-gray-500 hover:bg-gray-100" onClick={onClose}>×</button>
      </div>
      {error ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {loading ? <p className="text-sm text-gray-500">{t(`${K}.loadingDependencies`)}</p> : null}
      {!loading && dependencies.length === 0 ? <p className="text-sm text-gray-500">{t(`${K}.noDependencies`)}</p> : null}
      {dependencies.length > 0 ? (
        <ul className="divide-y divide-gray-100">
          {dependencies.map((dependency) => (
            <li key={dependency.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
              <span className="text-gray-700">{taskNames.get(dependency.predecessor_id) ?? dependency.predecessor_id} → {taskNames.get(dependency.successor_id) ?? dependency.successor_id} · {t(`${K}.type${dependency.dependency_type}`)} · {t(`${K}.lagDaysValue`, { days: dependency.lag_days })}</span>
              <button type="button" disabled={busy} onClick={() => onDelete(dependency.id)} className="inline-flex items-center gap-1 text-red-700 hover:text-red-900 disabled:opacity-50"><Trash2 className="h-4 w-4" aria-hidden="true" />{t(`${K}.deleteDependency`)}</button>
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={submit} className="grid gap-3 border-t border-gray-100 pt-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="text-xs font-medium text-gray-600 sm:col-span-1">{t(`${K}.predecessor`)}
          <select required value={values.predecessor_id} onChange={(event) => setValues((current) => ({ ...current, predecessor_id: event.target.value }))} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900">
            <option value="">{t(`${K}.chooseTask`)}</option>
            {tasks.map(({ task: item }) => <option key={item.id} value={item.id}>{item.wbs_code} — {item.task_name}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600 sm:col-span-1">{t(`${K}.successor`)}
          <select required value={values.successor_id} onChange={(event) => setValues((current) => ({ ...current, successor_id: event.target.value }))} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900">
            <option value="">{t(`${K}.chooseTask`)}</option>
            {tasks.map(({ task: item }) => <option key={item.id} value={item.id}>{item.wbs_code} — {item.task_name}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">{t(`${K}.dependencyType`)}
          <select value={values.dependency_type} onChange={(event) => setValues((current) => ({ ...current, dependency_type: event.target.value as ConstructionTaskDependencyType }))} className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-2 py-2 text-sm text-gray-900">
            {DEPENDENCY_TYPES.map((type) => <option key={type} value={type}>{t(`${K}.type${type}`)}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-gray-600">{t(`${K}.lagDays`)}
          <input type="number" min="-3650" max="3650" value={values.lag_days} onChange={(event) => setValues((current) => ({ ...current, lag_days: Number(event.target.value) }))} className="mt-1 block w-full rounded-lg border border-gray-300 px-2 py-2 text-sm text-gray-900" />
        </label>
        <Button type="submit" size="sm" isLoading={busy} disabled={!values.predecessor_id || !values.successor_id || values.predecessor_id === values.successor_id} className="self-end"><Plus className="h-4 w-4" aria-hidden="true" />{t(`${K}.addDependency`)}</Button>
      </form>
    </section>
  );
}

export function SchedulePage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { projectId: routeProjectId } = useParams();
  const queryClient = useQueryClient();
  const businessId = useAppStore((state) => state.currentBusiness?.business?.id ?? null);
  const [localProjectId, setLocalProjectId] = useState('');
  const [editingTask, setEditingTask] = useState<ConstructionScheduleTaskRow | null>(null);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [creatingSubtaskOf, setCreatingSubtaskOf] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [dependencyTask, setDependencyTask] = useState<ConstructionScheduleTaskRow | null>(null);
  const [dependencyError, setDependencyError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const selectedProjectId = routeProjectId ?? localProjectId;
  const projectQuery = useQuery({
    queryKey: ['construction', 'schedule-projects', businessId],
    queryFn: () => loadProjects(businessId as string),
    enabled: Boolean(businessId),
  });
  const projects = projectQuery.data ?? [];
  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const taskQuery = useQuery({
    queryKey: ['construction', 'schedule-tasks', businessId, selectedProjectId],
    queryFn: () => repos.schedule.getTaskTree(businessId as string, selectedProjectId),
    enabled: Boolean(businessId && selectedProjectId),
  });
  const summaryQuery = useQuery({
    queryKey: ['construction', 'schedule-summary', businessId, selectedProjectId],
    queryFn: () => repos.schedule.getProjectScheduleSummary(businessId as string, selectedProjectId),
    enabled: Boolean(businessId && selectedProjectId),
  });
  const referencesQuery = useQuery({
    queryKey: ['construction', 'schedule-references', businessId, selectedProjectId],
    queryFn: () => loadScheduleReferences(businessId as string, selectedProjectId),
    enabled: Boolean(businessId && selectedProjectId),
  });
  const flatTasks = useMemo(() => flattenTree(taskQuery.data ?? []), [taskQuery.data]);
  const dependencyQuery = useQuery({
    queryKey: ['construction', 'schedule-dependencies', businessId, dependencyTask?.id],
    queryFn: () => repos.schedule.listDependencies(businessId as string, dependencyTask!.id),
    enabled: Boolean(businessId && dependencyTask),
  });
  const invalidateSchedule = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['construction', 'schedule-tasks', businessId, selectedProjectId] }),
      queryClient.invalidateQueries({ queryKey: ['construction', 'schedule-summary', businessId, selectedProjectId] }),
      queryClient.invalidateQueries({ queryKey: ['construction', 'schedule-dependencies', businessId] }),
    ]);
  };
  const saveTaskMutation = useMutation({
    mutationFn: async (values: TaskFormValues) => {
      if (!businessId || !selectedProjectId) throw new Error(t(`${K}.errors.noBusiness`));
      const fields: Omit<UpdateConstructionScheduleTaskInput, 'project_id' | 'wbs_code' | 'task_name'>
        & Pick<CreateConstructionScheduleTaskInput, 'wbs_code' | 'task_name'> = {
        wbs_code: values.wbs_code.trim(),
        task_name: values.task_name.trim(),
        site_id: asNullable(values.site_id),
        parent_task_id: asNullable(values.parent_task_id),
        description: asNullable(values.description), status: values.status,
        planned_start: asNullable(values.planned_start), planned_finish: asNullable(values.planned_finish),
        actual_start: asNullable(values.actual_start), actual_finish: asNullable(values.actual_finish),
        boq_section_id: asNullable(values.boq_section_id),
        subcontract_id: asNullable(values.subcontract_id), sort_order: editingTask?.sort_order ?? flatTasks.length,
      };
      let saved: ConstructionScheduleTaskRow;
      if (editingTask) {
        saved = await repos.schedule.update(businessId, editingTask.id, fields);
        if (values.progress_percent !== editingTask.progress_percent) {
          await repos.schedule.updateProgress(editingTask.id, values.progress_percent);
        }
      } else {
        const input: CreateConstructionScheduleTaskInput = {
          ...fields, project_id: selectedProjectId, progress_percent: 0,
        };
        saved = await repos.schedule.create(businessId, input);
        if (values.progress_percent !== 0) await repos.schedule.updateProgress(saved.id, values.progress_percent);
      }
      return saved;
    },
    onSuccess: async () => {
      await invalidateSchedule();
      setEditingTask(null);
      setTaskModalOpen(false);
      setCreatingSubtaskOf('');
      setFormError(null);
    },
    onError: () => setFormError(t(`${K}.errors.saveTask`)),
  });
  const deleteTaskMutation = useMutation({
    mutationFn: async (taskId: string) => {
      if (!businessId) return;
      await repos.schedule.delete(businessId, taskId);
    },
    onSuccess: async (_result, taskId) => {
      await invalidateSchedule();
      if (dependencyTask?.id === taskId) setDependencyTask(null);
      setMutationError(null);
    },
    onError: () => setMutationError(t(`${K}.errors.deleteTask`)),
  });
  const addDependencyMutation = useMutation({
    mutationFn: async (values: DependencyFormValues) => {
      if (!businessId) return;
      await repos.schedule.createDependency(businessId, values);
    },
    onSuccess: async () => {
      await invalidateSchedule();
      setDependencyError(null);
    },
    onError: () => setDependencyError(t(`${K}.errors.addDependency`)),
  });
  const deleteDependencyMutation = useMutation({
    mutationFn: async (dependencyId: string) => {
      if (!businessId) return;
      await repos.schedule.deleteDependency(businessId, dependencyId);
    },
    onSuccess: invalidateSchedule,
    onError: () => setDependencyError(t(`${K}.errors.deleteDependency`)),
  });

  const openNewTask = (parentTaskId = '') => {
    setEditingTask(null);
    setTaskModalOpen(true);
    setCreatingSubtaskOf(parentTaskId);
    setFormError(null);
  };
  const startSave = (values: TaskFormValues) => saveTaskMutation.mutate(values);
  const openTask = (task: ConstructionScheduleTaskRow) => {
    setEditingTask(task);
    setTaskModalOpen(true);
    setCreatingSubtaskOf('');
    setFormError(null);
  };
  const onProjectChange = (nextProjectId: string) => {
    setDependencyTask(null);
    setEditingTask(null);
    setTaskModalOpen(false);
    setCreatingSubtaskOf('');
    setFormError(null);
    setLocalProjectId(nextProjectId);
    navigate(nextProjectId ? `/construction/schedule/${nextProjectId}` : '/construction/schedule');
  };
  const handleDeleteTask = (task: ConstructionScheduleTaskRow) => {
    if (window.confirm(t(`${K}.confirmDelete`))) deleteTaskMutation.mutate(task.id);
  };
  const displayDate = (value: string | null) => value
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`))
    : '—';
  const summary = summaryQuery.data ?? { total_tasks: 0, completed: 0, in_progress: 0, not_started: 0, on_hold: 0 };
  return (
    <main className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-brand-700"><CalendarDays className="h-5 w-5" aria-hidden="true" /><span className="text-xs font-semibold uppercase tracking-wide">{t(`${K}.eyebrow`)}</span></div>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">{t(`${K}.title`)}</h1>
        </div>
        <Button type="button" disabled={!selectedProject || saveTaskMutation.isPending || deleteTaskMutation.isPending} onClick={() => openNewTask()}><Plus className="h-4 w-4" aria-hidden="true" />{t(`${K}.addTask`)}</Button>
      </header>

      {projectQuery.isError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.loadProjects`)}</p> : null}
      <section className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <label className="block min-w-64 flex-1 text-sm font-medium text-gray-700">{t(`${K}.selectProject`)}
          <span className="relative mt-1 block">
            <select value={selectedProjectId} onChange={(event) => onProjectChange(event.target.value)} disabled={projectQuery.isLoading || saveTaskMutation.isPending || deleteTaskMutation.isPending} className="block w-full appearance-none rounded-lg border border-gray-300 bg-white py-2.5 ps-3 pe-10 text-gray-900">
              <option value="">{t(`${K}.selectProjectPlaceholder`)}</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          </span>
        </label>
        {selectedProject ? <p className="pb-2 text-sm text-gray-500">{selectedProject.name}</p> : null}
      </section>

      {selectedProjectId ? (
        <>
          <section aria-label={t(`${K}.summaryLabel`)} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {([
              ['summaryTotal', summary.total_tasks, 'text-gray-900'],
              ['summaryCompleted', summary.completed, 'text-green-700'],
              ['summaryInProgress', summary.in_progress, 'text-blue-700'],
              ['summaryNotStarted', summary.not_started, 'text-gray-600'],
              ['summaryOnHold', summary.on_hold, 'text-amber-700'],
            ] as const).map(([label, value, color]) => (
              <div key={label} className="rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                <p className="text-xs font-medium text-gray-500">{t(`${K}.${label}`)}</p>
                <p className={`mt-1 text-2xl font-semibold ${color}`}>{new Intl.NumberFormat(i18n.language).format(value)}</p>
              </div>
            ))}
          </section>

          {taskQuery.isError || summaryQuery.isError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{t(`${K}.errors.loadTasks`)}</p> : null}
          {mutationError ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{mutationError}</p> : null}
          {taskQuery.isLoading ? <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">{t(`${K}.loadingTasks`)}</div> : null}
          {!taskQuery.isLoading && !taskQuery.isError && flatTasks.length === 0 ? <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-600">{t(`${K}.empty`)}</div> : null}
          {!taskQuery.isLoading && flatTasks.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="min-w-[1250px] w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <tr>
                    <th scope="col" className="px-3 py-3">{t(`${K}.wbsCode`)}</th>
                    <th scope="col" className="min-w-64 px-3 py-3">{t(`${K}.taskName`)}</th>
                    <th scope="col" className="px-3 py-3">{t(`${K}.status`)}</th>
                    <th scope="col" className="px-3 py-3">{t(`${K}.plannedStart`)}</th>
                    <th scope="col" className="px-3 py-3">{t(`${K}.plannedFinish`)}</th>
                    <th scope="col" className="px-3 py-3">{t(`${K}.actualStart`)}</th>
                    <th scope="col" className="px-3 py-3">{t(`${K}.actualFinish`)}</th>
                    <th scope="col" className="min-w-40 px-3 py-3">{t(`${K}.progress`)}</th>
                    <th scope="col" className="px-3 py-3">{t(`${K}.actions`)}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {flatTasks.map(({ task, depth }) => (
                    <tr key={task.id} className={dependencyTask?.id === task.id ? 'bg-brand-50/60' : ''}>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs text-gray-600">{task.wbs_code}</td>
                      <td className="px-3 py-3">
                        <button type="button" onClick={() => openTask(task)} className={`flex items-center gap-1 border-s-2 border-gray-200 ps-2 text-start text-gray-900 hover:text-brand-700 ${depth === 0 || flatTasks.some(({ task: child }) => child.parent_task_id === task.id) ? 'font-semibold' : 'font-normal'}`} style={{ marginInlineStart: `${depth * 1.25}rem` }}>
                          {flatTasks.some(({ task: child }) => child.parent_task_id === task.id) ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" /> : null}
                          <span>{task.task_name}</span>
                        </button>
                      </td>
                      <td className="px-3 py-3"><span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${statusClasses(task.status)}`}>{t(taskStatusKey(task.status))}</span></td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">{displayDate(task.planned_start)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">{displayDate(task.planned_finish)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">{displayDate(task.actual_start)}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-gray-600">{displayDate(task.actual_finish)}</td>
                      <td className="px-3 py-3">
                        <div className="flex min-w-32 items-center gap-2">
                          <div role="progressbar" aria-label={t(`${K}.progressForTask`, { task: task.task_name })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress_percent} className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                            <div className={`h-full rounded-full transition-[width] ${progressClasses(task.status, task.progress_percent)}`} style={{ width: `${task.progress_percent}%` }} />
                          </div>
                          <span className="w-9 text-right text-xs tabular-nums text-gray-600">{task.progress_percent}%</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => openTask(task)} aria-label={t(`${K}.editTaskNamed`, { task: task.task_name })} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"><Pencil className="h-4 w-4" aria-hidden="true" /></button>
                          <button type="button" onClick={() => openNewTask(task.id)} aria-label={t(`${K}.addSubtaskNamed`, { task: task.task_name })} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"><Plus className="h-4 w-4" aria-hidden="true" /></button>
                          <button type="button" onClick={() => { setDependencyTask(task); setDependencyError(null); }} aria-label={t(`${K}.viewDependenciesNamed`, { task: task.task_name })} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"><ListTree className="h-4 w-4" aria-hidden="true" /></button>
                          <button type="button" onClick={() => handleDeleteTask(task)} aria-label={t(`${K}.deleteTaskNamed`, { task: task.task_name })} className="rounded-lg p-2 text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {dependencyTask ? (
            <DependencyPanel
              key={dependencyTask.id}
              task={dependencyTask}
              tasks={flatTasks}
              dependencies={dependencyQuery.data ?? []}
              loading={dependencyQuery.isLoading}
              busy={addDependencyMutation.isPending || deleteDependencyMutation.isPending}
              error={dependencyError}
              onAdd={(values) => addDependencyMutation.mutate(values)}
              onDelete={(dependencyId) => deleteDependencyMutation.mutate(dependencyId)}
              onClose={() => setDependencyTask(null)}
            />
          ) : null}
        </>
      ) : !projectQuery.isLoading ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center text-gray-600">
          <CalendarDays className="mx-auto mb-3 h-8 w-8 text-gray-400" aria-hidden="true" />
          <p>{projects.length === 0 ? t(`${K}.noProjects`) : t(`${K}.noProject`)}</p>
        </div>
      ) : null}

      {taskModalOpen ? (
        <TaskModal
          key={editingTask?.id ?? `new-${creatingSubtaskOf}`}
          task={editingTask}
          parentTaskId={creatingSubtaskOf}
          tasks={flatTasks}
          references={referencesQuery.data}
          loading={saveTaskMutation.isPending || referencesQuery.isLoading}
          error={formError}
          referencesError={referencesQuery.isError ? t(`${K}.errors.loadReferences`) : null}
          onClose={() => { setEditingTask(null); setTaskModalOpen(false); setCreatingSubtaskOf(''); setFormError(null); }}
          onSave={startSave}
        />
      ) : null}
    </main>
  );
}

async function loadProjects(businessId: string): Promise<Project[]> {
  const result: Project[] = [];
  for (let page = 0; page < 100; page += 1) {
    const next = await repos.projects.list(businessId, { page });
    result.push(...next.rows);
    if (result.length >= next.count || next.rows.length === 0) break;
  }
  return result;
}

