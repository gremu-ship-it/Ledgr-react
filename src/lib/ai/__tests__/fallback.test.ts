import { afterEach, describe, expect, it, vi } from 'vitest';
import { getProvider, getSupportProvider, remoteProvider } from '@/lib/ai/provider';
import { KNOWLEDGE_BASE } from '@/lib/ai/knowledge';
import type { AiData, ChatMessage, DataContext } from '@/lib/ai/types';

vi.mock('@/lib/supportAgent', () => ({
  callSupportAgent: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'test-token' } },
      }),
    },
  },
}));

import { callSupportAgent } from '@/lib/supportAgent';

const agent = vi.mocked(callSupportAgent);

const okAgentResponse = {
  content: 'Open the invoice from **/invoices** and hit Send.',
  actions: [{ label: 'Open Invoices', path: '/invoices', variant: 'primary' as const }],
  escalate: false,
  category: 'query' as const,
};

const supportCtx: DataContext = {
  companyName: 'Kwacha Traders',
  knowledgeBase: KNOWLEDGE_BASE,
};

/** Minimal live data so the rules engine renders performance/forecast answers. */
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
  monthlyTrend: [],
  overdueInvoices: [],
  topExpenses: [],
  topCustomers: [],
  concentration: null,
  anomalies: [],
  upcomingReceivables: [],
  upcomingPayables: [],
};

const aiCtx: DataContext = { companyName: 'Kwacha Traders', data, knowledgeBase: KNOWLEDGE_BASE };

const userMsg = (content: string): ChatMessage => ({ role: 'user', content });

afterEach(() => {
  agent.mockReset();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('getSupportProvider — support-agent with silent knowledge-base fallback', () => {
  it('returns the support-agent answer, including actions, when the function is healthy', async () => {
    agent.mockResolvedValueOnce(okAgentResponse);

    const answer = await getSupportProvider().answer(
      [userMsg('how do I send an invoice?')],
      { ...supportCtx, support: { category: 'query' } },
    );

    expect(answer.content).toBe(okAgentResponse.content);
    expect(answer.provider).toBe('support-agent');
    expect(answer.fallback).toBeFalsy();
    expect(answer.actions?.[0]?.path).toBe('/invoices');
    expect(agent).toHaveBeenCalledWith({
      messages: [userMsg('how do I send an invoice?')],
      category: 'query',
      context: undefined,
    });
  });

  it('forwards the selected category and attached diagnostics to the agent', async () => {
    const diagnostics = {
      errors: [{ message: 'boom', ts: new Date().toISOString(), kind: 'window.error' as const }],
      appVersion: '1.2.3',
      platform: 'test-agent',
      path: '/expenses',
    };
    agent.mockResolvedValueOnce(okAgentResponse);

    await getSupportProvider().answer(
      [userMsg('the app crashed')],
      { ...supportCtx, support: { category: 'error', context: diagnostics } },
    );

    expect(agent.mock.calls[0]?.[0].category).toBe('error');
    expect(agent.mock.calls[0]?.[0].context).toEqual(diagnostics);
  });

  it('falls back to the local knowledge base when the agent is unreachable — no throw, flagged answer', async () => {
    agent.mockRejectedValueOnce(new Error('edge function not deployed'));

    const answer = await getSupportProvider().answer(
      [userMsg('how do I create an invoice for a customer?')],
      { ...supportCtx, support: { category: 'query' } },
    );

    expect(answer.fallback).toBe(true);
    expect(answer.provider).toContain('ledgr-rules');
    // A real KB article, not an error message.
    expect(answer.content).toContain('**New Invoice**');
    expect(answer.content).not.toMatch(/couldn.t reach/i);
  });

  it('falls back when the agent answers with an empty body', async () => {
    agent.mockResolvedValueOnce({ ...okAgentResponse, content: '   ' });

    const answer = await getSupportProvider().answer(
      [userMsg('how do I record an expense?')],
      supportCtx,
    );

    expect(answer.fallback).toBe(true);
    expect(answer.content.length).toBeGreaterThan(40);
  });

  it('defaults to the query category when the payload is missing', async () => {
    agent.mockResolvedValueOnce(okAgentResponse);

    await getSupportProvider().answer([userMsg('hello')], supportCtx);

    expect(agent.mock.calls[0]?.[0].category).toBe('query');
  });
});

describe('remoteProvider — ai-chat with silent rules-engine fallback', () => {
  it('returns the remote answer when ai-chat is healthy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: 'Remote says the margins look good.', suggestions: ['Forecast my cash flow'] }),
    }));

    const answer = await remoteProvider('https://example.com/ai-chat').answer(
      [userMsg('how is my business doing?')],
      aiCtx,
    );

    expect(answer.content).toBe('Remote says the margins look good.');
    expect(answer.fallback).toBeFalsy();
  });

  it('falls back to the offline rules engine when fetch fails — answer still grounded in live data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const answer = await remoteProvider('https://example.com/ai-chat').answer(
      [userMsg('how is my business doing?')],
      aiCtx,
    );

    expect(answer.fallback).toBe(true);
    expect(answer.provider).toContain('offline fallback');
    expect(answer.content).toContain('MK 10,000,000');
    expect(answer.content).not.toMatch(/couldn.t reach/i);
  });

  it('falls back when ai-chat returns a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));

    const answer = await remoteProvider('https://example.com/ai-chat').answer(
      [userMsg('which invoices are overdue?')],
      aiCtx,
    );

    expect(answer.fallback).toBe(true);
    expect(answer.content.length).toBeGreaterThan(20);
  });
});

describe('getProvider — selection', () => {
  it('uses the remote ai-chat provider when VITE_AI_CHAT_URL is set', () => {
    vi.stubEnv('VITE_AI_CHAT_URL', 'https://example.com/ai-chat');
    expect(getProvider().name).toBe('ledgr-ai');
  });

  it('uses the offline rules engine when no remote URL is configured', () => {
    vi.stubEnv('VITE_AI_CHAT_URL', '');
    expect(getProvider().name).toBe('ledgr-rules');
  });
});
