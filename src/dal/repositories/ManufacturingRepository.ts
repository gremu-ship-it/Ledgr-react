import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, InsertDto, Row } from '../types/database';

export type WorkCentreType = 'machine' | 'labor' | 'cell' | 'outsourced';
export type RoutingStatus = 'draft' | 'active' | 'archived';
export type WorkOrderPriority = 'low' | 'normal' | 'high' | 'urgent';
export type ManufacturingWorkOrderStatus =
  | 'draft'
  | 'released'
  | 'in_progress'
  | 'completed'
  | 'closed'
  | 'cancelled';
export type ManufacturingRunStatus = 'in_progress' | 'completed' | 'aborted' | 'cancelled';

export type WorkCentre = Row<'work_centres'>;
export type CreateWorkCentreInput = Omit<InsertDto<'work_centres'>, 'business_id'>;
export type UpdateWorkCentreInput = Partial<CreateWorkCentreInput>;

export type Routing = Row<'routings'>;
export type RoutingStep = Row<'routing_steps'>;
export interface RoutingStepInput {
  sequence: number;
  work_centre_id: string;
  operation_name: string;
  setup_time_minutes: number;
  run_time_per_unit_minutes: number;
  queue_time_minutes: number;
  is_quality_checkpoint: boolean;
  notes: string | null;
}
export interface RoutingSummary extends Routing {
  product: Pick<Row<'products'>, 'id' | 'name' | 'sku'> | null;
}
export interface RoutingStepWithCentre extends RoutingStep {
  work_centre: Pick<WorkCentre, 'id' | 'code' | 'name' | 'centre_type'> | null;
}
export interface RoutingWithSteps extends RoutingSummary {
  steps: RoutingStepWithCentre[];
}
export interface SaveRoutingInput {
  id?: string | null;
  product_id: string;
  bom_version_id: string | null;
  code: string;
  name: string;
  version_number: number;
  notes: string | null;
  steps: RoutingStepInput[];
}

export type WorkOrder = Row<'manufacturing_work_orders'>;
export type WorkOrderLine = Row<'manufacturing_work_order_lines'>;
export type ProductionRun = Row<'manufacturing_production_runs'>;
export type ProductionRunLine = Row<'manufacturing_production_run_lines'>;
export interface WorkOrderSummary extends WorkOrder {
  product: Pick<Row<'products'>, 'id' | 'name' | 'sku' | 'unit_of_measure'> | null;
}
export interface WorkOrderDetail extends WorkOrderSummary {
  component_lines: WorkOrderLine[];
  routing: RoutingWithSteps | null;
  runs: (ProductionRun & { lines: ProductionRunLine[] })[];
}
export interface CreateWorkOrderInput {
  product_id: string;
  bom_version_id: string;
  routing_id?: string | null;
  quantity: number;
  reference?: string | null;
  planned_start?: string | null;
  planned_end?: string | null;
  from_location_id?: string | null;
  to_location_id?: string | null;
  notes?: string | null;
  priority?: WorkOrderPriority;
}
export interface CompleteRunInput {
  quantity_produced: number;
  quantity_scrapped: number;
  scrap_reason?: string | null;
  output_location_id: string | null;
}
export interface WorkOrderFilters {
  status?: ManufacturingWorkOrderStatus;
  priority?: WorkOrderPriority;
}

export class ManufacturingRepository {
  private readonly client: SupabaseClient<Database>;

  constructor(client: SupabaseClient<Database>) { this.client = client; }

  async listWorkCentres(businessId: string): Promise<WorkCentre[]> {
    const { data, error } = await this.client
      .from('work_centres')
      .select('*')
      .eq('business_id', businessId)
      .order('name', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async createWorkCentre(businessId: string, input: CreateWorkCentreInput): Promise<string> {
    const { data, error } = await this.client
      .from('work_centres')
      .insert({ ...input, business_id: businessId })
      .select('id')
      .single();
    if (error) throw error;
    return data.id;
  }

  async updateWorkCentre(businessId: string, id: string, input: UpdateWorkCentreInput): Promise<void> {
    const { data, error } = await this.client
      .from('work_centres')
      .update(input)
      .eq('business_id', businessId)
      .eq('id', id)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('manufacturing.errors.workCentreNotFound');
  }

  async listRoutings(businessId: string, productId?: string): Promise<RoutingSummary[]> {
    let query = this.client.from('routings').select('*').eq('business_id', businessId);
    if (productId) query = query.eq('product_id', productId);
    const { data, error } = await query.order('product_id').order('code').order('version_number', { ascending: false });
    if (error) throw error;
    const routes = data ?? [];
    const products = await this.loadProducts(businessId, routes.map((route) => route.product_id));
    return routes.map((route) => ({ ...route, product: products.get(route.product_id) ?? null }));
  }

  async getRoutingWithSteps(businessId: string, routingId: string): Promise<RoutingWithSteps> {
    const { data: route, error: routeError } = await this.client
      .from('routings')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', routingId)
      .maybeSingle();
    if (routeError) throw routeError;
    if (!route) throw new Error('manufacturing.errors.routingNotFound');
    const { data: steps, error: stepsError } = await this.client
      .from('routing_steps')
      .select('*')
      .eq('business_id', businessId)
      .eq('routing_id', routingId)
      .order('sequence');
    if (stepsError) throw stepsError;
    const centreIds = [...new Set((steps ?? []).map((step) => step.work_centre_id))];
    const centres = centreIds.length
      ? await this.loadWorkCentres(businessId, centreIds)
      : new Map<string, WorkCentre>();
    const products = await this.loadProducts(businessId, [route.product_id]);
    return {
      ...route,
      product: products.get(route.product_id) ?? null,
      steps: (steps ?? []).map((step) => ({
        ...step,
        work_centre: centres.get(step.work_centre_id) ?? null,
      })),
    };
  }

  async saveRouting(businessId: string, input: SaveRoutingInput): Promise<string> {
    const routeValues = {
      product_id: input.product_id,
      bom_version_id: input.bom_version_id,
      code: input.code,
      name: input.name,
      version_number: input.version_number,
      notes: input.notes,
      updated_at: new Date().toISOString(),
    };
    let routingId = input.id ?? null;
    if (routingId) {
      const { data, error } = await this.client.from('routings').update(routeValues)
        .eq('business_id', businessId).eq('id', routingId).eq('status', 'draft')
        .select('id').maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('manufacturing.errors.draftRoutingEditOnly');
    } else {
      const { data, error } = await this.client.from('routings')
        .insert({ ...routeValues, business_id: businessId, status: 'draft' })
        .select('id').single();
      if (error) throw error;
      routingId = data.id;
    }

    const { error: deleteError } = await this.client.from('routing_steps').delete()
      .eq('business_id', businessId).eq('routing_id', routingId);
    if (deleteError) throw deleteError;
    const orderedSteps = input.steps.map((step, index) => ({
      ...step,
      business_id: businessId,
      routing_id: routingId!,
      sequence: index + 1,
    }));
    if (orderedSteps.length) {
      const { error } = await this.client.from('routing_steps').insert(orderedSteps);
      if (error) throw error;
    }
    const { error: totalsError } = await this.client.from('routings').update({
      total_setup_minutes: orderedSteps.reduce((sum, step) => sum + Number(step.setup_time_minutes || 0), 0),
      total_run_minutes_per_unit: orderedSteps.reduce((sum, step) => sum + Number(step.run_time_per_unit_minutes || 0), 0),
    }).eq('business_id', businessId).eq('id', routingId).eq('status', 'draft');
    if (totalsError) throw totalsError;
    return routingId;
  }

  async activateRouting(businessId: string, routingId: string): Promise<void> {
    const { data, error } = await this.client.from('routings').update({ status: 'active' })
      .eq('business_id', businessId).eq('id', routingId).eq('status', 'draft')
      .select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('manufacturing.errors.draftRoutingActivateOnly');
  }

  async archiveRouting(businessId: string, routingId: string): Promise<void> {
    const { data, error } = await this.client
      .from('routings')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('business_id', businessId)
      .eq('id', routingId)
      .neq('status', 'archived')
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('manufacturing.errors.routingNotFound');
  }

  async listWorkOrders(businessId: string, filters: WorkOrderFilters = {}): Promise<WorkOrderSummary[]> {
    let query = this.client.from('manufacturing_work_orders').select('*').eq('business_id', businessId);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.priority) query = query.eq('priority', filters.priority);
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw error;
    const orders = data ?? [];
    const products = await this.loadProducts(businessId, orders.map((order) => order.product_id));
    return orders.map((order) => ({ ...order, product: products.get(order.product_id) ?? null }));
  }

  async getWorkOrder(businessId: string, orderId: string): Promise<WorkOrderDetail> {
    const { data: order, error } = await this.client
      .from('manufacturing_work_orders')
      .select('*')
      .eq('business_id', businessId)
      .eq('id', orderId)
      .maybeSingle();
    if (error) throw error;
    if (!order) throw new Error('manufacturing.errors.workOrderNotFound');
    const [lineResult, runResult, products] = await Promise.all([
      this.client.from('manufacturing_work_order_lines').select('*').eq('work_order_id', orderId).order('created_at'),
      this.client.from('manufacturing_production_runs').select('*').eq('work_order_id', orderId).order('run_number'),
      this.loadProducts(businessId, [order.product_id]),
    ]);
    if (lineResult.error) throw lineResult.error;
    if (runResult.error) throw runResult.error;
    const lines = lineResult.data ?? [];
    const runs = runResult.data ?? [];
    const runLines = runs.length
      ? await this.client.from('manufacturing_production_run_lines').select('*')
        .eq('business_id', businessId).in('production_run_id', runs.map((run) => run.id))
      : { data: [], error: null };
    if (runLines.error) throw runLines.error;
    const byRun = new Map<string, ProductionRunLine[]>();
    for (const line of runLines.data ?? []) byRun.set(line.production_run_id, [...(byRun.get(line.production_run_id) ?? []), line]);
    const routing = order.routing_id ? await this.getRoutingWithSteps(businessId, order.routing_id) : null;
    const allProductIds = [...new Set([order.product_id, ...lines.map((line) => line.component_product_id)])];
    const allProducts = await this.loadProducts(businessId, allProductIds);
    return {
      ...order,
      product: products.get(order.product_id) ?? allProducts.get(order.product_id) ?? null,
      component_lines: lines,
      routing,
      runs: runs.map((run) => ({ ...run, lines: byRun.get(run.id) ?? [] })),
    };
  }

  async createWorkOrder(businessId: string, input: CreateWorkOrderInput): Promise<string> {
    const { data, error } = await this.client.rpc('create_work_order_from_bom', {
      p_business_id: businessId,
      p_product_id: input.product_id,
      p_bom_version_id: input.bom_version_id,
      p_routing_id: input.routing_id ?? null,
      p_quantity: input.quantity,
      p_reference: input.reference ?? null,
      p_planned_start: input.planned_start ?? null,
      p_planned_end: input.planned_end ?? null,
      p_priority: input.priority ?? 'normal',
      p_from_location_id: input.from_location_id ?? null,
      p_to_location_id: input.to_location_id ?? null,
      p_notes: input.notes ?? null,
    });
    if (error) throw error;
    if (!data) throw new Error('manufacturing.errors.workOrderMissingId');
    return data;
  }

  async updateWorkOrderStatus(businessId: string, orderId: string, status: ManufacturingWorkOrderStatus): Promise<void> {
    const { data: order, error: orderError } = await this.client.from('manufacturing_work_orders')
      .select('id').eq('business_id', businessId).eq('id', orderId).maybeSingle();
    if (orderError) throw orderError;
    if (!order) throw new Error('manufacturing.errors.workOrderNotFound');
    const commands: Partial<Record<ManufacturingWorkOrderStatus, keyof Database['public']['Functions']>> = {
          released: 'manufacturing_wo_release',
      in_progress: 'manufacturing_wo_start',
      completed: 'manufacturing_wo_complete',
      closed: 'manufacturing_wo_close',
      cancelled: 'manufacturing_wo_cancel',
    };
    const command = commands[status];
    if (!command) throw new Error('manufacturing.errors.unsupportedWorkOrderStatus');
    const { error } = await this.client.rpc(command as never, { p_work_order_id: orderId } as never);
    if (error) throw error;
  }

  async listRuns(businessId: string, workOrderId: string): Promise<ProductionRun[]> {
    const { data: workOrder, error: workOrderError } = await this.client.from('manufacturing_work_orders')
      .select('id').eq('business_id', businessId).eq('id', workOrderId).maybeSingle();
    if (workOrderError) throw workOrderError;
    if (!workOrder) throw new Error('manufacturing.errors.workOrderNotFound');
    const { data, error } = await this.client.from('manufacturing_production_runs')
      .select('*').eq('work_order_id', workOrderId).order('run_number');
    if (error) throw error;
    return data ?? [];
  }

  async startRun(businessId: string, workOrderId: string, locationId: string): Promise<string> {
    const { data: workOrder, error: workOrderError } = await this.client.from('manufacturing_work_orders')
      .select('id,status').eq('business_id', businessId).eq('id', workOrderId).maybeSingle();
    if (workOrderError) throw workOrderError;
    if (!workOrder) throw new Error('manufacturing.errors.workOrderNotFound');
    if (workOrder.status !== 'released' && workOrder.status !== 'in_progress') {
      throw new Error('manufacturing.errors.workOrderNotOpenForRun');
    }
    const { data: authData, error: authError } = await this.client.auth.getUser();
    if (authError) throw authError;
    if (!authData.user) throw new Error('manufacturing.errors.signInToStartRun');
    const { data, error } = await this.client.from('manufacturing_production_runs').insert({
      work_order_id: workOrderId,
      run_number: 0, // overwritten under the locked work-order row by the insert trigger
      output_quantity: 0,
      scrap_quantity: 0,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      completed_at: null,
      created_by: authData.user.id,
      output_location_id: locationId,
    }).select('id').single();
    if (error) throw error;
    return data.id;
  }

  async completeRun(businessId: string, runId: string, input: CompleteRunInput): Promise<void> {
    const { error } = await this.client.rpc('complete_production_run', {
      p_business_id: businessId,
      p_run_id: runId,
      p_quantity_produced: input.quantity_produced,
      p_quantity_scrapped: input.quantity_scrapped,
      p_scrap_reason: input.scrap_reason ?? null,
      p_output_location_id: input.output_location_id,
    });
    if (error) throw error;
  }

  async abortRun(businessId: string, runId: string): Promise<void> {
    const { data: run, error: runError } = await this.client.from('manufacturing_production_runs')
      .select('id,work_order_id,status').eq('id', runId).maybeSingle();
    if (runError) throw runError;
    if (!run) throw new Error('manufacturing.errors.productionRunNotFound');
    const { data: workOrder, error: workOrderError } = await this.client.from('manufacturing_work_orders')
      .select('id').eq('id', run.work_order_id).eq('business_id', businessId).maybeSingle();
    if (workOrderError) throw workOrderError;
    if (!workOrder) throw new Error('manufacturing.errors.productionRunNotFound');
    const { data, error } = await this.client.from('manufacturing_production_runs')
      .update({ status: 'aborted', completed_at: new Date().toISOString() })
      .eq('id', runId).eq('status', 'in_progress').select('id').maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('manufacturing.errors.inProgressRunAbortOnly');
  }

  private async loadProducts(businessId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, Pick<Row<'products'>, 'id' | 'name' | 'sku' | 'unit_of_measure'>>();
    const { data, error } = await this.client.from('products').select('id,name,sku,unit_of_measure')
      .eq('business_id', businessId).in('id', unique);
    if (error) throw error;
    return new Map((data ?? []).map((product) => [product.id, product]));
  }

  private async loadWorkCentres(businessId: string, ids: string[]) {
    const { data, error } = await this.client.from('work_centres').select('*')
      .eq('business_id', businessId).in('id', ids);
    if (error) throw error;
    return new Map((data ?? []).map((centre) => [centre.id, centre]));
  }
}
