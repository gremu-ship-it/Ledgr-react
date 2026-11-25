import { describe, expect, it } from 'vitest';
import {
  calculateLaborCost,
  calculateMaterialCost,
  calculateOverheadCost,
  calculateTotalUnitCost,
  simulatePricing,
  type BomMaterialLine,
  type LaborOperationLine,
  type OverheadCostLine,
} from '../manufacturingCostingService';

const material = (overrides: Partial<BomMaterialLine> = {}): BomMaterialLine => ({
  id: 'line-1',
  component_id: 'component-1',
  component_name: 'Maize flour',
  quantity_per_unit: 2,
  unit_of_measure: 'kg',
  unit_cost: 1000,
  scrap_factor_pct: 0,
  line_cost: 0,
  ...overrides,
});

const operation = (overrides: Partial<LaborOperationLine> = {}): LaborOperationLine => ({
  id: 'op-1',
  operation_name: 'Assembly',
  labor_hours: 2,
  hourly_rate: 500,
  line_cost: 0,
  ...overrides,
});

const overhead = (overrides: Partial<OverheadCostLine> = {}): OverheadCostLine => ({
  id: 'oh-1',
  overhead_name: 'Power',
  cost_type: 'fixed',
  rate_or_amount: 300,
  line_cost: 300,
  ...overrides,
});

describe('calculateMaterialCost', () => {
  it('treats BOM quantities as per ONE output unit and applies scrap factors', () => {
    const cost = calculateMaterialCost([
      material({ quantity_per_unit: 2, unit_cost: 1000, scrap_factor_pct: 5 }),
      material({ id: 'line-2', quantity_per_unit: 0.5, unit_cost: 800, scrap_factor_pct: 0 }),
    ]);

    expect(cost).toBeCloseTo(2 * 1000 * 1.05 + 0.5 * 800, 6);
  });

  it('ignores blank/invalid numeric fields instead of producing NaN', () => {
    expect(calculateMaterialCost([
      material({ quantity_per_unit: Number.NaN, unit_cost: Number.NaN, scrap_factor_pct: Number.NaN }),
    ])).toBe(0);
    expect(calculateMaterialCost([])).toBe(0);
  });
});

describe('calculateLaborCost and calculateOverheadCost', () => {
  it('multiplies hours by wage rate for every operation', () => {
    expect(calculateLaborCost([
      operation({ labor_hours: 2, hourly_rate: 500 }),
      operation({ id: 'op-2', labor_hours: 0.5, hourly_rate: 1200 }),
    ])).toBe(1600);
  });

  it('charges fixed/machine-hour lines directly and percentage lines on direct cost', () => {
    const directCost = 3000;
    expect(calculateOverheadCost([
      overhead({ cost_type: 'fixed', rate_or_amount: 300, line_cost: 300 }),
      overhead({ id: 'oh-2', cost_type: 'machine_hours', rate_or_amount: 200, line_cost: 200 }),
      overhead({ id: 'oh-3', cost_type: 'percentage', rate_or_amount: 10, line_cost: 0 }),
    ], directCost)).toBe(800);
  });
});

describe('calculateTotalUnitCost', () => {
  it('rolls up materials, labor and overhead with percentage shares', () => {
    const result = calculateTotalUnitCost(
      [material({ quantity_per_unit: 2, unit_cost: 1000, scrap_factor_pct: 5 })],
      [operation({ labor_hours: 2, hourly_rate: 500 })],
      [overhead({ cost_type: 'percentage', rate_or_amount: 10, line_cost: 0 })],
    );

    // Materials 2100 + labor 1000 = 3100 direct; overhead 10% = 310.
    expect(result).toEqual({
      materialCostUnit: 2100,
      laborCostUnit: 1000,
      overheadCostUnit: 310,
      totalUnitCost: 3410,
      materialsPct: 62,
      laborPct: 29,
      overheadPct: 9,
    });
  });

  it('returns zero shares for an empty bill of materials', () => {
    expect(calculateTotalUnitCost([], [], [])).toEqual({
      materialCostUnit: 0,
      laborCostUnit: 0,
      overheadCostUnit: 0,
      totalUnitCost: 0,
      materialsPct: 0,
      laborPct: 0,
      overheadPct: 0,
    });
  });
});

describe('simulatePricing', () => {
  it('uses target gross margin: Cost / (1 - Margin%)', () => {
    const result = simulatePricing(7000, 'margin', 30, 9000);

    expect(result.recommendedPrice).toBe(10000);
    expect(result.unitGrossProfit).toBe(3000);
    expect(result.actualMarginPct).toBe(30);
    expect(result.actualMarkupPct).toBe(42.9);
    expect(result.currentCatalogMarginPct).toBe(22.2);
    expect(result.priceDifference).toBe(1000);
  });

  it('uses cost-plus markup: Cost * (1 + Markup%)', () => {
    const result = simulatePricing(5000, 'markup', 50, 6000);

    expect(result.recommendedPrice).toBe(7500);
    expect(result.unitGrossProfit).toBe(2500);
    expect(result.actualMarginPct).toBe(33.3);
    expect(result.actualMarkupPct).toBe(50);
    expect(result.priceDifference).toBe(1500);
  });

  it('caps margin at 99.9% and never divides by zero', () => {
    const capped = simulatePricing(100, 'margin', 100);
    expect(capped.recommendedPrice).toBe(100000);

    const beyond = simulatePricing(100, 'margin', 250);
    expect(beyond.recommendedPrice).toBe(capped.recommendedPrice);
  });

  it('handles zero cost and zero margin cleanly', () => {
    expect(simulatePricing(0, 'margin', 0)).toMatchObject({
      recommendedPrice: 0,
      unitGrossProfit: 0,
      actualMarginPct: 0,
      actualMarkupPct: 0,
    });
    expect(simulatePricing(4500, 'margin', 0)).toMatchObject({
      recommendedPrice: 4500,
      unitGrossProfit: 0,
      actualMarginPct: 0,
    });
    expect(simulatePricing(4500, 'markup', -20).ratePct).toBe(0);
  });
});
