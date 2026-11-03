import { supabase } from '@/lib/supabase';

export interface ManufacturingDashboardMetrics {
  active_work_orders: number;
  completed_this_period: number;
  total_output_this_period: number;
  total_scrap_this_period: number;
  avg_yield_pct: number;
  wip_value: number;
  total_material_cost_this_period: number;
}

export interface ThroughputTrendRow {
  period_start: string;
  output_quantity: number;
  scrap_quantity: number;
  work_order_count: number;
}

export interface YieldByProductRow {
  product_id: string;
  product_name: string;
  total_output: number;
  total_scrap: number;
  yield_pct: number;
  work_order_count: number;
}

export interface WipAgingRow {
  work_order_id: string;
  work_order_number: string;
  product_name: string;
  status: string;
  planned_quantity: number;
  completed_quantity: number;
  days_in_wip: number;
  wip_cost: number;
  age_bucket: '0-7 days' | '8-14 days' | '15-30 days' | '30+ days';
}

export interface CostVarianceRow {
  work_order_id: string;
  work_order_number: string;
  product_name: string;
  planned_cost: number;
  actual_cost: number;
  variance: number;
  variance_pct: number;
}

export interface ProductionSummaryRow {
  product_id: string;
  product_name: string;
  total_planned: number;
  total_completed: number;
  total_scrapped: number;
  yield_pct: number;
  total_material_cost: number;
  cost_per_unit: number;
  work_order_count: number;
  production_run_count: number;
}

export interface ManufacturingDashboardData {
  metrics: ManufacturingDashboardMetrics;
  previousMetrics: ManufacturingDashboardMetrics;
  throughput: ThroughputTrendRow[];
  yieldByProduct: YieldByProductRow[];
  wipAging: WipAgingRow[];
  costVariance: CostVarianceRow[];
  productionSummary: ProductionSummaryRow[];
}

export interface DashboardRange {
  startDate: string;
  endDate: string;
  previousStartDate: string;
  previousEndDate: string;
  granularity: 'day' | 'week' | 'month';
}

// Supabase's generated Database type is regenerated from the live schema;
// these reporting RPCs are introduced by the migration in this change.
type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};
const rpcClient = supabase as unknown as RpcClient;

async function callRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpcClient.rpc(name, args);
  if (error) throw error;
  return data as T;
}

const metricsFor = (businessId: string, startDate: string, endDate: string) =>
  callRpc<ManufacturingDashboardMetrics>('manufacturing_dashboard_metrics', {
    p_business_id: businessId,
    p_start_date: startDate,
    p_end_date: endDate,
  });

/** Fetch all dashboard views together. React Query caches this by business and range. */
export async function getManufacturingDashboard(
  businessId: string,
  range: DashboardRange,
): Promise<ManufacturingDashboardData> {
  const [metrics, previousMetrics, throughput, yieldByProduct, wipAging, costVariance, productionSummary] =
    await Promise.all([
      metricsFor(businessId, range.startDate, range.endDate),
      metricsFor(businessId, range.previousStartDate, range.previousEndDate),
      callRpc<ThroughputTrendRow[]>('manufacturing_throughput_trend', {
        p_business_id: businessId,
        p_start_date: range.startDate,
        p_end_date: range.endDate,
        p_granularity: range.granularity,
      }),
      callRpc<YieldByProductRow[]>('manufacturing_yield_by_product', {
        p_business_id: businessId,
        p_start_date: range.startDate,
        p_end_date: range.endDate,
      }),
      callRpc<WipAgingRow[]>('manufacturing_wip_aging', { p_business_id: businessId }),
      callRpc<CostVarianceRow[]>('manufacturing_cost_variance', {
        p_business_id: businessId,
        p_start_date: range.startDate,
        p_end_date: range.endDate,
      }),
      callRpc<ProductionSummaryRow[]>('manufacturing_production_summary', {
        p_business_id: businessId,
        p_start_date: range.startDate,
        p_end_date: range.endDate,
      }),
    ]);

  return {
    metrics,
    previousMetrics,
    throughput: throughput ?? [],
    yieldByProduct: yieldByProduct ?? [],
    wipAging: wipAging ?? [],
    costVariance: costVariance ?? [],
    productionSummary: productionSummary ?? [],
  };
}
