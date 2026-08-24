/**
 * Single source of truth for journal entry numbers.
 *
 * Phase 10.4 introduced a DB sequence (`next_journal_entry_number`) so
 * numbers stay unique across devices and clock skew. Three services had
 * independently re-implemented the fallback (and inventory still used the
 * local clock). All posting paths now go through this module.
 */
import { repos } from '@/lib/repositories';
import { createLogger } from '@/lib/logger';

const log = createLogger('JournalNumber');

export function formatFallbackJournalNumber(now = new Date()): string {
  const stamp =
    `${now.getFullYear()}` +
    `${String(now.getMonth() + 1).padStart(2, '0')}` +
    `${String(now.getDate()).padStart(2, '0')}` +
    `${String(now.getHours()).padStart(2, '0')}` +
    `${String(now.getMinutes()).padStart(2, '0')}` +
    `${String(now.getSeconds()).padStart(2, '0')}`;
  return `JNL-${stamp}`;
}

export function composeJournalEntryNumber(base: string, suffix?: string): string {
  if (!suffix) return base;
  const clean = suffix.replace(/^-+/, '');
  return clean ? `${base}-${clean}` : base;
}

type RpcClient = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

async function reserveFromDatabase(businessId: string): Promise<string | null> {
  try {
    const { data, error } = await (repos.journal.db as unknown as RpcClient).rpc(
      'next_journal_entry_number',
      { p_business_id: businessId },
    );
    if (!error && typeof data === 'string' && data) return data;
    if (error) {
      log.warn('next_journal_entry_number RPC failed — using timestamp fallback', {
        businessId,
        error: error.message,
      });
    }
  } catch (err) {
    log.warn('next_journal_entry_number RPC threw — using timestamp fallback', {
      businessId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return null;
}

/**
 * Reserve the next journal entry number for `businessId`.
 *
 * `suffix` is optional and only used to label companion entries
 * (e.g. `COGS`, `GRN`) — uniqueness already comes from the sequence.
 */
export async function nextEntryNumber(businessId: string, suffix?: string): Promise<string> {
  const reserved = await reserveFromDatabase(businessId);
  return composeJournalEntryNumber(reserved ?? formatFallbackJournalNumber(), suffix);
}
