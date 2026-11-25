import { beforeEach, describe, expect, it, vi } from 'vitest';

const aiApi = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/lib/supabase', () => ({
  supabase: { functions: { invoke: aiApi.invoke } },
}));

import '@/i18n';
import {
  getContextualPromptChips,
  getIntelligentFallbackResponse,
  sendAiChatMessage,
  type BusinessContextSnapshot,
  type ChatMessage,
} from '../aiChatService';

const context: BusinessContextSnapshot = {
  businessId: 'business-1',
  businessName: 'Ledger Ltd',
  currency: 'MWK',
  operatingModels: ['MANUFACTURING'],
  plan: 'enterprise',
  currentRoute: '/manufacturing/costing',
};

const userMessage = (content: string): ChatMessage => ({
  id: 'user-1',
  role: 'user',
  content,
  timestamp: new Date().toISOString(),
});

beforeEach(() => {
  aiApi.invoke.mockReset();
});

describe('getContextualPromptChips', () => {
  it('serves costing prompts on manufacturing routes', () => {
    expect(getContextualPromptChips('/manufacturing/costing')).toEqual([
      'How to calculate direct labor and BOM overhead?',
      'Explain difference between markup % and gross margin %',
      'How do scrap factors affect unit production cost?',
    ]);
  });

  it('serves retention/RFI prompts on construction routes', () => {
    expect(getContextualPromptChips('/construction/payment-certificates')).toEqual([
      'How does retention aging work on payment certificates?',
      'What is the difference between RFI and Change Order?',
      'How to match delivery notes to supplier bills?',
    ]);
  });

  it('serves receipt/scanner/CSV prompts on POS and product routes', () => {
    expect(getContextualPromptChips('/pos')).toEqual([
      'How do I set up 80mm thermal receipt printing?',
      'How to scan barcodes using a mobile phone camera?',
      'How to bulk import products via CSV?',
    ]);
    expect(getContextualPromptChips('/products')).toHaveLength(3);
  });

  it('serves accounting prompts on report, account and invoice routes', () => {
    for (const route of ['/reports', '/accounts', '/invoices']) {
      expect(getContextualPromptChips(route)).toEqual([
        'What is the formula for Working Capital ratio?',
        'Explain VAT output tax vs VAT input tax recovery',
        'How are unbalanced journal entries prevented in Ledgr?',
      ]);
    }
  });

  it('serves payroll prompts and a general set elsewhere', () => {
    expect(getContextualPromptChips('/payroll/pay-runs')[0]).toBe('How is PAYE tax calculated on salaries?');
    expect(getContextualPromptChips('/dashboard')).toEqual([
      'How do I issue shares and record equity capital?',
      'What are the 11 Construction workflow stages in Ledgr?',
      'How does local-first offline desktop sync work?',
      'Help me understand my profit and loss report',
    ]);
  });
});

describe('getIntelligentFallbackResponse', () => {
  it('answers costing and pricing questions with both formulas and a deep link', () => {
    const answer = getIntelligentFallbackResponse('Explain markup vs gross margin', context);
    expect(answer.content).toContain('Manufacturing Costing & Pricing Formulas');
    expect(answer.content).toContain('\\frac{\\text{Total Unit Cost}}{1 - \\text{Target Margin \\%}}');
    expect(answer.content).toContain('\\times (1 + \\text{Markup \\%})');
    expect(answer.actionUrl).toBe('/manufacturing/costing');
    expect(answer.actionLabel).toBe('Open Costing & Pricing Engine');
  });

  it('answers construction retention questions with the 11 workflow stages', () => {
    const answer = getIntelligentFallbackResponse('How does retention aging work?', context);
    expect(answer.content).toContain('Ledgr provides all 11 workflow items in sequence');
    expect(answer.actionUrl).toBe('/construction/payment-certificates');
    expect(answer.actionLabel).toBe('View Payment Certificates');
  });

  it('answers POS printing and barcode questions', () => {
    const answer = getIntelligentFallbackResponse('set up an 80mm thermal receipt printer', context);
    expect(answer.content).toContain('80mm');
    expect(answer.content).toContain('EAN-13');
    expect(answer.actionUrl).toBe('/pos');
    expect(answer.actionLabel).toBe('Open POS Terminal');
  });

  it('answers offline desktop questions', () => {
    const answer = getIntelligentFallbackResponse('How does offline desktop sync work?', context);
    expect(answer.content).toContain('14-day offline lease token');
    expect(answer.actionUrl).toBe('/dashboard');
  });

  it('gives a business-aware general accounting answer by default', () => {
    const answer = getIntelligentFallbackResponse('Help me understand my profit and loss', context);
    expect(answer.content).toContain('Ledger Ltd');
    expect(answer.content).toContain('Financial Analysis');
    expect(answer.actionUrl).toBe('/insights');
  });
});

describe('sendAiChatMessage', () => {
  it('uses the Edge Function response when it succeeds', async () => {
    aiApi.invoke.mockResolvedValue({
      data: { content: 'From the Edge Function', actionUrl: '/reports', actionLabel: 'View Reports' },
      error: null,
    });

    const messages = [userMessage('What is working capital?')];
    const reply = await sendAiChatMessage(messages, context);

    expect(aiApi.invoke).toHaveBeenCalledWith('ai-chat', { body: { messages, context } });
    expect(reply).toMatchObject({
      role: 'assistant',
      content: 'From the Edge Function',
      actionUrl: '/reports',
      actionLabel: 'View Reports',
    });
    expect(reply.id).toMatch(/^ai-\d+$/);
    expect(Number.isNaN(Date.parse(reply.timestamp))).toBe(false);
  });

  it('falls back locally when the Edge Function throws', async () => {
    aiApi.invoke.mockRejectedValue(new Error('offline'));
    const reply = await sendAiChatMessage([userMessage('how do scrap factors affect cost?')], context);
    expect(reply.content).toContain('Direct Materials');
    expect(reply.actionUrl).toBe('/manufacturing/costing');
    expect(reply.role).toBe('assistant');
  });

  it('falls back locally when the Edge Function returns an error', async () => {
    aiApi.invoke.mockResolvedValue({ data: null, error: new Error('not deployed') });
    const reply = await sendAiChatMessage([userMessage('show me construction workflows')], context);
    expect(reply.content).toContain('11 workflow items');
    expect(reply.actionUrl).toBe('/construction/payment-certificates');
  });

  it('handles an empty conversation without crashing', async () => {
    aiApi.invoke.mockResolvedValue({ data: null, error: null });
    const reply = await sendAiChatMessage([], context);
    expect(reply.role).toBe('assistant');
    expect(reply.content).toContain('Ledger Ltd');
  });
});
