import { useAppStore } from '@/store/useAppStore';
import { useUsage } from '@/hooks/useUsage';
import { hasCapability } from '@/lib/billing/plans';
import { isFeatureEnabled } from '@/lib/featureFlags';
import { AssistantDrawer } from './AssistantDrawer';

/**
 * Mount point for Ledgr AI's floating launcher (see AppLayout).
 *
 * The Support Assistant is always available through SupportWidget; this widget
 * adds the data-aware assistant, which needs (a) the `ai_agent` feature flag,
 * (b) a business in scope and (c) the `ai_insights` plan capability — the same
 * gate that guards the /ai page.
 */
export function AssistantWidget() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const { planTier } = useUsage();

  if (!isFeatureEnabled('ai_agent')) return null;
  if (!currentBusiness?.business?.id) return null;
  if (!hasCapability(planTier, 'ai_insights')) return null;

  return <AssistantDrawer mode="ai" companyName={currentBusiness.business.name} />;
}
