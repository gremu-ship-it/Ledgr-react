import { useQuery } from '@tanstack/react-query';
import { BranchRepository } from '@/dal/repositories/BranchRepository';
import { supabase } from '@/lib/supabase';

const branchRepository = new BranchRepository(supabase);

export function useAccessibleReportBranches(businessId: string) {
  return useQuery({
    queryKey: ['trial-balance-branches', businessId],
    queryFn: () => branchRepository.findActive(businessId),
    enabled: Boolean(businessId),
    staleTime: 5 * 60 * 1000,
  });
}
