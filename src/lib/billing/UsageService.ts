import { supabase } from '@/lib/supabase';
import { getPlan, type PlanTier } from './plans';
import { createLogger } from '@/lib/logger';

const log = createLogger('UsageService');

export interface UsageStats {
  currentMonth: number;
  limit: number | null;
  remaining: number | null;
  percentUsed: number;
  isUnlimited: boolean;
  canCreate: boolean;
}

export class UsageService {
  /**
   * Get current month's transaction count for a business
   */
  async getCurrentMonthUsage(businessId: string): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

    const { count, error } = await supabase
      .from('journal_entries')
      .select('*', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .gte('entry_date', startOfMonth);

    if (error) {
      log.error('Failed to count usage', error as Error);
      return 0;
    }

    return count || 0;
  }

  /**
   * Get full usage stats including plan limits
   */
  async getUsageStats(businessId: string, planTier: PlanTier): Promise<UsageStats> {
    const currentMonth = await this.getCurrentMonthUsage(businessId);
    const plan = getPlan(planTier);
    const limit = plan.transactionLimit;
    const isUnlimited = limit === null;

    let remaining: number | null = null;
    let percentUsed = 0;
    let canCreate = true;

    if (!isUnlimited && limit !== null) {
      remaining = Math.max(0, limit - currentMonth);
      percentUsed = Math.min(100, Math.round((currentMonth / limit) * 100));
      canCreate = currentMonth < limit;
    }

    return {
      currentMonth,
      limit,
      remaining,
      percentUsed,
      isUnlimited,
      canCreate,
    };
  }

  /**
   * Check if a business can create a new transaction
   */
  async canCreateTransaction(businessId: string, planTier: PlanTier): Promise<boolean> {
    const stats = await this.getUsageStats(businessId, planTier);
    return stats.canCreate;
  }

  /**
   * Record a transaction (called after successful journal entry creation)
   * This can be used for analytics or future overage billing
   */
  async recordTransaction(businessId: string, type: 'journal' | 'invoice' | 'expense') {
    // For now we just count journal_entries.
    // In the future we can store this in a usage_logs table.
    log.debug('Transaction recorded', { type, businessId });
  }

  /**
   * Get usage for the last 3 months (for charts)
   */
  async getUsageHistory(businessId: string, months = 3) {
    const history: { month: string; count: number }[] = [];
    const now = new Date();

    for (let i = months - 1; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = date.toISOString().slice(0, 10);
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().slice(0, 10);

      const { count } = await supabase
        .from('journal_entries')
        .select('*', { count: 'exact', head: true })
        .eq('business_id', businessId)
        .gte('entry_date', start)
        .lte('entry_date', end);

      history.push({
        month: date.toLocaleString('default', { month: 'short' }),
        count: count || 0,
      });
    }

    return history;
  }
}

export const usageService = new UsageService();