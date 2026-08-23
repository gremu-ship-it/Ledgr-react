import { Assistant } from '@/components/ai/Assistant';

/**
 * Full-page Ledgr AI.
 *
 * This is the SAME unified assistant component that AppLayout mounts as the
 * floating drawer — rendered to fill the route and starting on the Ledgr AI
 * tab. Chat, health cards, anomaly cards and the cash-flow forecast (built
 * by `src/lib/ai/forecast.ts` from the live `ai_context` payload) all come
 * from that one component, with the local knowledge base as the automatic
 * fallback when the remote assistant is unreachable.
 */
export function AiInsightsPage() {
  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] min-h-[480px] max-w-3xl flex-col rounded-2xl border border-gray-200 bg-white shadow-sm">
      <Assistant variant="page" initialMode="ai" />
    </div>
  );
}
