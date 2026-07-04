import { useQuery } from '@tanstack/react-query';
import { repos } from '@/lib/repositories';
import type { Row } from '@/dal/types/database';

export interface JournalEntryWithLock extends Row<'journal_entries'> {
  isLocked: boolean;
}

export function useJournalEntries(businessId?: string, from?: string, to?: string) {
  return useQuery({
    queryKey: ['journal', 'all', businessId, from, to],
    queryFn: async (): Promise<JournalEntryWithLock[]> => {
      const [rows, periods] = await Promise.all([
        repos.journal.findByBusinessAndDateRange(businessId!, from!, to!),
        repos.period.findByBusiness(businessId!),
      ]);
      const lockedPeriodIds = new Set(periods.filter((p) => p.is_closed).map((p) => p.id));
      return rows.map((entry) => ({
        ...entry,
        isLocked: entry.period_id ? lockedPeriodIds.has(entry.period_id) : false,
      }));
    },
    enabled: Boolean(businessId && from && to),
    staleTime: 1000 * 60 * 5,
  });
}