import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';
import { NotFoundError, UnauthorizedError, ValidationError, toRepositoryError } from '../errors/RepositoryError';

type Tables = Database['public']['Tables'];

export type ConstructionScheduleTaskStatus = 'not_started' | 'in_progress' | 'completed' | 'on_hold' | 'cancelled';
export type ConstructionTaskDependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export type ConstructionScheduleTaskRow = Omit<Tables['construction_schedule_tasks']['Row'], 'status'> & {
  status: ConstructionScheduleTaskStatus;
};
export type ConstructionTaskDependencyRow = Omit<Tables['construction_task_dependencies']['Row'], 'dependency_type'> & {
  dependency_type: ConstructionTaskDependencyType;
};

export interface CreateConstructionScheduleTaskInput {
  project_id: string;
  site_id?: string | null;
  parent_task_id?: string | null;
  wbs_code: string;
  task_name: string;
  description?: string | null;
  status?: ConstructionScheduleTaskStatus;
  planned_start?: string | null;
  planned_finish?: string | null;
  actual_start?: string | null;
  actual_finish?: string | null;
  progress_percent?: number;
  boq_section_id?: string | null;
  subcontract_id?: string | null;
  sort_order?: number;
}

export interface UpdateConstructionScheduleTaskInput {
  project_id?: string;
  site_id?: string | null;
  parent_task_id?: string | null;
  wbs_code?: string;
  task_name?: string;
  description?: string | null;
  status?: ConstructionScheduleTaskStatus;
  planned_start?: string | null;
  planned_finish?: string | null;
  actual_start?: string | null;
  actual_finish?: string | null;
  boq_section_id?: string | null;
  subcontract_id?: string | null;
  sort_order?: number;
}

export interface CreateConstructionTaskDependencyInput {
  predecessor_id: string;
  successor_id: string;
  dependency_type?: ConstructionTaskDependencyType;
  lag_days?: number;
}

export interface ConstructionScheduleTaskTreeNode extends ConstructionScheduleTaskRow {
  children: ConstructionScheduleTaskTreeNode[];
}

export interface ConstructionScheduleSummary {
  total_tasks: number;
  completed: number;
  in_progress: number;
  not_started: number;
  on_hold: number;
}

const TASK_RESOURCE = 'construction_schedule_tasks';
const DEPENDENCY_RESOURCE = 'construction_task_dependencies';

/** Tenant-scoped persistence for project WBS tasks and their dependencies. */
export class ConstructionScheduleRepository {
  private readonly client: SupabaseClient<Database>;

  constructor(client: SupabaseClient<Database>) {
    this.client = client;
  }

  async listByProject(businessId: string, projectId: string): Promise<ConstructionScheduleTaskRow[]> {
    const { data, error } = await this.client.from('construction_schedule_tasks')
      .select('*')
      .eq('business_id', businessId)
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true })
      .order('wbs_code', { ascending: true });
    if (error) throw toRepositoryError(TASK_RESOURCE, error);
    return (data ?? []) as ConstructionScheduleTaskRow[];
  }

  async getById(businessId: string, taskId: string): Promise<ConstructionScheduleTaskRow> {
    const { data, error } = await this.client.from('construction_schedule_tasks')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', taskId)
      .maybeSingle();
    if (error) throw toRepositoryError(TASK_RESOURCE, error);
    if (!data) throw new NotFoundError(TASK_RESOURCE, taskId);
    return data as ConstructionScheduleTaskRow;
  }

  async create(businessId: string, input: CreateConstructionScheduleTaskInput): Promise<ConstructionScheduleTaskRow> {
    const createdBy = await this.requireActor(TASK_RESOURCE);
    const { data, error } = await this.client.from('construction_schedule_tasks')
      .insert({ ...input, business_id: businessId, created_by: createdBy })
      .select('*')
      .single();
    if (error) throw toRepositoryError(TASK_RESOURCE, error);
    return data as ConstructionScheduleTaskRow;
  }

  async update(
    businessId: string,
    taskId: string,
    changes: UpdateConstructionScheduleTaskInput,
  ): Promise<ConstructionScheduleTaskRow> {
    const { data, error } = await this.client.from('construction_schedule_tasks')
      .update({ ...changes, updated_at: new Date().toISOString() })
      .eq('business_id', businessId)
      .eq('id', taskId)
      .select('*')
      .maybeSingle();
    if (error) throw toRepositoryError(TASK_RESOURCE, error);
    if (!data) throw new NotFoundError(TASK_RESOURCE, taskId);
    return data as ConstructionScheduleTaskRow;
  }

  async delete(businessId: string, taskId: string): Promise<boolean> {
    const { data, error } = await this.client.from('construction_schedule_tasks')
      .delete()
      .eq('business_id', businessId)
      .eq('id', taskId)
      .select('id')
      .maybeSingle();
    if (error) throw toRepositoryError(TASK_RESOURCE, error);
    return data !== null;
  }

  async updateProgress(taskId: string, progress: number): Promise<void> {
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
      throw new ValidationError(TASK_RESOURCE, 'construction-scheduling-invalid-progress', undefined, { includeResource: false });
    }
    const { error } = await this.client.rpc('update_task_progress', {
      p_task_id: taskId,
      p_progress: progress,
    });
    if (error) throw toRepositoryError(TASK_RESOURCE, error);
  }

  async listDependencies(businessId: string, taskId: string): Promise<ConstructionTaskDependencyRow[]> {
    const { data, error } = await this.client.from('construction_task_dependencies')
      .select('*')
      .eq('business_id', businessId)
      .or(`predecessor_id.eq.${taskId},successor_id.eq.${taskId}`)
      .order('created_at', { ascending: true });
    if (error) throw toRepositoryError(DEPENDENCY_RESOURCE, error);
    return (data ?? []) as ConstructionTaskDependencyRow[];
  }

  async createDependency(
    businessId: string,
    input: CreateConstructionTaskDependencyInput,
  ): Promise<ConstructionTaskDependencyRow> {
    const { data, error } = await this.client.from('construction_task_dependencies')
      .insert({ ...input, business_id: businessId })
      .select('*')
      .single();
    if (error) throw toRepositoryError(DEPENDENCY_RESOURCE, error);
    return data as ConstructionTaskDependencyRow;
  }

  async deleteDependency(businessId: string, dependencyId: string): Promise<boolean> {
    const { data, error } = await this.client.from('construction_task_dependencies')
      .delete()
      .eq('business_id', businessId)
      .eq('id', dependencyId)
      .select('id')
      .maybeSingle();
    if (error) throw toRepositoryError(DEPENDENCY_RESOURCE, error);
    return data !== null;
  }

  async getTaskTree(businessId: string, projectId: string): Promise<ConstructionScheduleTaskTreeNode[]> {
    const tasks = await this.listByProject(businessId, projectId);
    const nodes = new Map<string, ConstructionScheduleTaskTreeNode>(
      tasks.map((task) => [task.id, { ...task, children: [] }]),
    );
    const roots: ConstructionScheduleTaskTreeNode[] = [];

    for (const task of tasks) {
      const node = nodes.get(task.id);
      if (!node) continue;
      const parent = task.parent_task_id ? nodes.get(task.parent_task_id) : undefined;
      if (parent && parent.id !== node.id && !this.wouldCreateCycle(node.id, parent.id, nodes)) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }

  async getProjectScheduleSummary(businessId: string, projectId: string): Promise<ConstructionScheduleSummary> {
    const tasks = await this.listByProject(businessId, projectId);
    return tasks.reduce<ConstructionScheduleSummary>((summary, task) => {
      summary.total_tasks += 1;
      if (task.status === 'completed') summary.completed += 1;
      else if (task.status === 'in_progress') summary.in_progress += 1;
      else if (task.status === 'not_started') summary.not_started += 1;
      else if (task.status === 'on_hold') summary.on_hold += 1;
      return summary;
    }, { total_tasks: 0, completed: 0, in_progress: 0, not_started: 0, on_hold: 0 });
  }

  private wouldCreateCycle(
    taskId: string,
    parentId: string,
    nodes: Map<string, ConstructionScheduleTaskTreeNode>,
  ): boolean {
    const seen = new Set([taskId]);
    let currentId: string | null = parentId;

    while (currentId) {
      if (seen.has(currentId)) return true;
      seen.add(currentId);
      currentId = nodes.get(currentId)?.parent_task_id ?? null;
    }

    return false;
  }

  private async requireActor(resource: string): Promise<string> {
    const { data, error } = await this.client.auth.getUser();
    if (error) throw toRepositoryError(resource, error);
    if (!data.user) throw new UnauthorizedError(resource, 'An authenticated user is required for this operation.');
    return data.user.id;
  }
}
