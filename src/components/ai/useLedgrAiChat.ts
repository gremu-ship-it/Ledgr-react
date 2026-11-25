import { useCallback, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/store/useAppStore';
import {
  getContextualPromptChips,
  sendAiChatMessage,
  type BusinessContextSnapshot,
  type ChatMessage,
} from '@/services/aiChatService';

let sequence = 0;
const nextId = () => {
  sequence += 1;
  return `chat-${sequence}`;
};

/** Shared conversational state for the drawer and the embedded console. */
export function useLedgrAiChat() {
  const { t } = useTranslation();
  const location = useLocation();
  const business = useAppStore((s) => s.currentBusiness?.business);

  const context = useMemo<BusinessContextSnapshot>(() => ({
    businessId: business?.id ?? '',
    businessName: business?.name ?? t('ai.yourBusiness'),
    currency: business?.base_currency ?? 'MWK',
    operatingModels: [...(business?.operating_models ?? [])],
    plan: business?.plan_tier ?? 'free',
    currentRoute: location.pathname,
  }), [business, location.pathname, t]);

  const welcome = useMemo<ChatMessage>(() => ({
    id: 'chat-welcome',
    role: 'assistant',
    content: t('ai.chat.welcome', { business: context.businessName }),
    timestamp: new Date().toISOString(),
  }), [context.businessName, t]);

  const [messages, setMessages] = useState<ChatMessage[]>(() => [welcome]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chips = useMemo(() => getContextualPromptChips(location.pathname), [location.pathname]);

  const send = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || isThinking) return;

    const userMessage: ChatMessage = {
      id: nextId(),
      role: 'user',
      content: question,
      timestamp: new Date().toISOString(),
    };
    const conversation = [...messages, userMessage];
    setMessages(conversation);
    setInput('');
    setError(null);
    setIsThinking(true);
    try {
      const reply = await sendAiChatMessage(conversation, context);
      setMessages((current) => [...current, reply]);
    } catch {
      const failure: ChatMessage = {
        id: nextId(),
        role: 'assistant',
        content: t('ai.chat.error'),
        timestamp: new Date().toISOString(),
      };
      setMessages((current) => [...current, failure]);
      setError(t('ai.chat.error'));
    } finally {
      setIsThinking(false);
    }
  }, [context, isThinking, messages, t]);

  const clear = useCallback(() => {
    setMessages([{ ...welcome, id: nextId() }]);
    setInput('');
    setError(null);
    setIsThinking(false);
  }, [welcome]);

  return {
    messages,
    input,
    setInput,
    send,
    clear,
    isThinking,
    error,
    chips,
    context,
    isEnterprise: business?.plan_tier === 'enterprise',
  };
}
