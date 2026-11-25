/**
 * Manufacturing cost rollup and pricing simulation.
 *
 * BOM quantities are defined for exactly ONE finished output unit; the scrap
 * factor is applied only to that unit's material requirement. No batch size is
 * involved anywhere in this service.
 */

import { supabase } from '@/lib/supabase';

export interface BomMaterialLine {
  id: string;
  component_id: string;
  component_name: string;
  quantity_per_unit: number; // For exactly ONE finished unit
  unit_of_measure: string;
  unit_cost: number;
  scrap_factor_pct: number; // e.g. 5 for 5% waste
  line_cost: number;
}

export interface LaborOperationLine {
  id: string;
  operation_name: string;
  labor_hours: number;
  hourly_rate: number;
  line_cost: number;
}

export interface OverheadCostLine {
  id: string;
  overhead_name: string;
  cost_type: 'fixed' | 'machine_hours' | 'percentage';
  rate_or_amount: number;
  line_cost: number;
}

export interface CostRollupResult {
  materialCostUnit: number;
  laborCostUnit: number;
  overheadCostUnit: number;
  totalUnitCost: number;
  materialsPct: number;
  laborPct: number;
  overheadPct: number;
}

export interface PricingSimulationResult {
  strategy: 'margin' | 'markup';
  ratePct: number;
  recommendedPrice: number;
  unitGrossProfit: number;
  actualMarginPct: number;
  actualMarkupPct: number;
  currentCatalogPrice: number;
  currentCatalogMarginPct: number;
  priceDifference: number;
}

/** Calculates material cost per 1 finished unit from BOM lines. */
export function calculateMaterialCost(materials: BomMaterialLine[]): number {
  return materials.reduce((sum, item) => {
    const scrapMultiplier = 1 + (Number(item.scrap_factor_pct) || 0) / 100;
    const itemCost = (Number(item.quantity_per_unit) || 0) * (Number(item.unit_cost) || 0) * scrapMultiplier;
    return sum + itemCost;
  }, 0);
}

/** Calculates direct labor cost per 1 finished unit. */
export function calculateLaborCost(operations: LaborOperationLine[]): number {
  return operations.reduce((sum, op) => {
    return sum + (Number(op.labor_hours) || 0) * (Number(op.hourly_rate) || 0);
  }, 0);
}

/** Calculates manufacturing overhead cost per 1 finished unit. */
export function calculateOverheadCost(
  overheads: OverheadCostLine[],
  directCost = 0,
): number {
  return overheads.reduce((sum, oh) => {
    if (oh.cost_type === 'percentage') {
      return sum + directCost * ((Number(oh.rate_or_amount) || 0) / 100);
    }
    return sum + (Number(oh.line_cost) || Number(oh.rate_or_amount) || 0);
  }, 0);
}

/** Rolls up all 3 cost pillars. */
export function calculateTotalUnitCost(
  materials: BomMaterialLine[],
  labor: LaborOperationLine[],
  overheads: OverheadCostLine[],
): CostRollupResult {
  const matCost = calculateMaterialCost(materials);
  const labCost = calculateLaborCost(labor);
  const directCost = matCost + labCost;
  const ovhCost = calculateOverheadCost(overheads, directCost);
  const totalCost = matCost + labCost + ovhCost;

  return {
    materialCostUnit: Math.round(matCost * 100) / 100,
    laborCostUnit: Math.round(labCost * 100) / 100,
    overheadCostUnit: Math.round(ovhCost * 100) / 100,
    totalUnitCost: Math.round(totalCost * 100) / 100,
    materialsPct: totalCost > 0 ? Math.round((matCost / totalCost) * 100) : 0,
    laborPct: totalCost > 0 ? Math.round((labCost / totalCost) * 100) : 0,
    overheadPct: totalCost > 0 ? Math.round((ovhCost / totalCost) * 100) : 0,
  };
}

/** Pricing simulator: Target Gross Margin vs Cost-Plus Markup. */
export function simulatePricing(
  totalUnitCost: number,
  strategy: 'margin' | 'markup',
  ratePct: number,
  currentCatalogPrice: number = 0,
): PricingSimulationResult {
  const rate = Math.max(0, ratePct);
  // Target Gross Margin: Price = Cost / (1 - Margin%), capped at 99.9% so the
  // denominator can never reach zero. Cost-Plus Markup: Cost * (1 + Markup%).
  const clampedMargin = Math.min(rate, 99.9);
  const rawPrice = strategy === 'margin'
    ? totalUnitCost / (1 - clampedMargin / 100)
    : totalUnitCost * (1 + rate / 100);

  // Currency precision: keep two decimals, not fractions of a tambala.
  const recommendedPrice = Math.round(rawPrice * 100) / 100;
  const unitGrossProfit = Math.round((recommendedPrice - totalUnitCost) * 100) / 100;
  const actualMarginPct = recommendedPrice > 0
    ? Math.round(((recommendedPrice - totalUnitCost) / recommendedPrice) * 1000) / 10
    : 0;
  const actualMarkupPct = totalUnitCost > 0
    ? Math.round(((recommendedPrice - totalUnitCost) / totalUnitCost) * 1000) / 10
    : 0;

  const currentCatalogMarginPct = currentCatalogPrice > 0
    ? Math.round(((currentCatalogPrice - totalUnitCost) / currentCatalogPrice) * 1000) / 10
    : 0;

  return {
    strategy,
    ratePct: rate,
    recommendedPrice,
    unitGrossProfit,
    actualMarginPct,
    actualMarkupPct,
    currentCatalogPrice,
    currentCatalogMarginPct,
    priceDifference: Math.round((recommendedPrice - currentCatalogPrice) * 100) / 100,
  };
}

/**
 * Applies the simulated selling and true unit cost to the product catalog (and
 * therefore POS, which reads the same products row).
 */
export async function syncPriceToCatalog(
  productId: string,
  newSellingPrice: number,
  newCostPrice: number,
): Promise<void> {
  // The canonical selling-price column is added by the costing migration;
  // the generated client types predate it, hence the narrow structural cast.
  const products = supabase.from('products') as unknown as {
    update: (values: Record<string, unknown>) => {
      eq: (column: string, value: string) => PromiseLike<{ error: Error | null }>;
    };
  };
  const { error } = await products
    .update({
      unit_price: newSellingPrice,
      cost_price: newCostPrice,
      updated_at: new Date().toISOString(),
    })
    .eq('id', productId);

  if (error) throw error;
}
