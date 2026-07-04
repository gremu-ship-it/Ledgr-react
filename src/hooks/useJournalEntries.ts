import { useQuery } from '@tanstack/react-query';
import { repos } from '@/lib/repositories';
import type { Row } from '@/dal/types/database';

export interface JournalEntryWithLock extends Row<'journal_entries'> {
  isLocked: boolean;
}

/**
 * FIX: journal_entries.period_id is not currently populated by
 * journalService.ts on any entry-creation path (confirmed via DB query:
 * 0 of 21 existing entries have period_id set). Locking detection must
 * therefore be based on entry_date falling within a locked period's
 * [period_start, period_end] range — the same logic the DB trigger
 * fn_check_period_not_locked already uses — rather than the period_id FK,
 * which cannot be relied upon for existing or future entries until
 * journalService.ts is separately fixed to populate it.
 */
function isDateInLockedPeriod(
  entryDate: string,
  lockedRanges: { period_start: string; period_end: string }[],
): boolean {
  return lockedRanges.some(
    (r) => entryDate >= r.period_start && entryDate <= r.period_end,
  );
}

export function useJournalEntries(businessId?: string, from?: string, to?: string) {
  return useQuery({
    queryKey: ['journal', 'all', businessId, from, to],
    queryFn: async (): Promise<JournalEntryWithLock[]> => {
      const [rows, periods] = await Promise.all([
        repos.journal.findByBusinessAndDateRange(businessId!, from!, to!),
        repos.period.findByBusiness(businessId!),
      ]);
      const lockedRanges = periods
        .filter((p) => p.is_closed)
        .map((p) => ({ period_start: p.period_start, period_end: p.period_end }));

      return rows.map((entry) => ({
        ...entry,
        isLocked: isDateInLockedPeriod(entry.entry_date, lockedRanges),
      }));
    },
    enabled: Boolean(businessId && from && to),
    staleTime: 1000 * 60 * 5,
  });
}