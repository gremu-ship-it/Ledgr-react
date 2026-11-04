import { repos } from '@/lib/repositories';

export interface FxRevaluationResult {
  journalEntryId: string | null;
  lineCount: number;
  totalUnrealisedGain: number;
  totalUnrealisedLoss: number;
}

/**
 * Backward-compatible entry point for period management and other existing
 * callers. The dedicated repository/RPC owns the transaction so the posted
 * journal entry and revaluation history row are committed atomically.
 */
export async function runFxRevaluation(
  businessId: string,
  revaluationDate: string,
  userId: string | null,
): Promise<FxRevaluationResult> {
  if (!userId) throw new Error('You must be signed in to run FX revaluation.');
  const result = await repos.fxRevaluation.runRevaluation(businessId, revaluationDate);
  return {
    journalEntryId: result.journalEntryId,
    lineCount: result.lineCount,
    totalUnrealisedGain: result.totalUnrealisedGain,
    totalUnrealisedLoss: result.totalUnrealisedLoss,
  };
}
