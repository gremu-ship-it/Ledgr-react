/**
 * Ledgr AI conversational chat service.
 *
 * The Edge Function is the preferred answer source; when it is unavailable the
 * same answers are produced locally so the assistant never dead-ends. All copy
 * comes from the English catalog in `ai.chat.*` (other locales fall back to it).
 */

import { i18n } from '@/i18n';
import { supabase } from '@/lib/supabase';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  actionUrl?: string;
  actionLabel?: string;
}

export interface BusinessContextSnapshot {
  businessId: string;
  businessName: string;
  currency: string;
  operatingModels: string[];
  plan: string;
  currentRoute: string;
}

export interface AiChatResponse {
  content: string;
  actionUrl?: string;
  actionLabel?: string;
}

const tr = (key: string, options?: Record<string, unknown>) => String(i18n.t(key, options));

/** Contextual suggestion chips based on the active route. */
export function getContextualPromptChips(currentRoute: string): string[] {
  if (currentRoute.includes('/manufacturing')) {
    return [
      tr('ai.chat.chips.manufacturingLabor'),
      tr('ai.chat.chips.manufacturingMarkup'),
      tr('ai.chat.chips.manufacturingScrap'),
    ];
  }
  if (currentRoute.includes('/construction')) {
    return [
      tr('ai.chat.chips.constructionRetention'),
      tr('ai.chat.chips.constructionRfi'),
      tr('ai.chat.chips.constructionDelivery'),
    ];
  }
  if (currentRoute.includes('/pos') || currentRoute.includes('/inventory') || currentRoute.includes('/products')) {
    return [
      tr('ai.chat.chips.posThermal'),
      tr('ai.chat.chips.posBarcode'),
      tr('ai.chat.chips.posCsv'),
    ];
  }
  if (
    currentRoute.includes('/reports')
    || currentRoute.includes('/accounts')
    || currentRoute.includes('/invoices')
  ) {
    return [
      tr('ai.chat.chips.reportsWorkingCapital'),
      tr('ai.chat.chips.reportsVat'),
      tr('ai.chat.chips.reportsJournals'),
    ];
  }
  if (currentRoute.includes('/payroll')) {
    return [
      tr('ai.chat.chips.payrollPaye'),
      tr('ai.chat.chips.payrollReversal'),
      tr('ai.chat.chips.payrollPayslips'),
    ];
  }

  return [
    tr('ai.chat.chips.generalEquity'),
    tr('ai.chat.chips.generalStages'),
    tr('ai.chat.chips.generalOffline'),
    tr('ai.chat.chips.generalPnl'),
  ];
}

/**
 * Intelligent fallback engine for ERP guidance, accounting math and navigation.
 * Exported so the rule table can be unit-tested directly.
 */
export function getIntelligentFallbackResponse(
  userPrompt: string,
  context: BusinessContextSnapshot,
): AiChatResponse {
  const query = userPrompt.toLowerCase();

  if (
    query.includes('markup')
    || query.includes('margin')
    || query.includes('costing')
    || query.includes('cost')
    || query.includes('bom')
  ) {
    return {
      content: tr('ai.chat.fallback.cost'),
      actionUrl: '/manufacturing/costing',
      actionLabel: tr('ai.chat.actions.costing'),
    };
  }

  if (query.includes('construction') || query.includes('retention') || query.includes('payment certificate')) {
    return {
      content: tr('ai.chat.fallback.construction'),
      actionUrl: '/construction/payment-certificates',
      actionLabel: tr('ai.chat.actions.paymentCertificates'),
    };
  }

  if (query.includes('pos') || query.includes('barcode') || query.includes('thermal') || query.includes('receipt')) {
    return {
      content: tr('ai.chat.fallback.pos'),
      actionUrl: '/pos',
      actionLabel: tr('ai.chat.actions.pos'),
    };
  }

  if (query.includes('offline') || query.includes('desktop') || query.includes('install') || query.includes('lease')) {
    return {
      content: tr('ai.chat.fallback.offline'),
      actionUrl: '/dashboard',
      actionLabel: tr('ai.chat.actions.dashboard'),
    };
  }

  return {
    content: tr('ai.chat.fallback.general', { business: context.businessName }),
    actionUrl: '/insights',
    actionLabel: tr('ai.chat.actions.insights'),
  };
}

/** Sends a message to the Edge Function, falling back to the local engine. */
export async function sendAiChatMessage(
  messages: ChatMessage[],
  context: BusinessContextSnapshot,
): Promise<ChatMessage> {
  const latestUserMessage = messages[messages.length - 1]?.content || '';

  try {
    const { data, error } = await supabase.functions.invoke('ai-chat', {
      body: { messages, context },
    });

    if (!error && data && typeof data === 'object' && typeof data.content === 'string' && data.content) {
      const payload = data as { content: string; actionUrl?: unknown; actionLabel?: unknown };
      return {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        content: payload.content,
        timestamp: new Date().toISOString(),
        actionUrl: typeof payload.actionUrl === 'string' ? payload.actionUrl : undefined,
        actionLabel: typeof payload.actionLabel === 'string' ? payload.actionLabel : undefined,
      };
    }
  } catch {
    // Gracefully fall through to the local rule engine.
  }

  const response = getIntelligentFallbackResponse(latestUserMessage, context);
  return {
    id: `ai-${Date.now()}`,
    role: 'assistant',
    content: response.content,
    timestamp: new Date().toISOString(),
    actionUrl: response.actionUrl,
    actionLabel: response.actionLabel,
  };
}
