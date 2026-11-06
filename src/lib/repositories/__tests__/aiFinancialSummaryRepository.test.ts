import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/dal/types/database';

const financialMocks = vi.hoisted(() => ({
  getProfitOrLoss: vi.fn(),
  getSOFP: vi.fn(),
  getCashPosition: vi.fn(),
  aiData: null as unknown,
}));

vi.mock('@/dal/repositories/FinancialStatementRepository', () => ({
  FinancialStatementRepository: class {
    getProfitOrLoss(...args: unknown[]) { return financialMocks.getProfitOrLoss(...args); }
    getSOFP(...args: unknown[]) { return financialMocks.getSOFP(...args); }
    getCashPosition(...args: unknown[]) { return financialMocks.getCashPosition(...args); }
  },
}));
vi.mock('@/lib/ai/context', () => ({ normaliseAiData: () => financialMocks.aiData }));

import { AiRepository } from '../aiRepository';

function makeClient(options: { allowed?: boolean; summaries?: Record<string, unknown>[] } = {}) {
  const inserted: Record<string, unknown>[] = [];
  const tables: string[] = [];
  const from = vi.fn((table: string) => {
    tables.push(table);
    let payload: Record<string, unknown> | null = null;
    const query: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'limit']) query[method] = vi.fn(() => query);
    query.insert = vi.fn((value: Record<string, unknown>) => { payload = value; inserted.push(value); return query; });
    query.maybeSingle = vi.fn(async () => ({ data: options.summaries?.[0] ?? null, error: null }));
    query.single = vi.fn(async () => ({ data: { id: 'snapshot-1', created_at: '2026-11-05T10:00:00Z', ...payload }, error: null }));
    return query;
  });
  const rpc = vi.fn(async (name: string) => name === 'can_access_ai_financial_summaries'
    ? { data: options.allowed ?? true, error: null }
    : { data: {}, error: null });
  return {
    client: { from, rpc } as unknown as SupabaseClient<Database>,
    from,
    rpc,
    inserted,
    tables,
  };
}

function makeNormalizedData() {
  return {
    company: { id: 'business-1', name: 'Ledger Ltd', currency: 'MWK', vat_registered: true, financial_year_start: null },
    kpis: { receivables_total: 900, payables_total: 600 },
    monthlyTrend: [
      { month: '2026-08', cash_in: 3000, cash_out: 6000 },
      { month: '2026-09', cash_in: 3000, cash_out: 6000 },
      { month: '2026-10', cash_in: 3000, cash_out: 6000 },
    ],
    overdueInvoices: [{ customer: 'Customer A', days_overdue: 70, amount_outstanding: 100 }],
    upcomingReceivables: [{ amount_outstanding: 200, days_until_due: 15 }],
    upcomingPayables: [{ amount: 150, due_date: '2026-11-20' }],
  };
}

function makePnl(comparative = false) {
  return {
    totalRevenue: comparative ? 900 : 1000,
    comparativeTotalRevenue: comparative ? null : 900,
    grossProfit: comparative ? 360 : 400,
    comparativeGrossProfit: comparative ? null : 360,
    totalCostOfSales: comparative ? 400 : 500,
    totalOperatingExpenses: comparative ? 250 : 300,
    comparativeTotalOperatingExpenses: comparative ? null : 250,
    operatingExpenses: { lines: [{ name: 'Transport', amount: 100, comparativeAmount: 50 }] },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  financialMocks.aiData = makeNormalizedData();
  financialMocks.getProfitOrLoss.mockImplementation(async (_businessId: string, _start: string, _end: string, comparativeStart?: string | null) =>
    comparativeStart ? makePnl(false) : { ...makePnl(true), totalRevenue: 9000, totalCostOfSales: 3000, totalOperatingExpenses: 2000 });
  financialMocks.getSOFP.mockResolvedValue({
    currentAssets: {
      subtotal: 2000,
      lines: [
        { code: '1110', name: 'Cash on Hand', amount: 600 },
        { code: '1131', name: 'Trade Debtors', amount: 900 },
        { code: '1141', name: 'Trading Stock', amount: 500 },
      ],
    },
    currentLiabilities: { subtotal: 1000, lines: [{ code: '2111', name: 'Trade Creditors', amount: 1000 }] },
  });
  financialMocks.getCashPosition.mockResolvedValue(1000);
});

describe('AiRepository financial intelligence methods', () => {
  it('calculates runway and working-capital metrics through the injected client and statement repository', async () => {
    const { client, rpc } = makeClient();
    const repository = new AiRepository(client);

    const result = await repository.calculateCashRunway('business-1');

    expect(rpc).toHaveBeenCalledWith('can_access_ai_financial_summaries', { p_business_id: 'business-1' });
    expect(result.metrics).toMatchObject({ cash_balance: 1000, dso_days: 9, dpo_days: 10.8, current_ratio: 2, quick_ratio: 1.5 });
    expect(result.projections.map((projection) => projection.days)).toEqual([30, 60, 90]);
  });

  it('persists a localized deterministic summary snapshot for trend comparison', async () => {
    const { client, tables, inserted } = makeClient();
    const repository = new AiRepository(client);

    const summary = await repository.generateFinancialSummary('business-1');

    expect(tables).toContain('ai_financial_summaries');
    expect(inserted[0]).toMatchObject({
      business_id: 'business-1',
      health_score: summary.health_score,
      executive_summary: 'ai.summary.generatedOverview',
      metrics: expect.objectContaining({ currency: 'MWK', top_expense_driver: 'Transport' }),
    });
    expect(summary.key_risks.some((risk) => risk.key === 'ai.summary.risks.agedReceivables')).toBe(true);
  });

  it('loads the latest business snapshot via the injected client', async () => {
    const row = {
      id: 'snapshot-1', business_id: 'business-1', period_start: '2026-10-01', period_end: '2026-10-30',
      health_score: 82, executive_summary: 'ai.summary.generatedOverview', key_risks: [{ key: 'ai.summary.noMaterialRisks' }],
      recommendations: [], metrics: { currency: 'MWK', health_score: 82 }, created_at: '2026-11-05T10:00:00Z',
    };
    const { client } = makeClient({ summaries: [row] });
    const repository = new AiRepository(client);

    await expect(repository.getLatestFinancialSummary('business-1')).resolves.toMatchObject({
      id: 'snapshot-1', health_score: 82, key_risks: [{ key: 'ai.summary.noMaterialRisks' }],
    });
  });

  it('fails closed when the injected access check denies a non-Enterprise business', async () => {
    const { client } = makeClient({ allowed: false });
    const repository = new AiRepository(client);
    await expect(repository.calculateCashRunway('business-1')).rejects.toThrow(/active Enterprise/);
    expect(financialMocks.getSOFP).not.toHaveBeenCalled();
  });
});
