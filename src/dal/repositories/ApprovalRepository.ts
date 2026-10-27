import { supabase } from '@/lib/supabase';
import type { Database } from '@/dal/types/database.generated';

export type ApprovalDocumentType = 'purchase_order' | 'journal_entry';
export type ApprovalAction = 'approved' | 'rejected';
export type ApprovalRole = Database['public']['Enums']['user_role'];

export interface ApprovalWorkflowStep {
  step_order: number;
  required_role: ApprovalRole;
  description: string | null;
}

export interface ApprovalWorkflow {
  id: string;
  business_id: string;
  document_type: ApprovalDocumentType;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  steps: ApprovalWorkflowStep[];
}

export interface ApprovalHistoryItem {
  action: 'submitted' | 'approved' | 'rejected' | 'resubmitted';
  step_order: number;
  comments: string | null;
  acted_at: string;
  actor_id: string;
  actor_name: string;
}

export interface ApprovalRequestState {
  id: string;
  business_id: string;
  document_type: ApprovalDocumentType;
  document_id: string;
  status: 'pending' | 'approved' | 'rejected';
  current_step: number;
  total_steps: number;
  requested_by: string;
  requested_by_name: string;
  requested_at: string;
  current_role: ApprovalRole | null;
  current_description: string | null;
  can_approve: boolean;
  is_author: boolean;
  history: ApprovalHistoryItem[];
}

export interface ApprovalState {
  requires_approval: boolean;
  request: ApprovalRequestState | null;
}

interface Result<T> {
  data: T | null;
  error: { message?: string; code?: string } | null;
}
interface Query<T> extends PromiseLike<Result<T[]>> {
  eq(column: string, value: unknown): Query<T>;
  order(column: string, options?: { ascending?: boolean }): Query<T>;
  maybeSingle(): Promise<Result<T>>;
  single(): Promise<Result<T>>;
}
interface ApprovalClient {
  rpc(name: string, args: Record<string, unknown>): Promise<Result<unknown>>;
  from(name: string): { select(columns: string): Query<Record<string, unknown>> };
}

const client = supabase as unknown as ApprovalClient;

function unwrap<T>(result: Result<T>): T {
  if (result.error) throw new Error(result.error.message ?? 'Approval request failed.');
  if (result.data == null) throw new Error('Approval request returned no data.');
  return result.data;
}

function rows<T>(result: Result<T[]>): T[] {
  if (result.error) throw new Error(result.error.message ?? 'Approval request failed.');
  return result.data ?? [];
}

export const ApprovalRepository = {
  async getWorkflows(businessId: string): Promise<ApprovalWorkflow[]> {
    const workflows = rows(await client.from('approval_workflows').select('*')
      .eq('business_id', businessId).order('document_type', { ascending: true }));
    return Promise.all(workflows.map(async (workflow) => {
      const steps = rows(await client.from('approval_workflow_steps').select('step_order, required_role, description')
        .eq('workflow_id', workflow.id).order('step_order', { ascending: true }));
      return { ...workflow, steps } as unknown as ApprovalWorkflow;
    }));
  },

  async getWorkflow(businessId: string, documentType: ApprovalDocumentType): Promise<ApprovalWorkflow | null> {
    const result = await client.from('approval_workflows').select('*')
      .eq('business_id', businessId).eq('document_type', documentType).maybeSingle();
    if (result.error) throw new Error(result.error.message ?? 'Approval request failed.');
    if (!result.data) return null;
    const steps = rows(await client.from('approval_workflow_steps').select('step_order, required_role, description')
      .eq('workflow_id', result.data.id).order('step_order', { ascending: true }));
    return { ...result.data, steps } as unknown as ApprovalWorkflow;
  },

  async saveWorkflow(input: {
    businessId: string;
    documentType: ApprovalDocumentType;
    name: string;
    isActive: boolean;
    steps: Array<Pick<ApprovalWorkflowStep, 'required_role' | 'description'>>;
  }): Promise<string> {
    const data = unwrap(await client.rpc('save_approval_workflow', {
      p_business_id: input.businessId,
      p_document_type: input.documentType,
      p_name: input.name,
      p_is_active: input.isActive,
      p_steps: input.steps.map((step) => ({
        required_role: step.required_role,
        description: step.description,
      })),
    }));
    return String(data);
  },

  async requiresApproval(businessId: string, documentType: ApprovalDocumentType): Promise<boolean> {
    return Boolean(unwrap(await client.rpc('requires_approval', {
      p_business_id: businessId,
      p_document_type: documentType,
    })));
  },

  async start(businessId: string, documentType: ApprovalDocumentType, documentId: string): Promise<{
    required: boolean;
    status: string;
    request_id?: string;
    current_step?: number;
  }> {
    return unwrap(await client.rpc('start_approval_workflow', {
      p_business_id: businessId,
      p_document_type: documentType,
      p_document_id: documentId,
    })) as {
      required: boolean;
      status: string;
      request_id?: string;
      current_step?: number;
    };
  },

  async getState(
    businessId: string,
    documentType: ApprovalDocumentType,
    documentId: string,
  ): Promise<ApprovalState> {
    return unwrap(await client.rpc('get_approval_state', {
      p_business_id: businessId,
      p_document_type: documentType,
      p_document_id: documentId,
    })) as ApprovalState;
  },

  async act(requestId: string, action: ApprovalAction, comments?: string): Promise<unknown> {
    return unwrap(await client.rpc('act_on_approval', {
      p_request_id: requestId,
      p_action: action,
      p_comments: comments ?? null,
    }));
  },

  async resubmit(requestId: string): Promise<unknown> {
    return unwrap(await client.rpc('resubmit_approval', { p_request_id: requestId }));
  },

  async getPendingRequests(businessId: string): Promise<Record<string, unknown>[]> {
    return rows(await client.from('approval_requests').select('*')
      .eq('business_id', businessId).eq('status', 'pending').order('requested_at', { ascending: true }));
  },
};
