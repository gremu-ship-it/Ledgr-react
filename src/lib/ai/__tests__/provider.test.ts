import { describe, expect, it } from 'vitest';
import { answerLocally, buildSystemPrompt, matchArticle, rulesProvider, suggestionsFor } from '@/lib/ai/provider';
import { KNOWLEDGE_BASE } from '@/lib/ai/knowledge';
import { forecast } from '@/lib/ai/forecast';
import type { AiData, DataContext } from '@/lib/ai/types';

const data: AiData = {
  generated_at: '2026-08-22T00:00:00Z',
  company: { id: 'b1', name: 'Kwacha Traders', currency: 'MWK', vat_registered: true, financial_year_start: '01-01' },
  kpis: {
    period_start: '2026-08-01',
    period_end: '2026-08-31',
    revenue_mtd: 10_000_000,
    expenses_mtd: 7_000_000,
    net_profit_mtd: 3_000_000,
    profit_margin_pct: 30,
    cash_balance: 20_000_000,
    receivables_total: 4_000_000,
    overdue_total: 1_500_000,
    open_invoice_count: 6,
    payables_total: 1_000_000,
    avg_days_to_pay: 34,
    expense_ratio_pct: 70,
  },
  monthlyTrend: [
    { month: '2026-06', month_start: '2026-06-01', revenue: 9_000_000, expenses: 6_000_000, profit: 3_000_000, cash_in: 8_000_000, cash_out: 6_000_000, net_cash: 2_000_000, cumulative_cash: 2_000_000 },
    { month: '2026-07', month_start: '2026-07-01', revenue: 9_500_000, expenses: 6_200_000, profit: 3_300_000, cash_in: 9_000_000, cash_out: 6_500_000, net_cash: 2_500_000, cumulative_cash: 4_500_000 },
  ],
  overdueInvoices: [
    { invoice_id: 'i1', invoice_number: 'INV-0042', customer: 'Lilongwe Foods', amount_outstanding: 1_500_000, issue_date: '2026-05-01', due_date: '2026-06-01', days_overdue: 82 },
  ],
  topExpenses: [{ category: 'Fuel & Transport', account_code: '6300', amount: 2_400_000, document_count: 18, period_days: 90 }],
  topCustomers: [
    { customer: 'Blantyre Traders Ltd', revenue: 12_000_000, invoice_count: 9, last_invoice_date: '2026-08-01', outstanding: 1_000_000, share_pct: 40 },
  ],
  concentration: { total_revenue: 30_000_000, top_customer: 'Blantyre Traders Ltd', top_customer_revenue: 12_000_000, concentration_pct: 40, customer_count: 5 },
  anomalies: [
    { type: 'duplicate_expense', severity: 'high', occurred_on: '2026-08-04', amount: 450_000, reference: 'EXP-0091', description: 'Possible duplicate: EXP-0091 matches an earlier expense of MK 450,000.' },
  ],
  upcomingReceivables: [],
  upcomingPayables: [],
};

const ctx: DataContext = {
  companyName: 'Kwacha Traders',
  data,
  knowledgeBase: KNOWLEDGE_BASE,
  forecast: forecast(data, 3, new Date(2026, 7, 22)),
};

const supportCtx: DataContext = { companyName: 'Kwacha Traders', knowledgeBase: KNOWLEDGE_BASE };

describe('matchArticle', () => {
  it('finds the invoicing article from a natural question', () => {
    const a = matchArticle('how do I create an invoice for a customer?', KNOWLEDGE_BASE);
    expect(a).not.toBeNull();
    expect(a!.body.length).toBeGreaterThan(50);
  });

  it('returns null when nothing scores', () => {
    expect(matchArticle('zzzzz qqqqq', KNOWLEDGE_BASE)).toBeNull();
  });

  it('every article has a topic, keywords and a body', () => {
    for (const a of KNOWLEDGE_BASE) {
      expect(a.id).toBeTruthy();
      expect(a.topic).toBeTruthy();
      expect(a.keywords.length).toBeGreaterThan(0);
      expect(a.body.length).toBeGreaterThan(40);
    }
  });
});

describe('answerLocally — support mode (no company data)', () => {
  it('greets without quoting figures it does not have', () => {
    const out = answerLocally('hello', supportCtx);
    expect(out).toContain('Kwacha Traders');
    expect(out).not.toMatch(/MK\s/);
  });

  it('answers a how-to from the knowledge base', () => {
    const out = answerLocally('how do I reconcile my bank account?', supportCtx);
    expect(out.toLowerCase()).toMatch(/reconcil/);
  });

  it('offers next steps rather than failing on an unknown question', () => {
    const out = answerLocally('what is the airspeed velocity of a swallow', supportCtx);
    expect(out.length).toBeGreaterThan(40);
    expect(out).not.toMatch(/NaN|undefined/);
  });
});

describe('answerLocally — AI mode (live data)', () => {
  it('reports performance using the real KPI figures', () => {
    const out = answerLocally('how is my business doing?', ctx);
    expect(out).toContain('MK 10,000,000');
    expect(out).toContain('MK 7,000,000');
  });

  it('lists overdue invoices with the customer and invoice number', () => {
    const out = answerLocally('which invoices are overdue?', ctx);
    expect(out).toContain('Lilongwe Foods');
    expect(out).toContain('INV-0042');
  });

  it('produces a cash-flow forecast with a confidence level', () => {
    const out = answerLocally('what does my cash flow look like over the next 3 months?', ctx);
    expect(out.toLowerCase()).toMatch(/confidence/);
    expect(out).toMatch(/MK\s[\d,]+/);
  });

  it('answers a revenue-forecast question', () => {
    const out = answerLocally('forecast my revenue', ctx);
    expect(out.toLowerCase()).toMatch(/revenue/);
    expect(out).toMatch(/MK\s[\d,]+/);
  });

  it('names the top expense category', () => {
    const out = answerLocally('what are my biggest expenses?', ctx);
    expect(out).toContain('Fuel & Transport');
  });

  it('names the top customer', () => {
    const out = answerLocally('who are my top customers?', ctx);
    expect(out).toContain('Blantyre Traders Ltd');
  });

  it('surfaces anomalies', () => {
    const out = answerLocally('any anomalies or unusual transactions?', ctx);
    expect(out).toContain('EXP-0091');
  });

  it('gives advice tied to real figures', () => {
    const out = answerLocally('what should I improve?', ctx);
    expect(out).toMatch(/MK\s[\d,]+/);
  });

  it('never emits NaN, undefined or unformatted currency', () => {
    const questions = [
      'hi', 'how is my business doing', 'overdue invoices', 'top expenses', 'top customers',
      'cash flow forecast', 'forecast my expenses', 'what should I improve', 'anomalies',
      'I got an error saving an invoice', 'how do I add a user',
    ];
    for (const q of questions) {
      const out = answerLocally(q, ctx);
      expect(out).not.toMatch(/NaN|undefined|null\b|\[object Object\]/);
    }
  });
});

describe('answerLocally — empty company', () => {
  it('degrades gracefully with no data at all', () => {
    const empty: DataContext = { companyName: 'New Co', knowledgeBase: KNOWLEDGE_BASE };
    for (const q of ['how is my business doing', 'cash flow forecast', 'overdue invoices', 'what should I improve']) {
      const out = answerLocally(q, empty);
      expect(out.length).toBeGreaterThan(20);
      expect(out).not.toMatch(/NaN|undefined/);
    }
  });
});

describe('rulesProvider', () => {
  it('works offline and returns suggestions', async () => {
    const provider = rulesProvider();
    const answer = await provider.answer([{ role: 'user', content: 'how is my business doing?' }], ctx);
    expect(answer.provider).toBe('ledgr-rules');
    expect(answer.content).toMatch(/MK\s[\d,]+/);
    expect(answer.suggestions?.length ?? 0).toBeGreaterThan(0);
  });
});

describe('suggestionsFor', () => {
  it('always offers up to four follow-ups', () => {
    const s = suggestionsFor('how is my business doing?', ctx);
    expect(s.length).toBeGreaterThan(0);
    expect(s.length).toBeLessThanOrEqual(4);
  });
});

describe('buildSystemPrompt', () => {
  it('states the grounding rules and includes the live data', () => {
    const prompt = buildSystemPrompt(ctx);
    expect(prompt).toContain('Kwacha Traders');
    expect(prompt).toContain('MK 1,234,567');
    expect(prompt).toContain('LIVE BUSINESS DATA');
    expect(prompt).toContain('Lilongwe Foods');
  });

  it('keeps the data JSON inside its 16k budget even with a huge payload', () => {
    const huge: AiData = {
      ...data,
      overdueInvoices: Array.from({ length: 4000 }, (_, i) => ({
        invoice_id: `id-${i}`,
        invoice_number: `INV-${i}`,
        customer: `Customer number ${i} with a deliberately long trading name`,
        amount_outstanding: 1000 + i,
        issue_date: '2026-01-01',
        due_date: '2026-02-01',
        days_overdue: i,
      })),
    };
    const prompt = buildSystemPrompt({ ...ctx, data: huge });
    const jsonPart = prompt.split('LIVE BUSINESS DATA (JSON):\n')[1]?.split('\n\nPRODUCT KNOWLEDGE BASE')[0] ?? '';
    expect(jsonPart.length).toBeLessThanOrEqual(16_000);
  });

  it('works without live data (support mode)', () => {
    const prompt = buildSystemPrompt(supportCtx);
    expect(prompt).toContain('No live business data');
    expect(prompt).toContain('PRODUCT KNOWLEDGE BASE');
  });
});
