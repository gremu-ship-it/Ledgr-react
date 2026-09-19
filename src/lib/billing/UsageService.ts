import { supabase } from '@/lib/supabase';
import { repos } from '@/lib/repositories';
import { getPlan, normalizePlanTier, type PlanTier } from './plans';
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

/** Document tables that each cost one monthly transaction. */
type DocumentTable = 'invoices' | 'expenses' | 'payroll_runs';
type DocumentDateColumn = 'issue_date' | 'expense_date' | 'pay_date';

export class UsageService {
  /**
   * Count one document table for a date window.
   *
   * Returns 0 when the count itself fails. Callers use this to decide whether
   * to refuse a save, and refusing a sale because a count query timed out
   * would be worse than letting a soft limit slide — the quick-save RPC
   * asserts the same limit server-side for the flows that go through it.
   */
  private async countDocuments(
    table: DocumentTable,
    dateColumn: DocumentDateColumn,
    businessId: string,
    fromDate: string,
    toDate?: string,
  ): Promise<number> {
    let query = supabase
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('business_id', businessId)
      .gte(dateColumn, fromDate);
    if (toDate) query = query.lte(dateColumn, toDate);

    const { count, error } = await query;
    if (error) {
      log.error(`Failed to count ${table}`, error as Error);
      return 0;
    }
    return count ?? 0;
  }

  /**
   * Documents created this month — the unit the pricing page sells
   * ("200 transactions a month").
   *
   * This used to count `journal_entries`, which overstated usage several-fold:
   * one till sale posts a sale entry, an auto-receipt and (for stocked items) a
   * COGS entry, so a 200-transaction plan ran out after roughly 70 real sales.
   * A transaction is one document: an invoice, an expense or a payroll run.
   */
  async getCurrentMonthTransactionCount(businessId: string): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);

    const [invoices, expenses, payrollRuns] = await Promise.all([
      this.countDocuments('invoices', 'issue_date', businessId, startOfMonth),
      this.countDocuments('expenses', 'expense_date', businessId, startOfMonth),
      this.countDocuments('payroll_runs', 'pay_date', businessId, startOfMonth),
    ]);

    return invoices + expenses + payrollRuns;
  }

  /**
   * Transactions used this month.
   *
   * Kept under the old name because the billing screens call it, but it now
   * means documents — the same thing the plan limit is enforced against.
   */
  async getCurrentMonthUsage(businessId: string): Promise<number> {
    return this.getCurrentMonthTransactionCount(businessId);
  }

  /**
   * Get full usage stats including plan limits
   */
  async getUsageStats(businessId: string, planTier: PlanTier): Promise<UsageStats> {
    const currentMonth = await this.getCurrentMonthTransactionCount(businessId);
    const plan = getPlan(planTier);
    const limit = plan.transactionLimit;
    const isUnlimited = limit === null;

    let remaining: number | null = null;
    let percentUsed = 0;
    let canCreate = true;

    if (!isUnlimited && limit !== null) {
      remaining = Math.max(0, limit - currentMonth);
      // One decimal, not a whole percent: a business with 8 documents of a
      // 2,000 plan is at 0.4%, and rounding that to 0 made the meter — and the
      // 80%/100% thresholds — read as if nothing had been used at all. The
      // meter rounds its own label; this keeps the thresholds honest.
      percentUsed = Math.min(100, Math.round((currentMonth / limit) * 1000) / 10);
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
   * Throws when the business has used up its monthly transaction allowance.
   *
   * Call this BEFORE writing a document. It used to run from the journal
   * posting instead — i.e. after the invoice row existed — so tripping it left
   * a saved sale with no ledger entry behind (and, on the sync path, a queue
   * item that failed forever while its document sat on the books).
   *
   * Fails open: if the plan lookup or the count cannot be read, the save goes
   * ahead. A soft plan limit is not worth losing a sale over.
   */
  async assertWithinTransactionLimit(businessId: string): Promise<void> {
    const [business, used] = await Promise.all([
      supabase.from('businesses').select('plan_tier').eq('id', businessId).maybeSingle(),
      this.getCurrentMonthTransactionCount(businessId),
    ]);

    if (business.error || !business.data) {
      if (business.error) log.error('Failed to read plan tier', business.error as Error);
      return;
    }

    const plan = getPlan(normalizePlanTier(business.data.plan_tier));
    if (plan.transactionLimit === null) return;

    if (used >= plan.transactionLimit) {
      throw new Error(
        `Monthly transaction limit reached (${plan.transactionLimit}). Please upgrade your plan.`,
      );
    }
  }

  /**
   * Plan-limit guard for a flow that creates a document, tolerating replays.
   *
   * A retry of a save whose document already committed (the queue replaying a
   * sale whose ledger half failed, a lost response) must not be blocked by the
   * limit: the document is already on the books and refusing to continue would
   * strand it half-posted. `clientKey` — and the table that key was minted
   * for — is how those flows identify themselves.
   */
  async assertCanCreateDocument(
    businessId: string,
    clientKey?: string,
    documentKind: 'invoice' | 'expense' | 'payroll' = 'invoice',
  ): Promise<void> {
    try {
      await this.assertWithinTransactionLimit(businessId);
    } catch (err) {
      if (clientKey) {
        const existing = await this.findDocumentByClientKey(businessId, clientKey, documentKind);
        if (existing) return; // replay of an already-committed document
      }
      throw err;
    }
  }

  /**
   * The document a client key already produced, whichever table it belongs to.
   * A miss (or a lookup error) means "not a replay" — the caller then keeps the
   * limit error rather than letting the save through.
   */
  private async findDocumentByClientKey(
    businessId: string,
    clientKey: string,
    documentKind: 'invoice' | 'expense' | 'payroll',
  ): Promise<unknown | null> {
    try {
      if (documentKind === 'expense') {
        return await repos.expense.findByClientKey(businessId, clientKey);
      }
      if (documentKind === 'payroll') {
        return await repos.payroll.findByClientKey(businessId, clientKey);
      }
      return await repos.invoice.findByClientKey(businessId, clientKey);
    } catch (lookupError) {
      log.warn('Could not check whether this save is a replay', {
        documentKind,
        error: lookupError instanceof Error ? lookupError.message : String(lookupError),
      });
      return null;
    }
  }

  /**
   * Record a transaction (called after successful journal entry creation)
   * This can be used for analytics or future overage billing
   */
  async recordTransaction(businessId: string, type: 'journal' | 'invoice' | 'expense') {
    // Usage is counted from the document tables, so there is nothing to write.
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

      const [invoices, expenses, payrollRuns] = await Promise.all([
        this.countDocuments('invoices', 'issue_date', businessId, start, end),
        this.countDocuments('expenses', 'expense_date', businessId, start, end),
        this.countDocuments('payroll_runs', 'pay_date', businessId, start, end),
      ]);

      history.push({
        month: date.toLocaleString('default', { month: 'short' }),
        count: invoices + expenses + payrollRuns,
      });
    }

    return history;
  }
}

export const usageService = new UsageService();
